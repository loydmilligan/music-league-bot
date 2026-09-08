import { describe, expect, it, vi } from 'vitest';
import { createPlaylist, type YoutubeCreds } from '../ui/src/lib/ytm/youtube.js';

const creds: YoutubeCreds = { clientId: 'c', clientSecret: 's', refreshToken: 'r' };
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const fail = (status: number, body: unknown = { error: { errors: [{ reason: 'RATE_LIMIT_EXCEEDED' }] } }) =>
  ({ ok: false, status, json: async () => body }) as unknown as Response;

/** A fetch that returns the queued responses in order. */
function queue(responses: Response[]) {
  let i = 0;
  return vi.fn(async () => responses[Math.min(i++, responses.length - 1)]);
}

const noSleep = async () => {};

describe('createPlaylist retries', () => {
  it('retries a 429 from playlists.insert instead of failing the approval', async () => {
    // This is the real 2026-09-07 failure: playlists.insert has a short-window
    // burst limit separate from the daily quota, and a single 429 used to abort
    // the whole send.
    const f = queue([
      ok({ access_token: 'tok' }),
      fail(429),
      ok({ id: 'PL123' }),
    ]);
    const id = await createPlaylist(creds, { title: 't', description: 'd', videoIds: [] }, { fetchFn: f as never, sleep: noSleep });
    expect(id).toBe('PL123');
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('retries a 409 on playlistItems.insert (spike 003)', async () => {
    const f = queue([
      ok({ access_token: 'tok' }),
      ok({ id: 'PL123' }),
      fail(409),
      ok({}),
    ]);
    await createPlaylist(creds, { title: 't', description: 'd', videoIds: ['V1'] }, { fetchFn: f as never, sleep: noSleep });
    expect(f).toHaveBeenCalledTimes(4);
  });

  it('gives up on a status backing off cannot fix, and says which call failed', async () => {
    const f = queue([ok({ access_token: 'tok' }), fail(403, { error: { errors: [{ reason: 'quotaExceeded' }] } })]);
    await expect(
      createPlaylist(creds, { title: 't', description: 'd', videoIds: [] }, { fetchFn: f as never, sleep: noSleep }),
    ).rejects.toThrow(/playlists HTTP 403/);
  });

  it('stops retrying eventually rather than looping forever', async () => {
    const f = queue([ok({ access_token: 'tok' }), fail(429)]);
    await expect(
      createPlaylist(creds, { title: 't', description: 'd', videoIds: [] }, { fetchFn: f as never, sleep: noSleep }),
    ).rejects.toThrow(/429/);
    // 1 token call + 5 attempts.
    expect(f).toHaveBeenCalledTimes(6);
  });

  it('backs off longer for a rate limit than for a conflict', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => { waits.push(ms); };
    await createPlaylist(creds, { title: 't', description: 'd', videoIds: [] },
      { fetchFn: queue([ok({ access_token: 'tok' }), fail(429), ok({ id: 'P' })]) as never, sleep });
    const rateLimitWait = waits[0];
    waits.length = 0;
    await createPlaylist(creds, { title: 't', description: 'd', videoIds: [] },
      { fetchFn: queue([ok({ access_token: 'tok' }), fail(503), ok({ id: 'P' })]) as never, sleep });
    expect(rateLimitWait).toBeGreaterThan(waits[0]);
  });
});
