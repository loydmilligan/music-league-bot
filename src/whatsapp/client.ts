import { createRequire } from 'node:module';
import type { Client as ClientType, Message, Chat } from 'whatsapp-web.js';
import type { WhatsAppMessage } from '../bot/handler.js';

const _require = createRequire(import.meta.url);
const { Client, LocalAuth } = _require('whatsapp-web.js') as typeof import('whatsapp-web.js');
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

  client.on('ready', () => console.log('[whatsapp] Client ready'));

  client.on('disconnected', (reason) => {
    console.error('[whatsapp] Disconnected:', reason);
    process.exit(1);
  });

  client.on('message_create', async (raw: Message) => {
    const chatId = raw.from;
    const timeMs = raw.timestamp * 1000;

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
