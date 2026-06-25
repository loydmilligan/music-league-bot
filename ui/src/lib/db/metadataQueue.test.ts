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
	classifyFailure,
	getHierarchy,
	getScopeRollup,
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

		const status = getQueueStatus(db, { level: 'round', id: 1 });
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
// seedMultiLeague helper
// ---------------------------------------------------------------------------

/**
 * Creates two leagues, two seasons, two rounds and queue rows across them.
 *
 * League A → Season 1 (season_number=1) → Round 1 "Round 1A"
 *   Submissions: R1a (spotify:track:R1a), R1b (spotify:track:R1b)
 *   Queue: R1a/ytm=done, R1a/lastfm_pop=pending, R1b/ytm=failed
 *
 * League B → Season 2 (season_number=1) → Round 2 "Round 2B"
 *   Submissions: R2a (spotify:track:R2a)
 *   Queue: R2a/ytm=processing
 */
function seedMultiLeague(db: Database.Database): void {
	// Leagues
	db.prepare(`INSERT OR IGNORE INTO leagues (id, slug, name) VALUES (1, 'league-a', 'League A')`).run();
	db.prepare(`INSERT OR IGNORE INTO leagues (id, slug, name) VALUES (2, 'league-b', 'League B')`).run();
	// Seasons
	db.prepare(`INSERT OR IGNORE INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')`).run();
	db.prepare(`INSERT OR IGNORE INTO seasons (id, league_id, season_number, status) VALUES (2, 2, 1, 'active')`).run();
	// Rounds
	db.prepare(`INSERT OR IGNORE INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (1, 1, 'ml-r1', 'Round 1A', datetime('now'))`).run();
	db.prepare(`INSERT OR IGNORE INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (2, 2, 'ml-r2', 'Round 2B', datetime('now'))`).run();
	// Submissions
	db.prepare(`INSERT OR IGNORE INTO ml_submissions (round_id, spotify_uri, title, artists, created_at) VALUES (1, 'spotify:track:R1a', 'Song R1a', 'Artist', datetime('now'))`).run();
	db.prepare(`INSERT OR IGNORE INTO ml_submissions (round_id, spotify_uri, title, artists, created_at) VALUES (1, 'spotify:track:R1b', 'Song R1b', 'Artist', datetime('now'))`).run();
	db.prepare(`INSERT OR IGNORE INTO ml_submissions (round_id, spotify_uri, title, artists, created_at) VALUES (2, 'spotify:track:R2a', 'Song R2a', 'Artist', datetime('now'))`).run();
	// Queue rows
	// R1a/ytm = done (done_at set to a recent timestamp)
	db.prepare(`INSERT OR IGNORE INTO song_metadata_queue (spotify_uri, job_type, status, done_at, queued_at) VALUES ('spotify:track:R1a', 'ytm', 'done', strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now', '-1 hour')), strftime('%Y-%m-%dT%H:%M:%SZ','now'))`).run();
	// R1a/lastfm_pop = pending
	db.prepare(`INSERT OR IGNORE INTO song_metadata_queue (spotify_uri, job_type, status, queued_at) VALUES ('spotify:track:R1a', 'lastfm_pop', 'pending', strftime('%Y-%m-%dT%H:%M:%SZ','now'))`).run();
	// R1b/ytm = failed
	db.prepare(`INSERT OR IGNORE INTO song_metadata_queue (spotify_uri, job_type, status, error, queued_at) VALUES ('spotify:track:R1b', 'ytm', 'failed', 'Track not found', strftime('%Y-%m-%dT%H:%M:%SZ','now'))`).run();
	// R2a/ytm = processing
	db.prepare(`INSERT OR IGNORE INTO song_metadata_queue (spotify_uri, job_type, status, queued_at) VALUES ('spotify:track:R2a', 'ytm', 'processing', strftime('%Y-%m-%dT%H:%M:%SZ','now'))`).run();
}

// ---------------------------------------------------------------------------
// classifyFailure
// ---------------------------------------------------------------------------

describe('classifyFailure', () => {
	it('classifies "Track not found" as no_data', () => {
		expect(classifyFailure('Track not found')).toBe('no_data');
	});

	it('classifies "HTTP 503" as transient', () => {
		expect(classifyFailure('HTTP 503')).toBe('transient');
	});

	it('classifies "HTTP 429 rate limit" as rate_limited', () => {
		expect(classifyFailure('HTTP 429 rate limit')).toBe('rate_limited');
	});

	it('classifies "API key not configured" as config', () => {
		expect(classifyFailure('API key not configured')).toBe('config');
	});

	it('classifies null as transient', () => {
		expect(classifyFailure(null)).toBe('transient');
	});

	it('"API key not found" is no_data (not found matches rule 2, config requires not set|not configured)', () => {
		// Rule 1: /not set|not configured/i → config. "not found" does NOT match.
		// Rule 2: /not found/i → no_data. "not found" DOES match.
		// Therefore 'API key not found' → 'no_data'
		expect(classifyFailure('API key not found')).toBe('no_data');
	});

	it('classifies empty string as transient', () => {
		expect(classifyFailure('')).toBe('transient');
	});

	it('classifies ECONNREFUSED as transient', () => {
		expect(classifyFailure('ECONNREFUSED')).toBe('transient');
	});

	it('classifies timeout as transient', () => {
		expect(classifyFailure('Request timeout')).toBe('transient');
	});
});

