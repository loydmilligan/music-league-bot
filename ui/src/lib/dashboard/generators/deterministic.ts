import type Database from 'better-sqlite3';

// ── Exported slice types ───────────────────────────────────────────────────────

export interface MemberStat {
	submitted: number;
	avgPts: number;
	wins: number;
}

export type MemberTier = 'full' | 'lite';

export interface KpiItem {
	value: string;
	label: string;
	sub: string;
}

export interface MomentEntry {
	title: string;
	artist: string;
	submitter: string;
	round: string;
}

export interface Moments {
	mostLoved: MomentEntry;
	mostDivisive: MomentEntry;
	biggestUpset: MomentEntry;
}

export interface RelationshipEntry {
	who: string;
	pts: number;
}

export interface DeterministicMemberSlice {
	stat: MemberStat;
	tier: MemberTier;
	biggestFan: RelationshipEntry | null;
	biggestHater: RelationshipEntry | null;
}

export interface DeterministicLeagueSlice {
	kpis: KpiItem[];
	moments: Moments | null;
}

// ── Tier threshold ─────────────────────────────────────────────────────────────
// A member is 'full' if they submitted to at least 50% of completed league rounds,
// with a minimum of 3 submissions. Quiet/new members resolve to 'lite'.
export const TIER_CUTOFF_RATIO = 0.5;
const TIER_MIN_SUBMISSIONS = 3;

// Per-league manual promotions: settings key `dashboard_tier_full_<leagueId>` holding a
// JSON array of player ids that resolve to 'full' regardless of submission count. Used
// for members who are central to the league but short of the cutoff (late joiners).
// There is no manual demotion — the cutoff already handles that direction.
export const TIER_OVERRIDE_KEY_PREFIX = 'dashboard_tier_full_';

export function loadTierOverrides(db: Database.Database, leagueId: number): Set<number> {
	try {
		const row = db
			.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
			.get(`${TIER_OVERRIDE_KEY_PREFIX}${leagueId}`);
		if (!row) return new Set();
		const parsed: unknown = JSON.parse(row.value);
		if (!Array.isArray(parsed)) return new Set();
		return new Set(parsed.filter((id): id is number => typeof id === 'number'));
	} catch {
		return new Set();
	}
}

// ── Internal row types ─────────────────────────────────────────────────────────

interface SubPointsRow {
	player_id: number;
	round_id: number;
	spotify_uri: string;
	pts: number;
	title: string;
	artists: string;
}

interface VoteMatrixRow {
	target_player_id: number;
	voter_player_id: number;
	total_pts: number;
	shared_rounds: number;
}

interface PlayerNameRow {
	id: number;
	name: string;
}

interface RoundRow {
	id: number;
	name: string;
}

interface SpreadRow {
	spotify_uri: string;
	round_id: number;
	vote_spread: number;
	vote_count: number;
}

interface TotalPointsRow {
	totalPoints: number;
}

interface CommentStatsRow {
	commentCount: number;
	wordSum: number;
}

// ── Main entry point ───────────────────────────────────────────────────────────

/**
 * Compute all deterministic read-model data for a league:
 * - per-member stat (submitted / avgPts / wins) + tier (full/lite)
 * - per-member biggestFan / biggestHater relationships
 * - league KPIs (celebratory facts only — no win/loss ladder)
 * - league moments (mostLoved / mostDivisive / biggestUpset)
 */
