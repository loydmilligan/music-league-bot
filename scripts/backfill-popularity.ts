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
 *   tsx scripts/backfill-popularity.ts                  # all unfetched songs (global)
 *   tsx scripts/backfill-popularity.ts <seasonId>       # only that season's songs
 *   tsx scripts/backfill-popularity.ts <seasonId> --force  # re-fetch even if cached
 *
 * Runs from the root context (can import src/) — NOT inside the ui container.
 */
import 'dotenv/config';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { getLastfmPopularity } from '../src/api/lastfm.js';
import { recomputePopularityProxies } from '../ui/src/lib/lastfm.js';

const ENSURE = `CREATE TABLE IF NOT EXISTS song_popularity (
  spotify_uri TEXT PRIMARY KEY, artist TEXT NOT NULL, title TEXT NOT NULL,
  listeners INTEGER, playcount INTEGER, popularity_proxy INTEGER,
  spotify_popularity INTEGER, popularity_source TEXT, fetched_at TEXT NOT NULL
);`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const firstArtist = (artists: string) => (artists.split(',')[0] ?? artists).trim();


async function main() {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) { console.error('LASTFM_API_KEY not set'); process.exit(1); }
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const seasonArg = args.find((a) => /^\d+$/.test(a)) ? Number(args.find((a) => /^\d+$/.test(a))) : null;

  const db = new Database(resolve(process.env.DATA_DIR ?? 'data', 'league.db'));
  db.pragma('journal_mode = WAL');
  db.exec(ENSURE);
  // Migrate: add popularity_source if the table already existed without it.
  const spCols = (db.pragma('table_info(song_popularity)') as { name: string }[]).map((c) => c.name);
  if (spCols.length && !spCols.includes('popularity_source')) {
    db.exec('ALTER TABLE song_popularity ADD COLUMN popularity_source TEXT');
  }

  // Distinct songs (real submissions, real track URIs). --force re-fetches even
  // cached songs; otherwise only the unfetched ones.
  const where = seasonArg
    ? `JOIN rounds r ON r.id = m.round_id WHERE r.season_id = ${seasonArg} AND`
    : 'WHERE';
  const cacheClause = force ? '' : ' AND m.spotify_uri NOT IN (SELECT spotify_uri FROM song_popularity)';
  const songs = db.prepare(
    `SELECT m.spotify_uri AS uri, m.artists AS artists, m.title AS title
     FROM ml_submissions m ${where}
       m.competitor_id IS NOT NULL
       AND m.spotify_uri LIKE 'spotify:track:%'${cacheClause}
     GROUP BY m.spotify_uri`,
  ).all() as { uri: string; artists: string; title: string }[];

  console.log(`[popularity] ${songs.length} song(s) to fetch${seasonArg ? ` in season ${seasonArg}` : ''}${force ? ' (FORCE refresh)' : ''}`);
  if (!songs.length) { console.log('[popularity] nothing to fetch — all cached (no-op).'); db.close(); return; }

  // Upsert so --force refreshes existing rows (search-based normalized lookup).
  const ins = db.prepare(
    `INSERT INTO song_popularity (spotify_uri, artist, title, listeners, playcount, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(spotify_uri) DO UPDATE SET
       artist=excluded.artist, title=excluded.title,
       listeners=excluded.listeners, playcount=excluded.playcount, fetched_at=excluded.fetched_at`,
  );
  let ok = 0, miss = 0;
  for (const s of songs) {
    const a = firstArtist(s.artists);
    const info = await getLastfmPopularity(a, s.title, apiKey);
    ins.run(s.uri, a, s.title, info.listeners, info.playcount, nowIso());
    const matched = info.matchedTitle && (info.matchedTitle.toLowerCase() !== s.title.toLowerCase())
      ? ` (matched: ${info.matchedArtist} — ${info.matchedTitle})` : '';
    if (info.error || (info.listeners === 0 && info.playcount === 0)) { miss++; console.log(`   · MISS ${a} — ${s.title}${info.error ? ' [' + info.error + ']' : ''}`); }
    else { ok++; console.log(`   · ${a} — ${s.title}: ${info.listeners} listeners / ${info.playcount} plays${matched}`); }
    await sleep(300); // courtesy: search + getInfo = 2 calls/song
  }
  console.log(`[popularity] fetched ${ok} with data, ${miss} with no/zero data`);

  // Fill spotify popularity + recompute proxy on the uniform percentile scale.
  const { updated, nullRemaining } = await recomputePopularityProxies(db);
  console.log(`[popularity] recomputed proxy for ${updated} song(s); ${nullRemaining} still missing all signal`);
  db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