// ---------------------------------------------------------------------------
// scope-aware aggregation
// ---------------------------------------------------------------------------

describe('scope-aware aggregation', () => {
	it('all scope sees all 4 job rows', () => {
		const db = freshDb();
		seedMultiLeague(db);
		const status = getQueueStatus(db, { level: 'all' });
		// 4 rows: R1a/ytm, R1a/lastfm_pop, R1b/ytm, R2a/ytm
		let total = 0;
		for (const jtc of Object.values(status.byJobType)) {
			total += jtc.total;
		}
		expect(total).toBe(4);
	});

	it('undefined scope sees all rows (same as all)', () => {
		const db = freshDb();
		seedMultiLeague(db);
		const status = getQueueStatus(db);
		let total = 0;
		for (const jtc of Object.values(status.byJobType)) {
			total += jtc.total;
		}
		expect(total).toBe(4);
	});

	it('league scope (league_id=1) sees 3 rows, NOT R2a', () => {
		const db = freshDb();
		seedMultiLeague(db);
		const status = getQueueStatus(db, { level: 'league', id: 1 });
		let total = 0;
		for (const jtc of Object.values(status.byJobType)) {
			total += jtc.total;
		}
		expect(total).toBe(3);
		// No ytm processing (that's R2a)
		expect(status.byJobType['ytm']?.processing ?? 0).toBe(0);
	});

	it('season scope (season_id=1) sees 3 rows, NOT R2a', () => {
		const db = freshDb();
		seedMultiLeague(db);
		const status = getQueueStatus(db, { level: 'season', id: 1 });
		let total = 0;
		for (const jtc of Object.values(status.byJobType)) {
			total += jtc.total;
		}
		expect(total).toBe(3);
	});

	it('round scope (round_id=1) sees 3 rows, NOT R2a', () => {
		const db = freshDb();
		seedMultiLeague(db);
		const status = getQueueStatus(db, { level: 'round', id: 1 });
		let total = 0;
		for (const jtc of Object.values(status.byJobType)) {
			total += jtc.total;
		}
		expect(total).toBe(3);
	});

	it('round scope (round_id=2) sees 1 row (R2a ytm processing)', () => {
		const db = freshDb();
		seedMultiLeague(db);
		const status = getQueueStatus(db, { level: 'round', id: 2 });
		let total = 0;
		for (const jtc of Object.values(status.byJobType)) {
			total += jtc.total;
		}
		expect(total).toBe(1);
		expect(status.byJobType['ytm']?.processing).toBe(1);
	});

	it('league B scope sees only R2a', () => {
		const db = freshDb();
		seedMultiLeague(db);
		const status = getQueueStatus(db, { level: 'league', id: 2 });
		let total = 0;
		for (const jtc of Object.values(status.byJobType)) {
			total += jtc.total;
		}
		expect(total).toBe(1);
		expect(status.byJobType['ytm']?.processing).toBe(1);
	});

	it('done field is computed as total - pending - processing - failed', () => {
		const db = freshDb();
		seedMultiLeague(db);
		const status = getQueueStatus(db, { level: 'all' });
		// ytm: total=3 (R1a done, R1b failed, R2a processing), pending=0, processing=1, failed=1 → done=1
		const ytm = status.byJobType['ytm'];
		expect(ytm).toBeDefined();
		expect(ytm.total).toBe(3);
		expect(ytm.done).toBe(1); // lifetime done, not done24h
		expect(ytm.failed).toBe(1);
		expect(ytm.processing).toBe(1);
	});

	it('done is lifetime done, not done24h', () => {
		const db = freshDb();
		seedMultiLeague(db);
		const status = getQueueStatus(db, { level: 'all' });
		const ytm = status.byJobType['ytm'];
		// done24h counts rows where done_at is within last 24h (R1a was done 1 hour ago = within 24h)
		// done (lifetime) = total - pending - processing - failed = 3 - 0 - 1 - 1 = 1
		expect(ytm.done).toBe(ytm.total - ytm.pending - ytm.processing - ytm.failed);
	});
});

