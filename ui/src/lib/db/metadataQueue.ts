/**
 * metadataQueue.ts — helpers for the unified song_metadata_queue table.
 *
 * The queue has one row per (spotify_uri, job_type) pair. Workers claim rows
 * by setting status='processing'. All helpers accept a Database instance so
 * callers can pass an in-memory DB for tests.
 *
 */

import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JobType = 'ytm' | 'lastfm_pop' | 'lastfm_tags' | 'audio' | 'lyrics';
export type JobStatus = 'pending' | 'processing' | 'done' | 'failed';

/** Scope for filtering queue rows by league/season/round/all. */
export type Scope = { level: 'all' | 'league' | 'season' | 'round'; id?: number };

export interface QueueFailure {
	id: number;
	spotify_uri: string;
	job_type: string;
	error: string | null;
	retries: number;
}

export interface JobTypeCounts {
	pending: number;
	processing: number;
	done24h: number;
	failed: number;
	total: number;
	done: number; // lifetime done = total - pending - processing - failed
}

export interface QueueStatus {
	byJobType: Record<string, JobTypeCounts>;
	failures: QueueFailure[];
	totalPending: number;
	totalProcessing: number;
}

export interface CoverageRow {
	spotify_uri: string;
	title: string | null;
	artist: string | null;
	jobs: Record<string, 'done' | 'processing' | 'pending' | 'failed' | 'missing'>;
}

export interface ReadinessItem {
	ok: boolean;
	count: number;
	total: number;
}

export interface DigestReadiness {
	ytm: ReadinessItem;
	lastfm_pop: ReadinessItem;
	lastfm_tags: ReadinessItem;
	lyrics: ReadinessItem;
	audio: ReadinessItem;
}

export interface HierarchyRound {
	id: number;
	name: string;
	songCount: number;
	done: number;
	pending: number;
	processing: number;
	failed: number;
	total: number;
}

export interface HierarchySeason {
	id: number;
	name: string;
	rounds: HierarchyRound[];
	done: number;
	pending: number;
	processing: number;
	failed: number;
	total: number;
	songCount: number;
}

export interface HierarchyLeague {
	id: number;
	name: string;
	seasons: HierarchySeason[];
	done: number;
	pending: number;
	processing: number;
	failed: number;
	total: number;
	songCount: number;
}

// ---------------------------------------------------------------------------
// Enqueue helpers
// ---------------------------------------------------------------------------

/**
 * Idempotent enqueue of a single (spotifyUri, jobType) pair.
 * INSERT OR IGNORE means a second call for the same pair is a no-op.
 */
export function enqueue(db: Database.Database, spotifyUri: string, jobType: JobType): void {
	db.prepare(
		`INSERT OR IGNORE INTO song_metadata_queue (spotify_uri, job_type, queued_at)
		 VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
	).run(spotifyUri, jobType);
}

/**
 * Enqueue all combinations of spotifyUris × jobTypes.
 * Each pair is an independent INSERT OR IGNORE.
 */
export function enqueueMany(
	db: Database.Database,
	spotifyUris: string[],
	jobTypes: JobType[]
): void {
	const stmt = db.prepare(
		`INSERT OR IGNORE INTO song_metadata_queue (spotify_uri, job_type, queued_at)
		 VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
	);
	const tx = db.transaction(() => {
		for (const uri of spotifyUris) {
			for (const jt of jobTypes) {
				stmt.run(uri, jt);
			}
		}
	});
	tx();
}

// ---------------------------------------------------------------------------
// Status queries
// ---------------------------------------------------------------------------

/** Build a subquery that returns the set of spotify_uris in scope. */
function buildScopeUriSubquery(scope: Scope | undefined): { subquery: string | null; params: unknown[] } {
	if (scope == null || scope.level === 'all') {
		return { subquery: null, params: [] };
	}
	if (scope.level === 'round') {
		return {
			subquery: `SELECT DISTINCT spotify_uri FROM ml_submissions WHERE round_id = ?`,
			params: [scope.id]
		};
	}
	if (scope.level === 'season') {
		return {
			subquery: `SELECT DISTINCT ms.spotify_uri FROM ml_submissions ms JOIN rounds r ON r.id = ms.round_id WHERE r.season_id = ?`,
			params: [scope.id]
		};
	}
	// league
	return {
		subquery: `SELECT DISTINCT ms.spotify_uri FROM ml_submissions ms JOIN rounds r ON r.id = ms.round_id JOIN seasons s ON s.id = r.season_id WHERE s.league_id = ?`,
		params: [scope.id]
	};
}

