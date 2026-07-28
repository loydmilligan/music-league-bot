import { createRequire } from 'node:module';
import type { Client as ClientType, Message, Chat } from 'whatsapp-web.js';
import type { WhatsAppMessage } from '../bot/handler.js';
import { formatEnvelope } from './listGroups.js';

const _require = createRequire(import.meta.url);
const { Client, LocalAuth, Poll, MessageMedia } = _require('whatsapp-web.js') as typeof import('whatsapp-web.js');
const qrcode = _require('qrcode-terminal') as { generate(qr: string, opts?: { small?: boolean }): void };

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

    const wrapped: WhatsAppMessage = {
      body: raw.body,
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
): (chatId: string, filePath: string, caption?: string) => Promise<void> {
  return async (chatId, filePath, caption) => {
    const media = MessageMedia.fromFilePath(filePath);
    await client.sendMessage(chatId, media, caption ? { caption } : undefined);
  };
}
