import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIG_ID = process.env.SPOTIFY_CLIENT_ID;
const ORIG_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

beforeEach(() => {
  process.env.SPOTIFY_CLIENT_ID = 'id';
  process.env.SPOTIFY_CLIENT_SECRET = 'secret';
  vi.resetModules();
});
afterEach(() => {
  if (ORIG_ID === undefined) delete process.env.SPOTIFY_CLIENT_ID; else process.env.SPOTIFY_CLIENT_ID = ORIG_ID;
  if (ORIG_SECRET === undefined) delete process.env.SPOTIFY_CLIENT_SECRET; else process.env.SPOTIFY_CLIENT_SECRET = ORIG_SECRET;
  vi.restoreAllMocks();
});

it('maps track URIs to popularity, batching by 50', async () => {
  const uris = Array.from({ length: 51 }, (_, i) => `spotify:track:id${i}`);
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: any) => {
    if (String(url).includes('accounts.spotify.com')) {
      return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
    }
    calls.push(String(url));
    const ids = new URL(String(url)).searchParams.get('ids')!.split(',');
    return new Response(JSON.stringify({ tracks: ids.map((id) => ({ uri: `spotify:track:${id}`, popularity: 42 })) }), { status: 200 });
  }));
  const { fetchSpotifyPopularity } = await import('./spotify.js');
  const out = await fetchSpotifyPopularity(uris);
  expect(out.size).toBe(51);
  expect(out.get('spotify:track:id0')).toBe(42);
  expect(calls.length).toBe(2); // 50 + 1
});

it('returns an empty map when creds are absent (no throw)', async () => {
  delete process.env.SPOTIFY_CLIENT_ID;
  delete process.env.SPOTIFY_CLIENT_SECRET;
  const { fetchSpotifyPopularity } = await import('./spotify.js');
  const out = await fetchSpotifyPopularity(['spotify:track:x']);
  expect(out.size).toBe(0);
});
