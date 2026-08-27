import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';

let db: Database.Database;
vi.mock('$lib/db/client.js', () => ({ getDb: () => db }));

const { GET, POST, PATCH, DELETE } = await import('./+server.js');
const params = { roundId: '149' };
const req = (body: unknown) => ({ json: async () => body }) as Request;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('bz', 'Boarz');
  db.prepare("INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')").run();
  db.prepare(
    "INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (149, 1, 'ml-149', ?, '2026-08-01T00:00:00Z')",
  ).run('R149');
});

it('returns an empty list for a round with no notes', async () => {
  expect((await (await GET({ params } as never)).json()).notes).toEqual([]);
});

it('creates a note', async () => {
  const res = await POST({ params, request: req({ target: 'chat', body: 'a thing' }) } as never);
  expect((await res.json()).note.target).toBe('chat');
  expect((await (await GET({ params } as never)).json()).notes).toHaveLength(1);
});

it('400s on an unknown target', async () => {
  await expect(POST({ params, request: req({ target: 'nope', body: 'x' }) } as never))
    .rejects.toMatchObject({ status: 400 });
});

it('400s on an empty body', async () => {
  await expect(POST({ params, request: req({ target: 'general', body: '   ' }) } as never))
    .rejects.toMatchObject({ status: 400 });
});

it('patches and deletes', async () => {
  const { note } = await (await POST({ params, request: req({ target: 'general', body: 'x' }) } as never)).json();
  const patched = await (await PATCH({ params, request: req({ id: note.id, body: 'y' }) } as never)).json();
  expect(patched.note.body).toBe('y');
  await DELETE({ params, request: req({ id: note.id }) } as never);
  expect((await (await GET({ params } as never)).json()).notes).toEqual([]);
});

it('404s patching an unknown note', async () => {
  await expect(PATCH({ params, request: req({ id: 'nope', body: 'y' }) } as never))
    .rejects.toMatchObject({ status: 404 });
});
