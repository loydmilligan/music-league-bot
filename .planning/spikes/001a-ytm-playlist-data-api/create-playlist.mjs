// SPIKE 001a — create an unlisted playlist on Matt's account via YouTube Data
// API v3 and insert three videos. Validates end-to-end: refresh-token auth →
// playlists.insert → playlistItems.insert → URL that opens in YouTube Music.
//
//   node .planning/spikes/001a-ytm-playlist-data-api/create-playlist.mjs
//
// Quota per run: 50 (playlist) + 3×50 (items) = 200 of 10,000/day.

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(join(fileURLToPath(import.meta.url), "../../../.."));
const OUT = join(REPO, ".planning/spikes/001a-ytm-playlist-data-api/result.json");

const env = {};
for (const line of readFileSync(join(REPO, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
for (const k of ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"]) {
  if (!env[k]) { console.error(`Missing ${k} in .env — run mint-youtube-refresh-token.mjs first`); process.exit(1); }
}

// Three stable, well-known videos (KC & The Sunshine Band one is from the
// actual Boarz chat — the very first link on the Tape).
const VIDEO_IDS = ["w-l5FyA3pgo", "dQw4w9WgXcQ", "hTWKbfoikeg"];

const log = [];
const ev = (tag, data) => { log.push({ ts: new Date().toISOString(), tag, ...data }); console.log(`[${tag}]`, JSON.stringify(data)); };

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
  const body = await res.json();
  if (!res.ok) throw new Error(`token refresh failed (HTTP ${res.status}): ${body.error ?? ""} ${body.error_description ?? ""}`);
  ev("auth", { ok: true, scope: body.scope, expires_in: body.expires_in });
  return body.access_token;
}

async function api(token, path, payload) {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${path} failed (HTTP ${res.status}): ${JSON.stringify(body.error?.errors ?? body).slice(0, 400)}`);
  return body;
}

const t0 = Date.now();
const token = await accessToken();

const pl = await api(token, "playlists?part=snippet,status", {
  snippet: {
    title: "SPIKE 001a — Boarz YTM test (delete me)",
    description: "Created by music-league-bot spike 001a. Safe to delete.",
  },
  status: { privacyStatus: "unlisted" },
});
ev("playlist.created", { id: pl.id, title: pl.snippet?.title, privacy: pl.status?.privacyStatus });

for (const vid of VIDEO_IDS) {
  const item = await api(token, "playlistItems?part=snippet", {
    snippet: { playlistId: pl.id, resourceId: { kind: "youtube#video", videoId: vid } },
  });
  ev("item.inserted", { videoId: vid, position: item.snippet?.position });
}

const result = {
  playlistId: pl.id,
  youtube: `https://www.youtube.com/playlist?list=${pl.id}`,
  youtubeMusic: `https://music.youtube.com/playlist?list=${pl.id}`,
  quotaUsed: 50 + VIDEO_IDS.length * 50,
  durationMs: Date.now() - t0,
  log,
};
writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log("\n=== SPIKE 001a RESULT ===");
console.log("YouTube:        " + result.youtube);
console.log("YouTube Music:  " + result.youtubeMusic);
console.log(`Quota used: ${result.quotaUsed} units · ${result.durationMs}ms · log → ${OUT}`);
