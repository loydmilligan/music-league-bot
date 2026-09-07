#!/usr/bin/env node
/**
 * ytm-token-watchdog — keeps the YouTube OAuth refresh token from dying unnoticed.
 *
 * Background: the Google Cloud project is in "Testing" publishing status, which
 * hard-expires refresh tokens after 7 days. On 2026-08-30 the token died and
 * nobody noticed until 2026-09-06 — a week of failed Boarz drops. This watchdog
 * closes that detection gap.
 *
 * Two independent triggers:
 *   1. LIVE PROBE — refresh the token and make one 1-unit videos.list call. If
 *      that fails the token is already dead, whatever the calendar says. Fires
 *      at max severity immediately (a token can be revoked, not just expire).
 *   2. COUNTDOWN — days elapsed since YOUTUBE_TOKEN_MINTED_AT, on Matt's ladder:
 *        day 5  14:00            "2 days left"      default
 *        day 6  14:00            "tomorrow"         high
 *        day 7  09:00/11:00/14:00 escalating        high -> urgent -> urgent
 *
 * Each rung fires once per token generation (deduped on the mint timestamp), so
 * re-minting silently resets the whole ladder.
 *
 *   node scripts/ytm-token-watchdog.mjs                    # real run
 *   node scripts/ytm-token-watchdog.mjs --dry-run          # decide, don't send
 *   node scripts/ytm-token-watchdog.mjs --simulate 7 --hour 11 --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'ui/package.json'));
const Database = require('better-sqlite3');

const argvHas = (f) => process.argv.includes(f);
const argvVal = (f) => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const DRY = argvHas('--dry-run');
const SIM_DAY = argvVal('--simulate') !== undefined ? Number(argvVal('--simulate')) : null;
const SIM_HOUR = argvVal('--hour') !== undefined ? Number(argvVal('--hour')) : null;

function parseEnv(p) {
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = { ...parseEnv('/home/loydmilligan/sysops-agent/.env'), ...parseEnv(path.join(ROOT, '.env')) };

// NTFY_TOPIC is the digest job's topic (mlb-digest) — do NOT reuse it. Alerts get
// their own authenticated topic; the grant was made by the sysops agent 2026-09-07.
const NTFY_SERVER = env.NTFY_URL || 'https://ntfy.mattmariani.com';
const NTFY_TOPIC = env.NTFY_TOPIC_ALERTS || 'mlbot-alerts';
const NTFY_TOKEN = env.NTFY_TOKEN || '';
const MINT_CMD = 'node .planning/spikes/001a-ytm-playlist-data-api/mint-youtube-refresh-token.mjs';
// One-click refresh, served by scripts/ytm-refresh-endpoint.mjs. Only reachable
// from a browser ON THE LAPTOP (loopback) — which is exactly how Matt opens the
// ntfy topic. Publishing the OAuth app was ruled out on 2026-09-07, so this
// ladder is the permanent mechanism, not a stopgap.
const REFRESH_URL = `http://127.0.0.1:${env.YTM_REFRESH_PORT || 4577}/start?k=${env.YTM_REFRESH_KEY ?? ''}`;

// ── state (one row per rung per token generation) ────────────────────────────
const db = new Database(path.join(ROOT, 'data/league.db'));
db.exec(`CREATE TABLE IF NOT EXISTS ytm_token_alerts (
  minted_at TEXT NOT NULL,
  rung      TEXT NOT NULL,
  sent_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (minted_at, rung)
)`);
const alreadySent = (mintedAt, rung) =>
  !!db.prepare('SELECT 1 FROM ytm_token_alerts WHERE minted_at=? AND rung=?').get(mintedAt, rung);
const markSent = (mintedAt, rung) =>
  db.prepare('INSERT OR IGNORE INTO ytm_token_alerts (minted_at, rung) VALUES (?,?)').run(mintedAt, rung);

// ── live probe ───────────────────────────────────────────────────────────────
async function probe() {
  for (const k of ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN']) {
    if (!env[k]) return { ok: false, why: `missing ${k} in .env` };
  }
  let res;
  try {
    res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: env.YOUTUBE_REFRESH_TOKEN,
        client_id: env.YOUTUBE_CLIENT_ID,
        client_secret: env.YOUTUBE_CLIENT_SECRET,
      }).toString(),
    });
  } catch (e) {
    return { ok: false, why: `network: ${e.message}` };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, why: `${body.error ?? res.status}: ${body.error_description ?? ''}`.trim() };
  // 1-unit call — proves the token is usable, costs almost nothing.
  const v = await fetch('https://www.googleapis.com/youtube/v3/videos?part=id&id=TT2izWpGDCo', {
    headers: { Authorization: `Bearer ${body.access_token}` },
  });
  if (!v.ok) {
    const vb = await v.json().catch(() => ({}));
    return { ok: false, why: `videos.list HTTP ${v.status}: ${vb.error?.errors?.[0]?.reason ?? ''}` };
  }
  return { ok: true };
}

// ── ntfy ─────────────────────────────────────────────────────────────────────
async function notify({ title, body, priority, tags }) {
  if (DRY) {
    console.log(`[dry-run] ntfy ${priority} "${title}" — ${body.replace(/\n/g, ' / ')}`);
    return true;
  }
  const headers = {
    Title: title,
    Priority: priority,
    Tags: tags,
    Actions: `view, Refresh token now, ${REFRESH_URL}`,
  };
  if (NTFY_TOKEN) headers.Authorization = `Bearer ${NTFY_TOKEN}`;
  const res = await fetch(`${NTFY_SERVER}/${NTFY_TOPIC}`, { method: 'POST', headers, body });
  if (!res.ok) {
    console.error(`[fail] ntfy HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return false;
  }
  return true;
}

// ── ladder ───────────────────────────────────────────────────────────────────
const LADDER = [
  { day: 5, hour: 14, rung: 'day5_1400', priority: 'default', tags: 'hourglass',
    title: 'YouTube token expires in 2 days' },
  { day: 6, hour: 14, rung: 'day6_1400', priority: 'high', tags: 'warning',
    title: 'YouTube token expires TOMORROW' },
  { day: 7, hour: 9,  rung: 'day7_0900', priority: 'high', tags: 'warning',
    title: 'YouTube token expires TODAY' },
  { day: 7, hour: 11, rung: 'day7_1100', priority: 'urgent', tags: 'rotating_light',
    title: 'YouTube token expires today — still not refreshed' },
  { day: 7, hour: 14, rung: 'day7_1400', priority: 'urgent', tags: 'rotating_light,sos',
    title: 'LAST CALL: YouTube token dies today' },
];

const mintedAt = env.YOUTUBE_TOKEN_MINTED_AT;
if (!mintedAt) {
  console.error('[fatal] YOUTUBE_TOKEN_MINTED_AT not set in .env — cannot compute the countdown.');
  process.exit(1);
}
const ageMs = Date.now() - Date.parse(mintedAt);
const ageDays = SIM_DAY !== null ? SIM_DAY : Math.floor(ageMs / 86_400_000);
const hour = SIM_HOUR !== null ? SIM_HOUR : new Date().getHours();

const p = await probe();
console.log(`[info] token minted ${mintedAt} · age ${ageDays}d · hour ${hour} · probe ${p.ok ? 'OK' : 'FAILED (' + p.why + ')'}`);

if (!p.ok) {
  // Dead already — one shout per day, regardless of where we are on the ladder.
  const rung = `dead_${new Date().toISOString().slice(0, 10)}`;
  if (alreadySent(mintedAt, rung)) {
    console.log('[skip] dead-token alert already sent today');
  } else if (await notify({
    title: 'YouTube token is DEAD — Boarz drops are failing',
    body: `Probe failed: ${p.why}\n\nTap "Refresh token now" (laptop only).\n`
      + `Terminal fallback:\n${MINT_CMD}\n\nUntil then every ytm-drop run fails.`,
    priority: 'urgent', tags: 'rotating_light,skull',
  })) { if (!DRY) markSent(mintedAt, rung); console.log(`[sent] ${rung}`); }
  db.close();
  process.exit(0);
}

const due = LADDER.find((r) => r.day === ageDays && r.hour === hour);
if (!due) {
  console.log('[ok] nothing due at this day/hour');
  db.close();
  process.exit(0);
}
if (alreadySent(mintedAt, due.rung)) {
  console.log(`[skip] ${due.rung} already sent for this token`);
  db.close();
  process.exit(0);
}
const left = 7 - ageDays;
const body = `Minted ${mintedAt.slice(0, 10)} — Google expires it 7 days after mint (project is in "Testing" status).\n`
  + `${left > 0 ? `${left} day(s) left.` : 'Expires today.'}\n\n`
  + `Tap "Refresh token now" with this topic open on the laptop.\n`
  + `Terminal fallback:\n${MINT_CMD}`;
if (await notify({ title: due.title, body, priority: due.priority, tags: due.tags })) {
  if (!DRY) markSent(mintedAt, due.rung);
  console.log(`[sent] ${due.rung} (${due.priority})`);
}
db.close();