/**
 * Returns per-job-type counts and the failures list.
 * When scope is provided, results are filtered accordingly.
 */
export function getQueueStatus(db: Database.Database, scope?: Scope): QueueStatus {
	const { subquery, params } = buildScopeUriSubquery(scope);

	// Use DISTINCT on (q.spotify_uri, q.job_type) when joining to avoid
	// double-counting when the same URI has multiple submission rows in a round.
	const whereClause = subquery ? `WHERE q.spotify_uri IN (${subquery})` : '';
	const rows = db.prepare(
		`SELECT q.job_type, q.status,
		        COUNT(*) AS cnt,
		        SUM(CASE WHEN q.status='done' AND q.done_at > strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now','-1 day')) THEN 1 ELSE 0 END) AS done24h_cnt
		 FROM song_metadata_queue q
		 ${whereClause}
		 GROUP BY q.job_type, q.status`
	).all(...params) as Array<{ job_type: string; status: string; cnt: number; done24h_cnt: number }>;

	const byJobType: Record<string, JobTypeCounts> = {};
	for (const row of rows) {
		if (!byJobType[row.job_type]) {
			byJobType[row.job_type] = { pending: 0, processing: 0, done24h: 0, failed: 0, total: 0, done: 0 };
		}
		const entry = byJobType[row.job_type];
		entry.total += row.cnt;
		if (row.status === 'pending') entry.pending += row.cnt;
		else if (row.status === 'processing') entry.processing += row.cnt;
		else if (row.status === 'done') entry.done24h += row.done24h_cnt;
		else if (row.status === 'failed') entry.failed += row.cnt;
	}
	for (const entry of Object.values(byJobType)) {
		entry.done = Math.max(0, entry.total - entry.pending - entry.processing - entry.failed);
	}

	const failures = getFailures(db, scope);

	let totalPending = 0;
	let totalProcessing = 0;
	for (const jt of Object.values(byJobType)) {
		totalPending += jt.pending;
		totalProcessing += jt.processing;
	}

	return { byJobType, failures, totalPending, totalProcessing };
}

/**
 * Returns all failed jobs, optionally scoped.
 * Accepts either a Scope object or a legacy number (round id) for backwards compatibility.
 */
export function getFailures(db: Database.Database, scope?: Scope | number): QueueFailure[] {
	// Handle legacy call signature where scope was roundId: number
	let resolvedScope: Scope | undefined;
	if (typeof scope === 'number') {
		resolvedScope = { level: 'round', id: scope };
	} else {
		resolvedScope = scope;
	}

	const { subquery, params } = buildScopeUriSubquery(resolvedScope);
	const whereClause = subquery
		? `WHERE q.status = 'failed' AND q.spotify_uri IN (${subquery})`
		: `WHERE q.status = 'failed'`;

	return db.prepare(
		`SELECT q.id, q.spotify_uri, q.job_type, q.error, q.retries
		 FROM song_metadata_queue q
		 ${whereClause}
		 ORDER BY q.queued_at DESC`
	).all(...params) as QueueFailure[];
}

/**
 * Reset a failed job back to pending so a worker will retry it.
 */
export function retryJob(db: Database.Database, id: number): void {
	db.prepare(
		`UPDATE song_metadata_queue
		 SET status = 'pending', error = NULL, retries = 0, started_at = NULL, done_at = NULL
		 WHERE id = ?`
	).run(id);
}

/**
 * If the row for (spotifyUri, jobType) exists and is 'failed', reset it to pending.
 * No-op if the row doesn't exist or is in any other status.
 */
export function resetFailed(db: Database.Database, spotifyUri: string, jobType: JobType): void {
	db.prepare(
		`UPDATE song_metadata_queue
		 SET status = 'pending', error = NULL, retries = 0, started_at = NULL, done_at = NULL
		 WHERE spotify_uri = ? AND job_type = ? AND status = 'failed'`
	).run(spotifyUri, jobType);
}

// ---------------------------------------------------------------------------
// Coverage matrix
// ---------------------------------------------------------------------------

