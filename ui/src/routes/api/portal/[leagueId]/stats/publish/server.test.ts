import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';

let db: ReturnType<typeof openLeagueDb>;
vi.mock('$lib/db/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/db/client.js')>()),
  getDb: () => db,
}));
const { pubMock } = vi.hoisted(() => ({ pubMock: vi.fn() }));
vi.mock('$lib/portal/statsPublish.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/portal/statsPublish.js')>()),
  publishLeagueStats: pubMock,
}));

const { POST } = await import('./+server.js');
const { StatsPublishBusyError } = await import('$lib/portal/statsPublish.js');
const post = (id: string) => POST({ params: { leagueId: id } } as never);

beforeEach(() => {
  db = openLeagueDb(':memory:');
  db.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('bz', 'Boarz');
  db.prepare('INSERT INTO leagues (id, slug, name) VALUES (2, ?, ?)').run('nosite', 'NoSite');
  db.prepare('INSERT INTO dashboard_sites (slug, league_id, season, read_model, published_at, refreshed_at) VALUES (?, 1, 1, \'{}\', \'2026-01-01\', \'2026-01-01\')').run('bz-site');
  pubMock.mockReset();
});

describe('stats publish endpoint', () => {
  it('400 on bad id', async () => {
    await expect(post('abc')).rejects.toMatchObject({ status: 400 });
    expect(pubMock).not.toHaveBeenCalled();
  });
  it('404 on unknown league', async () => {
    await expect(post('99')).rejects.toMatchObject({ status: 404 });
  });
  it('404 on league without b-side site (publish not called)', async () => {
    await expect(post('2')).rejects.toMatchObject({ status: 404 });
    expect(pubMock).not.toHaveBeenCalled();
  });
  it('404 when publish reports no b-side site', async () => {
    pubMock.mockRejectedValue(new Error('no b-side site'));
    await expect(post('1')).rejects.toMatchObject({ status: 404 });
  });
  it('409 when busy', async () => {
    pubMock.mockRejectedValue(new StatsPublishBusyError());
    await expect(post('1')).rejects.toMatchObject({ status: 409 });
  });
  it('200 with result, including partial failures', async () => {
    const r = { updatedAt: 'T', seasons: [{ number: 2, path: 'stats', ok: true }, { number: 1, path: 'stats/s1', ok: false, error: 'x' }] };
    pubMock.mockResolvedValue(r);
    const res = await post('1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(r);
    expect(pubMock).toHaveBeenCalledWith(1);
  });
});
