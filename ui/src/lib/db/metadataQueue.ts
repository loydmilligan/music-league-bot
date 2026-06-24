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

/**
 * Returns per-job-type counts and the failures list.
 * When roundId is provided, results are scoped to submissions in that round.
 */
export function getQueueStatus(db: Database.Database, roundId?: number): QueueStatus {
	// Build a WHERE clause that optionally scopes to a round's submissions.
	const scopeJoin = roundId != null
		? `JOIN ml_submissions ms ON ms.spotify_uri = q.spotify_uri AND ms.round_id = ${roundId}`
		: '';

	const rows = db.prepare(
		`SELECT q.job_type, q.status,
		        COUNT(*) AS cnt,
		        SUM(CASE WHEN q.status='done' AND q.done_at > strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now','-1 day')) THEN 1 ELSE 0 END) AS done24h_cnt
		 FROM song_metadata_queue q
		 ${scopeJoin}
		 GROUP BY q.job_type, q.status`
	).all() as Array<{ job_type: string; status: string; cnt: number; done24h_cnt: number }>;

	const byJobType: Record<string, JobTypeCounts> = {};
	for (const row of rows) {
		if (!byJobType[row.job_type]) {
			byJobType[row.job_type] = { pending: 0, processing: 0, done24h: 0, failed: 0, total: 0 };
		}
		const entry = byJobType[row.job_type];
		entry.total += row.cnt;
		if (row.status === 'pending') entry.pending += row.cnt;
		else if (row.status === 'processing') entry.processing += row.cnt;
		else if (row.status === 'done') entry.done24h += row.done24h_cnt;
		else if (row.status === 'failed') entry.failed += row.cnt;
	}

	const failures = getFailures(db, roundId);

	let totalPending = 0;
	let totalProcessing = 0;
	for (const jt of Object.values(byJobType)) {
		totalPending += jt.pending;
		totalProcessing += jt.processing;
	}

	return { byJobType, failures, totalPending, totalProcessing };
}

/**
 * Returns all failed jobs, optionally scoped to a round's submissions.
 */
export function getFailures(db: Database.Database, roundId?: number): QueueFailure[] {
	const scopeJoin = roundId != null
		? `JOIN ml_submissions ms ON ms.spotify_uri = q.spotify_uri AND ms.round_id = ${roundId}`
		: '';

	return db.prepare(
		`SELECT q.id, q.spotify_uri, q.job_type, q.error, q.retries
		 FROM song_metadata_queue q
		 ${scopeJoin}
		 WHERE q.status = 'failed'
		 ORDER BY q.queued_at DESC`
	).all() as QueueFailure[];
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

	// YTM: count submissions that have a ytm_link_cache row
	const ytmCount = (db.prepare(
		`SELECT COUNT(DISTINCT ms.spotify_uri) AS n
		 FROM ml_submissions ms
		 JOIN ytm_link_cache ytc ON ytc.spotify_uri = ms.spotify_uri
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