export function buildDeterministicSlices(
	db: Database.Database,
	leagueId: number,
): {
	members: Map<number, DeterministicMemberSlice>;
	league: DeterministicLeagueSlice;
} {
	// 1. All rounds — name-lookup map must include every round so moments
	//    (and any round-id → display-name resolution) never fall back to the id.
	//    Completed-only count is derived separately for tier cutoff + KPI sub.
	const rounds = db
		.prepare<[number], RoundRow & { phase: string | null }>(
			`SELECT r.id, r.name, r.phase
       FROM rounds r
       JOIN seasons s ON s.id = r.season_id
       WHERE s.league_id = ?`,
		)
		.all(leagueId);

	const totalRounds = rounds.filter((r) => r.phase === 'complete').length;

	const roundNames = new Map<number, string>();
	for (const r of rounds) roundNames.set(r.id, r.name);

	// 2. Per-submission point totals scoped to this league
	const subRows = db
		.prepare<[number], SubPointsRow>(
			`SELECT
         m.player_id,
         m.round_id,
         m.spotify_uri,
         m.title,
         m.artists,
         COALESCE(SUM(v.points), 0) AS pts
       FROM ml_submissions m
       JOIN rounds r ON r.id = m.round_id
       JOIN seasons s ON s.id = r.season_id
       LEFT JOIN votes v ON v.round_id = m.round_id AND v.spotify_uri = m.spotify_uri
       WHERE s.league_id = ? AND m.player_id IS NOT NULL
       GROUP BY m.id`,
		)
		.all(leagueId);

	// 3. Per-round max points (to identify winners)
	const roundMaxPts = new Map<number, number>();
	for (const row of subRows) {
		const cur = roundMaxPts.get(row.round_id) ?? 0;
		if (row.pts > cur) roundMaxPts.set(row.round_id, row.pts);
	}

	// 4. Per-player stats
	const playerAccum = new Map<
		number,
		{ submitted: number; totalPts: number; wins: number }
	>();
	for (const row of subRows) {
		let p = playerAccum.get(row.player_id);
		if (!p) {
			p = { submitted: 0, totalPts: 0, wins: 0 };
			playerAccum.set(row.player_id, p);
		}
		p.submitted++;
		p.totalPts += row.pts;
		const max = roundMaxPts.get(row.round_id) ?? 0;
		if (max > 0 && row.pts === max) p.wins++;
	}

	// 5. Tier cutoff + assemble member slices (fan/hater filled below)
	const tierCutoff = Math.max(TIER_MIN_SUBMISSIONS, Math.round(totalRounds * TIER_CUTOFF_RATIO));
	const forcedFull = loadTierOverrides(db, leagueId);
	const memberSlices = new Map<number, DeterministicMemberSlice>();

	for (const [playerId, acc] of playerAccum) {
		const avgPts =
			acc.submitted > 0
				? Math.round((acc.totalPts / acc.submitted) * 10) / 10
				: 0;
		memberSlices.set(playerId, {
			stat: { submitted: acc.submitted, avgPts, wins: acc.wins },
			tier: forcedFull.has(playerId) || acc.submitted >= tierCutoff ? 'full' : 'lite',
			biggestFan: null,
			biggestHater: null,
		});
	}

	// 6. Fan / hater vote matrix
	const voteMatrixRows = db
		.prepare<[number], VoteMatrixRow>(
			`SELECT
         s.player_id    AS target_player_id,
         v.player_id    AS voter_player_id,
         SUM(v.points)  AS total_pts,
         COUNT(DISTINCT v.round_id) AS shared_rounds
       FROM votes v
       JOIN ml_submissions s ON s.round_id = v.round_id AND s.spotify_uri = v.spotify_uri
       JOIN rounds r ON r.id = v.round_id
       JOIN seasons sea ON sea.id = r.season_id
       WHERE sea.league_id = ?
         AND s.player_id IS NOT NULL
         AND v.player_id IS NOT NULL
         AND s.player_id != v.player_id
       GROUP BY s.player_id, v.player_id`,
		)
		.all(leagueId);

	// Resolve player names for all IDs seen in the matrix
	const allPlayerIds = new Set<number>();
	for (const row of voteMatrixRows) {
		allPlayerIds.add(row.target_player_id);
		allPlayerIds.add(row.voter_player_id);
	}
	const playerNames = new Map<number, string>();
	if (allPlayerIds.size > 0) {
		const placeholders = Array.from(allPlayerIds)
			.map(() => '?')
			.join(',');
		const nameRows = db
			.prepare<number[], PlayerNameRow>(
				`SELECT id, name FROM players WHERE id IN (${placeholders})`,
			)
			.all(...Array.from(allPlayerIds));
		for (const r of nameRows) playerNames.set(r.id, r.name);
	}

	// Find best fan (max pts) and biggest hater (min pts, ≥ 2 shared rounds) per target
	const fanByTarget = new Map<number, VoteMatrixRow>();
	const haterByTarget = new Map<number, VoteMatrixRow>();
	for (const row of voteMatrixRows) {
		if (!playerNames.has(row.voter_player_id)) continue;

		const cur = fanByTarget.get(row.target_player_id);
		if (!cur || row.total_pts > cur.total_pts) fanByTarget.set(row.target_player_id, row);

		if (row.shared_rounds >= 2) {
			const curH = haterByTarget.get(row.target_player_id);
			if (!curH || row.total_pts < curH.total_pts) haterByTarget.set(row.target_player_id, row);
		}
	}

	for (const [playerId, slice] of memberSlices) {
		const fan = fanByTarget.get(playerId);
		if (fan) {
			slice.biggestFan = {
				who: playerNames.get(fan.voter_player_id) ?? '',
				pts: fan.total_pts,
			};
		}
		const hater = haterByTarget.get(playerId);
		if (hater) {
			slice.biggestHater = {
				who: playerNames.get(hater.voter_player_id) ?? '',
				pts: hater.total_pts,
			};
		}
	}

	// 7. KPIs + moments
	const kpis = buildKpis(db, leagueId, totalRounds, subRows, roundMaxPts);
	const moments = buildMoments(db, leagueId, subRows, roundMaxPts, roundNames, playerNames);

	return {
		members: memberSlices,
		league: { kpis, moments },
	};
}

// ── KPI builder ────────────────────────────────────────────────────────────────