// ---------------------------------------------------------------------------
// getHierarchy
// ---------------------------------------------------------------------------

describe('getHierarchy', () => {
	it('returns array of length 2 (2 leagues)', () => {
		const db = freshDb();
		seedMultiLeague(db);
		const hierarchy = getHierarchy(db);
		expect(hierarchy).toHaveLength(2);
	});

	it('League A has 1 season and 1 round', () => {
		const db = freshDb();
		seedMultiLeague(db);
		const hierarchy = getHierarchy(db);
		const leagueA = hierarchy.find((l) => l.id === 1);
		expect(leagueA).toBeDefined();
		expect(leagueA!.seasons).toHaveLength(1);
		expect(leagueA!.seasons[0].rounds).toHaveLength(1);
	});

	it('Round 1 has songCount=2 (R1a, R1b)', () => {
		const db = freshDb();
		seedMultiLeague(db);
		const hierarchy = getHierarchy(db);
		const leagueA = hierarchy.find((l) => l.id === 1)!;
		const season1 = leagueA.seasons[0];
		const round1 = season1.rounds[0];
		expect(round1.songCount).toBe(2);
	});

	it('Season 1 rolls up songCount=2 and name is "Season 1"', () => {
		const db = freshDb();
		seedMultiLeague(db);
		const hierarchy = getHierarchy(db);
		const leagueA = hierarchy.find((l) => l.id === 1)!;
		const season1 = leagueA.seasons[0];
		expect(season1.songCount).toBe(2);
		expect(season1.name).toBe('Season 1');
	});

	it('League A rolls up songCount=2', () => {
		const db = freshDb();
		seedMultiLeague(db);
		const hierarchy = getHierarchy(db);
		const leagueA = hierarchy.find((l) => l.id === 1)!;
		expect(leagueA.songCount).toBe(2);
	});

	it('Round-level queue counts are correct', () => {
		const db = freshDb();
		seedMultiLeague(db);
		const hierarchy = getHierarchy(db);
		const leagueA = hierarchy.find((l) => l.id === 1)!;
		const round1 = leagueA.seasons[0].rounds[0];
		// R1a/ytm=done, R1b/ytm=failed, R1a/lastfm_pop=pending
		expect(round1.done).toBe(1);
		expect(round1.failed).toBe(1);
		expect(round1.pending).toBe(1);
		expect(round1.processing).toBe(0);
		expect(round1.total).toBe(3);
	});

	it('Season-level counts are sum of rounds', () => {
		const db = freshDb();
		seedMultiLeague(db);
		const hierarchy = getHierarchy(db);
		const leagueA = hierarchy.find((l) => l.id === 1)!;
		const season1 = leagueA.seasons[0];
		expect(season1.done).toBe(1);
		expect(season1.failed).toBe(1);
		expect(season1.pending).toBe(1);
		expect(season1.total).toBe(3);
	});

	it('League name matches seeded name', () => {
		const db = freshDb();
		seedMultiLeague(db);
		const hierarchy = getHierarchy(db);
		const leagueA = hierarchy.find((l) => l.id === 1)!;
		const leagueB = hierarchy.find((l) => l.id === 2)!;
		expect(leagueA.name).toBe('League A');
		expect(leagueB.name).toBe('League B');
	});
});

// ---------------------------------------------------------------------------
// getScopeRollup
// ---------------------------------------------------------------------------

describe('getScopeRollup', () => {
	it('matches getQueueStatus for league scope', () => {
		const db = freshDb();
		seedMultiLeague(db);
		const rollup = getScopeRollup(db, { level: 'league', id: 1 });
		const direct = getQueueStatus(db, { level: 'league', id: 1 });
		expect(rollup.totalPending).toBe(direct.totalPending);
		expect(rollup.totalProcessing).toBe(direct.totalProcessing);
		expect(rollup.byJobType).toEqual(direct.byJobType);
	});

	it('matches getQueueStatus for season scope', () => {
		const db = freshDb();
		seedMultiLeague(db);
		const rollup = getScopeRollup(db, { level: 'season', id: 1 });
		const direct = getQueueStatus(db, { level: 'season', id: 1 });
		expect(rollup.totalPending).toBe(direct.totalPending);
		expect(rollup.totalProcessing).toBe(direct.totalProcessing);
	});

	it('matches getQueueStatus for round scope', () => {
		const db = freshDb();
		seedMultiLeague(db);
		const rollup = getScopeRollup(db, { level: 'round', id: 1 });
		const direct = getQueueStatus(db, { level: 'round', id: 1 });
		expect(rollup.totalPending).toBe(direct.totalPending);
		expect(rollup.byJobType).toEqual(direct.byJobType);
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
});
