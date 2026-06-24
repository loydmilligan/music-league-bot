/**
 * Tests for POST /api/rounds/[roundId]/analyze-audio
 *
 * Verifies the endpoint enqueues audio jobs and returns { queued: N }
 * immediately without calling sintel directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

vi.mock('$lib/db/client.js', async (orig) => {
	const actual = await orig<typeof import('$lib/db/client.js')>();
	return { ...actual, getDb: () => db };
});

import { POST } from './+server.js';

function mkPostEvent(roundId: string): Parameters<typeof POST>[0] {
	return { params: { roundId } } as unknown as Parameters<typeof POST>[0];
}

function seedRoundWithSubmissions(db: Database.Database, roundId: number, uris: string[]) {
	// Insert a minimal league, season, and round so getRoundById works
	db.prepare(`INSERT OR IGNORE INTO leagues (id, name, slug) VALUES (1, 'Test League', 'test-league')`).run();
	db.prepare(`INSERT OR IGNORE INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')`).run();
	db.prepare(
		`INSERT OR IGNORE INTO rounds (id, season_id, ml_round_id, name, created_at)
		 VALUES (?, 1, ?, 'Round', '2024-01-01T00:00:00Z')`
	).run(roundId, `ml-round-${roundId}`);
	for (const uri of uris) {
		db.prepare(
			`INSERT OR IGNORE INTO ml_submissions (round_id, spotify_uri, title, artists, created_at)
			 VALUES (?, ?, 'Song', 'Artist', '2024-01-01T00:00:00Z')`
		).run(roundId, uri);
	}
}

beforeEach(() => {
	db = openLeagueDb(':memory:');
});

describe('POST /api/rounds/[roundId]/analyze-audio', () => {
	it('returns { queued: N } for a round with submissions', async () => {
		seedRoundWithSubmissions(db, 1, ['spotify:track:aaa', 'spotify:track:bbb', 'spotify:track:ccc']);

		const res = await POST(mkPostEvent('1'));
		const body = await res.json();
		expect(body).toEqual({ queued: 3 });
	});

	it('inserts audio jobs into song_metadata_queue', async () => {
		seedRoundWithSubmissions(db, 2, ['spotify:track:x1', 'spotify:track:x2']);

		await POST(mkPostEvent('2'));

		const rows = db
			.prepare(`SELECT spotify_uri, job_type, status FROM song_metadata_queue ORDER BY spotify_uri`)
			.all() as Array<{ spotify_uri: string; job_type: string; status: string }>;

		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ spotify_uri: 'spotify:track:x1', job_type: 'audio', status: 'pending' });
		expect(rows[1]).toMatchObject({ spotify_uri: 'spotify:track:x2', job_type: 'audio', status: 'pending' });
	});

	it('returns { queued: 0 } when round has no submissions', async () => {
		seedRoundWithSubmissions(db, 3, []);

		const res = await POST(mkPostEvent('3'));
		const body = await res.json();
		expect(body.queued).toBe(0);
	});

	it('is idempotent — second call does not duplicate queue rows', async () => {
		seedRoundWithSubmissions(db, 4, ['spotify:track:dup']);

		await POST(mkPostEvent('4'));
		await POST(mkPostEvent('4'));

		const count = (
			db.prepare(`SELECT COUNT(*) AS n FROM song_metadata_queue WHERE spotify_uri = 'spotify:track:dup' AND job_type = 'audio'`).get() as { n: number }
		).n;
		expect(count).toBe(1);
	});

	it('throws 400 for invalid roundId', async () => {
		await expect(POST(mkPostEvent('abc'))).rejects.toMatchObject({ status: 400 });
	});

	it('throws 404 for a round that does not exist', async () => {
		await expect(POST(mkPostEvent('9999'))).rejects.toMatchObject({ status: 404 });
	});
});
