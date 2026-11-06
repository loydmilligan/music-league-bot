import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type { Client as ClientType, Message, Chat } from 'whatsapp-web.js';
import type { WhatsAppMessage } from '../bot/handler.js';
import { formatEnvelope } from './listGroups.js';
import { recordSeenMessage, recordReaction } from '../storage/reactionsDb.js';

const _require = createRequire(import.meta.url);
const { Client, LocalAuth, Poll, MessageMedia } = _require('whatsapp-web.js') as typeof import('whatsapp-web.js');
const qrcode = _require('qrcode-terminal') as { generate(qr: string, opts?: { small?: boolean }): void };

/**
 * Every address form this account is known by.
 *
 * `client.info.wid` reports the phone-based id (12134198455@c.us) but the same
 * account appears in groups as a LID (186428122255581@lid), so comparing a
 * quoted message's author against wid alone wrongly concludes "not me". Learn
 * the forms instead: for our OWN messages `msg.from` IS our id (see
 * listGroups.ts), so one outgoing message teaches us the LID.
 */
const selfIds = new Set<string>();

/**
 * A message id's serialized form. This wwebjs build leaves `_serialized`
 * undefined and stores it under a minified `$1` key, so fall back to that, then
 * to rebuilding it ("fromMe_remote_id[_participant]") from the parts.
 */
export function serializeMsgId(id: unknown): string | null {
  if (!id || typeof id !== 'object') return typeof id === 'string' ? id : null;
  const o = id as Record<string, unknown>;
  if (typeof o._serialized === 'string' && o._serialized) return o._serialized;
  if (typeof o.$1 === 'string' && o.$1) return o.$1;
  const part = o.participant as { _serialized?: string } | string | undefined;
  const participant = typeof part === 'string' ? part : part?._serialized;
  if (o.remote == null || o.id == null) return null;
  const remote = typeof o.remote === 'string' ? o.remote : (o.remote as { _serialized?: string })._serialized;
  return `${Boolean(o.fromMe)}_${remote}_${o.id}${participant ? `_${participant}` : ''}`;
}

/**
 * A WhatsApp user id (wid) as "user@server". Ids arrive as strings or as
 * objects whose serialized form is `_serialized`, or `$1` in this minified
 * build, or only `user` + `server` parts.
 */
export function serializeWid(id: unknown): string | null {
  if (typeof id === 'string') return id || null;
  if (!id || typeof id !== 'object') return null;
  const o = id as Record<string, unknown>;
  if (typeof o._serialized === 'string' && o._serialized) return o._serialized;
  if (typeof o.$1 === 'string' && o.$1) return o.$1;
  if (typeof o.user === 'string' && o.user && typeof o.server === 'string' && o.server) {
    return `${o.user}@${o.server}`;
  }
  return null;
}

/**
 * Does this message @mention the bot? True when any mentioned id is one of our
 * own ids, or (belt and braces) when the body carries "@<digits>" for the user
 * part of any of our ids, since WhatsApp writes a mention as "@<number>".
 */
export function mentionsSelf(mentionedIds: unknown[] | undefined, body: string, ids: Set<string>): boolean {
  if ((mentionedIds ?? []).some((id) => {
    const wid = serializeWid(id);
    return !!wid && ids.has(wid);
  })) return true;
  for (const id of ids) {
    const user = id.split('@')[0];
    if (/^\d+$/.test(user) && new RegExp(`@${user}(?!\\d)`).test(body)) return true;
  }
  return false;
}

/**
 * Learn this account's own ids at 'ready': the phone wid from client.info and,
 * best effort, the LID it appears as in groups. Without this, selfIds stays
 * empty after every restart until the bot sends something, so @mentions of the
 * bot go unrecognised.
 */
export async function seedSelfIds(
  client: Pick<ClientType, 'getContactLidAndPhone'> & { info?: { wid?: unknown } },
  ids: Set<string> = selfIds,
  log: (line: string) => void = console.log,
): Promise<void> {
  const learn = (id: string) => {
    if (!ids.has(id)) log(`[self] learned own id ${id}`);
    ids.add(id);
  };
  const wid = serializeWid(client.info?.wid);
  if (!wid) {
    log('[self] no wid in client.info');
    return;
  }
  learn(wid);
  try {
    const [found] = await client.getContactLidAndPhone([wid]);
    if (found?.lid) learn(found.lid);
    if (found?.pn) learn(found.pn);
  } catch (err) {
    log(`[self] lid lookup failed (${err instanceof Error ? err.name : 'error'})`);
  }
}

interface BufferedMsg { sender: string; timeMs: number; text: string; }
const chatBuffer = new Map<string, BufferedMsg[]>();
const BUFFER_SIZE = 5;

