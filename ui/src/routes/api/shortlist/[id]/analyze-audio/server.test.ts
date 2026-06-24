/**
 * Tests for POST /api/shortlist/[id]/analyze-audio
 *
 * Verifies the endpoint enqueues a single audio job and returns { queued: 1 }
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

function mkPostEvent(id: string): Parameters<typeof POST>[0] {
	return { params: { id } } as unknown as Parameters<typeof POST>[0];
}

function seedShortlistSong(db: Database.Database, id: number | string, spotifyUri: string) {
	db.prepare(
		`INSERT OR IGNORE INTO shortlist_songs (id, spotify_uri, title, artist)
		 VALUES (?, ?, 'Song Title', 'Some Artist')`
	).run(String(id), spotifyUri);
}

beforeEach(() => {
	db = openLeagueDb(':memory:');
});

describe('POST /api/shortlist/[id]/analyze-audio', () => {
	it('returns { queued: 1 } for a valid shortlist song', async () => {
		seedShortlistSong(db, 'song-1', 'spotify:track:shortlist1');

		const res = await POST(mkPostEvent('song-1'));
		const body = await res.json();
		expect(body).toEqual({ queued: 1 });
	});

	it('inserts an audio job into song_metadata_queue', async () => {
		seedShortlistSong(db, 'song-2', 'spotify:track:sl2');

		await POST(mkPostEvent('song-2'));

		const row = db
			.prepare(`SELECT spotify_uri, job_type, status FROM song_metadata_queue WHERE spotify_uri = 'spotify:track:sl2'`)
			.get() as { spotify_uri: string; job_type: string; status: string } | undefined;

		expect(row).toBeDefined();
		expect(row).toMatchObject({ spotify_uri: 'spotify:track:sl2', job_type: 'audio', status: 'pending' });
	});

	it('is idempotent — second call does not duplicate queue rows', async () => {
		seedShortlistSong(db, 'song-3', 'spotify:track:sl-dup');

		await POST(mkPostEvent('song-3'));
		await POST(mkPostEvent('song-3'));

		const count = (
			db.prepare(`SELECT COUNT(*) AS n FROM song_metadata_queue WHERE spotify_uri = 'spotify:track:sl-dup' AND job_type = 'audio'`).get() as { n: number }
		).n;
		expect(count).toBe(1);
	});

	it('throws 400 when id param is missing', async () => {
		await expect(POST({ params: { id: '' } } as unknown as Parameters<typeof POST>[0])).rejects.toMatchObject({ status: 400 });
	});

	it('throws 404 for a shortlist song that does not exist', async () => {
		await expect(POST(mkPostEvent('9999'))).rejects.toMatchObject({ status: 404 });
	});
});