/**
 * Returns a song × job-type status grid for all submissions in a round.
 * Songs that have no queue row for a given job type show 'missing'.
 */
export function getCoverageMatrix(db: Database.Database, roundId: number): CoverageRow[] {
	// Fetch distinct submissions for the round
	const songs = db.prepare(
		`SELECT DISTINCT ms.spotify_uri, ms.title, ms.artists AS artist
		 FROM ml_submissions ms
		 WHERE ms.round_id = ?
		 ORDER BY ms.spotify_uri`
	).all(roundId) as Array<{ spotify_uri: string; title: string | null; artist: string | null }>;

	if (songs.length === 0) return [];

	// Fetch all queue rows for these URIs
	const uris = songs.map((s) => s.spotify_uri);
	const placeholders = uris.map(() => '?').join(',');
	const queueRows = db.prepare(
		`SELECT spotify_uri, job_type, status
		 FROM song_metadata_queue
		 WHERE spotify_uri IN (${placeholders})`
	).all(...uris) as Array<{ spotify_uri: string; job_type: string; status: string }>;

	// Build a lookup map: uri → { jobType → status }
	const lookup = new Map<string, Map<string, string>>();
	for (const row of queueRows) {
		if (!lookup.has(row.spotify_uri)) lookup.set(row.spotify_uri, new Map());
		lookup.get(row.spotify_uri)!.set(row.job_type, row.status);
	}

	const allJobTypes: JobType[] = ['ytm', 'lastfm_pop', 'lastfm_tags', 'audio', 'lyrics'];

	return songs.map((song) => {
		const jobMap = lookup.get(song.spotify_uri) ?? new Map<string, string>();
		const jobs: Record<string, 'done' | 'processing' | 'pending' | 'failed' | 'missing'> = {};
		for (const jt of allJobTypes) {
			const st = jobMap.get(jt);
			jobs[jt] = (st as 'done' | 'processing' | 'pending' | 'failed') ?? 'missing';
		}
		return { spotify_uri: song.spotify_uri, title: song.title, artist: song.artist, jobs };
	});
}

// ---------------------------------------------------------------------------
// Digest readiness
// ---------------------------------------------------------------------------

/**
 * Computes readiness per digest section for a given round.
 * Thresholds: ytm requires 100%; lastfm_pop/tags/lyrics/audio require ≥80%.
 *
 * For lastfm_tags: we check done rows in song_metadata_queue for job_type='lastfm_tags'
 * because the `tags` column in song_popularity does not exist yet (added in a later task).
 * This avoids crashes while still giving a meaningful signal.
 */
export function getDigestReadiness(db: Database.Database, roundId: number): DigestReadiness {
	// Count distinct submissions in the round
	const totalRow = db.prepare(
		`SELECT COUNT(DISTINCT spotify_uri) AS n FROM ml_submissions WHERE round_id = ?`
	).get(roundId) as { n: number };
	const total = totalRow?.n ?? 0;

	if (total === 0) {
		const empty: ReadinessItem = { ok: false, count: 0, total: 0 };
		return { ytm: empty, lastfm_pop: empty, lastfm_tags: empty, lyrics: empty, audio: empty };
	}

	// YTM: count submissions where the ytm lookup job completed (link may be null —
	// not all tracks are on YouTube Music, but "checked" counts as covered).
	const ytmCount = (db.prepare(
		`SELECT COUNT(DISTINCT ms.spotify_uri) AS n
		 FROM ml_submissions ms
		 JOIN song_metadata_queue smq ON smq.spotify_uri = ms.spotify_uri
		   AND smq.job_type = 'ytm' AND smq.status = 'done'
		 WHERE ms.round_id = ?`
	).get(roundId) as { n: number }).n;

	// lastfm_pop: count submissions with a song_popularity row
	const lastfmPopCount = (db.prepare(
		`SELECT COUNT(DISTINCT ms.spotify_uri) AS n
		 FROM ml_submissions ms
		 JOIN song_popularity sp ON sp.spotify_uri = ms.spotify_uri
		 WHERE ms.round_id = ?`
	).get(roundId) as { n: number }).n;

	// lastfm_tags: proxy via song_metadata_queue done rows for job_type='lastfm_tags'
	const lastfmTagsCount = (db.prepare(
		`SELECT COUNT(DISTINCT ms.spotify_uri) AS n
		 FROM ml_submissions ms
		 JOIN song_metadata_queue smq ON smq.spotify_uri = ms.spotify_uri
		   AND smq.job_type = 'lastfm_tags' AND smq.status = 'done'
		 WHERE ms.round_id = ?`
	).get(roundId) as { n: number }).n;

	// lyrics: count submissions with a song_lyrics_metrics row
	const lyricsCount = (db.prepare(
		`SELECT COUNT(DISTINCT ms.spotify_uri) AS n
		 FROM ml_submissions ms
		 JOIN song_lyrics_metrics slm ON slm.spotify_uri = ms.spotify_uri
		 WHERE ms.round_id = ?`
	).get(roundId) as { n: number }).n;

	// audio: count submissions with a song_audio_features row
	const audioCount = (db.prepare(
		`SELECT COUNT(DISTINCT ms.spotify_uri) AS n
		 FROM ml_submissions ms
		 JOIN song_audio_features saf ON saf.spotify_uri = ms.spotify_uri
		 WHERE ms.round_id = ?`
	).get(roundId) as { n: number }).n;

	const pct80 = (count: number) => count / total >= 0.8;

	return {
		ytm: { ok: ytmCount === total, count: ytmCount, total },
		lastfm_pop: { ok: pct80(lastfmPopCount), count: lastfmPopCount, total },
		lastfm_tags: { ok: pct80(lastfmTagsCount), count: lastfmTagsCount, total },
		lyrics: { ok: pct80(lyricsCount), count: lyricsCount, total },
		audio: { ok: pct80(audioCount), count: audioCount, total }
	};
}

