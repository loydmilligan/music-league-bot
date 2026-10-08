import { describe, expect, it, beforeEach, vi } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
import { setAuth, seedLeagueAndSeason, makeEvent, AUTH } from '../testHelpers.js';
import { defaultConfig } from '$lib/portalAdmin/config.js';

let db: ReturnType<typeof openLeagueDb>;
vi.mock('$lib/db/client.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('$lib/db/client.js')>()), getDb: () => db }));
const { GET, PUT } = await import('./+server.js');

beforeEach(() => {
	db = openLeagueDb(':memory:');
});

describe('GET /config', () => {
	setAuth();
	it('401s without a token', async () => {
		await expect(GET(makeEvent())).rejects.toMatchObject({ status: 401 });
	});
	it('404s an unknown league slug', async () => {
		await expect(GET(makeEvent({ slug: 'nope', headers: AUTH }))).rejects.toMatchObject({ status: 404 });
	});
	it('returns defaults for a league with no saved config', async () => {
		seedLeagueAndSeason(db);
		const res = await GET(makeEvent({ headers: AUTH }));
		expect(await res.json()).toEqual(defaultConfig());
	});
	it('round-trips a saved config', async () => {
		seedLeagueAndSeason(db);
		const body = { ...defaultConfig(), sections: { ...defaultConfig().sections } };
		body.sections.pulse.frequency = 'daily';
		await PUT(makeEvent({ body, url: 'http://t/config', headers: AUTH }));
		const res = await GET(makeEvent({ headers: AUTH }));
		expect((await res.json()).sections.pulse.frequency).toBe('daily');
	});
});

describe('PUT /config', () => {
	setAuth();
	it('400s a malformed body', async () => {
		seedLeagueAndSeason(db);
		await expect(PUT(makeEvent({ body: { nope: true }, url: 'http://t/config', headers: AUTH }))).rejects.toMatchObject({
			status: 400,
		});
	});
	it('400s on a bad section shape', async () => {
		seedLeagueAndSeason(db);
		const body = defaultConfig();
		(body.sections.thisWeek as unknown as { frequency: string }).frequency = 'yearly';
		await expect(PUT(makeEvent({ body, url: 'http://t/config', headers: AUTH }))).rejects.toMatchObject({ status: 400 });
	});
});