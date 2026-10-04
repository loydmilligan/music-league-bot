import { describe, expect, it, vi } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';

const db = openLeagueDb(':memory:');
const getDbMock = vi.fn(() => db);

vi.mock('$lib/db/client.js', async (orig) => {
  const actual = await orig<typeof import('$lib/db/client.js')>();
  return { ...actual, getDb: () => getDbMock() };
});

import { load } from './+layout.server.js';

const run = (u: string) =>
  (load as unknown as (e: { url: URL }) => Promise<Record<string, unknown>>)({ url: new URL(u, 'http://x.test') });
const ADMIN = ['leagues', 'crossLeagueUpcoming', 'watcher', 'chatUnassignedCount', 'contentPendingCount'];

describe('root layout load', () => {
  it('returns admin data for normal requests', async () => {
    const d = await run('/settings');
    for (const k of ADMIN) expect(d).toHaveProperty(k);
  });
  it('returns no admin data with ?share=1', async () => {
    getDbMock.mockClear();
    const d = await run('/digest2/5?share=1');
    for (const k of ADMIN) expect(d).not.toHaveProperty(k);
    expect(getDbMock).not.toHaveBeenCalled();
  });
  it('returns no admin data for /portal-stats/ pages', async () => {
    const d = await run('/portal-stats/3');
    for (const k of ADMIN) expect(d).not.toHaveProperty(k);
  });
});