// ---------------------------------------------------------------------------
// classifyFailure
// ---------------------------------------------------------------------------

/**
 * Classify a job failure error string into a category.
 * Precedence (first match wins):
 *  1. 'config'       — /not set|not configured/i
 *  2. 'no_data'      — /not found/i
 *  3. 'rate_limited' — /HTTP 4|rate/i
 *  4. 'transient'    — /HTTP 5|ECONN|timeout/i
 *  5. default        — 'transient'
 */
export function classifyFailure(error: string | null): 'rate_limited' | 'no_data' | 'transient' | 'config' {
	if (!error) return 'transient';
	if (/not set|not configured/i.test(error)) return 'config';
	if (/not found/i.test(error)) return 'no_data';
	if (/HTTP 4|rate/i.test(error)) return 'rate_limited';
	if (/HTTP 5|ECONN|timeout/i.test(error)) return 'transient';
	return 'transient';
}

// ---------------------------------------------------------------------------
// getHierarchy — league → season → round tree with roll-up counts
// ---------------------------------------------------------------------------

/**
 * Builds the full hierarchy tree without N+1 queries.
 * Uses 5 flat queries then stitches in JS.
 */
export function getHierarchy(db: Database.Database): HierarchyLeague[] {
	// 1. All leagues
	const leagues = db.prepare(
		`SELECT id, name FROM leagues ORDER BY id`
	).all() as Array<{ id: number; name: string }>;

	// 2. All seasons with league_id
	const seasons = db.prepare(
		`SELECT id, league_id, season_number FROM seasons ORDER BY league_id, season_number`
	).all() as Array<{ id: number; league_id: number; season_number: number }>;

	// 3. All rounds with season_id
	const rounds = db.prepare(
		`SELECT id, season_id, name FROM rounds ORDER BY season_id, id`
	).all() as Array<{ id: number; season_id: number; name: string }>;

	// 4. Aggregation per round + status (no N+1)
	// Use DISTINCT on (ms.spotify_uri, ms.round_id) to avoid double-counting
	// URIs that appear multiple times in ml_submissions for a round.
	const statusAgg = db.prepare(
		`SELECT r.id AS round_id, q.status, COUNT(DISTINCT q.spotify_uri || '|' || q.job_type) AS cnt
		 FROM song_metadata_queue q
		 JOIN ml_submissions ms ON ms.spotify_uri = q.spotify_uri
		 JOIN rounds r ON r.id = ms.round_id
		 GROUP BY r.id, q.status`
	).all() as Array<{ round_id: number; status: string; cnt: number }>;

	// 5. Song count per round (distinct URIs)
	const songCountRows = db.prepare(
		`SELECT round_id, COUNT(DISTINCT spotify_uri) AS cnt FROM ml_submissions GROUP BY round_id`
	).all() as Array<{ round_id: number; cnt: number }>;

	// Also need total jobs per round (across all statuses)
	const totalAgg = db.prepare(
		`SELECT r.id AS round_id, COUNT(DISTINCT q.spotify_uri || '|' || q.job_type) AS cnt
		 FROM song_metadata_queue q
		 JOIN ml_submissions ms ON ms.spotify_uri = q.spotify_uri
		 JOIN rounds r ON r.id = ms.round_id
		 GROUP BY r.id`
	).all() as Array<{ round_id: number; cnt: number }>;

	// Index data for O(1) lookup
	const songCountByRound = new Map(songCountRows.map((r) => [r.round_id, r.cnt]));
	const totalByRound = new Map(totalAgg.map((r) => [r.round_id, r.cnt]));

	// status counts per round
	type RoundCounts = { done: number; pending: number; processing: number; failed: number };
	const countsByRound = new Map<number, RoundCounts>();
	for (const row of statusAgg) {
		if (!countsByRound.has(row.round_id)) {
			countsByRound.set(row.round_id, { done: 0, pending: 0, processing: 0, failed: 0 });
		}
		const c = countsByRound.get(row.round_id)!;
		if (row.status === 'done') c.done += row.cnt;
		else if (row.status === 'pending') c.pending += row.cnt;
		else if (row.status === 'processing') c.processing += row.cnt;
		else if (row.status === 'failed') c.failed += row.cnt;
	}

	// Index rounds by season_id
	const roundsBySeason = new Map<number, Array<{ id: number; season_id: number; name: string }>>();
	for (const r of rounds) {
		if (!roundsBySeason.has(r.season_id)) roundsBySeason.set(r.season_id, []);
		roundsBySeason.get(r.season_id)!.push(r);
	}

	// Index seasons by league_id
	const seasonsByLeague = new Map<number, Array<{ id: number; league_id: number; season_number: number }>>();
	for (const s of seasons) {
		if (!seasonsByLeague.has(s.league_id)) seasonsByLeague.set(s.league_id, []);
		seasonsByLeague.get(s.league_id)!.push(s);
	}

	// Build hierarchy
	return leagues.map((league) => {
		const leagueSeasons = seasonsByLeague.get(league.id) ?? [];

		const builtSeasons: HierarchySeason[] = leagueSeasons.map((season) => {
			const seasonRounds = roundsBySeason.get(season.id) ?? [];

			const builtRounds: HierarchyRound[] = seasonRounds.map((round) => {
				const counts = countsByRound.get(round.id) ?? { done: 0, pending: 0, processing: 0, failed: 0 };
				const total = totalByRound.get(round.id) ?? 0;
				const songCount = songCountByRound.get(round.id) ?? 0;
				return {
					id: round.id,
					name: round.name,
					songCount,
					done: counts.done,
					pending: counts.pending,
					processing: counts.processing,
					failed: counts.failed,
					total
				};
			});

			// Roll up season from rounds
			const seasonDone = builtRounds.reduce((acc, r) => acc + r.done, 0);
			const seasonPending = builtRounds.reduce((acc, r) => acc + r.pending, 0);
			const seasonProcessing = builtRounds.reduce((acc, r) => acc + r.processing, 0);
			const seasonFailed = builtRounds.reduce((acc, r) => acc + r.failed, 0);
			const seasonTotal = builtRounds.reduce((acc, r) => acc + r.total, 0);
			const seasonSongCount = builtRounds.reduce((acc, r) => acc + r.songCount, 0);

			return {
				id: season.id,
				name: `Season ${season.season_number}`,
				rounds: builtRounds,
				done: seasonDone,
				pending: seasonPending,
				processing: seasonProcessing,
				failed: seasonFailed,
				total: seasonTotal,
				songCount: seasonSongCount
			};
		});

		// Roll up league from seasons
		const leagueDone = builtSeasons.reduce((acc, s) => acc + s.done, 0);
		const leaguePending = builtSeasons.reduce((acc, s) => acc + s.pending, 0);
		const leagueProcessing = builtSeasons.reduce((acc, s) => acc + s.processing, 0);
		const leagueFailed = builtSeasons.reduce((acc, s) => acc + s.failed, 0);
		const leagueTotal = builtSeasons.reduce((acc, s) => acc + s.total, 0);
		const leagueSongCount = builtSeasons.reduce((acc, s) => acc + s.songCount, 0);

		return {
			id: league.id,
			name: league.name,
			seasons: builtSeasons,
			done: leagueDone,
			pending: leaguePending,
			processing: leagueProcessing,
			failed: leagueFailed,
			total: leagueTotal,
			songCount: leagueSongCount
		};
	});
}

