/**
 * Tests for metadataQueue.ts — unified song_metadata_queue helpers.
 *
 * Uses an in-memory SQLite DB (openLeagueDb(':memory:')) so each describe
 * block starts from a clean state without touching the filesystem.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from './client.js';
import type Database from 'better-sqlite3';
import {
	enqueue,
	enqueueMany,
	getQueueStatus,
	getFailures,
	retryJob,
	getCoverageMatrix,
	getDigestReadiness,
	type JobType
} from './metadataQueue.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshDb(): Database.Database {
	return openLeagueDb(':memory:');
}

/** Seed minimal relational data needed for round-scoped queries. */
function seedRoundWithSubmissions(
	db: Database.Database,
	roundId: number,
	uris: string[]
): void {
	// league → season → round → submissions (no competitor needed for anon rows)
	db.prepare(
		`INSERT OR IGNORE INTO leagues (id, slug, name) VALUES (1, 'test', 'Test League')`
	).run();
	db.prepare(
		`INSERT OR IGNORE INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')`
	).run();
	db.prepare(
		`INSERT OR IGNORE INTO rounds (id, season_id, ml_round_id, name, created_at)
		 VALUES (?, 1, 'ml-' || ?, 'Round ' || ?, datetime('now'))`
	).run(roundId, roundId, roundId);
	for (const uri of uris) {
		// competitor_id NULL → uses the anon partial index
		db.prepare(
			`INSERT OR IGNORE INTO ml_submissions (round_id, spotify_uri, title, artists, created_at)
			 VALUES (?, ?, 'Title', 'Artist', datetime('now'))`
		).run(roundId, uri);
	}
}

// ---------------------------------------------------------------------------
// enqueue / enqueueMany
// ---------------------------------------------------------------------------

describe('enqueue', () => {
	it('inserts a pending row', () => {
		const db = freshDb();
		enqueue(db, 'spotify:track:AAA', 'ytm');
		const row = db.prepare("SELECT * FROM song_metadata_queue WHERE spotify_uri='spotify:track:AAA'").get() as {
			job_type: string;
			status: string;
			retries: number;
		};
		expect(row.job_type).toBe('ytm');
		expect(row.status).toBe('pending');
		expect(row.retries).toBe(0);
	});

	it('is idempotent (INSERT OR IGNORE)', () => {
		const db = freshDb();
		enqueue(db, 'spotify:track:AAA', 'ytm');
		enqueue(db, 'spotify:track:AAA', 'ytm'); // second call should be a no-op
		const count = (
			db.prepare("SELECT COUNT(*) n FROM song_metadata_queue WHERE spotify_uri='spotify:track:AAA' AND job_type='ytm'").get() as { n: number }
		).n;
		expect(count).toBe(1);
	});

	it('allows the same URI with different job types', () => {
		const db = freshDb();
		enqueue(db, 'spotify:track:AAA', 'ytm');
		enqueue(db, 'spotify:track:AAA', 'lastfm_pop');
		const count = (
			db.prepare("SELECT COUNT(*) n FROM song_metadata_queue WHERE spotify_uri='spotify:track:AAA'").get() as { n: number }
		).n;
		expect(count).toBe(2);
	});
});

