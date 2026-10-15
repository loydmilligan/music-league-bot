import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config/loader.js';
import { SpotifyAdapter } from './spotify/adapter.js';
import { openDb } from './storage/db.js';
import { createClient, makeSendDm, makeSendPoll, makeSendMedia, makeSay, makeSendToNumber } from './whatsapp/client.js';
import { allowPlayerDm, loadOptedInWhatsApp } from './whatsapp/optIn.js';
import Database from 'better-sqlite3';
import { createLoginCodeService, lookupPlayerNumber } from './whatsapp/loginCode.js';
import { handleMessage } from './bot/handler.js';
import { startDigestPoller } from './digest/poller.js';
import { resolvePing } from './digest/ping.js';
import { guardedSend } from './whatsapp/sendGuard.js';
import { parseTargets } from './whatsapp/sendGuard.js';
import { generateOpenRouterRevealImage, runRevealAnnouncement } from './reveal/announcement.js';
import { runManualSend } from './digest/manualSend.js';
import { startControlServer } from './control/server.js';
import { createPromptTables, insertPrompt } from './chat/prompts/store.js';
import type { PromptOption, PromptTemplates } from './chat/prompts/types.js';
import { createJevResponder } from './chat/jevResponder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, '../config/rules.json');

const config = loadConfig(configPath);
const spotify = new SpotifyAdapter();
const db = openDb(path.join(__dirname, '../data/submissions.db'));
createPromptTables(db);

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

const jevRespond = process.env.WHATSAPP_JEV_ENABLED === '1' && process.env.OPENROUTER_API_KEY
  ? createJevResponder({
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.WHATSAPP_JEV_MODEL,
      cooldownMs: Number(process.env.WHATSAPP_JEV_COOLDOWN_MS ?? 30_000),
    })
  : undefined;
if (process.env.WHATSAPP_JEV_ENABLED === '1' && !jevRespond) {
  console.warn('[jev-chat] WHATSAPP_JEV_ENABLED=1 but OPENROUTER_API_KEY is missing; feature disabled');
}

const client = createClient(async (msg) => {
  await handleMessage(msg, {
    config,
    spotify,
    db,
    allowedGroupIds,
    ownerPhone,
    masterPlaylistName,
    sendDm: makeSendDm(client),
    jevRespond,
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

  // Portal login codes: read-only lookup in league.db; bypasses the opt-in guard
  // (the player asked) with its own 3/hour limit. LOGIN_CODE_REDIRECT diverts all.
  let leagueDbRo: Database.Database | null = null;
  const loginCodes = createLoginCodeService({
    lookup: (name) => {
      leagueDbRo ??= new Database(path.join(__dirname, '../data/league.db'), { readonly: true, fileMustExist: true });
      return lookupPlayerNumber(leagueDbRo, name);
    },
    send: (target, text) => makeSendToNumber(client)(target, text),
    redirect: process.env.LOGIN_CODE_REDIRECT,
    log: (line) => console.log(line),
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
    onNotify: async (text) => {
      await makeSendDm(client)(ownerPhone, text);
    },
    onPoll: async (target, name, options, allowMultiple) => {
      const to = target ?? ownerPhone;
      await makeSendPoll(client)(to, name, options, allowMultiple);
      console.log(`[poll] sent "${name}" (${options.length} options) to ${to}`);
      return { target: to };
    },
    onMedia: async (target, file, caption, pin) => {
      const to = target ?? ownerPhone;
      await makeSendMedia(client)(to, file, caption ?? undefined, pin ?? undefined);
      console.log(`[media] sent ${file} to ${to}${pin ? ` (pinned ${pin}s)` : ''}`);
      return { target: to };
    },
    onPrompt: async (raw) => {
      const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `p-${Date.now()}`;
      insertPrompt(db, {
        id,
        chatId: String(raw.chatId),
        messageId: typeof raw.messageId === 'string' ? raw.messageId : null,
        hashtag: typeof raw.hashtag === 'string' ? raw.hashtag : null,
        subject: typeof raw.subject === 'string' ? raw.subject : null,
        options: raw.options as PromptOption[],
        templates: raw.templates as PromptTemplates,
        onePerPerson: raw.onePerPerson !== false,
        acceptDirect: raw.acceptDirect === true,
        acceptInline: raw.acceptInline === true,
        kind: typeof raw.kind === 'string' ? raw.kind : null,
        meta: raw.meta,
      });
      console.log(`[prompt] opened ${id} in ${String(raw.chatId)}`);
      return { id };
    },
    onSay: async (target, text, pin) => {
      const to = target ?? ownerPhone;
      await makeSay(client)(to, text, pin ?? undefined);
      console.log(`[say] sent ${text.length} chars to ${to}${pin ? ` (pinned ${pin}s)` : ''}`);
      return { target: to };
    },
    onDm: async (to, text) => {
      const surveyDir = process.env.SURVEY_DATA_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../boarz-season-2-survey/data');
      const optedIn = await loadOptedInWhatsApp(surveyDir);
      const decision = allowPlayerDm(to, optedIn);
      if (decision.action === 'block') {
        console.log(`[dm] blocked — ${decision.reason}`);
        return { sent: false, reason: decision.reason };
      }
      await makeSay(client)(decision.target, text);
      console.log(`[dm] sent ${text.length} chars to ${decision.target}`);
      return { sent: true, target: decision.target, reason: decision.reason };
    },
    onLoginCode: (req) => loginCodes.request(req),
    onRoundReveal: async (request) => {
      const result = await runRevealAnnouncement(request, {
        env: {
          mode: process.env.ROUND_REVEAL_SEND_MODE,
          targets: {
            ...parseTargets(process.env.DIGEST_SEND_TARGETS),
            ...parseTargets(process.env.ROUND_REVEAL_SEND_TARGETS),
          },
        },
        dataDir: '/app/data',
        generate: (prompt) => generateOpenRouterRevealImage(prompt),
        sendMedia: (target, file, caption) => makeSendMedia(client)(target, file, caption),
        sendText: (target, text) => makeSay(client)(target, text),
      });
      console.log(`[round-reveal] ${request.leagueSlug} round ${request.roundNumber}: ${result.sent ? (result.media ? 'image sent' : 'text sent') : 'blocked'} — ${result.reason}`);
      if (result.warning) console.warn(`[round-reveal] ${result.warning}`);
      return result;
    },
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