// ---------------------------------------------------------------------------
// getScopeRollup — per-scope QueueStatus (delegates to getQueueStatus)
// ---------------------------------------------------------------------------

/**
 * Returns the QueueStatus for a given scope node.
 * Delegates to getQueueStatus for DRY implementation.
 */
export function getScopeRollup(db: Database.Database, scope: Scope): QueueStatus {
	return getQueueStatus(db, scope);
}

// ---------------------------------------------------------------------------
// getChildrenRollups — per-child, per-job-type counts for heatmap view
// ---------------------------------------------------------------------------

export interface ChildRollup {
	id: number;
	name: string;
	songCount: number;
	byJobType: Record<string, { done: number; pending: number; processing: number; failed: number; total: number }>;
}

/**
 * Returns the CHILDREN of the given scope, each with per-job-type job counts.
 * Mapping:
 *   all    → leagues
 *   league → seasons (named "Season N")
 *   season → rounds
 *   round  → [] (songs are served by coverageMatrix, not this fn)
 *
 * Uses a small number of grouped queries (no N+1). Bound ? params throughout.
 */
export function getChildrenRollups(db: Database.Database, scope: Scope): ChildRollup[] {
	if (scope.level === 'round') {
		// Round children (songs) come from coverageMatrix, not this function.
		return [];
	}

	if (scope.level === 'all') {
		return getLeagueRollups(db);
	}

	if (scope.level === 'league') {
		return getSeasonRollups(db, scope.id!);
	}

	// season
	return getRoundRollups(db, scope.id!);
}

