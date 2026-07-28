import { createRequire } from 'node:module';
import type { Client as ClientType, Message, Chat } from 'whatsapp-web.js';
import type { WhatsAppMessage } from '../bot/handler.js';
import { formatEnvelope } from './listGroups.js';

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
  const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { executablePath: process.env.CHROMIUM_PATH || undefined, args: puppeteerArgs },
  });

  client.on('qr', (qr) => {
    console.log('[whatsapp] Scan this QR code to authenticate:');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => {
    console.log('[whatsapp] Client ready');
    if (process.env.LOG_GROUPS === '1') {
      console.log('[groups] LOG_GROUPS on — post a message in a chat to see its real id here');
    }
  });

  client.on('disconnected', (reason) => {
    console.error('[whatsapp] Disconnected:', reason);
    process.exit(1);
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
      capturedAt: new Date(timeMs).toISOString(),
      priorMessages: priors,
      reply: (text) => raw.reply(text).then(() => undefined),
      getContact: () => raw.getContact(),
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
export function makeSay(
  client: ClientType,
): (chatId: string, text: string, pinSeconds?: number) => Promise<void> {
  return async (chatId, text, pinSeconds) => {
    const sent = await client.sendMessage(chatId, text);
    await tryPin(sent, pinSeconds);
  };
}
