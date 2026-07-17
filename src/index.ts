import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config/loader.js';
import { SpotifyAdapter } from './spotify/adapter.js';
import { openDb } from './storage/db.js';
import { createClient, makeSendDm } from './whatsapp/client.js';
import { handleMessage } from './bot/handler.js';
import { startDigestPoller } from './digest/poller.js';
import { resolvePing } from './digest/ping.js';
import { guardedSend } from './whatsapp/sendGuard.js';
import { runManualSend } from './digest/manualSend.js';
import { startControlServer } from './control/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, '../config/rules.json');

const config = loadConfig(configPath);
const spotify = new SpotifyAdapter();
const db = openDb(path.join(__dirname, '../data/submissions.db'));

const allowedGroupIds = (process.env.WHATSAPP_ALLOWED_GROUP_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const rawOwnerPhone = process.env.OWNER_PHONE_NUMBER;
if (!rawOwnerPhone) {
  console.error('[bot] OWNER_PHONE_NUMBER is required — set it in .env');
  process.exit(1);
}
const ownerPhone = rawOwnerPhone.includes('@') ? rawOwnerPhone : `${rawOwnerPhone}@c.us`;

const masterPlaylistName = process.env.MASTER_PLAYLIST_NAME ?? 'Music League — All Mentions';

const client = createClient(async (msg) => {
  await handleMessage(msg, {
    config,
    spotify,
    db,
    allowedGroupIds,
    ownerPhone,
    masterPlaylistName,
    sendDm: makeSendDm(client),
  });
});

console.log('[bot] Starting WhatsApp client...');
client.initialize();

// Digest auto-post. Fails closed: without DIGEST_SEND_MODE=live and a
// DIGEST_SEND_TARGETS entry for a league, this polls and posts nothing.
// `ready` can fire more than once (reconnects), so guard the one-time wiring.
let started = false;
client.on('ready', () => {
  if (started) return;
  started = true;

  const baseUrl = process.env.BOT_UI_INTERNAL_URL ?? 'http://bot-ui:3002';
  const { runOnce } = startDigestPoller({
    baseUrl,
    send: (target, text) => makeSendDm(client)(target, text),
    notifyOwner: (msg) => makeSendDm(client)(ownerPhone, msg),
  });

  // Local control plane (container-local only): trigger a poll, or send any
  // round's digest to any group. See src/control/server.ts.
  startControlServer({
    onTrigger: runOnce,
    onSend: (req) =>
      runManualSend(
        {
          render: async (roundId) => {
            const res = await fetch(`${baseUrl}/api/digest/${roundId}/render`, { method: 'POST' });
            if (!res.ok) throw new Error(`render → ${res.status} ${await res.text().catch(() => '')}`);
            return (await res.json()) as { name: string; url: string };
          },
          send: (target, text) => makeSendDm(client)(target, text),
          log: (msg) => console.log(msg),
        },
        req,
      ),
  });

  // One-shot send test. Only when DIGEST_PING_TARGET is set; confirms sendMessage
  // works (Store methods are broken in this wwebjs build) before any real digest.
  const ping = resolvePing(process.env);
  if (ping) {
    void guardedSend(ping.env, ping.leagueSlug, ping.text, (t, text) => makeSendDm(client)(t, text))
      .then((r) => console.log(`[ping] ${r.sent ? 'SENT' : 'blocked'} — ${r.reason}`))
      .catch((err) => console.error('[ping] threw:', err));
  }
});
