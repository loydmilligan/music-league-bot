#!/usr/bin/env tsx
/**
 * sprint-17 popularity-fetch — fetch + persist per-song Last.fm popularity.
 *
 * For each submitted song not yet in `song_popularity`, fetch Last.fm
 * listeners/playcount via the existing getLastfmTrackInfo(), persist the raw
 * counts, then recompute the 0-100 popularity_proxy over the WHOLE corpus via
 * computePopularityProxies() (the proxy is relative, so it's kept globally
 * consistent). Optionally rides along Spotify track.popularity. Idempotent:
 * already-fetched songs are skipped; a second run with no new songs is a no-op.
 *
 * Usage:
 *   tsx scripts/backfill-popularity.ts            # all unfetched songs (global)
 *   tsx scripts/backfill-popularity.ts <seasonId> # only that season's songs
 *
 * Runs from the root context (can import src/) — NOT inside the ui container.
 */
import 'dotenv/config';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { getLastfmTrackInfo, computePopularityProxies } from '../src/api/lastfm.js';

const ENSURE = `CREATE TABLE IF NOT EXISTS song_popularity (
  spotify_uri TEXT PRIMARY KEY, artist TEXT NOT NULL, title TEXT NOT NULL,
  listeners INTEGER, playcount INTEGER, popularity_proxy INTEGER,
  spotify_popularity INTEGER, fetched_at TEXT NOT NULL
);`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const firstArtist = (artists: string) => (artists.split(',')[0] ?? artists).trim();

async function spotifyPopularity(uris: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const id = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret || !uris.length) return out;
  try {
    const tr = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
      body: 'grant_type=client_credentials',
    });
    const token = (await tr.json() as { access_token?: string }).access_token;
    if (!token) return out;
    const ids = uris.map((u) => u.split(':').pop()!).filter(Boolean);
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const r = await fetch(`https://api.spotify.com/v1/tracks?ids=${batch.join(',')}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) continue;
      const { tracks } = await r.json() as { tracks: ({ uri: string; popularity?: number } | null)[] };
      for (const t of tracks) if (t && typeof t.popularity === 'number') out.set(t.uri, t.popularity);
    }
  } catch (e) {
    console.warn('[spotify] popularity fetch skipped:', (e as Error).message);
  }
  return out;
}

async function main() {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) { console.error('LASTFM_API_KEY not set'); process.exit(1); }
  const seasonArg = process.argv[2] ? Number(process.argv[2]) : null;

  const db = new Database(resolve(process.env.DATA_DIR ?? 'data', 'league.db'));
  db.pragma('journal_mode = WAL');
  db.exec(ENSURE);

  // Distinct unfetched songs (real submissions, real track URIs).
  const where = seasonArg
    ? `JOIN rounds r ON r.id = m.round_id WHERE r.season_id = ${seasonArg} AND`
    : 'WHERE';
  const songs = db.prepare(
    `SELECT m.spotify_uri AS uri, m.artists AS artists, m.title AS title
     FROM ml_submissions m ${where}
       m.competitor_id IS NOT NULL
       AND m.spotify_uri LIKE 'spotify:track:%'
       AND m.spotify_uri NOT IN (SELECT spotify_uri FROM song_popularity)
     GROUP BY m.spotify_uri`,
  ).all() as { uri: string; artists: string; title: string }[];

  console.log(`[popularity] ${songs.length} unfetched song(s)${seasonArg ? ` in season ${seasonArg}` : ''}`);
  if (!songs.length) { console.log('[popularity] nothing to fetch — all cached (no-op).'); db.close(); return; }

  const ins = db.prepare(
    `INSERT OR IGNORE INTO song_popularity (spotify_uri, artist, title, listeners, playcount, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let ok = 0, miss = 0;
  for (const s of songs) {
    const a = firstArtist(s.artists);
    const info = await getLastfmTrackInfo(a, s.title, apiKey);
    ins.run(s.uri, a, s.title, info.listeners, info.playcount, nowIso());
    if (info.error || (info.listeners === 0 && info.playcount === 0)) { miss++; }
    else ok++;
    await sleep(250); // Last.fm courtesy rate-limit
  }
  console.log(`[popularity] fetched ${ok} with data, ${miss} with no/zero data`);

  // Spotify popularity ride-along (best-effort, supplementary).
  const sp = await spotifyPopularity(songs.map((s) => s.uri));
  if (sp.size) {
    const updSp = db.prepare('UPDATE song_popularity SET spotify_popularity = ? WHERE spotify_uri = ?');
    const tx = db.transaction(() => { for (const [uri, pop] of sp) updSp.run(pop, uri); });
    tx();
    console.log(`[popularity] spotify popularity set for ${sp.size} song(s)`);
  }

  // Recompute popularity_proxy over the WHOLE corpus (relative metric).
  const all = db.prepare('SELECT spotify_uri, listeners, playcount FROM song_popularity').all() as { spotify_uri: string; listeners: number; playcount: number }[];
  const proxies = computePopularityProxies(all.map((r) => ({ listeners: r.listeners ?? 0, playcount: r.playcount ?? 0 })));
  const updPx = db.prepare('UPDATE song_popularity SET popularity_proxy = ? WHERE spotify_uri = ?');
  const tx2 = db.transaction(() => { all.forEach((r, i) => updPx.run(proxies[i], r.spotify_uri)); });
  tx2();
  console.log(`[popularity] recomputed proxy over ${all.length} song(s)`);
  db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
