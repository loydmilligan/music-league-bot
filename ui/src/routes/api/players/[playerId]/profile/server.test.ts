import { it, expect, vi, beforeEach, describe } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';

// Shared in-memory DB injected into the handler under test.
const db = openLeagueDb(':memory:');

vi.mock('$lib/db/client.js', async (orig) => {
	const actual = await orig<typeof import('$lib/db/client.js')>();
	return { ...actual, getDb: () => db };
});

let GET: typeof import('./+server.js').GET;
let PATCH: typeof import('./+server.js').PATCH;

beforeEach(async () => {
	db.prepare('DELETE FROM player_profiles').run();
	db.prepare('DELETE FROM players').run();
	({ GET, PATCH } = await import('./+server.js'));
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function mkPlayer(name = 'Alice'): number {
	db.prepare('INSERT INTO players (name) VALUES (?)').run(name);
	return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

function evt(playerId: number | string) {
	return { params: { playerId: String(playerId) } } as unknown as Parameters<typeof GET>[0];
}

function patchEvt(playerId: number | string, body: object) {
	return {
		params: { playerId: String(playerId) },
		request: { json: async () => body } as unknown as Request,
	} as unknown as Parameters<typeof PATCH>[0];
}

// ── GET tests ─────────────────────────────────────────────────────────────────

describe('GET /api/players/:playerId/profile', () => {
	it('returns 200 with empty-default profile when no row exists', async () => {
		const id = mkPlayer();
		const res = await GET(evt(id));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.player_id).toBe(id);
		expect(body.notes).toBeNull();
		expect(body.tags).toEqual([]);
		expect(body.taste_fingerprint).toBeNull();
		expect(body.updated_at).toBeNull();
	});

	it('returns persisted profile when row exists', async () => {
		const id = mkPlayer();
		db.prepare(
			`INSERT INTO player_profiles (player_id, notes, tags, taste_fingerprint, updated_at)
			 VALUES (?, ?, ?, ?, datetime('now'))`,
		).run(id, 'My notes', JSON.stringify(['indie', '80s']), JSON.stringify({ summary: 'eclectic' }));

		const res = await GET(evt(id));
		const body = await res.json();
		expect(body.notes).toBe('My notes');
		expect(body.tags).toEqual(['indie', '80s']);
		expect(body.taste_fingerprint).toEqual({ summary: 'eclectic' });
		expect(body.updated_at).toBeTruthy();
	});

	it('returns 404 for unknown player', async () => {
		await expect(GET(evt(99999))).rejects.toMatchObject({ status: 404 });
	});

	it('returns 400 for invalid playerId', async () => {
		await expect(GET(evt('abc'))).rejects.toMatchObject({ status: 400 });
	});
});

// ── PATCH tests ───────────────────────────────────────────────────────────────

describe('PATCH /api/players/:playerId/profile', () => {
	it('creates profile row and persists notes + tags', async () => {
		const id = mkPlayer();
		const res = await PATCH(patchEvt(id, { notes: 'Some context', tags: ['rock'] }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.notes).toBe('Some context');
		expect(body.tags).toEqual(['rock']);
		expect(body.updated_at).toBeTruthy();
	});

	it('follow-up GET reflects PATCH changes', async () => {
		const id = mkPlayer();
		await PATCH(patchEvt(id, { notes: 'Updated note', tags: ['jazz', 'soul'] }));

		const res = await GET(evt(id));
		const body = await res.json();
		expect(body.notes).toBe('Updated note');
		expect(body.tags).toEqual(['jazz', 'soul']);
	});

	it('PATCH leaves taste_fingerprint untouched', async () => {
		const id = mkPlayer();
		const fp = { signature_artists: ['Radiohead'], genres: ['art rock'] };
		db.prepare(
			`INSERT INTO player_profiles (player_id, notes, tags, taste_fingerprint, updated_at)
			 VALUES (?, ?, '[]', ?, datetime('now'))`,
		).run(id, null, JSON.stringify(fp));

		await PATCH(patchEvt(id, { notes: 'New notes', tags: ['indie'] }));

		const row = db
			.prepare('SELECT taste_fingerprint FROM player_profiles WHERE player_id = ?')
			.get(id) as { taste_fingerprint: string };
		expect(JSON.parse(row.taste_fingerprint)).toEqual(fp);
	});

	it('PATCH with only notes leaves tags unchanged', async () => {
		const id = mkPlayer();
		db.prepare(
			`INSERT INTO player_profiles (player_id, notes, tags) VALUES (?, ?, ?)`,
		).run(id, null, JSON.stringify(['existing']));

		await PATCH(patchEvt(id, { notes: 'Just a note' }));

		const res = await GET(evt(id));
		const body = await res.json();
		expect(body.tags).toEqual(['existing']);
		expect(body.notes).toBe('Just a note');
	});

	it('PATCH with only tags leaves notes unchanged', async () => {
		const id = mkPlayer();
		db.prepare(
			`INSERT INTO player_profiles (player_id, notes, tags) VALUES (?, ?, '[]')`,
		).run(id, 'Keep this note');

		await PATCH(patchEvt(id, { tags: ['new-tag'] }));

		const res = await GET(evt(id));
		const body = await res.json();
		expect(body.notes).toBe('Keep this note');
		expect(body.tags).toEqual(['new-tag']);
	});

	it('PATCH allows setting notes to null', async () => {
		const id = mkPlayer();
		db.prepare(
			`INSERT INTO player_profiles (player_id, notes, tags) VALUES (?, ?, '[]')`,
		).run(id, 'Old note');

		await PATCH(patchEvt(id, { notes: null }));
		const res = await GET(evt(id));
		expect((await res.json()).notes).toBeNull();
	});

	it('returns 400 when body has neither notes nor tags', async () => {
		const id = mkPlayer();
		await expect(PATCH(patchEvt(id, {}))).rejects.toMatchObject({ status: 400 });
	});

	it('returns 400 when tags is not an array', async () => {
		const id = mkPlayer();
		await expect(PATCH(patchEvt(id, { tags: 'not-an-array' }))).rejects.toMatchObject({ status: 400 });
	});

	it('returns 404 for unknown player', async () => {
		await expect(PATCH(patchEvt(99999, { notes: 'x' }))).rejects.toMatchObject({ status: 404 });
	});
});