/** Return per-league rollups (children of 'all' scope). */
function getLeagueRollups(db: Database.Database): ChildRollup[] {
	// 1. All leagues
	const leagues = db.prepare(
		`SELECT id, name FROM leagues ORDER BY id`
	).all() as Array<{ id: number; name: string }>;

	if (leagues.length === 0) return [];

	// 2. Song count per league (distinct URIs via submissions → rounds → seasons → leagues)
	const songCountRows = db.prepare(
		`SELECT s.league_id AS child_id, COUNT(DISTINCT ms.spotify_uri) AS cnt
		 FROM ml_submissions ms
		 JOIN rounds r ON r.id = ms.round_id
		 JOIN seasons s ON s.id = r.season_id
		 GROUP BY s.league_id`
	).all() as Array<{ child_id: number; cnt: number }>;

	// 3. Grouped queue counts per league per job_type per status
	const queueRows = db.prepare(
		`SELECT s.league_id AS child_id, q.job_type, q.status, COUNT(DISTINCT q.spotify_uri || '|' || q.job_type) AS cnt
		 FROM song_metadata_queue q
		 JOIN ml_submissions ms ON ms.spotify_uri = q.spotify_uri
		 JOIN rounds r ON r.id = ms.round_id
		 JOIN seasons s ON s.id = r.season_id
		 GROUP BY s.league_id, q.job_type, q.status`
	).all() as Array<{ child_id: number; job_type: string; status: string; cnt: number }>;

	return buildChildRollups(leagues, songCountRows, queueRows);
}

/** Return per-season rollups (children of a league scope). */
function getSeasonRollups(db: Database.Database, leagueId: number): ChildRollup[] {
	// 1. Seasons for this league
	const seasons = db.prepare(
		`SELECT id, season_number FROM seasons WHERE league_id = ? ORDER BY season_number`
	).all(leagueId) as Array<{ id: number; season_number: number }>;

	if (seasons.length === 0) return [];

	const nodes = seasons.map(s => ({ id: s.id, name: `Season ${s.season_number}` }));

	// 2. Song count per season
	const songCountRows = db.prepare(
		`SELECT r.season_id AS child_id, COUNT(DISTINCT ms.spotify_uri) AS cnt
		 FROM ml_submissions ms
		 JOIN rounds r ON r.id = ms.round_id
		 WHERE r.season_id IN (SELECT id FROM seasons WHERE league_id = ?)
		 GROUP BY r.season_id`
	).all(leagueId) as Array<{ child_id: number; cnt: number }>;

	// 3. Queue counts per season per job_type per status
	const queueRows = db.prepare(
		`SELECT r.season_id AS child_id, q.job_type, q.status, COUNT(DISTINCT q.spotify_uri || '|' || q.job_type) AS cnt
		 FROM song_metadata_queue q
		 JOIN ml_submissions ms ON ms.spotify_uri = q.spotify_uri
		 JOIN rounds r ON r.id = ms.round_id
		 WHERE r.season_id IN (SELECT id FROM seasons WHERE league_id = ?)
		 GROUP BY r.season_id, q.job_type, q.status`
	).all(leagueId) as Array<{ child_id: number; job_type: string; status: string; cnt: number }>;

	return buildChildRollups(nodes, songCountRows, queueRows);
}

