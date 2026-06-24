/**
 * queueWorker.ts — Unified metadata queue worker.
 *
 * Dispatches across all 5 job types from song_metadata_queue:
 *   ytm          → resolveYtmLink (Songlink / Odesli)
 *   lastfm_pop   → fetchPopularity (Last.fm)
 *   lastfm_tags  → fetchTags (Last.fm)
 *   audio        → analyzeTrack (sintel) — 1-concurrent hard limit
 *   lyrics       → fetchLyrics (LRCLIB)
 *
 * Rate limit: one job per 6s tick. Audio jobs are additionally gated to
 * 1-concurrent — if an audio job is already processing, audio is skipped
 * this tick (other job types proceed normally).
 *
 * Retry semantics:
 *   - On failure with retries < 3: increment retries, reset to 'pending'
 *   - On failure with retries >= 3: mark 'failed' permanently
 *   - Manual retry (via retryJob from metadataQueue.ts) resets retries = 0
 *
 */

import { getDb } from './db/client.js';
import { resolveYtmLink } from './songlink.js';
import { fetchPopularity, fetchTags } from './lastfm.js';
import { fetchLyrics } from './lrclib.js';
import { analyzeTrack, type AudioFeatures } from './sintel.js';
import type Database from 'better-sqlite3';

const POLL_MS = 6_000;
const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingJob {
	id: number;
	spotify_uri: string;
	job_type: string;
	retries: number;
}

interface SongMeta {
	title: string;
	artist: string;
}

// ---------------------------------------------------------------------------
// Song metadata lookup (title + artist for external API calls)
// ---------------------------------------------------------------------------

/**
 * Returns title and artist for a spotify_uri.
 * Prefers ml_submissions; falls back to shortlist_songs; finally returns
 * empty strings (providers will 404 gracefully or throw — handled by retry).
 */
export function getSongMeta(db: Database.Database, spotifyUri: string): SongMeta {
	const fromSubmissions = db
		.prepare('SELECT title, artists FROM ml_submissions WHERE spotify_uri = ? LIMIT 1')
		.get(spotifyUri) as { title: string; artists: string } | undefined;
	if (fromSubmissions) {
		return { title: fromSubmissions.title ?? '', artist: fromSubmissions.artists ?? '' };
	}

	const fromShortlist = db
		.prepare('SELECT title, artist FROM shortlist_songs WHERE spotify_uri = ? LIMIT 1')
		.get(spotifyUri) as { title: string; artist: string } | undefined;
	if (fromShortlist) {
		return { title: fromShortlist.title ?? '', artist: fromShortlist.artist ?? '' };
	}

	return { title: '', artist: '' };
}

// ---------------------------------------------------------------------------
// Job dispatch
// ---------------------------------------------------------------------------

async function dispatchJob(
	db: Database.Database,
	job: PendingJob,
	meta: SongMeta
): Promise<void> {
	const { spotify_uri, job_type } = job;
	const { title, artist } = meta;

	switch (job_type) {
		case 'ytm': {
			const ytmUrl = await resolveYtmLink(spotify_uri);
			if (ytmUrl) {
				const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
				db.prepare(
					'INSERT OR REPLACE INTO ytm_link_cache (spotify_uri, ytm_url, resolved_at) VALUES (?, ?, ?)'
				).run(spotify_uri, ytmUrl, now);
			}
			// null result (Songlink has no YTM link) is not a failure — mark done.
			break;
		}
		case 'lastfm_pop':
			await fetchPopularity(db, spotify_uri, title, artist);
			break;
		case 'lastfm_tags':
			await fetchTags(db, spotify_uri, title, artist);
			break;
		case 'audio': {
			const features: AudioFeatures = await analyzeTrack(spotify_uri);
			const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
			db.prepare(
				`INSERT OR REPLACE INTO song_audio_features
				 (spotify_uri, bpm, key, scale, energy, duration_s, analyzed_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`
			).run(
				features.spotify_uri,
				features.bpm,
				features.key,
				features.scale,
				features.energy,
				features.duration_s,
				now
			);
			break;
		}
		case 'lyrics':
			await fetchLyrics(db, spotify_uri, title, artist);
			break;
		default:
			throw new Error(`Unknown job_type: ${job_type}`);
	}
}

// ---------------------------------------------------------------------------
// Tick logic (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Run one worker tick. Picks the next eligible pending job, claims it with an
 * optimistic lock, dispatches it, and records success or failure.
 *
 * Returns 'processed' | 'idle' | 'skipped' for test observability.
 */
export async function runWorkerTick(db: Database.Database): Promise<'processed' | 'idle' | 'skipped'> {
	// Check if any audio job is currently processing (1-concurrent limit).
	const audioProcessing = db
		.prepare(`SELECT COUNT(*) AS n FROM song_metadata_queue WHERE job_type='audio' AND status='processing'`)
		.get() as { n: number };
	const audioBlocked = audioProcessing.n > 0;

	// Pick next pending job. Prefer fast jobs (non-audio) over audio.
	// If audio is blocked, exclude audio entirely this tick.
	const query = audioBlocked
		? `SELECT id, spotify_uri, job_type, retries
		   FROM song_metadata_queue
		   WHERE status='pending' AND job_type != 'audio'
		   ORDER BY queued_at ASC LIMIT 1`
		: `SELECT id, spotify_uri, job_type, retries
		   FROM song_metadata_queue
		   WHERE status='pending'
		   ORDER BY CASE WHEN job_type='audio' THEN 1 ELSE 0 END ASC, queued_at ASC
		   LIMIT 1`;

	const job = db.prepare(query).get() as PendingJob | undefined;
	if (!job) return 'idle';

	// Optimistic claim: only proceed if we actually updated the row.
	const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
	const claimed = db
		.prepare(
			`UPDATE song_metadata_queue
			 SET status='processing', started_at=?
			 WHERE id=? AND status='pending'`
		)
		.run(now, job.id);

	if (claimed.changes === 0) {
		// Another worker claimed it first.
		return 'skipped';
	}

	const meta = getSongMeta(db, job.spotify_uri);

	try {
		await dispatchJob(db, job, meta);

		const doneAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
		db.prepare(
			`UPDATE song_metadata_queue SET status='done', done_at=? WHERE id=?`
		).run(doneAt, job.id);

		return 'processed';
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		const newRetries = (job.retries ?? 0) + 1;

		if (job.retries < MAX_RETRIES) {
			// Auto-retry: increment retries, reset to pending.
			db.prepare(
				`UPDATE song_metadata_queue
				 SET status='pending', retries=?, error=?, started_at=NULL
				 WHERE id=?`
			).run(newRetries, errorMsg, job.id);
		} else {
			// Circuit open: mark failed permanently.
			db.prepare(
				`UPDATE song_metadata_queue
				 SET status='failed', retries=?, error=?
				 WHERE id=?`
			).run(newRetries, errorMsg, job.id);
		}

		return 'processed';
	}
}

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the unified metadata queue worker.
 * Called once from hooks.server.ts at startup.
 */
export function startQueueWorker(): void {
	setInterval(() => {
		const db = getDb();
		runWorkerTick(db).catch((err) => {
			console.error('[queueWorker] tick error:', err);
		});
	}, POLL_MS);
}
