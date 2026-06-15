import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { buildDeterministicSlices } from '$lib/dashboard/generators/deterministic.js';
import { buildOverlap } from '$lib/dashboard/generators/overlap.js';
import type { ReadModel } from '$lib/dashboard/buildReadModel.js';

const SECTIONS = ['superlatives', 'stats', 'fingerprints', 'moments', 'overlap'] as const;
type Section = (typeof SECTIONS)[number];
type SectionDecision = 'refresh' | 'hold' | 'lock';

interface SectionStateRow {
	section: string;
	decision: string;
	steer: string | null;
}

interface SiteRow {
	slug: string;
	season: number;
	archived_rounds: string;
	read_model: string;
}

// GET /api/content/:leagueId/update-plan
// Returns the "add this round" entry + the recompute sections with concrete-change details.
export const GET: RequestHandler = async ({ params }) => {
	const leagueId = Number(params.leagueId);
	if (!Number.isInteger(leagueId) || leagueId <= 0) throw error(400, 'invalid leagueId');

	const db = getDb();

	const league = db.prepare('SELECT id, name FROM leagues WHERE id = ?').get(leagueId) as
		| { id: number; name: string }
		| undefined;
	if (!league) throw error(404, `league ${leagueId} not found`);

	const site = db
		.prepare('SELECT slug, season, archived_rounds, read_model FROM dashboard_sites WHERE league_id = ?')
		.get(leagueId) as SiteRow | undefined;
	if (!site) throw error(404, `league ${leagueId} has no published b-side`);

	const archivedRoundIds: number[] = JSON.parse(site.archived_rounds);

	// Find pending round: most-recent finalized digest not yet archived
	const pendingRow = db
		.prepare(
			`SELECT dd.round_id, r.name AS round_name, r.voting_deadline,
			        dd.finalized_at
			 FROM digest_drafts dd
			 JOIN rounds r ON r.id = dd.round_id
			 JOIN seasons se ON se.id = r.season_id
			 WHERE se.league_id = ? AND dd.finalized_at IS NOT NULL
			 ORDER BY dd.round_id DESC
			 LIMIT 1`,
		)
		.get(leagueId) as
		| { round_id: number; round_name: string; voting_deadline: string | null; finalized_at: string }
		| undefined;

	if (!pendingRow || archivedRoundIds.includes(pendingRow.round_id)) {
		throw error(409, 'no pending update for this league');
	}

	// Winner for the pending round
	const winnerRow = db
		.prepare(
			`SELECT sub.title, sub.artists, p.name AS player_name,
			        COALESCE(SUM(v.points), 0) AS pts
			 FROM ml_submissions sub
			 LEFT JOIN votes v ON v.round_id = sub.round_id AND v.spotify_uri = sub.spotify_uri
			 LEFT JOIN competitors c ON c.id = sub.competitor_id
			 LEFT JOIN players p ON p.id = c.player_id
			 WHERE sub.round_id = ?
			 GROUP BY sub.id
			 ORDER BY pts DESC
			 LIMIT 1`,
		)
		.get(pendingRow.round_id) as
		| { title: string; artists: string; player_name: string | null; pts: number }
		| undefined;

	const totalVotes = (
		db
			.prepare('SELECT COUNT(*) AS n FROM votes WHERE round_id = ?')
			.get(pendingRow.round_id) as { n: number }
	).n;

	// Per-section decisions from dashboard_section_state (default 'refresh' if not set)
	const stateRows = db
		.prepare(
			'SELECT section, decision, steer FROM dashboard_section_state WHERE league_id = ?',
		)
		.all(leagueId) as SectionStateRow[];
	const decisionMap = new Map<string, SectionDecision>(
		stateRows.map((r) => [r.section, r.decision as SectionDecision]),
	);

	// Compute concrete change details using current deterministic data
	const currentModel = JSON.parse(site.read_model) as ReadModel;
	const { league: detLeague } = buildDeterministicSlices(db, leagueId);

	// Stats delta
	const songCountBefore = currentModel.archive.length > 0
		? (currentModel.kpis.find((k) => k.label === 'songs submitted')?.value ?? '0')
		: '0';
	const songCountNow = (
		db
			.prepare(
				`SELECT COUNT(*) AS n FROM ml_submissions s
				 JOIN rounds r ON r.id = s.round_id
				 JOIN seasons se ON se.id = r.season_id
				 WHERE se.league_id = ? AND s.player_id IS NOT NULL`,
			)
			.get(leagueId) as { n: number }
	).n;
	const pointsThisRound = totalVotes > 0
		? (db
				.prepare('SELECT COALESCE(SUM(points), 0) AS pts FROM votes WHERE round_id = ?')
				.get(pendingRow.round_id) as { pts: number }).pts
		: 0;

	// Moments change
	const newMoments = detLeague.moments;
	const currentMostLoved = currentModel.moments?.mostLoved?.title ?? '';
	const momentDetail = newMoments
		? newMoments.mostLoved.title !== currentMostLoved
			? `New "most loved" candidate: ${newMoments.mostLoved.title}`
			: `"Most loved" unchanged (${currentMostLoved}); divisive + upset may shift`
		: 'No moment data available';

	// Fingerprint / overlap details (simple summaries)
	const memberCount = (
		db
			.prepare(
				`SELECT COUNT(DISTINCT c.player_id) AS n
				 FROM ml_submissions s
				 JOIN competitors c ON c.id = s.competitor_id
				 JOIN rounds r ON r.id = s.round_id
				 JOIN seasons se ON se.id = r.season_id
				 WHERE se.league_id = ? AND c.player_id IS NOT NULL`,
			)
			.get(leagueId) as { n: number }
	).n;

	const sections = [
		{
			id: 'entry',
			kind: 'add',
			label: 'New archive entry',
			required: true,
			note: `Round ${archivedRoundIds.length + 1} — "${pendingRow.round_name}". Added to the timeline, newest first. Links to the full digest.`,
			detail: winnerRow
				? `${winnerRow.title} — ${winnerRow.artists} · won by ${winnerRow.player_name ?? 'Unknown'} · ${totalVotes} votes`
				: `${totalVotes} votes cast`,
			steerable: false,
		},
		{
			id: 'superlatives',
			kind: 'recompute',
			label: 'Season superlatives',
			decision: decisionMap.get('superlatives') ?? 'refresh',
			note: 'Season awards re-evaluated with new round data.',
			detail: 'Points shift may move awards — refresh to regenerate all superlatives.',
			steerable: true,
		},
		{
			id: 'stats',
			kind: 'recompute',
			label: 'Season stats · KPIs',
			decision: decisionMap.get('stats') ?? 'refresh',
			note: 'Counts and tallies roll forward.',
			detail: `+${songCountNow - Number(songCountBefore.replace(/[^0-9]/g, '') || 0)} songs · +${pointsThisRound} points awarded`,
			steerable: false,
		},
		{
			id: 'fingerprints',
			kind: 'recompute',
			label: 'Taste fingerprints',
			decision: decisionMap.get('fingerprints') ?? 'refresh',
			note: `${memberCount} member profiles re-read with new round's votes.`,
			detail: 'Full-tier profiles regenerate; lite profiles update stats.',
			steerable: true,
		},
		{
			id: 'moments',
			kind: 'recompute',
			label: 'Moments of the season',
			decision: decisionMap.get('moments') ?? 'refresh',
			note: 'Group-consensus picks re-evaluated.',
			detail: momentDetail,
			steerable: true,
		},
		{
			id: 'overlap',
			kind: 'recompute',
			label: 'Your people · overlap',
			decision: decisionMap.get('overlap') ?? 'hold',
			note: 'Vote-together percentages recalc with the new shared round.',
			detail: 'Held by default — one round rarely moves it; refresh if you want it current.',
			steerable: false,
		},
	];

	return json({
		league: { id: league.id, name: league.name },
		slug: site.slug,
		pending: {
			roundId: pendingRow.round_id,
			theme: pendingRow.round_name,
			winnerSong: winnerRow?.title ?? '',
			winnerArtist: winnerRow?.artists ?? '',
			submitter: winnerRow?.player_name ?? '',
			votes: totalVotes,
			closedAt: pendingRow.voting_deadline,
		},
		sections,
	});
};
