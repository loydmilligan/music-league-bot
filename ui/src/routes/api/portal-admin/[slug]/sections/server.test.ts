import { describe, expect, it, beforeEach, vi } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
import { KPI_CATALOG, SECTION_IDS } from '$lib/portalAdmin/config.js';
import { setAuth, seedLeagueAndSeason, makeEvent, AUTH } from '../testHelpers.js';

let db: ReturnType<typeof openLeagueDb>;
vi.mock('$lib/db/client.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('$lib/db/client.js')>()), getDb: () => db }));
const { GET } = await import('./+server.js');

beforeEach(() => {
	db = openLeagueDb(':memory:');
});

describe('GET /sections', () => {
	setAuth();
	it('returns the stable catalog for a league', async () => {
		seedLeagueAndSeason(db);
		db.prepare(`INSERT INTO players (id, name) VALUES (1, 'Crush'), (2, 'Lyle')`).run();
		db.prepare(`INSERT INTO season_players (season_id, player_id) VALUES (1, 1), (1, 2)`).run();
		db.prepare("UPDATE seasons SET status='complete' WHERE id=1").run();
		db.prepare(`INSERT INTO seasons (id, league_id, season_number, status) VALUES (2, 1, 1, 'complete')`).run();
		const res = await GET(makeEvent({ headers: AUTH }));
		const catalog = await res.json();
		expect(catalog.kpis.map((k: { id: string }) => k.id)).toEqual([...KPI_CATALOG]);
		expect(catalog.members).toEqual([
			{ id: '1', name: 'Crush' },
			{ id: '2', name: 'Lyle' },
		]);
		expect(catalog.seasons).toEqual([1, 2]);
		expect(Object.keys(catalog.nextDue)).toEqual([...SECTION_IDS]);
	});
});