function buildKpis(
	db: Database.Database,
	leagueId: number,
	totalRounds: number,
	subRows: SubPointsRow[],
	roundMaxPts: Map<number, number>,
): KpiItem[] {
	const kpis: KpiItem[] = [];

	// Total songs submitted
	kpis.push({
		value: subRows.length.toLocaleString(),
		label: 'songs submitted',
		sub: `across ${totalRounds} round${totalRounds !== 1 ? 's' : ''}`,
	});

	// Total points awarded
	const ptRow = db
		.prepare<[number], TotalPointsRow>(
			`SELECT COALESCE(SUM(v.points), 0) AS totalPoints
       FROM votes v
       JOIN rounds r ON r.id = v.round_id
       JOIN seasons s ON s.id = r.season_id
       WHERE s.league_id = ?`,
		)
		.get(leagueId);
	const totalPoints = ptRow?.totalPoints ?? 0;
	kpis.push({
		value: totalPoints.toLocaleString(),
		label: 'points awarded',
		sub: 'the group is generous, mostly',
	});

	// Distinct round winners (celebratory: the trophy gets around)
	const winnerIds = new Set<number>();
	for (const row of subRows) {
		const max = roundMaxPts.get(row.round_id) ?? 0;
		if (max > 0 && row.pts === max) winnerIds.add(row.player_id);
	}
	if (winnerIds.size > 0) {
		kpis.push({
			value: String(winnerIds.size),
			label: 'different round winners',
			sub: 'the trophy gets around',
		});
	}

	// Avg words per submission note (if enough comments exist)
	const commentRow = db
		.prepare<[number], CommentStatsRow>(
			`SELECT
         COUNT(CASE WHEN m.comment IS NOT NULL AND TRIM(m.comment) != '' THEN 1 END) AS commentCount,
         COALESCE(SUM(
           CASE WHEN m.comment IS NOT NULL AND TRIM(m.comment) != '' THEN
             LENGTH(TRIM(m.comment)) - LENGTH(REPLACE(TRIM(m.comment), ' ', '')) + 1
           ELSE 0 END
         ), 0) AS wordSum
       FROM ml_submissions m
       JOIN rounds r ON r.id = m.round_id
       JOIN seasons s ON s.id = r.season_id
       WHERE s.league_id = ?`,
		)
		.get(leagueId);
	if (commentRow && commentRow.commentCount >= 3) {
		const avgWords = Math.round(commentRow.wordSum / commentRow.commentCount);
		kpis.push({
			value: String(avgWords),
			label: 'avg words per submission note',
			sub: 'the group has feelings',
		});
	}

	return kpis;
}

// ── Moments builder ────────────────────────────────────────────────────────────

function buildMoments(
	db: Database.Database,
	leagueId: number,
	subRows: SubPointsRow[],
	roundMaxPts: Map<number, number>,
	roundNames: Map<number, string>,
	playerNames: Map<number, string>,
): Moments | null {
	if (subRows.length === 0) return null;

	// Vote spread per submission (for mostDivisive)
	const spreadRows = db
		.prepare<[number], SpreadRow>(
			`SELECT
         v.spotify_uri,
         v.round_id,
         MAX(v.points) - MIN(v.points) AS vote_spread,
         COUNT(*) AS vote_count
       FROM votes v
       JOIN rounds r ON r.id = v.round_id
       JOIN seasons s ON s.id = r.season_id
       WHERE s.league_id = ?
       GROUP BY v.round_id, v.spotify_uri
       HAVING vote_count >= 2`,
		)
		.all(leagueId);

	const spreadByKey = new Map<string, number>();
	for (const r of spreadRows) spreadByKey.set(`${r.round_id}:${r.spotify_uri}`, r.vote_spread);

	// mostLoved: highest total points
	let loved = subRows[0];
	for (const row of subRows) {
		if (row.pts > loved.pts) loved = row;
	}

	// mostDivisive: highest vote spread (songs with >= 2 votes)
	let divisive: SubPointsRow = loved;
	let maxSpread = -1;
	for (const row of subRows) {
		const spread = spreadByKey.get(`${row.round_id}:${row.spotify_uri}`) ?? -1;
		if (spread > maxSpread) {
			maxSpread = spread;
			divisive = row;
		}
	}

	// biggestUpset: round winner with smallest margin over 2nd place
	const roundSecondBest = new Map<number, number>();
	const roundWinnerRow = new Map<number, SubPointsRow>();
	for (const row of subRows) {
		const max = roundMaxPts.get(row.round_id) ?? 0;
		if (max > 0 && row.pts === max) {
			if (!roundWinnerRow.has(row.round_id)) roundWinnerRow.set(row.round_id, row);
		} else {
			const cur = roundSecondBest.get(row.round_id) ?? 0;
			if (row.pts > cur) roundSecondBest.set(row.round_id, row.pts);
		}
	}
	let upset: SubPointsRow = loved;
	let minMargin = Infinity;
	for (const [roundId, winner] of roundWinnerRow) {
		const secondPts = roundSecondBest.get(roundId) ?? 0;
		const margin = winner.pts - secondPts;
		if (margin < minMargin) {
			minMargin = margin;
			upset = winner;
		}
	}

	function toEntry(row: SubPointsRow): MomentEntry {
		return {
			title: row.title,
			artist: row.artists,
			submitter: playerNames.get(row.player_id) ?? String(row.player_id),
			round: roundNames.get(row.round_id) ?? String(row.round_id),
		};
	}

	return {
		mostLoved: toEntry(loved),
		mostDivisive: toEntry(divisive),
		biggestUpset: toEntry(upset),
	};
}
