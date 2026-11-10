#!/usr/bin/env node
/**
 * wa-watchdog — keeps the bot's WhatsApp Web session alive.
 *
 * 2026-11-09 20:28 the Chromium page behind whatsapp-web.js crashed while the
 * container stayed "Up"; nothing noticed until the 08:00 morning recap send timed
 * out. This probes GET /health (src/whatsapp/health.ts) every 5 minutes and
 * restarts the bot container when the session is dead. Decisions and the alert
 * policy (push only on a problem or developing problem) live in
 * scripts/wa-watchdog/decide.mjs.
 *
 * Restart is the ONLY remedy: never logout, never touch .wwebjs_auth, never touch
 * the Pixel (re-login risks a ban on the bot account).
 *
 *   node scripts/wa-watchdog.mjs             # real run (systemd timer)
 *   node scripts/wa-watchdog.mjs --dry-run   # probe + decide; no restart, no push
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide, afterRestart, initialState } from './wa-watchdog/decide.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const CONTAINER = process.env.WA_WATCHDOG_CONTAINER || 'music-league-bot-bot-1';
const HEALTH_URL = process.env.WA_WATCHDOG_URL || 'http://127.0.0.1:3003/health';
const STATE_FILE = process.env.WA_WATCHDOG_STATE || path.join(ROOT, 'data/wa-watchdog-state.json');
const RECOVER_WAIT_MS = 180_000;
// Run before the 08:00 morning recap send: one failure is enough to restart.
const PREFLIGHT = { from: '07:45', to: '07:55' };

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
const NTFY_SERVER = env.NTFY_URL || 'https://ntfy.mattmariani.com';
const NTFY_TOPIC = env.NTFY_TOPIC_ALERTS || 'mlbot-alerts';
const NTFY_TOKEN = env.NTFY_TOKEN || '';

const log = (m) => console.log(`[wa-watchdog] ${m}`);

async function probe() {
  const started = Date.now();
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(15_000) });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok && body.ok === true, ms: body.ms ?? Date.now() - started, reason: body.reason ?? `HTTP ${res.status}` };
  } catch (err) {
    // Connection refused = bot still starting or crashed; timeout = page hung.
    return { ok: false, ms: Date.now() - started, reason: err?.cause?.code || `${err?.name}: ${err?.message}` };
  }
}

const TITLES = {
  slow: 'WhatsApp bot getting slow',
  repeat: 'WhatsApp bot keeps dying',
  down: 'WhatsApp bot is DOWN',
  limit: 'WhatsApp bot is DOWN (restart limit)',
  recovered: 'WhatsApp bot recovered',
};
const PRIORITY = { slow: 'default', repeat: 'high', down: 'urgent', limit: 'urgent', recovered: 'low' };

async function notify({ kind, detail }) {
  const title = TITLES[kind] ?? `WhatsApp bot: ${kind}`;
  if (DRY) return log(`[dry-run] ntfy ${PRIORITY[kind]} "${title}" - ${detail}`);
  const headers = { Title: title, Priority: PRIORITY[kind] ?? 'default', Tags: kind === 'recovered' ? 'white_check_mark' : 'warning' };
  if (NTFY_TOKEN) headers.Authorization = `Bearer ${NTFY_TOKEN}`;
  try {
    const res = await fetch(`${NTFY_SERVER}/${NTFY_TOPIC}`, { method: 'POST', headers, body: detail, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) console.error(`[wa-watchdog] ntfy HTTP ${res.status}`);
  } catch (err) {
    console.error(`[wa-watchdog] ntfy failed: ${err}`);
  }
  log(`alert ${kind}: ${detail}`);
}

function loadState() {
  try { return { ...initialState(), ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch { return initialState(); }
}
function saveState(s) {
  if (DRY) return;
  fs.writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(s, null, 2));
  fs.renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
}

function inPreflight(d = new Date()) {
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return hm >= PREFLIGHT.from && hm <= PREFLIGHT.to;
}

async function waitHealthy() {
  const deadline = Date.now() + RECOVER_WAIT_MS;
  let last;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10_000));
    last = await probe();
    if (last.ok) return { ok: true, last };
  }
  return { ok: false, last };
}

const preflight = inPreflight();
const p = await probe();
let { restart, alerts, state } = decide(loadState(), p, { now: Date.now(), preflight });
log(`${p.ok ? 'ok' : 'FAIL'} ${p.ms}ms${p.ok ? '' : ` (${p.reason})`} fails=${state.consecFails}${preflight ? ' preflight' : ''}`);
for (const a of alerts) await notify(a);

if (restart) {
  if (DRY) {
    log(`[dry-run] would restart ${CONTAINER}`);
  } else {
    log(`restarting ${CONTAINER}`);
    let reason;
    try {
      execFileSync('docker', ['restart', CONTAINER], { stdio: 'inherit', timeout: 120_000 });
    } catch (err) {
      reason = `docker restart failed: ${err.message}`;
    }
    const w = reason ? { ok: false } : await waitHealthy();
    log(w.ok ? `recovered (${w.last.ms}ms)` : `not recovered: ${reason ?? w.last?.reason}`);
    const r = afterRestart(state, w.ok, { now: Date.now(), reason: reason ?? w.last?.reason });
    state = r.state;
    for (const a of r.alerts) await notify(a);
  }
}
saveState(state);
