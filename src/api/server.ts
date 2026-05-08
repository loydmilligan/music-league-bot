import 'dotenv/config';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SpotifyAdapter } from '../spotify/adapter.js';

const PORT = parseInt(process.env.BRACKET_API_PORT ?? '3001', 10);
const spotify = new SpotifyAdapter();

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
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

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`[bracket-api] Listening on http://localhost:${PORT}`);
});
