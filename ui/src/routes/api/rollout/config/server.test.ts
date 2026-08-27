import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';
import { DEFAULT_ROLLOUT } from '$lib/rollout/defaults.js';

let db: Database.Database;
vi.mock('$lib/db/client.js', () => ({ getDb: () => db }));

const { GET, PUT } = await import('./+server.js');
const url = (qs: string) => new URL(`http://x/api/rollout/config${qs}`);

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('sb', 'Second Best');
});

describe('GET', () => {
  it('returns the default rollout, disabled, when nothing is stored', async () => {
    const body = await (await GET({ url: url('?leagueId=1') } as never)).json();
    expect(body.enabled).toBe(false);
    expect(body.rollout.order).toEqual(DEFAULT_ROLLOUT.order);
  });

  it('400s without a leagueId', async () => {
    await expect(GET({ url: url('') } as never)).rejects.toMatchObject({ status: 400 });
  });
});

describe('PUT', () => {
  const req = (body: unknown) => ({ json: async () => body }) as Request;

  it('stores and echoes a valid rollout', async () => {
    const res = await PUT({ url: url('?leagueId=1'), request: req({ rollout: DEFAULT_ROLLOUT, enabled: true }) } as never);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    const back = await (await GET({ url: url('?leagueId=1') } as never)).json();
    expect(back.enabled).toBe(true);
  });

  it('400s on a structurally invalid rollout', async () => {
    await expect(
      PUT({ url: url('?leagueId=1'), request: req({ rollout: { order: [] }, enabled: true }) } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('defaults enabled to false when omitted', async () => {
    await PUT({ url: url('?leagueId=1'), request: req({ rollout: DEFAULT_ROLLOUT }) } as never);
    const back = await (await GET({ url: url('?leagueId=1') } as never)).json();
    expect(back.enabled).toBe(false);
  });
});
