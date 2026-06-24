import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';

// Shared in-memory DB injected into the handler under test.
const db = openLeagueDb(':memory:');

vi.mock('$lib/db/client.js', async (orig) => {
	const actual = await orig<typeof import('$lib/db/client.js')>();
	return { ...actual, getDb: () => db };
});

// Route handler — loaded lazily so mocks are in place first.
let POST: typeof import('./+server.js').POST;

beforeEach(async () => {
	db.prepare('DELETE FROM song_metadata_queue').run();
	({ POST } = await import('./+server.js'));
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function mkEvt(rawUri: string, body?: object) {
	const encodedUri = encodeURIComponent(rawUri);
	const hasBody = body !== undefined;
	return {
		params: { spotifyUri: encodedUri },
		request: {
			headers: { get: (h: string) => (hasBody && h === 'content-type' ? 'application/json' : null) },
			json: async () => body,
		} as unknown as Request,
	} as unknown as Parameters<typeof POST>[0];
}

function queueRows(uri: string) {
	return db
		.prepare('SELECT job_type, status FROM song_metadata_queue WHERE spotify_uri = ? ORDER BY job_type')
		.all(uri) as Array<{ job_type: string; status: string }>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/songs/[spotifyUri]/enrich', () => {
	const TRACK_URI = 'spotify:track:6rqhFgbbKwnb9MLmUQDhG6';

	it('happy path — all 5 job types enqueued when no body', async () => {
		const res = await POST(mkEvt(TRACK_URI));
		expect(res.status).toBe(200);

		const body = await res.json() as { queued: number; alreadyQueued: number };
		expect(body.queued).toBe(5);
		expect(body.alreadyQueued).toBe(0);

		const rows = queueRows(TRACK_URI);
		expect(rows).toHaveLength(5);
		const jobTypes = rows.map((r) => r.job_type).sort();
		expect(jobTypes).toEqual(['audio', 'lastfm_pop', 'lastfm_tags', 'lyrics', 'ytm']);
		expect(rows.every((r) => r.status === 'pending')).toBe(true);
	});

	it('subset — only requested job types are enqueued', async () => {
		const res = await POST(mkEvt(TRACK_URI, { jobTypes: ['ytm', 'audio'] }));
		expect(res.status).toBe(200);

		const body = await res.json() as { queued: number; alreadyQueued: number };
		expect(body.queued).toBe(2);
		expect(body.alreadyQueued).toBe(0);

		const rows = queueRows(TRACK_URI);
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.job_type).sort()).toEqual(['audio', 'ytm']);
	});

	it('idempotency — re-enqueue returns alreadyQueued for existing rows', async () => {
		// First call enqueues all 5
		await POST(mkEvt(TRACK_URI));

		// Second call: same URI, all 5 types again
		const res = await POST(mkEvt(TRACK_URI));
		expect(res.status).toBe(200);

		const body = await res.json() as { queued: number; alreadyQueued: number };
		expect(body.queued).toBe(0);
		expect(body.alreadyQueued).toBe(5);

		// Still exactly 5 rows — no duplicates
		const rows = queueRows(TRACK_URI);
		expect(rows).toHaveLength(5);
	});

	it('partial idempotency — only new job types count as queued', async () => {
		// Enqueue 2 types first
		await POST(mkEvt(TRACK_URI, { jobTypes: ['ytm', 'audio'] }));

		// Now enqueue all 5; 2 already exist, 3 are new
		const res = await POST(mkEvt(TRACK_URI));
		const body = await res.json() as { queued: number; alreadyQueued: number };
		expect(body.queued).toBe(3);
		expect(body.alreadyQueued).toBe(2);
	});

	it('400 — bad URI (missing spotify:track: prefix)', async () => {
		await expect(POST(mkEvt('spotify:album:abc123'))).rejects.toMatchObject({ status: 400 });
	});

	it('400 — bare string URI', async () => {
		await expect(POST(mkEvt('not-a-uri-at-all'))).rejects.toMatchObject({ status: 400 });
	});

	it('400 — invalid jobType in body', async () => {
		await expect(
			POST(mkEvt(TRACK_URI, { jobTypes: ['ytm', 'invalid_type'] }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('400 — jobTypes is not an array', async () => {
		await expect(
			POST(mkEvt(TRACK_URI, { jobTypes: 'ytm' }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('handles URL-encoded colons in spotifyUri param', async () => {
		// SvelteKit passes the raw param value which may be URL-encoded
		// mkEvt already uses encodeURIComponent, so colons become %3A
		const res = await POST(mkEvt(TRACK_URI));
		expect(res.status).toBe(200);
		// The rows should be stored with the decoded URI
		const rows = queueRows(TRACK_URI);
		expect(rows).toHaveLength(5);
	});

	it('empty jobTypes array enqueues nothing', async () => {
		const res = await POST(mkEvt(TRACK_URI, { jobTypes: [] }));
		expect(res.status).toBe(200);

		const body = await res.json() as { queued: number; alreadyQueued: number };
		expect(body.queued).toBe(0);
		expect(body.alreadyQueued).toBe(0);

		const rows = queueRows(TRACK_URI);
		expect(rows).toHaveLength(0);
	});
});
