// SPIKE 002c — resolve a real round's Spotify submissions to YouTube video ids
// using YouTube Data API v3 search.list (100 quota units per search).
//
//   node .planning/spikes/002c-ytm-link-data-api-search/resolve-round.mjs [roundId]
//
// Default round: 149 (Surrender Monkeys). Prints a match table with the top
// result per track plus a naive title-similarity check, and writes result.json.

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const REPO = resolve(join(fileURLToPath(import.meta.url), "../../../.."));
const require = createRequire(join(REPO, "ui/package.json"));
const Database = require("better-sqlite3");

const env = {};
for (const line of readFileSync(join(REPO, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const ROUND_ID = Number(process.argv[2] ?? 149);

const db = new Database(join(REPO, "data/league.db"), { readonly: true });
const tracks = db
  .prepare(
    `SELECT s.title, s.artists, s.spotify_uri FROM ml_submissions s WHERE s.round_id = ? ORDER BY s.spotify_uri`,
  )
  .all(ROUND_ID);
const roundName = db.prepare(`SELECT name FROM rounds WHERE id = ?`).get(ROUND_ID)?.name;
db.close();
if (!tracks.length) { console.error(`No submissions for round ${ROUND_ID}`); process.exit(1); }
console.log(`Round ${ROUND_ID} "${roundName}" — ${tracks.length} tracks\n`);

async function accessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: env.YOUTUBE_REFRESH_TOKEN,
      client_id: env.YOUTUBE_CLIENT_ID,
      client_secret: env.YOUTUBE_CLIENT_SECRET,
    }).toString(),
  });
  if (!res.ok) throw new Error(`token refresh failed HTTP ${res.status}`);
  return (await res.json()).access_token;
}

// Crude similarity: fraction of query words present in the result title+channel.
function overlap(q, hay) {
  const words = q.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return 0;
  const h = hay.toLowerCase();
  return words.filter((w) => h.includes(w)).length / words.length;
}

const token = await accessToken();
const rows = [];
for (const t of tracks) {
  const q = `${t.title} ${t.artists}`;
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("q", q);
  url.searchParams.set("type", "video");
  url.searchParams.set("videoCategoryId", "10"); // Music
  url.searchParams.set("maxResults", "3");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { rows.push({ ...t, error: `HTTP ${res.status}` }); continue; }
  const items = (await res.json()).items ?? [];
  const top = items[0];
  const cand = items.map((i) => ({
    videoId: i.id?.videoId,
    title: i.snippet?.title,
    channel: i.snippet?.channelTitle,
    score: overlap(q, `${i.snippet?.title} ${i.snippet?.channelTitle}`),
  }));
  rows.push({
    query: q,
    spotify_uri: t.spotify_uri,
    top: cand[0] ?? null,
    alternates: cand.slice(1),
  });
  const s = cand[0];
  console.log(
    `${s && s.score >= 0.6 ? "✓" : "?"} ${t.title} — ${t.artists}\n    → ${s?.title} · ${s?.channel} · score ${s?.score?.toFixed(2)} · ${s?.videoId}`,
  );
}

const good = rows.filter((r) => r.top && r.top.score >= 0.6).length;
const summary = {
  round: { id: ROUND_ID, name: roundName },
  tracks: rows.length,
  scoreGte60: good,
  hitRate: +(good / rows.length).toFixed(2),
  quotaUsed: rows.length * 100,
  rows,
};
writeFileSync(join(REPO, ".planning/spikes/002c-ytm-link-data-api-search/result.json"), JSON.stringify(summary, null, 2));
console.log(`\n=== ${good}/${rows.length} auto-match (score ≥ 0.6) · quota ${summary.quotaUsed} units · result.json written ===`);
