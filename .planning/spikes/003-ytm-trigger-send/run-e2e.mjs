// SPIKE 003 — end-to-end: round → resolved video ids (002c) → real YTM
// playlist (001a) → link posted to the TEST group via the bot's control /say.
//
//   node .planning/spikes/003-ytm-trigger-send/run-e2e.mjs [roundId]
//
// HARD-CODED SAFETY: the WhatsApp target is the TEST group only. Promoting to
// a real league group is a build decision, not a spike edit.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_GROUP = "120363428945055429@g.us"; // "Chat bot test group" — verified id
const REPO = resolve(join(fileURLToPath(import.meta.url), "../../../.."));
const ROUND_ID = Number(process.argv[2] ?? 149);

const env = {};
for (const line of readFileSync(join(REPO, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// 1. Video ids from the 002c resolver run (re-run 002c for a different round).
const resPath = join(REPO, ".planning/spikes/002c-ytm-link-data-api-search/result.json");
if (!existsSync(resPath)) { console.error("Run spike 002c first (resolve-round.mjs)"); process.exit(1); }
const resolved = JSON.parse(readFileSync(resPath, "utf8"));
if (resolved.round.id !== ROUND_ID) { console.error(`002c result is for round ${resolved.round.id}, not ${ROUND_ID}`); process.exit(1); }
const videoIds = resolved.rows.map((r) => r.top?.videoId).filter(Boolean);
console.log(`Round ${ROUND_ID} "${resolved.round.name}" — ${videoIds.length} resolved videos`);

// 2. Create the playlist.
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
// playlistItems.insert intermittently 409s (SERVICE_UNAVAILABLE) on rapid
// sequential inserts — transient, retry with backoff. Found in this spike.
async function api(token, path, payload, tries = 5) {
  for (let i = 0; ; i++) {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (res.ok) return body;
    const transient = [409, 500, 503].includes(res.status);
    if (!transient || i >= tries - 1) {
      throw new Error(`${path} HTTP ${res.status}: ${JSON.stringify(body.error?.errors ?? body).slice(0, 300)}`);
    }
    const wait = 1000 * 2 ** i;
    console.log(`  transient HTTP ${res.status} on ${path.split("?")[0]} — retry ${i + 1}/${tries - 1} in ${wait}ms`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

const token = await accessToken();
const pl = await api(token, "playlists?part=snippet,status", {
  snippet: {
    title: `Boarz II Men · ${resolved.round.name}`,
    description: `Music League round ${ROUND_ID} — auto-built YTM mirror (spike 003).`,
  },
  status: { privacyStatus: "unlisted" },
});
for (const vid of videoIds) {
  await api(token, "playlistItems?part=snippet", {
    snippet: { playlistId: pl.id, resourceId: { kind: "youtube#video", videoId: vid } },
  });
  await new Promise((r) => setTimeout(r, 400)); // pace inserts — see 409 note above
}
const ytmUrl = `https://music.youtube.com/playlist?list=${pl.id}`;
console.log(`Playlist created: ${ytmUrl} (${videoIds.length} tracks)`);

// 3. Post to the TEST group via the bot's control server (internal-only port).
const text = `🎧 *${resolved.round.name}* — this week's playlist for the YouTube Music crowd:\n${ytmUrl}\n\n(spike 003 test — auto-built mirror of the round's Spotify playlist)`;
const out = execFileSync("docker", [
  "exec", "music-league-bot-bot-1", "node", "-e",
  `fetch('http://localhost:3003/say',{method:'POST',headers:{'content-type':'application/json'},body:process.argv[1]}).then(async r=>{console.log(r.status, await r.text())})`,
  JSON.stringify({ target: TEST_GROUP, text }),
], { encoding: "utf8" });
console.log("control /say →", out.trim());

writeFileSync(join(REPO, ".planning/spikes/003-ytm-trigger-send/result.json"), JSON.stringify({
  round: resolved.round, playlistId: pl.id, ytmUrl, tracks: videoIds.length,
  target: TEST_GROUP, say: out.trim(), at: new Date().toISOString(),
}, null, 2));
console.log("=== SPIKE 003 COMPLETE — check the test group on your phone ===");
