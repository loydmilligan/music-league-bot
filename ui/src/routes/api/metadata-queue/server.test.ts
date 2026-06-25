/**
 * Tests for metadata-queue API endpoints:
 *   GET /api/metadata-queue/status
 *   POST /api/metadata-queue/fill-gaps
 *   POST /api/metadata-queue/retry
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
import type Database from 'better-sqlite3';
import { enqueue } from '$lib/db/metadataQueue.js';

// Shared in-memory DB injected into all handlers under test.
const db = openLeagueDb(':memory:');

vi.mock('$lib/db/client.js', async (orig) => {
	const actual = await orig<typeof import('$lib/db/client.js')>();
	return { ...actual, getDb: () => db };
});

// Lazy-loaded handlers so mocks are in place first.
let GET_status: typeof import('./status/+server.js').GET;
let POST_fillGaps: typeof import('./fill-gaps/+server.js').POST;
let POST_retry: typeof import('./retry/+server.js').POST;

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

function seedRound(roundId: number, uris: string[]): void {
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
		db.prepare(
			`INSERT OR IGNORE INTO ml_submissions (round_id, spotify_uri, title, artists, created_at)
			 VALUES (?, ?, 'Title', 'Artist', datetime('now'))`
		).run(roundId, uri);
	}
}

function setAutoAudio(enabled: boolean): void {
	const value = enabled ? '1' : '0';
	db.prepare(
		`INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_analyze_audio', ?)`
	).run(value);
}

function mkGetEvent(searchParams: Record<string, string> = {}) {
	const params = new URLSearchParams(searchParams);
	return {
		url: { searchParams: params },
	} as unknown as Parameters<typeof GET_status>[0];
}

function mkPostEvent(body: unknown) {
	return {
		request: { json: async () => body } as unknown as Request,
	} as unknown as Parameters<typeof POST_fillGaps>[0];
}

function mkRetryEvent(body: unknown) {
	return {
		request: { json: async () => body } as unknown as Request,
	} as unknown as Parameters<typeof POST_retry>[0];
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
	// Wipe relevant tables between tests
	db.pragma('foreign_keys = OFF');
	for (const t of [
		'song_metadata_queue',
		'ml_submissions',
		'rounds',
		'seasons',
		'leagues',
	]) {
		try {
			db.prepare(`DELETE FROM ${t}`).run();
		} catch {
			// table may not exist in this schema variant
		}
	}
	// Remove auto_analyze_audio setting
	db.prepare(`DELETE FROM settings WHERE key = 'auto_analyze_audio'`).run();
	db.pragma('foreign_keys = ON');

	({ GET: GET_status } = await import('./status/+server.js'));
	({ POST: POST_fillGaps } = await import('./fill-gaps/+server.js'));
	({ POST: POST_retry } = await import('./retry/+server.js'));
});

// ---------------------------------------------------------------------------
// GET /api/metadata-queue/status
// ---------------------------------------------------------------------------

describe('GET /api/metadata-queue/status', () => {
	it('returns zero counts for an empty queue (no roundId)', async () => {
		const res = await GET_status(mkGetEvent());
		expect(res.status).toBe(200);
		const body = await res.json() as {
			totalPending: number;
			totalProcessing: number;
			failures: unknown[];
			byJobType: Record<string, unknown>;
		};
		expect(body.totalPending).toBe(0);
		expect(body.totalProcessing).toBe(0);
		expect(body.failures).toHaveLength(0);
		expect(body.byJobType).toEqual({});
	});

	it('returns counts across all rounds when no roundId provided', async () => {
		enqueue(db, 'spotify:track:A', 'ytm');
		enqueue(db, 'spotify:track:B', 'lastfm_pop');
		db.prepare("UPDATE song_metadata_queue SET status='processing' WHERE spotify_uri='spotify:track:B'").run();

		const res = await GET_status(mkGetEvent());
		const body = await res.json() as { totalPending: number; totalProcessing: number };
		expect(body.totalPending).toBe(1);
		expect(body.totalProcessing).toBe(1);
	});

	it('returns 400 for non-numeric roundId', async () => {
		const res = await GET_status(mkGetEvent({ roundId: 'abc' }));
		expect(res.status).toBe(400);
	});

	it('scopes to a round when roundId is provided', async () => {
		seedRound(1, ['spotify:track:inRound']);
		enqueue(db, 'spotify:track:inRound', 'ytm');
		enqueue(db, 'spotify:track:notInRound', 'ytm');

		const res = await GET_status(mkGetEvent({ roundId: '1' }));
		expect(res.status).toBe(200);
		const body = await res.json() as { totalPending: number };
		expect(body.totalPending).toBe(1);
	});

	it('includes digestReadiness and coverageMatrix when roundId is provided', async () => {
		seedRound(1, ['spotify:track:A']);

		const res = await GET_status(mkGetEvent({ roundId: '1' }));
		const body = await res.json() as {
			digestReadiness: Record<string, { ok: boolean; count: number; total: number }>;
			coverageMatrix: Array<{ spotify_uri: string; jobs: Record<string, string> }>;
		};
		expect(body.digestReadiness).toBeDefined();
		expect(body.coverageMatrix).toBeDefined();
		expect(body.coverageMatrix).toHaveLength(1);
		expect(body.coverageMatrix[0].spotify_uri).toBe('spotify:track:A');
	});

	it('does NOT include digestReadiness when no roundId is provided', async () => {
		const res = await GET_status(mkGetEvent());
		const body = await res.json() as Record<string, unknown>;
		expect(body.digestReadiness).toBeUndefined();
		expect(body.coverageMatrix).toBeUndefined();
	});

	it('includes failures array with correct shape', async () => {
		enqueue(db, 'spotify:track:X', 'lastfm_tags');
		db.prepare(
			"UPDATE song_metadata_queue SET status='failed', error='timeout', retries=2 WHERE spotify_uri='spotify:track:X'"
		).run();

		const res = await GET_status(mkGetEvent());
		const body = await res.json() as {
			failures: Array<{ id: number; spotify_uri: string; job_type: string; error: string; retries: number }>;
		};
		expect(body.failures).toHaveLength(1);
		expect(body.failures[0].spotify_uri).toBe('spotify:track:X');
		expect(body.failures[0].job_type).toBe('lastfm_tags');
		expect(body.failures[0].error).toBe('timeout');
		expect(body.failures[0].retries).toBe(2);
	});

	// --- Task 3: scope-aware ?level=&id= params ---

	it('returns 400 when level is an unrecognised value', async () => {
		const res = await GET_status(mkGetEvent({ level: 'bogus' }));
		expect(res.status).toBe(400);
	});

	it('returns 400 when level=league with no id', async () => {
		const res = await GET_status(mkGetEvent({ level: 'league' }));
		expect(res.status).toBe(400);
	});

	it('returns 400 when level=season with no id', async () => {
		const res = await GET_status(mkGetEvent({ level: 'season' }));
		expect(res.status).toBe(400);
	});

	it('returns 400 when level=round with no id', async () => {
		const res = await GET_status(mkGetEvent({ level: 'round' }));
		expect(res.status).toBe(400);
	});

	it('returns 400 when level=round with non-integer id', async () => {
		const res = await GET_status(mkGetEvent({ level: 'round', id: 'notanumber' }));
		expect(res.status).toBe(400);
	});

	it('returns 400 when level=league with non-integer id', async () => {
		const res = await GET_status(mkGetEvent({ level: 'league', id: 'abc' }));
		expect(res.status).toBe(400);
	});

	it('returns league-scoped counts matching getQueueStatus for level=league&id=1', async () => {
		seedRound(1, ['spotify:track:leagueTrack']);
		enqueue(db, 'spotify:track:leagueTrack', 'ytm');

		const res = await GET_status(mkGetEvent({ level: 'league', id: '1' }));
		expect(res.status).toBe(200);
		const body = await res.json() as { totalPending: number };
		// The seeded track is in league 1, so scope-filtered count should be 1
		expect(body.totalPending).toBe(1);
	});

	it('omits digestReadiness and coverageMatrix for non-round scope (level=league)', async () => {
		seedRound(1, ['spotify:track:leagueTrack2']);

		const res = await GET_status(mkGetEvent({ level: 'league', id: '1' }));
		expect(res.status).toBe(200);
		const body = await res.json() as Record<string, unknown>;
		expect(body.digestReadiness).toBeUndefined();
		expect(body.coverageMatrix).toBeUndefined();
	});

	it('level=all with no id returns all-scope counts (same as no params)', async () => {
		enqueue(db, 'spotify:track:allScope', 'ytm');

		const resAll = await GET_status(mkGetEvent({ level: 'all' }));
		const resNoParams = await GET_status(mkGetEvent());
		expect(resAll.status).toBe(200);
		const bodyAll = await resAll.json() as { totalPending: number };
		const bodyNone = await resNoParams.json() as { totalPending: number };
		expect(bodyAll.totalPending).toBe(bodyNone.totalPending);
	});

	it('?roundId= back-compat returns round-scoped counts with digestReadiness and coverageMatrix', async () => {
		seedRound(2, ['spotify:track:backcompat']);

		const res = await GET_status(mkGetEvent({ roundId: '2' }));
		expect(res.status).toBe(200);
		const body = await res.json() as Record<string, unknown>;
		// digestReadiness and coverageMatrix must be present for round scope
		expect(body.digestReadiness).toBeDefined();
		expect(body.coverageMatrix).toBeDefined();
	});

	it('?level=round&id=N returns digestReadiness and coverageMatrix (new param form)', async () => {
		seedRound(3, ['spotify:track:newform']);

		const res = await GET_status(mkGetEvent({ level: 'round', id: '3' }));
		expect(res.status).toBe(200);
		const body = await res.json() as Record<string, unknown>;
		expect(body.digestReadiness).toBeDefined();
		expect(body.coverageMatrix).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// POST /api/metadata-queue/fill-gaps
// ---------------------------------------------------------------------------

describe('POST /api/metadata-queue/fill-gaps', () => {
	it('returns 400 when roundId is missing', async () => {
		const res = await POST_fillGaps(mkPostEvent({}) as Parameters<typeof POST_fillGaps>[0]);
		expect(res.status).toBe(400);
	});

	it('returns 400 when roundId is not a number', async () => {
		const res = await POST_fillGaps(mkPostEvent({ roundId: 'abc' }) as Parameters<typeof POST_fillGaps>[0]);
		expect(res.status).toBe(400);
	});

	it('returns { queued: 0 } for a round with no submissions', async () => {
		seedRound(1, []);
		const res = await POST_fillGaps(mkPostEvent({ roundId: 1 }) as Parameters<typeof POST_fillGaps>[0]);
		expect(res.status).toBe(200);
		const body = await res.json() as { queued: number };
		expect(body.queued).toBe(0);
	});

	it('enqueues all 4 fast job types for a round\'s URIs', async () => {
		seedRound(1, ['spotify:track:A', 'spotify:track:B']);

		const res = await POST_fillGaps(mkPostEvent({ roundId: 1 }) as Parameters<typeof POST_fillGaps>[0]);
		expect(res.status).toBe(200);
		const body = await res.json() as { queued: number };
		// 2 URIs × 4 job types = 8 pending rows
		expect(body.queued).toBe(8);

		const count = (db.prepare('SELECT COUNT(*) AS n FROM song_metadata_queue WHERE status=?').get('pending') as { n: number }).n;
		expect(count).toBe(8);
	});

	it('does not re-enqueue already done rows', async () => {
		seedRound(1, ['spotify:track:A']);
		enqueue(db, 'spotify:track:A', 'ytm');
		db.prepare("UPDATE song_metadata_queue SET status='done' WHERE spotify_uri='spotify:track:A' AND job_type='ytm'").run();

		await POST_fillGaps(mkPostEvent({ roundId: 1 }) as Parameters<typeof POST_fillGaps>[0]);

		// ytm should still be done, not pending
		const ytmRow = db.prepare(
			"SELECT status FROM song_metadata_queue WHERE spotify_uri='spotify:track:A' AND job_type='ytm'"
		).get() as { status: string };
		expect(ytmRow.status).toBe('done');
	});

	it('resets failed rows back to pending', async () => {
		seedRound(1, ['spotify:track:A']);
		enqueue(db, 'spotify:track:A', 'lastfm_pop');
		db.prepare("UPDATE song_metadata_queue SET status='failed', error='err', retries=3 WHERE spotify_uri='spotify:track:A' AND job_type='lastfm_pop'").run();

		await POST_fillGaps(mkPostEvent({ roundId: 1 }) as Parameters<typeof POST_fillGaps>[0]);

		const row = db.prepare(
			"SELECT status, error, retries FROM song_metadata_queue WHERE spotify_uri='spotify:track:A' AND job_type='lastfm_pop'"
		).get() as { status: string; error: string | null; retries: number };
		expect(row.status).toBe('pending');
		expect(row.error).toBeNull();
		expect(row.retries).toBe(0);
	});

	it('does NOT enqueue audio when auto_analyze_audio is disabled', async () => {
		setAutoAudio(false);
		seedRound(1, ['spotify:track:A']);

		await POST_fillGaps(mkPostEvent({ roundId: 1 }) as Parameters<typeof POST_fillGaps>[0]);

		const audioRow = db.prepare(
			"SELECT * FROM song_metadata_queue WHERE spotify_uri='spotify:track:A' AND job_type='audio'"
		).get();
		expect(audioRow).toBeUndefined();
	});

	it('enqueues audio when auto_analyze_audio is enabled', async () => {
		setAutoAudio(true);
		seedRound(1, ['spotify:track:A']);

		await POST_fillGaps(mkPostEvent({ roundId: 1 }) as Parameters<typeof POST_fillGaps>[0]);

		const audioRow = db.prepare(
			"SELECT status FROM song_metadata_queue WHERE spotify_uri='spotify:track:A' AND job_type='audio'"
		).get() as { status: string } | undefined;
		expect(audioRow).toBeDefined();
		expect(audioRow!.status).toBe('pending');
	});

	it('is idempotent — calling twice does not duplicate rows', async () => {
		seedRound(1, ['spotify:track:A']);

		await POST_fillGaps(mkPostEvent({ roundId: 1 }) as Parameters<typeof POST_fillGaps>[0]);
		await POST_fillGaps(mkPostEvent({ roundId: 1 }) as Parameters<typeof POST_fillGaps>[0]);

		const count = (db.prepare('SELECT COUNT(*) AS n FROM song_metadata_queue').get() as { n: number }).n;
		expect(count).toBe(4); // 1 URI × 4 job types
	});
});

	// --- Task 7: scope-aware {level, id} params ---

	it('returns 400 when level is an unrecognised value', async () => {
		const res = await POST_fillGaps(mkPostEvent({ level: 'bogus' }) as Parameters<typeof POST_fillGaps>[0]);
		expect(res.status).toBe(400);
	});

	it('returns 400 when level=league with no id', async () => {
		const res = await POST_fillGaps(mkPostEvent({ level: 'league' }) as Parameters<typeof POST_fillGaps>[0]);
		expect(res.status).toBe(400);
	});

	it('returns 400 when level=season with no id', async () => {
		const res = await POST_fillGaps(mkPostEvent({ level: 'season' }) as Parameters<typeof POST_fillGaps>[0]);
		expect(res.status).toBe(400);
	});

	it('returns 400 when level=round with no id', async () => {
		const res = await POST_fillGaps(mkPostEvent({ level: 'round' }) as Parameters<typeof POST_fillGaps>[0]);
		expect(res.status).toBe(400);
	});

	it('level=all with no id enqueues the entire corpus', async () => {
		// Seed 2 leagues with separate rounds and URIs
		db.prepare(`INSERT OR IGNORE INTO leagues (id, slug, name) VALUES (1, 'alpha', 'Alpha'), (2, 'beta', 'Beta')`).run();
		db.prepare(`INSERT OR IGNORE INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 1, 'active'), (20, 2, 1, 'active')`).run();
		db.prepare(`INSERT OR IGNORE INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (100, 10, 'ml-100', 'Round 100', datetime('now')), (200, 20, 'ml-200', 'Round 200', datetime('now'))`).run();
		for (const [roundId, uri] of [[100, 'spotify:track:alpha1'], [100, 'spotify:track:alpha2'], [200, 'spotify:track:beta1']] as [number, string][]) {
			db.prepare(`INSERT OR IGNORE INTO ml_submissions (round_id, spotify_uri, title, artists, created_at) VALUES (?, ?, 'T', 'A', datetime('now'))`).run(roundId, uri);
		}

		const res = await POST_fillGaps(mkPostEvent({ level: 'all' }) as Parameters<typeof POST_fillGaps>[0]);
		expect(res.status).toBe(200);
		const body = await res.json() as { queued: number };
		// 3 URIs × 4 fast job types = 12 pending rows
		expect(body.queued).toBe(12);

		const totalPending = (db.prepare(`SELECT COUNT(*) AS n FROM song_metadata_queue WHERE status='pending'`).get() as { n: number }).n;
		expect(totalPending).toBe(12);

		// Verify both leagues' URIs are in the queue
		const alphaRows = (db.prepare(`SELECT COUNT(*) AS n FROM song_metadata_queue WHERE spotify_uri LIKE 'spotify:track:alpha%'`).get() as { n: number }).n;
		const betaRows = (db.prepare(`SELECT COUNT(*) AS n FROM song_metadata_queue WHERE spotify_uri LIKE 'spotify:track:beta%'`).get() as { n: number }).n;
		expect(alphaRows).toBe(8); // 2 URIs × 4 job types
		expect(betaRows).toBe(4);  // 1 URI × 4 job types
	});

	it('level=league enqueues only that league\'s submissions (other league NOT enqueued)', async () => {
		// Seed 2 leagues with separate rounds and URIs
		db.prepare(`INSERT OR IGNORE INTO leagues (id, slug, name) VALUES (1, 'alpha', 'Alpha'), (2, 'beta', 'Beta')`).run();
		db.prepare(`INSERT OR IGNORE INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 1, 'active'), (20, 2, 1, 'active')`).run();
		db.prepare(`INSERT OR IGNORE INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (100, 10, 'ml-100', 'Round 100', datetime('now')), (200, 20, 'ml-200', 'Round 200', datetime('now'))`).run();
		for (const [roundId, uri] of [[100, 'spotify:track:leagueA'], [200, 'spotify:track:leagueB']] as [number, string][]) {
			db.prepare(`INSERT OR IGNORE INTO ml_submissions (round_id, spotify_uri, title, artists, created_at) VALUES (?, ?, 'T', 'A', datetime('now'))`).run(roundId, uri);
		}

		// Fill gaps only for league 1 (alpha)
		const res = await POST_fillGaps(mkPostEvent({ level: 'league', id: 1 }) as Parameters<typeof POST_fillGaps>[0]);
		expect(res.status).toBe(200);
		const body = await res.json() as { queued: number };
		// 1 URI × 4 job types = 4
		expect(body.queued).toBe(4);

		// League 2's URI must NOT be enqueued
		const betaRow = db.prepare(`SELECT COUNT(*) AS n FROM song_metadata_queue WHERE spotify_uri='spotify:track:leagueB'`).get() as { n: number };
		expect(betaRow.n).toBe(0);
	});

	it('round-scope back-compat: {roundId: N} still behaves as today', async () => {
		seedRound(10, ['spotify:track:backcompat1', 'spotify:track:backcompat2']);

		const res = await POST_fillGaps(mkPostEvent({ roundId: 10 }) as Parameters<typeof POST_fillGaps>[0]);
		expect(res.status).toBe(200);
		const body = await res.json() as { queued: number };
		// 2 URIs × 4 job types = 8
		expect(body.queued).toBe(8);

		const pending = (db.prepare(`SELECT COUNT(*) AS n FROM song_metadata_queue WHERE status='pending'`).get() as { n: number }).n;
		expect(pending).toBe(8);
	});

	it('level=all with empty corpus returns {queued: 0}', async () => {
		const res = await POST_fillGaps(mkPostEvent({ level: 'all' }) as Parameters<typeof POST_fillGaps>[0]);
		expect(res.status).toBe(200);
		const body = await res.json() as { queued: number };
		expect(body.queued).toBe(0);
	});

// ---------------------------------------------------------------------------
// POST /api/metadata-queue/retry
// ---------------------------------------------------------------------------

describe('POST /api/metadata-queue/retry', () => {
	it('returns 400 when id is missing', async () => {
		const res = await POST_retry(mkRetryEvent({}));
		expect(res.status).toBe(400);
	});

	it('returns 400 when id is not a number', async () => {
		const res = await POST_retry(mkRetryEvent({ id: 'abc' }));
		expect(res.status).toBe(400);
	});

	it('returns { ok: true } and resets a failed job to pending', async () => {
		enqueue(db, 'spotify:track:X', 'ytm');
		db.prepare("UPDATE song_metadata_queue SET status='failed', error='boom', retries=3 WHERE spotify_uri='spotify:track:X'").run();

		const id = (db.prepare("SELECT id FROM song_metadata_queue WHERE spotify_uri='spotify:track:X'").get() as { id: number }).id;

		const res = await POST_retry(mkRetryEvent({ id }));
		expect(res.status).toBe(200);
		const body = await res.json() as { ok: boolean };
		expect(body.ok).toBe(true);

		const row = db.prepare("SELECT status, error, retries FROM song_metadata_queue WHERE id=?").get(id) as {
			status: string;
			error: string | null;
			retries: number;
		};
		expect(row.status).toBe('pending');
		expect(row.error).toBeNull();
		expect(row.retries).toBe(0);
	});
});