function pushToBuffer(chatId: string, msg: BufferedMsg) {
  const buf = chatBuffer.get(chatId) ?? [];
  buf.push(msg);
  if (buf.length > BUFFER_SIZE) buf.shift();
  chatBuffer.set(chatId, buf);
}

export function createClient(onMessage: (msg: WhatsAppMessage) => Promise<void>): ClientType {
  const puppeteerArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
  // One-shot relinking without a camera: put the bot account's phone number
  // (digits only) in data/wa-pair-phone; the client then asks WhatsApp for an
  // 8-character code ("Link with phone number instead" on the phone). Delete
  // the file once linked.
  const pairFile = path.join(process.cwd(), 'data', 'wa-pair-phone');
  const pairPhone = (process.env.WA_PAIR_PHONE || (fs.existsSync(pairFile) ? fs.readFileSync(pairFile, 'utf8') : '')).replace(/\D/g, '');
  const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { executablePath: process.env.CHROMIUM_PATH || undefined, args: puppeteerArgs },
    ...(pairPhone ? { pairWithPhoneNumber: { phoneNumber: pairPhone, showNotification: true } } : {}),
  });

  client.on('code', (code: string) => {
    console.log(`[whatsapp] Pairing code: ${code} (WhatsApp > Linked devices > Link a device > Link with phone number instead)`);
  });

  // Startup stages between "Starting WhatsApp client" and "Client ready", so a
  // silent hang shows where it stopped (no message content is logged).
  let lastLoading = -1;
  client.on('loading_screen', (percent: number | string) => {
    const p = Number(percent);
    if (p !== lastLoading) console.log(`[whatsapp] loading ${p}%`);
    lastLoading = p;
  });
  client.on('authenticated', () => console.log('[whatsapp] authenticated (saved login restored)'));
  client.on('auth_failure', (msg: string) => console.error('[whatsapp] auth failure:', String(msg).slice(0, 120)));
  client.on('change_state', (state: string) => console.log(`[whatsapp] state ${state}`));

  client.on('qr', (qr) => {
    console.log('[whatsapp] Scan this QR code to authenticate:');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => {
    console.log('[whatsapp] Client ready');
    void seedSelfIds(client).catch(() => undefined);
    if (process.env.LOG_GROUPS === '1') {
      console.log('[groups] LOG_GROUPS on — post a message in a chat to see its real id here');
    }
  });

  client.on('disconnected', (reason) => {
    console.error('[whatsapp] Disconnected:', reason);
    process.exit(1);
  });

  // Every emoji reaction in the bot's groups (the relay phone can't see these).
  client.on('message_reaction', (reaction) => {
    try {
      const remote = reaction.msgId?.remote as unknown;
      const chatId = typeof remote === 'string' ? remote : (remote as { _serialized?: string } | undefined)?._serialized;
      if (!chatId || !chatId.endsWith('@g.us')) return;
      const targetMsgId = serializeMsgId(reaction.msgId);
      if (!targetMsgId) return;
      recordReaction({
        targetMsgId,
        chatId: String(chatId),
        reactorId: reaction.senderId,
        reaction: reaction.reaction ?? '',
        ts: new Date((reaction.timestamp ?? Date.now() / 1000) * 1000).toISOString(),
      });
      if (process.env.LOG_REACTIONS === '1') {
        console.log(`[reactions] ${reaction.senderId} ${reaction.reaction || '(removed)'} → ${targetMsgId}`);
      }
    } catch (err) {
      console.error('[reactions] could not record reaction:', err);
    }
  });

  client.on('message_create', async (raw: Message) => {
    const chatId = raw.from;
    const timeMs = raw.timestamp * 1000;

    // Our own outgoing messages carry our id in `from` — the only reliable way
    // to learn the LID this account shows up as inside groups.
    if (raw.fromMe && raw.from) {
      if (!selfIds.has(raw.from)) console.log(`[self] learned own id ${raw.from}`);
      selfIds.add(raw.from);
    }

    // LOG_GROUPS=1: dump the message's whole raw payload plus the address
    // envelope. Plain fields only — no Store call (every Store method throws
    // `r: r` in this wwebjs version). Post in a chat to find its @g.us id.
    if (process.env.LOG_GROUPS === '1') {
      console.log(
        formatEnvelope({ from: raw.from, to: raw.to, author: raw.author, fromMe: raw.fromMe }),
      );
      try {
        // _data is the raw WhatsApp payload — every field in one place.
        console.log('[groups] raw._data:', JSON.stringify((raw as { _data?: unknown })._data));
      } catch (err) {
        console.log('[groups] could not stringify _data:', String(err));
      }
    }

    const priors = (chatBuffer.get(chatId) ?? []).slice(-3);

    pushToBuffer(chatId, {
      sender: raw.author ?? raw.from,
      timeMs,
      text: raw.body,
    });

    let chatName = chatId;
    try {
      const chat: Chat = await raw.getChat();
      chatName = chat.name || chatId;
    } catch { /* fallback to chatId */ }

    // Index group messages so emoji reactions can be credited to their author.
    // Best-effort: a storage error must never break message handling.
    if (chatId.endsWith('@g.us')) {
      try {
        const d = (raw as { _data?: { notifyName?: string } })._data ?? {};
        const msgId = serializeMsgId(raw.id) ?? serializeMsgId((raw as { _data?: { id?: unknown } })._data?.id);
        if (msgId) recordSeenMessage({
          msgId,
          chatId,
          chatName: chatName === chatId ? null : chatName,
          authorId: raw.author ?? null,
          authorName: d.notifyName ?? null,
          text: raw.body ?? '',
          ts: new Date(timeMs).toISOString(),
        });
      } catch (err) {
        console.error('[reactions] could not index message:', err);
      }
    }

    // Is this a quote-reply to something WE said? getQuotedMessage() is a Store
    // call and Store is broken in this build, so read the plain _data envelope.
    // `quotedParticipant` is the quoted message's author.
    let quotedFromBot = false;
    let quotedText: string | undefined;
    if (raw.hasQuotedMsg) {
      const d = (raw as { _data?: Record<string, unknown> })._data ?? {};
      // The quoted message's own text. "Reply privately" carries the card into
      // the DM this way, and it is the only handle on WHICH prompt is meant.
      const qm = d.quotedMsg as { caption?: string; body?: string } | undefined;
      quotedText = qm?.caption || qm?.body || undefined;
      const qp = d.quotedParticipant as { _serialized?: string } | string | undefined;
      const quotedAuthor = typeof qp === 'string' ? qp : qp?._serialized;
      // Permissive until we have learned at least one id, so the very first
      // reply after a restart is not silently dropped. The engine still only
      // acts when exactly one prompt is open in the chat.
      quotedFromBot = !quotedAuthor || selfIds.size === 0 || selfIds.has(quotedAuthor);
      console.log(
        `[reply] quotedAuthor=${quotedAuthor ?? '?'} known=[${[...selfIds].join(',')}] → fromBot=${quotedFromBot}`,
      );
    }

    const wrapped: WhatsAppMessage = {
      body: raw.body,
      quotedFromBot,
      quotedText,
      from: chatId,
      chatName,
      author: raw.author ?? raw.from,
      fromMe: raw.fromMe,
      mentionsBot: mentionsSelf(raw.mentionedIds as unknown[], raw.body ?? '', selfIds),
      capturedAt: new Date(timeMs).toISOString(),
      priorMessages: priors,
      notifyName: (raw as { _data?: { notifyName?: string } })._data?.notifyName || undefined,
      reply: (text) => raw.reply(text).then(() => undefined),
      getContact: () => raw.getContact(),
      react: (emoji) => raw.react(emoji).then(() => undefined),
    };

    try {
      await onMessage(wrapped);
    } catch (err) {
      console.error('[whatsapp] Unhandled error in message handler:', err);
    }
  });

  return client;
}

