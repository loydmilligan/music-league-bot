/**
 * Tests for ui/src/lib/queueWorker.ts — unified metadata queue worker.
 *
 * Uses openLeagueDb(':memory:') for DB isolation. Provider functions are
 * mocked with vi.mock() so no real network or subprocess calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openLeagueDb } from './db/client.js';
import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Mock all external providers before importing the worker
// ---------------------------------------------------------------------------

vi.mock('./songlink.js', () => ({
	resolveYtmLink: vi.fn()
}));

vi.mock('./lastfm.js', () => ({
	fetchPopularity: vi.fn(),
	fetchTags: vi.fn()
}));

vi.mock('./lrclib.js', () => ({
	fetchLyrics: vi.fn()
}));

vi.mock('./sintel.js', () => ({
	analyzeTrack: vi.fn()
}));

import { runWorkerTick, getSongMeta, resetOrphanedJobs } from './queueWorker.js';
import { resolveYtmLink } from './songlink.js';
import { fetchPopularity, fetchTags } from './lastfm.js';
import { fetchLyrics } from './lrclib.js';
import { analyzeTrack } from './sintel.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshDb(): Database.Database {
	return openLeagueDb(':memory:');
}

function enqueueJob(
	db: Database.Database,
	spotifyUri: string,
	jobType: string,
	retries = 0
): number {
	const result = db
		.prepare(
			`INSERT INTO song_metadata_queue (spotify_uri, job_type, status, retries, queued_at)
			 VALUES (?, ?, 'pending', ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
		)
		.run(spotifyUri, jobType, retries);
	return result.lastInsertRowid as number;
}

function getJob(db: Database.Database, id: number) {
	return db
		.prepare('SELECT * FROM song_metadata_queue WHERE id = ?')
		.get(id) as Record<string, unknown>;
}

function insertSubmission(db: Database.Database, spotifyUri: string, title: string, artists: string) {
	// Insert minimal dependency chain: leagues → seasons → rounds → ml_submissions
	db.prepare(
		`INSERT OR IGNORE INTO leagues (id, slug, name) VALUES (1, 'test-league', 'Test League')`
	).run();
	db.prepare(
		`INSERT OR IGNORE INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')`
	).run();
	db.prepare(
		`INSERT OR IGNORE INTO rounds (id, season_id, ml_round_id, name, created_at)
		 VALUES (1, 1, 'ml-round-1', 'Test Round', '2024-01-01T00:00:00Z')`
	).run();
	db.prepare(
		`INSERT OR IGNORE INTO ml_submissions (spotify_uri, title, artists, round_id, created_at)
		 VALUES (?, ?, ?, 1, '2024-01-01T00:00:00Z')`
	).run(spotifyUri, title, artists);
}

// ---------------------------------------------------------------------------
// getSongMeta
// ---------------------------------------------------------------------------

describe('getSongMeta', () => {
	it('returns empty strings when no matching song', () => {
		const db = freshDb();
		const meta = getSongMeta(db, 'spotify:track:unknown');
		expect(meta).toEqual({ title: '', artist: '' });
	});

	it('returns title + artists from ml_submissions', () => {
		const db = freshDb();
		insertSubmission(db, 'spotify:track:abc', 'My Song', 'Cool Artist');
		const meta = getSongMeta(db, 'spotify:track:abc');
		expect(meta).toEqual({ title: 'My Song', artist: 'Cool Artist' });
	});

	it('falls back to shortlist_songs when not in ml_submissions', () => {
		const db = freshDb();
		db.prepare(
			`INSERT INTO shortlist_songs (id, spotify_uri, title, artist, added_at)
			 VALUES ('id1', ?, ?, ?, '2024-01-01T00:00:00Z')`
		).run('spotify:track:xyz', 'Short Song', 'Short Artist');
		const meta = getSongMeta(db, 'spotify:track:xyz');
		expect(meta).toEqual({ title: 'Short Song', artist: 'Short Artist' });
	});
});

// ---------------------------------------------------------------------------
// runWorkerTick — idle when queue is empty
// ---------------------------------------------------------------------------

describe('runWorkerTick — empty queue', () => {
	it('returns idle when no pending jobs', async () => {
		const db = freshDb();
		const result = await runWorkerTick(db);
		expect(result).toBe('idle');
	});
});

// ---------------------------------------------------------------------------
// runWorkerTick — ytm handler
// ---------------------------------------------------------------------------

describe('runWorkerTick — ytm', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('marks job done and inserts ytm_link_cache on success', async () => {
		const db = freshDb();
		const uri = 'spotify:track:ytm1';
		const id = enqueueJob(db, uri, 'ytm');
		vi.mocked(resolveYtmLink).mockResolvedValue('https://music.youtube.com/watch?v=abc');

		const result = await runWorkerTick(db);
		expect(result).toBe('processed');

		const job = getJob(db, id);
		expect(job.status).toBe('done');
		expect(job.done_at).toBeTruthy();

		const cache = db
			.prepare('SELECT ytm_url FROM ytm_link_cache WHERE spotify_uri = ?')
			.get(uri) as { ytm_url: string } | undefined;
		expect(cache?.ytm_url).toBe('https://music.youtube.com/watch?v=abc');
	});

	it('marks job done (no cache insert) when resolveYtmLink returns null', async () => {
		const db = freshDb();
		const uri = 'spotify:track:ytm2';
		const id = enqueueJob(db, uri, 'ytm');
		vi.mocked(resolveYtmLink).mockResolvedValue(null);

		const result = await runWorkerTick(db);
		expect(result).toBe('processed');

		const job = getJob(db, id);
		expect(job.status).toBe('done');

		const cache = db
			.prepare('SELECT ytm_url FROM ytm_link_cache WHERE spotify_uri = ?')
			.get(uri);
		expect(cache).toBeUndefined();
	});

	it('retries on failure (retries < 3)', async () => {
		const db = freshDb();
		const uri = 'spotify:track:ytmFail';
		const id = enqueueJob(db, uri, 'ytm', 0);
		vi.mocked(resolveYtmLink).mockRejectedValue(new Error('network error'));

		await runWorkerTick(db);

		const job = getJob(db, id);
		expect(job.status).toBe('pending');
		expect(job.retries).toBe(1);
		expect(job.error).toMatch(/network error/);
	});

	it('marks failed permanently when retries >= 3', async () => {
		const db = freshDb();
		const uri = 'spotify:track:ytmPerm';
		// retries already at MAX_RETRIES (3), so job.retries(3) >= 3 → fail permanently
		const id = enqueueJob(db, uri, 'ytm', 3);
		vi.mocked(resolveYtmLink).mockRejectedValue(new Error('persistent error'));

		await runWorkerTick(db);

		const job = getJob(db, id);
		expect(job.status).toBe('failed');
		expect(job.retries).toBe(4);
	});
});

// ---------------------------------------------------------------------------
// runWorkerTick — lastfm_pop handler
// ---------------------------------------------------------------------------

describe('runWorkerTick — lastfm_pop', () => {
	beforeEach(() => vi.clearAllMocks());

	it('calls fetchPopularity with song meta and marks done', async () => {
		const db = freshDb();
		const uri = 'spotify:track:lfm1';
		insertSubmission(db, uri, 'Popular Song', 'Pop Artist');
		const id = enqueueJob(db, uri, 'lastfm_pop');
		vi.mocked(fetchPopularity).mockResolvedValue(undefined);

		await runWorkerTick(db);

		expect(fetchPopularity).toHaveBeenCalledWith(db, uri, 'Popular Song', 'Pop Artist');
		expect(getJob(db, id).status).toBe('done');
	});
});

// ---------------------------------------------------------------------------
// runWorkerTick — lastfm_tags handler
// ---------------------------------------------------------------------------

describe('runWorkerTick — lastfm_tags', () => {
	beforeEach(() => vi.clearAllMocks());

	it('calls fetchTags and marks done', async () => {
		const db = freshDb();
		const uri = 'spotify:track:tags1';
		insertSubmission(db, uri, 'Tagged Song', 'Tag Artist');
		const id = enqueueJob(db, uri, 'lastfm_tags');
		vi.mocked(fetchTags).mockResolvedValue(undefined);

		await runWorkerTick(db);

		expect(fetchTags).toHaveBeenCalledWith(db, uri, 'Tagged Song', 'Tag Artist');
		expect(getJob(db, id).status).toBe('done');
	});
});

// ---------------------------------------------------------------------------
// runWorkerTick — lyrics handler
// ---------------------------------------------------------------------------

describe('runWorkerTick — lyrics', () => {
	beforeEach(() => vi.clearAllMocks());

	it('calls fetchLyrics and marks done', async () => {
		const db = freshDb();
		const uri = 'spotify:track:lyr1';
		insertSubmission(db, uri, 'Lyric Song', 'Lyric Artist');
		const id = enqueueJob(db, uri, 'lyrics');
		vi.mocked(fetchLyrics).mockResolvedValue(undefined);

		await runWorkerTick(db);

		expect(fetchLyrics).toHaveBeenCalledWith(db, uri, 'Lyric Song', 'Lyric Artist');
		expect(getJob(db, id).status).toBe('done');
	});
});

// ---------------------------------------------------------------------------
// runWorkerTick — audio handler
// ---------------------------------------------------------------------------

describe('runWorkerTick — audio', () => {
	beforeEach(() => vi.clearAllMocks());

	it('calls analyzeTrack and inserts song_audio_features on success', async () => {
		const db = freshDb();
		const uri = 'spotify:track:audio1';
		const id = enqueueJob(db, uri, 'audio');
		vi.mocked(analyzeTrack).mockResolvedValue({
			spotify_uri: uri,
			bpm: 120,
			key: 'C',
			scale: 'major',
			energy: 0.8,
			duration_s: 200
		});

		await runWorkerTick(db);

		expect(analyzeTrack).toHaveBeenCalledWith(uri);
		expect(getJob(db, id).status).toBe('done');

		const row = db
			.prepare('SELECT * FROM song_audio_features WHERE spotify_uri = ?')
			.get(uri) as Record<string, unknown> | undefined;
		expect(row?.bpm).toBe(120);
		expect(row?.key).toBe('C');
		expect(row?.scale).toBe('major');
		expect(row?.energy).toBe(0.8);
		expect(row?.duration_s).toBe(200);
	});

	it('skips audio jobs when another audio is processing (1-concurrent limit)', async () => {
		const db = freshDb();

		// Manually place an audio job in 'processing' state.
		db.prepare(
			`INSERT INTO song_metadata_queue (spotify_uri, job_type, status, retries, queued_at, started_at)
			 VALUES ('spotify:track:inprogress', 'audio', 'processing', 0,
			         strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
		).run();

		// Enqueue another audio job.
		const id = enqueueJob(db, 'spotify:track:audio2', 'audio');

		const result = await runWorkerTick(db);

		// The tick should return idle (no non-audio pending jobs either).
		expect(result).toBe('idle');
		// The pending audio job must remain pending.
		expect(getJob(db, id).status).toBe('pending');
		expect(analyzeTrack).not.toHaveBeenCalled();
	});

	it('processes a fast job when audio is blocked', async () => {
		const db = freshDb();

		// Manually place an audio job in 'processing' state.
		db.prepare(
			`INSERT INTO song_metadata_queue (spotify_uri, job_type, status, retries, queued_at, started_at)
			 VALUES ('spotify:track:inprogress2', 'audio', 'processing', 0,
			         strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
		).run();

		// Enqueue audio job (should be skipped) and a fast job (should run).
		enqueueJob(db, 'spotify:track:blocked', 'audio');
		const fastId = enqueueJob(db, 'spotify:track:fast1', 'lyrics');
		vi.mocked(fetchLyrics).mockResolvedValue(undefined);

		const result = await runWorkerTick(db);

		expect(result).toBe('processed');
		expect(fetchLyrics).toHaveBeenCalled();
		expect(getJob(db, fastId).status).toBe('done');
	});
});

// ---------------------------------------------------------------------------
// runWorkerTick — fast jobs preferred over audio
// ---------------------------------------------------------------------------

describe('runWorkerTick — job priority', () => {
	beforeEach(() => vi.clearAllMocks());

	it('picks fast job before audio when both are pending', async () => {
		const db = freshDb();

		// Enqueue audio first (earlier queued_at), then a fast job.
		const audioId = enqueueJob(db, 'spotify:track:audioFirst', 'audio');
		const fastId = enqueueJob(db, 'spotify:track:fastSecond', 'lyrics');
		vi.mocked(fetchLyrics).mockResolvedValue(undefined);

		await runWorkerTick(db);

		// Fast job should have been processed, audio still pending.
		expect(getJob(db, fastId).status).toBe('done');
		expect(getJob(db, audioId).status).toBe('pending');
		expect(fetchLyrics).toHaveBeenCalled();
		expect(analyzeTrack).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// runWorkerTick — optimistic lock (skipped tick)
// ---------------------------------------------------------------------------

describe('runWorkerTick — optimistic lock', () => {
	// NOTE: The true optimistic-lock 'skipped' path (SELECT finds pending, but
	// UPDATE claims 0 rows because another worker grabbed it between SELECT and
	// UPDATE) requires intercepting the DB at statement level. The path is
	// covered by the code structure (claimed.changes === 0 → return 'skipped')
	// but not exercised in isolation here.
	it('returns idle when the only job is already processing (no pending jobs)', async () => {
		const db = freshDb();
		const uri = 'spotify:track:race';
		const id = enqueueJob(db, uri, 'ytm');

		// Manually mark it processing — SELECT finds no pending jobs → idle.
		db.prepare(`UPDATE song_metadata_queue SET status='processing' WHERE id=?`).run(id);

		const result = await runWorkerTick(db);
		expect(result).toBe('idle'); // No pending jobs remain, so idle
	});
});

// ---------------------------------------------------------------------------
// Stuck-job recovery — metadata queue "audio stuck in processing" fix
// ---------------------------------------------------------------------------

function insertProcessingAudio(
	db: Database.Database,
	spotifyUri: string,
	opts: { retries?: number; ageSeconds?: number } = {}
): number {
	const { retries = 0, ageSeconds = 0 } = opts;
	const startedExpr =
		ageSeconds > 0
			? `strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now', '-${ageSeconds} seconds'))`
			: `strftime('%Y-%m-%dT%H:%M:%SZ','now')`;
	const result = db
		.prepare(
			`INSERT INTO song_metadata_queue (spotify_uri, job_type, status, retries, queued_at, started_at)
			 VALUES (?, 'audio', 'processing', ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), ${startedExpr})`
		)
		.run(spotifyUri, retries);
	return result.lastInsertRowid as number;
}

describe('resetOrphanedJobs — startup recovery', () => {
	it('resets every processing row to pending (orphaned by a prior process)', () => {
		const db = freshDb();
		const audioId = insertProcessingAudio(db, 'spotify:track:stuckaudio', { retries: 1 });
		const ytmId = db
			.prepare(
				`INSERT INTO song_metadata_queue (spotify_uri, job_type, status, retries, queued_at, started_at)
				 VALUES ('spotify:track:stuckytm', 'ytm', 'processing', 0,
				         strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
			)
			.run().lastInsertRowid as number;

		const n = resetOrphanedJobs(db);

		expect(n).toBe(2);
		expect(getJob(db, audioId).status).toBe('pending');
		expect(getJob(db, audioId).started_at).toBeNull();
		expect(getJob(db, ytmId).status).toBe('pending');
	});

	it('leaves pending / done / failed rows untouched', () => {
		const db = freshDb();
		const pendingId = enqueueJob(db, 'spotify:track:p', 'audio');
		db.prepare(
			`INSERT INTO song_metadata_queue (spotify_uri, job_type, status, queued_at)
			 VALUES ('spotify:track:d', 'ytm', 'done', strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
		).run();

		const n = resetOrphanedJobs(db);

		expect(n).toBe(0);
		expect(getJob(db, pendingId).status).toBe('pending');
	});
});

describe('runWorkerTick — stale audio recovery', () => {
	beforeEach(() => vi.clearAllMocks());

	it('recovers an audio job stuck in processing past the stale threshold', async () => {
		const db = freshDb();
		// A lone audio job that has been 'processing' for 10 minutes — the classic
		// permanently-stuck row that otherwise blocks every future audio job.
		const id = insertProcessingAudio(db, 'spotify:track:stale', { ageSeconds: 600 });
		vi.mocked(analyzeTrack).mockResolvedValue({
			spotify_uri: 'spotify:track:stale', bpm: 120, key: 'C', scale: 'major', energy: 0.5, duration_s: 180,
		});

		const result = await runWorkerTick(db);

		// Recovered to pending, then claimed + dispatched within the same tick.
		expect(result).toBe('processed');
		expect(analyzeTrack).toHaveBeenCalledTimes(1);
		expect(getJob(db, id).status).toBe('done');
	});

	it('marks a stale audio job failed once retries are exhausted', async () => {
		const db = freshDb();
		const id = insertProcessingAudio(db, 'spotify:track:staledead', { retries: 3, ageSeconds: 600 });

		await runWorkerTick(db);

		expect(getJob(db, id).status).toBe('failed');
		expect(analyzeTrack).not.toHaveBeenCalled();
	});

	it('does NOT reset a fresh processing audio job (still 1-concurrent blocked)', async () => {
		const db = freshDb();
		const freshId = insertProcessingAudio(db, 'spotify:track:fresh'); // started just now
		const pendingId = enqueueJob(db, 'spotify:track:waiting', 'audio');

		const result = await runWorkerTick(db);

		expect(getJob(db, freshId).status).toBe('processing'); // untouched
		expect(getJob(db, pendingId).status).toBe('pending'); // still blocked
		expect(analyzeTrack).not.toHaveBeenCalled();
		expect(result).toBe('idle');
	});
});
