import 'dotenv/config';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '../.env');

const _require = createRequire(import.meta.url);
const { Client, LocalAuth } = _require('whatsapp-web.js') as typeof import('whatsapp-web.js');
const qrcode = _require('qrcode-terminal') as { generate(qr: string, opts?: { small?: boolean }): void };

function updateEnv(groupId: string): void {
  if (!existsSync(envPath)) {
    console.error('[set-group] .env file not found at', envPath);
    process.exit(1);
  }

  const content = readFileSync(envPath, 'utf8');
  const updated = content.replace(
    /^WHATSAPP_ALLOWED_GROUP_IDS=.*/m,
    `WHATSAPP_ALLOWED_GROUP_IDS=${groupId}`,
  );

  if (updated === content && !content.includes('WHATSAPP_ALLOWED_GROUP_IDS=')) {
    writeFileSync(envPath, content + `\nWHATSAPP_ALLOWED_GROUP_IDS=${groupId}\n`, 'utf8');
  } else {
    writeFileSync(envPath, updated, 'utf8');
  }
}

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ['--no-sandbox'] },
});

client.on('qr', (qr) => {
  console.log('[set-group] Scan this QR code to authenticate:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('[set-group] Connected. Send any message in the group you want the bot to monitor.');
});

client.on('message_create', (msg) => {
  if (!msg.from.endsWith('@g.us')) return;
  if (msg.fromMe) return;

  const groupId = msg.from;

  console.log(`\n[set-group] Detected group message from: ${groupId}`);
  console.log(`[set-group] Writing WHATSAPP_ALLOWED_GROUP_IDS=${groupId} to .env`);

  updateEnv(groupId);

  console.log('[set-group] Done. Restart the bot with: npm run dev');
  process.exit(0);
});

client.on('disconnected', (reason) => {
  console.error('[set-group] Disconnected:', reason);
  process.exit(1);
});

client.initialize();
