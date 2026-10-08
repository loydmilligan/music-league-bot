import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';

let db: Database.Database;
vi.mock('$lib/db/client.js', () => ({ getDb: () => db }));
const { writeMock } = vi.hoisted(() => ({ writeMock: vi.fn() }));
vi.mock('$lib/portal/portalJson.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/portal/portalJson.js')>()),
  writePortalJson: writeMock,
}));

const { GET, PUT } = await import('./+server.js');
const req = (body: unknown) => ({ json: async () => body }) as Request;
const put = (id: string, body: unknown) => PUT({ params: { leagueId: id }, request: req(body) } as never);
const get = (id: string) => GET({ params: { leagueId: id } } as never);

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('bz', 'Boarz');
  writeMock.mockReset();
  writeMock.mockResolvedValue({ path: '/x', digests: 1 });
});

describe('season settings endpoint', () => {
  it('GET unknown league 404s', async () => {
    await expect(get('99')).rejects.toMatchObject({ status: 404 });
  });
  it('GET invalid id 400s', async () => {
    await expect(get('abc')).rejects.toMatchObject({ status: 400 });
  });
  it('PUT rejects non-https and stores nothing', async () => {
    await expect(put('1', { feedUrl: 'http://x', hubUrl: null })).rejects.toMatchObject({ status: 400 });
    expect(await (await get('1')).json()).toEqual({ feedUrl: null, hubUrl: null, surveyKey: null });
  });
  it('PUT rejects bad body', async () => {
    await expect(put('1', { feedUrl: 5, hubUrl: null })).rejects.toMatchObject({ status: 400 });
  });
  it('PUT unknown league 404s', async () => {
    await expect(put('99', { feedUrl: null, hubUrl: null })).rejects.toMatchObject({ status: 404 });
  });
  it('PUT valid stores, writes portal.json', async () => {
    const body = await (await put('1', { feedUrl: 'https://f.example/feed.json', hubUrl: 'https://h.example/' })).json();
    expect(body).toEqual({ ok: true, portalWritten: true });
    expect(writeMock).toHaveBeenCalledWith(db, 1);
    expect(await (await get('1')).json()).toEqual({ feedUrl: 'https://f.example/feed.json', hubUrl: 'https://h.example/', surveyKey: null });
  });
  it('PUT with no b-side reports portalWritten false', async () => {
    writeMock.mockResolvedValue(null);
    expect(await (await put('1', { feedUrl: null, hubUrl: null })).json()).toEqual({ ok: true, portalWritten: false });
  });
  it('PUT keeps settings when writePortalJson rejects', async () => {
    writeMock.mockRejectedValue(new Error('leak'));
    const body = await (await put('1', { feedUrl: 'https://f.example/', hubUrl: null })).json();
    expect(body).toMatchObject({ ok: true, portalWritten: false });
    expect(body.warning).toContain('leak');
    expect((await (await get('1')).json()).feedUrl).toBe('https://f.example/');
  });
});
