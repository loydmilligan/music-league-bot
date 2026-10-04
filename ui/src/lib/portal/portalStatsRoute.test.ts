import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'svelte/server';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { buildStatsNav } from './statsNav.js';
import PortalStatsNav from './PortalStatsNav.svelte';

let db: Database.Database;
vi.mock('$lib/db/client.js', async (orig) => ({ ...(await orig<typeof import('$lib/db/client.js')>()), getDb: () => db }));
const buildSnapshotCached = vi.fn();
vi.mock('$lib/server/boarzStats/data.js', () => ({ buildSnapshotCached: (s: unknown) => buildSnapshotCached(s) }));

import { load } from '../../routes/portal-stats/[leagueId]/+page.server.js';

function ev(leagueId: string, qs = '') {
	return { params: { leagueId }, url: new URL('http://x/portal-stats/' + leagueId + qs) } as never;
}
async function status(p: unknown): Promise<number | null> {
	try { await p; return null; } catch (e) { return (e as { status?: number }).status ?? -1; }
}

beforeEach(() => {
	db = openLeagueDb(':memory:');
	db.exec(`
		INSERT INTO leagues (id, slug, name) VALUES (1, 'bz', 'Boarz'), (2, 'np', 'Nostalgia');
		INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 1, 'complete'), (11, 1, 2, 'active');
		INSERT INTO dashboard_sites (slug, league_id, season, read_model, archived_rounds, is_live, published_at, refreshed_at)
			VALUES ('LeagueSlugAAAAAAAAAAAA', 1, 2, '{}', '[]', 1, '2026-01-01', '2026-01-01');
	`);
	buildSnapshotCached.mockReset();
	buildSnapshotCached.mockReturnValue({
		league: { seasons: [{ id: 10, number: 1, status: 'complete' }, { id: 11, number: 2, status: 'active' }] }
	});
});

describe('PortalStatsNav', () => {
	it('renders only relative, reload links', () => {
		const nav = buildStatsNav({ leagueName: 'Boarz', depth: 3, seasons: [1, 2], currentSeason: 2, selectedSeason: 1 });
		const { body } = render(PortalStatsNav, { props: { nav } });
		expect(body).not.toContain('href="/');
		expect(body).toContain('data-sveltekit-reload');
		expect(body).toContain('href="../../archive"');
		expect(body).toMatch(/href="\.\.\/"[^>]*>Stats</);
		expect(body).toContain('href="../s1/"');
	});
});

describe('load', () => {
	it('returns share:true and nav (depth 2 default, active season current)', async () => {
		const r = (await load(ev('1'))) as { share: boolean; nav: ReturnType<typeof buildStatsNav> };
		expect(r.share).toBe(true);
		expect(r.nav.homeHref).toBe('../');
		expect(r.nav.seasons[0]).toMatchObject({ number: 2, current: true, selected: true });
		expect(buildSnapshotCached).toHaveBeenCalledWith({ leagueSlug: 'bz', seasons: undefined });
	});
	it('season + depth=3 selects that season', async () => {
		const r = (await load(ev('1', '?season=1&depth=3'))) as { nav: ReturnType<typeof buildStatsNav> };
		expect(r.nav.homeHref).toBe('../../');
		expect(r.nav.seasons.find((s) => s.number === 1)).toMatchObject({ selected: true, href: '../s1/' });
		expect(buildSnapshotCached).toHaveBeenCalledWith({ leagueSlug: 'bz', seasons: [1] });
	});
	it('404 unknown league, 404 no b-side site, 400 bad id', async () => {
		expect(await status(load(ev('99')))).toBe(404);
		expect(await status(load(ev('2')))).toBe(404);
		expect(await status(load(ev('abc')))).toBe(400);
	});
	it('404 when snapshot throws', async () => {
		buildSnapshotCached.mockImplementation(() => { throw new Error('nope'); });
		expect(await status(load(ev('1')))).toBe(404);
	});
});