export function makeSendDm(client: ClientType): (phone: string, text: string) => Promise<void> {
  return async (phone, text) => { await client.sendMessage(phone, text); };
}

// Experiment (2026-07-23): send a native WhatsApp poll from the bot account.
// whatsapp-web.js 1.34 ships a Poll structure; sendMessage accepts it directly.
export function makeSendPoll(
  client: ClientType,
): (chatId: string, name: string, options: string[], allowMultiple?: boolean) => Promise<void> {
  return async (chatId, name, options, allowMultiple = false) => {
    // messageSecret is optional at runtime (Poll.js defaults it) but the shipped
    // .d.ts marks it required — cast to satisfy the type without inventing a secret.
    const pollOpts = { allowMultipleAnswers: allowMultiple } as unknown as ConstructorParameters<typeof Poll>[2];
    await client.sendMessage(chatId, new Poll(name, options, pollOpts));
  };
}

// Experiment (2026-07-27): send an image from a file already inside the container.
// Pairs with makeSendPoll — a numbered album-art grid posted just before a poll,
// so the poll's text options can reference tiles by number.
export function makeSendMedia(
  client: ClientType,
): (chatId: string, filePath: string, caption?: string, pinSeconds?: number) => Promise<void> {
  return async (chatId, filePath, caption, pinSeconds) => {
    const media = MessageMedia.fromFilePath(filePath);
    const sent = await client.sendMessage(chatId, media, caption ? { caption } : undefined);
    await tryPin(sent, pinSeconds);
  };
}