describe('enqueueMany', () => {
	it('enqueues all uri × jobType combinations', () => {
		const db = freshDb();
		enqueueMany(
			db,
			['spotify:track:A', 'spotify:track:B'],
			['ytm', 'lastfm_pop']
		);
		const count = (
			db.prepare('SELECT COUNT(*) n FROM song_metadata_queue').get() as { n: number }
		).n;
		expect(count).toBe(4); // 2 URIs × 2 job types
	});

	it('is idempotent — re-running produces no duplicates', () => {
		const db = freshDb();
		const uris = ['spotify:track:A'];
		const jobs: JobType[] = ['ytm', 'audio'];
		enqueueMany(db, uris, jobs);
		enqueueMany(db, uris, jobs);
		const count = (
			db.prepare('SELECT COUNT(*) n FROM song_metadata_queue').get() as { n: number }
		).n;
		expect(count).toBe(2);
	});

	it('handles empty arrays gracefully', () => {
		const db = freshDb();
		expect(() => enqueueMany(db, [], ['ytm'])).not.toThrow();
		expect(() => enqueueMany(db, ['spotify:track:A'], [])).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// getQueueStatus
// ---------------------------------------------------------------------------

describe('getQueueStatus', () => {
	it('returns zero counts for an empty queue', () => {
		const db = freshDb();
		const status = getQueueStatus(db);
		expect(status.totalPending).toBe(0);
		expect(status.totalProcessing).toBe(0);
		expect(status.failures).toHaveLength(0);
	});

	it('counts by job type and status', () => {
		const db = freshDb();
		enqueue(db, 'spotify:track:A', 'ytm');
		enqueue(db, 'spotify:track:B', 'ytm');
		// manually set one to processing
		db.prepare("UPDATE song_metadata_queue SET status='processing' WHERE spotify_uri='spotify:track:B'").run();
		enqueue(db, 'spotify:track:C', 'lastfm_pop');
		db.prepare("UPDATE song_metadata_queue SET status='failed', error='oops' WHERE spotify_uri='spotify:track:C'").run();

		const status = getQueueStatus(db);
		expect(status.totalPending).toBe(1);
		expect(status.totalProcessing).toBe(1);
		expect(status.byJobType['ytm'].pending).toBe(1);
		expect(status.byJobType['ytm'].processing).toBe(1);
		expect(status.byJobType['lastfm_pop'].failed).toBe(1);
		expect(status.failures).toHaveLength(1);
		expect(status.failures[0].spotify_uri).toBe('spotify:track:C');
	});

	it('scopes to a round when roundId provided', () => {
		const db = freshDb();
		seedRoundWithSubmissions(db, 1, ['spotify:track:inRound']);
		enqueue(db, 'spotify:track:inRound', 'ytm');
		enqueue(db, 'spotify:track:notInRound', 'ytm');

		const status = getQueueStatus(db, 1);
		// Only the in-round submission should be counted
		expect(status.totalPending).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// getFailures
// ---------------------------------------------------------------------------

describe('getFailures', () => {
	it('returns only failed rows', () => {
		const db = freshDb();
		enqueue(db, 'spotify:track:A', 'ytm');
		enqueue(db, 'spotify:track:B', 'lastfm_pop');
		db.prepare("UPDATE song_metadata_queue SET status='failed', error='err', retries=2 WHERE spotify_uri='spotify:track:B'").run();

		const failures = getFailures(db);
		expect(failures).toHaveLength(1);
		expect(failures[0].job_type).toBe('lastfm_pop');
		expect(failures[0].error).toBe('err');
		expect(failures[0].retries).toBe(2);
	});

	it('scopes to a round', () => {
		const db = freshDb();
		seedRoundWithSubmissions(db, 1, ['spotify:track:inRound']);
		enqueue(db, 'spotify:track:inRound', 'ytm');
		enqueue(db, 'spotify:track:other', 'ytm');
		db.prepare("UPDATE song_metadata_queue SET status='failed', error='e'").run();

		const failures = getFailures(db, 1);
		expect(failures).toHaveLength(1);
		expect(failures[0].spotify_uri).toBe('spotify:track:inRound');
	});
});

// ---------------------------------------------------------------------------
// retryJob
// ---------------------------------------------------------------------------

describe('retryJob', () => {
	it('resets status to pending and clears error and retries', () => {
		const db = freshDb();
		enqueue(db, 'spotify:track:A', 'ytm');
		db.prepare("UPDATE song_metadata_queue SET status='failed', error='boom', retries=3").run();

		const id = (
			db.prepare("SELECT id FROM song_metadata_queue WHERE spotify_uri='spotify:track:A'").get() as { id: number }
		).id;

		retryJob(db, id);

		const row = db.prepare("SELECT * FROM song_metadata_queue WHERE id=?").get(id) as {
			status: string;
			error: string | null;
			retries: number;
		};
		expect(row.status).toBe('pending');
		expect(row.error).toBeNull();
		expect(row.retries).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// getCoverageMatrix
// ---------------------------------------------------------------------------

describe('getCoverageMatrix', () => {
	it('returns empty array for a round with no submissions', () => {
		const db = freshDb();
		seedRoundWithSubmissions(db, 1, []);
		const matrix = getCoverageMatrix(db, 1);
		expect(matrix).toHaveLength(0);
	});

	it('marks missing for jobs not in the queue', () => {
		const db = freshDb();
		seedRoundWithSubmissions(db, 1, ['spotify:track:A']);
		const matrix = getCoverageMatrix(db, 1);
		expect(matrix).toHaveLength(1);
		expect(matrix[0].spotify_uri).toBe('spotify:track:A');
		// All job types should be 'missing' since nothing is queued
		for (const status of Object.values(matrix[0].jobs)) {
			expect(status).toBe('missing');
		}
	});

	it('reflects actual queue status for queued jobs', () => {
		const db = freshDb();
		seedRoundWithSubmissions(db, 1, ['spotify:track:A']);
		enqueue(db, 'spotify:track:A', 'ytm');
		db.prepare("UPDATE song_metadata_queue SET status='done' WHERE spotify_uri='spotify:track:A' AND job_type='ytm'").run();
		enqueue(db, 'spotify:track:A', 'lastfm_pop'); // stays pending

		const matrix = getCoverageMatrix(db, 1);
		expect(matrix[0].jobs['ytm']).toBe('done');
		expect(matrix[0].jobs['lastfm_pop']).toBe('pending');
		expect(matrix[0].jobs['audio']).toBe('missing');
	});

	it('does not include submissions from other rounds', () => {
		const db = freshDb();
		seedRoundWithSubmissions(db, 1, ['spotify:track:A']);
		seedRoundWithSubmissions(db, 2, ['spotify:track:B']);
		const matrix = getCoverageMatrix(db, 1);
		expect(matrix).toHaveLength(1);
		expect(matrix[0].spotify_uri).toBe('spotify:track:A');
	});
});

// ---------------------------------------------------------------------------
// getDigestReadiness
// ---------------------------------------------------------------------------

describe('getDigestReadiness', () => {
	it('returns all ok:false with count 0 for round with no submissions', () => {
		const db = freshDb();
		seedRoundWithSubmissions(db, 1, []);
		const readiness = getDigestReadiness(db, 1);
		for (const item of Object.values(readiness)) {
			expect(item.ok).toBe(false);
			expect(item.count).toBe(0);
			expect(item.total).toBe(0);
		}
	});

	it('ytm: ok=true only when 100% of submissions have a ytm_link_cache row', () => {
		const db = freshDb();
		seedRoundWithSubmissions(db, 1, ['spotify:track:A', 'spotify:track:B']);

		// seed ytm_link_cache for only one
		db.prepare(
			`INSERT INTO ytm_link_cache (spotify_uri, ytm_url, resolved_at) VALUES ('spotify:track:A', 'https://ytm.test', datetime('now'))`
		).run();

		let readiness = getDigestReadiness(db, 1);
		expect(readiness.ytm.ok).toBe(false);
		expect(readiness.ytm.count).toBe(1);
		expect(readiness.ytm.total).toBe(2);

		// seed the second
		db.prepare(
			`INSERT INTO ytm_link_cache (spotify_uri, ytm_url, resolved_at) VALUES ('spotify:track:B', 'https://ytm.test2', datetime('now'))`
		).run();
		readiness = getDigestReadiness(db, 1);
		expect(readiness.ytm.ok).toBe(true);
	});

	it('lastfm_pop: ok=true at ≥80% coverage', () => {
		const db = freshDb();
		const uris = Array.from({ length: 5 }, (_, i) => `spotify:track:${i}`);
		seedRoundWithSubmissions(db, 1, uris);

		// seed song_popularity for 4 of 5 (80%)
		for (const uri of uris.slice(0, 4)) {
			db.prepare(
				`INSERT INTO song_popularity (spotify_uri, artist, title, fetched_at) VALUES (?, 'A', 'T', datetime('now'))`
			).run(uri);
		}

		const readiness = getDigestReadiness(db, 1);
		expect(readiness.lastfm_pop.ok).toBe(true);
		expect(readiness.lastfm_pop.count).toBe(4);

		// Drop to 3/5 (60%) → not ok
		db.prepare("DELETE FROM song_popularity").run();
		for (const uri of uris.slice(0, 3)) {
			db.prepare(
				`INSERT INTO song_popularity (spotify_uri, artist, title, fetched_at) VALUES (?, 'A', 'T', datetime('now'))`
			).run(uri);
		}
		const readiness2 = getDigestReadiness(db, 1);
		expect(readiness2.lastfm_pop.ok).toBe(false);
	});

	it('lastfm_tags: proxied via song_metadata_queue done rows', () => {
		const db = freshDb();
		const uris = Array.from({ length: 5 }, (_, i) => `spotify:track:${i}`);
		seedRoundWithSubmissions(db, 1, uris);

		// Mark 4/5 as done in the queue (80%)
		for (const uri of uris.slice(0, 4)) {
			enqueue(db, uri, 'lastfm_tags');
			db.prepare(
				`UPDATE song_metadata_queue SET status='done' WHERE spotify_uri=? AND job_type='lastfm_tags'`
			).run(uri);
		}

		const readiness = getDigestReadiness(db, 1);
		expect(readiness.lastfm_tags.ok).toBe(true);
		expect(readiness.lastfm_tags.count).toBe(4);
	});

	it('lyrics: checks song_lyrics_metrics table', () => {
		const db = freshDb();
		const uris = ['spotify:track:X', 'spotify:track:Y'];
		seedRoundWithSubmissions(db, 1, uris);

		db.prepare(
			`INSERT INTO song_lyrics_metrics (spotify_uri, has_lyrics, fetched_at) VALUES ('spotify:track:X', 1, datetime('now'))`
		).run();
		db.prepare(
			`INSERT INTO song_lyrics_metrics (spotify_uri, has_lyrics, fetched_at) VALUES ('spotify:track:Y', 0, datetime('now'))`
		).run();

		const readiness = getDigestReadiness(db, 1);
		// 2/2 have a lyrics row = 100% ≥ 80% → ok
		expect(readiness.lyrics.ok).toBe(true);
		expect(readiness.lyrics.count).toBe(2);
	});

	it('audio: checks song_audio_features table', () => {
		const db = freshDb();
		const uris = ['spotify:track:X'];
		seedRoundWithSubmissions(db, 1, uris);

		// No audio features yet
		let readiness = getDigestReadiness(db, 1);
		expect(readiness.audio.ok).toBe(false);
		expect(readiness.audio.count).toBe(0);

		db.prepare(
			`INSERT INTO song_audio_features (spotify_uri, bpm, key, scale, energy, duration_s) VALUES ('spotify:track:X', 120, 'C', 'major', 0.8, 210)`
		).run();
		readiness = getDigestReadiness(db, 1);
		expect(readiness.audio.ok).toBe(true);
		expect(readiness.audio.count).toBe(1);
	});

	it('total in each readiness item reflects the round submission count', () => {
		const db = freshDb();
		seedRoundWithSubmissions(db, 1, ['spotify:track:A', 'spotify:track:B', 'spotify:track:C']);
		const readiness = getDigestReadiness(db, 1);
		for (const item of Object.values(readiness)) {
			expect(item.total).toBe(3);
		}
	});
});

// ---------------------------------------------------------------------------
// song_metadata_queue + song_lyrics_metrics table existence
// ---------------------------------------------------------------------------

describe('schema tables', () => {
	it('song_metadata_queue table exists with correct columns', () => {
		const db = freshDb();
		const cols = (
			db.prepare('PRAGMA table_info(song_metadata_queue)').all() as { name: string }[]
		).map((r) => r.name);
		for (const col of ['id', 'spotify_uri', 'job_type', 'status', 'error', 'retries', 'queued_at', 'started_at', 'done_at']) {
			expect(cols).toContain(col);
		}
	});

	it('song_lyrics_metrics table exists with correct columns', () => {
		const db = freshDb();
		const cols = (
			db.prepare('PRAGMA table_info(song_lyrics_metrics)').all() as { name: string }[]
		).map((r) => r.name);
		for (const col of ['spotify_uri', 'has_lyrics', 'fetched_at']) {
			expect(cols).toContain(col);
		}
	});

	it('ytm_resolution_queue still exists (not removed)', () => {
		const db = freshDb();
		const tables = (
			db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
		).map((r) => r.name);
		expect(tables).toContain('ytm_resolution_queue');
		expect(tables).toContain('song_metadata_queue');
	});
});
