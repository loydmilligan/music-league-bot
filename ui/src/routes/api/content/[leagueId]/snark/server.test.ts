import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';

const db = openLeagueDb(':memory:');

vi.mock('$lib/db/client.js', async (orig) => {
	const actual = await orig<typeof import('$lib/db/client.js')>();
	return { ...actual, getDb: () => db };
});

let PATCH_snark: typeof import('./+server.js').PATCH;

beforeEach(async () => {
	db.pragma('foreign_keys = OFF');
	for (const t of ['dashboard_sites', 'leagues']) {
		try {
			db.prepare(`DELETE FROM ${t}`).run();
		} catch {
			// table may not exist — skip
		}
	}
	db.pragma('foreign_keys = ON');

	({ PATCH: PATCH_snark } = await import('./+server.js'));
});

function insertLeagueWithSite(slug: string): number {
	db.prepare('INSERT INTO leagues (slug, name) VALUES (?, ?)').run(slug, 'Test League');
	const { id } = db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number };
	const now = new Date().toISOString();
	db.prepare(
		`INSERT INTO dashboard_sites (slug, league_id, season, read_model, archived_rounds, is_live, published_at, refreshed_at)
		 VALUES (?, ?, 1, '{}', '[]', 1, ?, ?)`,
	).run(slug + '-site', id, now, now);
	return id;
}

function mkEvt(leagueId: number, body: object) {
	return {
		params: { leagueId: String(leagueId) },
		request: { json: async () => body } as unknown as Request,
	} as unknown as Parameters<typeof PATCH_snark>[0];
}

function getSnarkLevel(leagueId: number): number {
	const row = db
		.prepare('SELECT snark_level FROM dashboard_sites WHERE league_id = ?')
		.get(leagueId) as { snark_level: number } | undefined;
	return row?.snark_level ?? -1;
}

describe('PATCH /api/content/:leagueId/snark', () => {
	it('persists level 0 (gentle)', async () => {
		const id = insertLeagueWithSite('alpha');
		const res = await PATCH_snark(mkEvt(id, { level: 0 }));
		expect(res.status).toBe(200);
		const body = await res.json() as { ok: boolean; snark_level: number };
		expect(body.ok).toBe(true);
		expect(body.snark_level).toBe(0);
		expect(getSnarkLevel(id)).toBe(0);
	});

	it('persists level 2 (spicy)', async () => {
		const id = insertLeagueWithSite('beta');
		const res = await PATCH_snark(mkEvt(id, { level: 2 }));
		expect(res.status).toBe(200);
		expect(getSnarkLevel(id)).toBe(2);
	});

	it('rejects level 3 with 400', async () => {
		const id = insertLeagueWithSite('gamma');
		await expect(PATCH_snark(mkEvt(id, { level: 3 }))).rejects.toMatchObject({ status: 400 });
	});

	it('rejects non-integer level with 400', async () => {
		const id = insertLeagueWithSite('delta');
		await expect(PATCH_snark(mkEvt(id, { level: 'spicy' }))).rejects.toMatchObject({ status: 400 });
	});

	it('returns 404 for league with no published b-side', async () => {
		db.prepare('INSERT INTO leagues (slug, name) VALUES (?, ?)').run('epsilon', 'Epsilon');
		const { id } = db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number };
		await expect(PATCH_snark(mkEvt(id, { level: 1 }))).rejects.toMatchObject({ status: 404 });
	});

	it('returns 400 for invalid leagueId', async () => {
		const evt = {
			params: { leagueId: 'not-a-number' },
			request: { json: async () => ({ level: 1 }) } as unknown as Request,
		} as unknown as Parameters<typeof PATCH_snark>[0];
		await expect(PATCH_snark(evt)).rejects.toMatchObject({ status: 400 });
	});
});