/**
 * Best-effort pin. sendMessage only returns a Message when a page-side
 * `Chat.find` succeeds (Client.js:154/173), and every Store method is broken in
 * this whatsapp-web.js build — the same `r: r` failure listGroups.ts documents.
 * So `sent` is routinely undefined and pinning is simply unavailable here.
 * Never let that lose the message that was already delivered.
 */
async function tryPin(sent: unknown, pinSeconds?: number): Promise<void> {
  if (!pinSeconds) return;
  const msg = sent as { pin?: (d: number) => Promise<boolean> } | undefined;
  if (typeof msg?.pin !== 'function') {
    console.warn('[whatsapp] pin unavailable (sendMessage returned no Message) — sent unpinned');
    return;
  }
  try {
    await msg.pin(pinSeconds);
  } catch (err) {
    console.warn('[whatsapp] pin failed, message still sent:', err instanceof Error ? err.message : String(err));
  }
}

// Plain text to an arbitrary chat, optionally pinned. makeSendDm exists but is
// fire-and-forget; this returns through pin(), which needs the sent Message.
/**
 * DM a phone number (`<digits>@c.us`). Sending straight to the @c.us id hangs
 * until Puppeteer's protocol timeout for LID-migrated contacts, so ask WhatsApp
 * for the contact's LID first and send there; fall back to the @c.us id.
 */
export function makeSendToNumber(
  client: ClientType,
  log: (line: string) => void = console.log,
): (chatId: string, text: string) => Promise<void> {
  return async (chatId, text) => {
    const t0 = Date.now();
    let target = chatId;
    try {
      const [ids] = await client.getContactLidAndPhone([chatId]);
      if (ids?.lid) target = ids.lid;
    } catch (err) {
      log(`[dm-number] lid lookup failed (${err instanceof Error ? err.message : String(err)}); using ${chatId.slice(-9)}`);
    }
    log(`[dm-number] resolved ${target.endsWith('@lid') ? 'lid' : 'c.us'} in ${Date.now() - t0}ms`);
    await client.sendMessage(target, text);
    log(`[dm-number] sent in ${Date.now() - t0}ms`);
  };
}

export function makeSay(
  client: ClientType,
): (chatId: string, text: string, pinSeconds?: number) => Promise<void> {
  return async (chatId, text, pinSeconds) => {
    const sent = await client.sendMessage(chatId, text);
    await tryPin(sent, pinSeconds);
  };
}

/**
 * Screenshot a standalone HTML document to a PNG at 1080 px wide, full page.
 * Uses the whatsapp-web.js client's own Chromium (no new dependency) on a NEW
 * page that is always closed; the WhatsApp page itself is never touched.
 */
export function makeScreenshotHtml(
  client: ClientType,
): (html: string, outPath: string) => Promise<void> {
  return async (html, outPath) => {
    const browser = client.pupBrowser;
    if (!browser) throw new Error('browser not ready');
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1080, height: 800, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
      await page.screenshot({ path: outPath as `${string}.png`, fullPage: true, type: 'png' });
    } finally {
      await page.close().catch(() => undefined);
    }
  };
}

/**
 * A DM target WhatsApp will deliver to. A group author is usually already a
 * LID; an @c.us id is swapped for its LID when WhatsApp knows one, because
 * sending straight to @c.us hangs for LID-migrated contacts (see
 * makeSendToNumber). Same person either way.
 */
async function dmTarget(client: ClientType, chatId: string): Promise<string> {
  if (!chatId.endsWith('@c.us')) return chatId;
  try {
    const [ids] = await client.getContactLidAndPhone([chatId]);
    return ids?.lid || chatId;
  } catch {
    return chatId;
  }
}

/** dmTarget bound to a client: the id a DM to `chatId` is actually sent to. */
export function makeDmTarget(client: ClientType): (chatId: string) => Promise<string> {
  return (chatId) => dmTarget(client, chatId);
}

/** DM an image file to one chat id (the requester). */
export function makeSendImageTo(client: ClientType): (chatId: string, filePath: string) => Promise<void> {
  return async (chatId, filePath) => {
    await client.sendMessage(await dmTarget(client, chatId), MessageMedia.fromFilePath(filePath));
  };
}

/** DM plain text to one chat id (the requester). */
export function makeSendTextTo(client: ClientType): (chatId: string, text: string) => Promise<void> {
  return async (chatId, text) => {
    await client.sendMessage(await dmTarget(client, chatId), text);
  };
}
