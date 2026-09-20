#!/usr/bin/env node
/**
 * ml-round-songs-sync — make an in-flight round's submitted songs visible to
 * the Guess workspace before Music League's export includes them.
 *
 * Music League's commissioner export.zip only covers completed rounds, so the
 * Guess tab (gated on ml_submissions rows) stays dark exactly when guessing
 * matters. But the round's Spotify playlist receives every submission as it
 * lands, anonymously. This script copies those tracks into ml_submissions as
 * anonymous placeholder rows (competitor_id IS NULL):
 *
 *   - the round page's ML tab joins competitors with an INNER JOIN, so
 *     NULL-identity rows keep it empty — no reveal, no spoilers;
 *   - the guess workspace (visibleSubmissions / eligibleSongs) never selects
 *     identity, so it sees the songs;
 *   - the schema anticipates this state: idx_ml_submissions_anon plus
 *     upsertSubmission's "drop the stale anonymous placeholder" step means
 *     the post-round export import replaces these rows with identified ones.
 *
 * Usage:
 *   node scripts/ml-round-songs-sync.mjs --round 152 --playlist <spotifyPlaylistId> [--mine <uri-substring>]
 *
 * --mine flags Matt's own pick in voting_lab_ballot.is_mine so the workspace
 * excludes it from the guess slate (he obviously knows his own song).
 *
 * Idempotent: existing (round, uri) anonymous rows are left untouched, so it
 * can be re-run as more submissions land. Dry-run by default; --apply writes.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DB_PATH = process.env.LEAGUE_DB ?? resolve(REPO_ROOT, 'data/league.db');
const APPLY = process.argv.includes('--apply');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const roundId = Number(argValue('--round'));
let playlistId = argValue('--playlist');
const mineUri = argValue('--mine');

if (!Number.isInteger(roundId)) {
  console.error('usage: node scripts/ml-round-songs-sync.mjs --round <dbRoundId> [--playlist <id>] [--mine <uri-substring>]');
  process.exit(1);
}

function loadSpotifyEnv() {
  // ui/.env holds the real credentials; root .env (if present) wins per dotenv
  // convention. No writes, no logs of values.
  for (const p of ['ui/.env', '.env']) {
    try {
      for (const line of readFileSync(resolve(REPO_ROOT, p), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
      }
    } catch { /* optional file */ }
  }
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    console.error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not found (ui/.env)');
    process.exit(1);
  }
}

/** Playlist id via the CLI when not given: rounds get returns playlist_id for the current round. */
function resolvePlaylistId(db) {
  const row = db.prepare(
    `SELECT r.ml_round_id AS rid, l.id AS lid FROM rounds r
       JOIN seasons s ON s.id = r.season_id JOIN leagues l ON l.id = s.league_id
      WHERE r.id = ?`,
  ).get(roundId);
  if (!row) { console.error(`round ${roundId} not found`); process.exit(1); }
  const res = spawnSync('cli-web-musicleague', ['rounds', 'get', row.lid, row.rid, '--json'], {
    encoding: 'utf8', timeout: 120_000,
  });
  if (res.status !== 0) { console.error(`rounds get failed: ${res.stderr?.slice(0, 300)}`); process.exit(1); }
  const out = JSON.parse(res.stdout);
  if (!out.playlist_id) { console.error('round has no playlist yet — pass --playlist'); process.exit(1); }
  return out.playlist_id;
}

async function fetchPlaylistTracks(id) {
  const tokRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!tokRes.ok) throw new Error(`spotify token failed (${tokRes.status})`);
  const { access_token } = await tokRes.json();

  const tracks = [];
  let url = `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100&fields=next,items(track(id,name,artists(name),album(name)))`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` } });
    if (!res.ok) throw new Error(`playlist fetch failed (${res.status})`);
    const page = await res.json();
    for (const it of page.items ?? []) {
      if (!it.track) continue;
      tracks.push({
        uri: `spotify:track:${it.track.id}`,
        title: it.track.name,
        artists: it.track.artists.map((a) => a.name).join(', '),
        album: it.track.album?.name ?? null,
      });
    }
    url = page.next;
  }
  return tracks;
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

loadSpotifyEnv();
if (!playlistId) playlistId = resolvePlaylistId(db);

const round = db.prepare('SELECT id, name FROM rounds WHERE id = ?').get(roundId);
if (!round) { console.error(`round ${roundId} not found`); process.exit(1); }

const tracks = await fetchPlaylistTracks(playlistId);
console.log(`round ${roundId} "${round.name}" · playlist ${playlistId} · ${tracks.length} tracks`);

const existing = new Set(
  db.prepare('SELECT spotify_uri FROM ml_submissions WHERE round_id = ?').all(roundId).map((r) => r.spotify_uri),
);

const fresh = tracks.filter((t) => !existing.has(t.uri));
for (const t of tracks) {
  const status = existing.has(t.uri) ? 'already' : (APPLY ? 'inserted' : 'would insert');
  console.log(`  [${status}] ${t.title} — ${t.artists} (${t.uri})`);
}

if (APPLY) {
  const insert = db.prepare(
    `INSERT INTO ml_submissions
       (round_id, competitor_id, spotify_uri, title, album, artists, comment, created_at, visible_to_voters)
     VALUES (?, NULL, ?, ?, ?, ?, NULL, ?, 1)`,
  );
  const tx = db.transaction(() => {
    const now = new Date().toISOString();
    for (const t of fresh) insert.run(roundId, t.uri, t.title, t.album, t.artists, now);
    if (mineUri) {
      db.prepare(
        `INSERT INTO voting_lab_ballot (round_id, spotify_uri, is_mine, updated_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(round_id, spotify_uri) DO UPDATE SET is_mine = 1, updated_at = excluded.updated_at`,
      ).run(roundId, tracks.find((t) => t.uri.includes(mineUri))?.uri ?? mineUri, new Date().toISOString());
    }
  });
  tx();
  console.log(`applied: ${fresh.length} anonymous placeholder row(s)${mineUri ? ' + is_mine flag' : ''}`);
} else {
  console.log(`dry run — ${fresh.length} row(s) would be inserted. Re-run with --apply.`);
}
