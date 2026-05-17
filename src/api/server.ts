import 'dotenv/config';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SpotifyAdapter } from '../spotify/adapter.js';
import { kvDelete, kvGet, kvSet } from './tournamentStore.js';
import { computePopularityProxies, getLastfmTrackInfo } from './lastfm.js';
import { getMlAuthState, probeMlAuth, startMlAuthHeartbeat } from './mlAuthHeartbeat.js';

const PORT = parseInt(process.env.BRACKET_API_PORT ?? '3001', 10);
const spotify = new SpotifyAdapter();

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function empty(res: ServerResponse, status: number): void {
  setCors(res);
  res.writeHead(status);
  res.end();
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const method = req.method ?? '';
  const url = req.url ?? '';

  if (method === 'OPTIONS') {
    empty(res, 204);
    return;
  }

  if (method === 'POST' && url === '/bracket/round') {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw) as { roundName?: string; spotifyUris?: string[] };
      const { roundName, spotifyUris } = body;

      if (!roundName || !Array.isArray(spotifyUris) || spotifyUris.length === 0) {
        json(res, 400, { error: 'roundName and spotifyUris are required' });
        return;
      }

      const { id: playlistId, url: playlistUrl } = await spotify.createPlaylist(roundName);
      await spotify.addTracksToPlaylist(playlistId, spotifyUris);
      json(res, 200, { playlistId, playlistUrl });
    } catch (err) {
      console.error('[bracket-api] POST /bracket/round error:', err);
      json(res, 500, { error: err instanceof Error ? err.message : 'Internal error' });
    }
    return;
  }

  const deleteMatch = url.match(/^\/bracket\/playlist\/([^/]+)$/);
  if (method === 'DELETE' && deleteMatch) {
    try {
      await spotify.deletePlaylist(deleteMatch[1]!);
      empty(res, 204);
    } catch (err) {
      console.error('[bracket-api] DELETE /bracket/playlist error:', err);
      json(res, 500, { error: err instanceof Error ? err.message : 'Internal error' });
    }
    return;
  }

  // Tournament storage endpoints
  if (method === 'GET' && url === '/bracket/tournament') {
    const raw = kvGet('tournament');
    raw ? json(res, 200, JSON.parse(raw)) : empty(res, 204);
    return;
  }

  if (method === 'PUT' && url === '/bracket/tournament') {
    const raw = await readBody(req);
    kvSet('tournament', raw);
    empty(res, 204);
    return;
  }

  if (method === 'DELETE' && url === '/bracket/tournament') {
    kvDelete('tournament');
    kvDelete('songs');
    empty(res, 204);
    return;
  }

  if (method === 'GET' && url === '/bracket/songs') {
    const raw = kvGet('songs');
    raw ? json(res, 200, JSON.parse(raw)) : json(res, 200, []);
    return;
  }

  if (method === 'PUT' && url === '/bracket/songs') {
    const raw = await readBody(req);
    kvSet('songs', raw);
    empty(res, 204);
    return;
  }

  if (method === 'POST' && url === '/bracket/songs/enrich') {
    try {
      const apiKey = process.env.LASTFM_API_KEY ?? '';
      if (!apiKey) { json(res, 503, { error: 'LASTFM_API_KEY not configured' }); return; }

      const raw = await readBody(req);
      const songs = JSON.parse(raw) as Array<{ id: string; title: string; artist?: string }>;
      if (!Array.isArray(songs)) { json(res, 400, { error: 'Body must be an array of songs' }); return; }

      // Deduplicate by "artist|title"
      const cache = new Map<string, { listeners: number; playcount: number }>();
      const results: Array<{ listeners: number; playcount: number }> = [];

      for (const song of songs) {
        const key = `${(song.artist ?? '').toLowerCase()}|${song.title.toLowerCase()}`;
        if (!cache.has(key)) {
          const info = await getLastfmTrackInfo(song.artist ?? '', song.title, apiKey);
          cache.set(key, { listeners: info.listeners, playcount: info.playcount });
        }
        results.push(cache.get(key)!);
      }

      const proxies = computePopularityProxies(results);
      const enriched = songs.map((s, i) => ({
        ...s,
        lastfm_listeners: results[i].listeners,
        lastfm_playcount: results[i].playcount,
        popularity_proxy: proxies[i],
      }));

      json(res, 200, enriched);
    } catch (err) {
      console.error('[bracket-api] POST /bracket/songs/enrich error:', err);
      json(res, 500, { error: err instanceof Error ? err.message : 'Internal error' });
    }
    return;
  }

  if (method === 'GET' && url.startsWith('/bracket/spotify/search')) {
    try {
      const qs = new URL(url, 'http://localhost').searchParams;
      const q = qs.get('q')?.trim();
      if (!q) { json(res, 400, { error: 'q parameter required' }); return; }
      const limit = Math.min(20, Math.max(1, parseInt(qs.get('limit') ?? '10', 10)));
      const tracks = await spotify.searchTracks(q, limit);
      json(res, 200, tracks);
    } catch (err) {
      console.error('[bracket-api] GET /bracket/spotify/search error:', err);
      json(res, 500, { error: err instanceof Error ? err.message : 'Internal error' });
    }
    return;
  }

  if (method === 'GET' && url === '/ml-auth/status') {
    json(res, 200, getMlAuthState());
    return;
  }

  if (method === 'POST' && url === '/ml-auth/recheck') {
    try {
      const state = await probeMlAuth();
      json(res, 200, state);
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : 'probe failed' });
    }
    return;
  }

  json(res, 404, { error: 'Not found' });
});

startMlAuthHeartbeat();

server.listen(PORT, () => {
  console.log(`[bracket-api] Listening on http://localhost:${PORT}`);
});
