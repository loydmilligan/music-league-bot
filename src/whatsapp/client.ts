import { Client, LocalAuth, type Message } from 'whatsapp-web.js';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const qrcode = require('qrcode-terminal') as { generate(qr: string, opts?: { small?: boolean }): void };
import type { WhatsAppMessage } from '../bot/handler.js';

export function createClient(onMessage: (msg: WhatsAppMessage) => Promise<void>): Client {
  const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox'] },
  });

  client.on('qr', (qr) => {
    console.log('[whatsapp] Scan this QR code to authenticate:');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => {
    console.log('[whatsapp] Client ready');
  });

  client.on('disconnected', (reason) => {
    console.error('[whatsapp] Disconnected:', reason);
    process.exit(1);
  });

  client.on('message', async (raw: Message) => {
    const wrapped: WhatsAppMessage = {
      body: raw.body,
      from: raw.from,
      author: raw.author ?? raw.from,
      fromMe: raw.fromMe,
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

export function makeSendDm(client: Client): (phone: string, text: string) => Promise<void> {
  return async (phone, text) => {
    await client.sendMessage(phone, text);
  };
}