/** Return per-round rollups (children of a season scope). */
function getRoundRollups(db: Database.Database, seasonId: number): ChildRollup[] {
	// 1. Rounds for this season
	const rounds = db.prepare(
		`SELECT id, name FROM rounds WHERE season_id = ? ORDER BY id`
	).all(seasonId) as Array<{ id: number; name: string }>;

	if (rounds.length === 0) return [];

	// 2. Song count per round
	const songCountRows = db.prepare(
		`SELECT round_id AS child_id, COUNT(DISTINCT spotify_uri) AS cnt
		 FROM ml_submissions
		 WHERE round_id IN (SELECT id FROM rounds WHERE season_id = ?)
		 GROUP BY round_id`
	).all(seasonId) as Array<{ child_id: number; cnt: number }>;

	// 3. Queue counts per round per job_type per status
	const queueRows = db.prepare(
		`SELECT ms.round_id AS child_id, q.job_type, q.status, COUNT(DISTINCT q.spotify_uri || '|' || q.job_type) AS cnt
		 FROM song_metadata_queue q
		 JOIN ml_submissions ms ON ms.spotify_uri = q.spotify_uri
		 WHERE ms.round_id IN (SELECT id FROM rounds WHERE season_id = ?)
		 GROUP BY ms.round_id, q.job_type, q.status`
	).all(seasonId) as Array<{ child_id: number; job_type: string; status: string; cnt: number }>;

	return buildChildRollups(rounds, songCountRows, queueRows);
}

/**
 * Shared assembler: merges flat query results into ChildRollup[].
 * nodes: the child items (id + name)
 * songCountRows: one row per child_id with a count
 * queueRows: one row per (child_id, job_type, status) with a count
 */
function buildChildRollups(
	nodes: Array<{ id: number; name: string }>,
	songCountRows: Array<{ child_id: number; cnt: number }>,
	queueRows: Array<{ child_id: number; job_type: string; status: string; cnt: number }>
): ChildRollup[] {
	const songCounts = new Map(songCountRows.map(r => [r.child_id, r.cnt]));

	// Index queue data: child_id → job_type → { pending, processing, done, failed, total }
	type Counts = { pending: number; processing: number; failed: number; total: number };
	const queueMap = new Map<number, Map<string, Counts>>();

	for (const row of queueRows) {
		if (!queueMap.has(row.child_id)) queueMap.set(row.child_id, new Map());
		const jtMap = queueMap.get(row.child_id)!;
		if (!jtMap.has(row.job_type)) jtMap.set(row.job_type, { pending: 0, processing: 0, failed: 0, total: 0 });
		const counts = jtMap.get(row.job_type)!;
		counts.total += row.cnt;
		if (row.status === 'pending') counts.pending += row.cnt;
		else if (row.status === 'processing') counts.processing += row.cnt;
		else if (row.status === 'failed') counts.failed += row.cnt;
	}

	return nodes.map(node => {
		const jtMap = queueMap.get(node.id) ?? new Map<string, Counts>();
		const byJobType: ChildRollup['byJobType'] = {};

		for (const [jobType, counts] of jtMap) {
			byJobType[jobType] = {
				done: Math.max(0, counts.total - counts.pending - counts.processing - counts.failed),
				pending: counts.pending,
				processing: counts.processing,
				failed: counts.failed,
				total: counts.total,
			};
		}

		return {
			id: node.id,
			name: node.name,
			songCount: songCounts.get(node.id) ?? 0,
			byJobType,
		};
	});
}
