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

beforeEach(() => {
  db = openLeagueDb(':memory:');
  for (const [id, s] of [[1, 'a'], [2, 'b'], [3, 'c']] as const) db.prepare('INSERT INTO leagues (id, slug, name) VALUES (?, ?, ?)').run(id, s, s);
  db.prepare('INSERT INTO dashboard_sites (slug, league_id, season, read_model, published_at, refreshed_at) VALUES (?, 1, 1, \'{}\', \'2026-01-01\', \'2026-01-01\')').run('a-site');
  db.prepare('INSERT INTO dashboard_sites (slug, league_id, season, read_model, published_at, refreshed_at) VALUES (?, 3, 1, \'{}\', \'2026-01-01\', \'2026-01-01\')').run('c-site');
  pubMock.mockReset();
});

describe('publish-all endpoint', () => {
  it('publishes exactly the leagues with sites, sequentially', async () => {
    const order: number[] = [];
    pubMock.mockImplementation(async (id: number) => { order.push(id); return { updatedAt: 'T', seasons: [{ number: 1, path: 'stats', ok: true }] }; });
    const res = await POST({} as never);
    expect(res.status).toBe(200);
    expect(order).toEqual([1, 3]);
    const body = await res.json();
    expect(body.results.map((r: { leagueId: number }) => r.leagueId)).toEqual([1, 3]);
    expect(body.results.every((r: { ok: boolean }) => r.ok)).toBe(true);
  });
  it('200 when only some leagues fail', async () => {
    pubMock.mockImplementation(async (id: number) => { if (id === 1) throw new Error('boom'); return { updatedAt: 'T', seasons: [] }; });
    const res = await POST({} as never);
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results[0]).toMatchObject({ leagueId: 1, ok: false, error: 'boom' });
    expect(results[1]).toMatchObject({ leagueId: 3, ok: true });
  });
  it('500 with same body when every league fails', async () => {
    pubMock.mockRejectedValue(new Error('boom'));
    const res = await POST({} as never);
    expect(res.status).toBe(500);
    expect((await res.json()).results).toHaveLength(2);
  });
});
