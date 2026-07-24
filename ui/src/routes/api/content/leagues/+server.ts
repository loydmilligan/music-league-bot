import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

const B_SIDE_BASE = (process.env.PUBLIC_DIGEST_BASE_URL ?? 'https://digest.mattmariani.com').replace(/\/+$/, '');

interface LeagueRow {
	id: number;
	slug: string;
	name: string;
}

interface SiteRow {
	slug: string;
	season: number;
	archived_rounds: string;
	refreshed_at: string;
}

interface RoundRow {
	id: number;
	name: string;
	voting_deadline: string | null;
}

interface WinnerRow {
	round_id: number;
	winner_title: string;
	winner_artists: string;
	winner_player_name: string | null;
	pts: number;
}

interface VoteCountRow {
	round_id: number;
	total_votes: number;
}

interface MemberCountRow {
	league_id: number;
	member_count: number;
}

// GET /api/content/leagues — one row per league + b-side state + pending flag.
// pending = a finalized digest_drafts row whose round_id is NOT in archived_rounds.
export const GET: RequestHandler = async () => {
	const db = getDb();

	const leagues = db.prepare('SELECT id, slug, name FROM leagues ORDER BY id').all() as LeagueRow[];

	// Member counts per league (distinct people who have submitted).
	//
	// Counts by player_id when the competitor is linked to a players row, and
	// falls back to the competitor's own id otherwise — a competitor who joined
	// after the last player-seeding run has player_id NULL, and the old
	// `WHERE c.player_id IS NOT NULL` filter silently dropped them (Boarz showed
	// 8 members for 9 people). The fallback is negated so a competitor id can
	// never collide with a player id and merge two distinct members into one.
	const memberCounts = db
		.prepare(
			`SELECT se.league_id, COUNT(DISTINCT COALESCE(c.player_id, -c.id)) AS member_count
			 FROM ml_submissions s
			 JOIN competitors c ON c.id = s.competitor_id
			 JOIN rounds r ON r.id = s.round_id
			 JOIN seasons se ON se.id = r.season_id
			 GROUP BY se.league_id`,
		)
		.all() as MemberCountRow[];
	const memberCountMap = new Map(memberCounts.map((r) => [r.league_id, r.member_count]));

	// All dashboard_sites keyed by league_id
	const sites = db
		.prepare('SELECT league_id, slug, season, archived_rounds, refreshed_at FROM dashboard_sites')
		.all() as (SiteRow & { league_id: number })[];
	const siteMap = new Map(sites.map((s) => [s.league_id, s]));

	// All finalized draft round_ids — use MAX(finalized_at) per round to get the latest
	// re-finalization time (a round can be re-finalized after the site was last built).
	const finalizedRows = db
		.prepare(
			`SELECT se.league_id, dd.round_id, r.name AS round_name, r.voting_deadline,
			        MAX(dd.finalized_at) AS finalized_at
			 FROM digest_drafts dd
			 JOIN rounds r ON r.id = dd.round_id
			 JOIN seasons se ON se.id = r.season_id
			 WHERE dd.finalized_at IS NOT NULL
			 GROUP BY se.league_id, dd.round_id, r.name, r.voting_deadline
			 ORDER BY se.league_id, dd.round_id`,
		)
		.all() as {
		league_id: number;
		round_id: number;
		round_name: string;
		voting_deadline: string | null;
		finalized_at: string;
	}[];

	// For each league, find the most-recent pending round.
	// A round is PENDING if: it's not in archived_rounds (new), OR its finalized_at is
	// newer than the site's refreshed_at (re-finalized after the last build).
	const pendingByLeague = new Map<
		number,
		{ roundId: number; roundName: string; closedAt: string | null; finalizedAt: string }
	>();
	for (const row of finalizedRows) {
		const site = siteMap.get(row.league_id);
		if (!site) continue; // not published yet
		const archived: number[] = JSON.parse(site.archived_rounds);
		const finalizedAt = new Date(row.finalized_at);
		const refreshedAt = new Date(site.refreshed_at);
		const isPending = !archived.includes(row.round_id) || finalizedAt > refreshedAt;
		if (!isPending) continue;

		// Keep most-recent pending by finalized_at; fall back to round_id on ties
		const existing = pendingByLeague.get(row.league_id);
		const existingFinalizedAt = existing ? new Date(existing.finalizedAt) : null;
		if (
			!existing ||
			finalizedAt > existingFinalizedAt! ||
			(finalizedAt.getTime() === existingFinalizedAt!.getTime() && row.round_id > existing.roundId)
		) {
			pendingByLeague.set(row.league_id, {
				roundId: row.round_id,
				roundName: row.round_name,
				closedAt: row.voting_deadline,
				finalizedAt: row.finalized_at,
			});
		}
	}

	// Winner info for pending rounds
	const pendingRoundIds = [...pendingByLeague.values()].map((v) => v.roundId);
	const winnerMap = new Map<number, { title: string; artists: string; submitter: string }>();
	const voteMap = new Map<number, number>();
	if (pendingRoundIds.length > 0) {
		const phs = pendingRoundIds.map(() => '?').join(',');

		const winnerRows = db
			.prepare(
				`SELECT sub.round_id, sub.title AS winner_title, sub.artists AS winner_artists,
				        p.name AS winner_player_name,
				        COALESCE(SUM(v.points), 0) AS pts
				 FROM ml_submissions sub
				 LEFT JOIN votes v ON v.round_id = sub.round_id AND v.spotify_uri = sub.spotify_uri
				 LEFT JOIN competitors c ON c.id = sub.competitor_id
				 LEFT JOIN players p ON p.id = c.player_id
				 WHERE sub.round_id IN (${phs})
				 GROUP BY sub.id
				 ORDER BY sub.round_id, pts DESC`,
			)
			.all(...pendingRoundIds) as WinnerRow[];

		for (const row of winnerRows) {
			if (!winnerMap.has(row.round_id)) {
				winnerMap.set(row.round_id, {
					title: row.winner_title,
					artists: row.winner_artists,
					submitter: row.winner_player_name ?? '',
				});
			}
		}

		const voteRows = db
			.prepare(
				`SELECT round_id, COUNT(*) AS total_votes FROM votes WHERE round_id IN (${phs}) GROUP BY round_id`,
			)
			.all(...pendingRoundIds) as VoteCountRow[];
		for (const r of voteRows) voteMap.set(r.round_id, r.total_votes);
	}

	const result = leagues.map((league) => {
		const site = siteMap.get(league.id);
		const pending = pendingByLeague.get(league.id);
		const winner = pending ? winnerMap.get(pending.roundId) : undefined;

		return {
			id: league.id,
			slug: league.slug,
			name: league.name,
			members: memberCountMap.get(league.id) ?? 0,
			bside: site
				? {
						slug: site.slug,
						url: `${B_SIDE_BASE}/${site.slug}`,
						season: site.season,
						archivedCount: (JSON.parse(site.archived_rounds) as number[]).length,
						lastUpdated: site.refreshed_at,
					}
				: null,
			pending: pending
				? {
						roundId: pending.roundId,
						theme: pending.roundName,
						winnerSong: winner?.title ?? '',
						winnerArtist: winner?.artists ?? '',
						submitter: winner?.submitter ?? '',
						votes: voteMap.get(pending.roundId) ?? 0,
						closedAt: pending.closedAt,
					}
				: null,
		};
	});

	return json(result);
};
