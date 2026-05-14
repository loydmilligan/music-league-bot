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

function addGroupToEnv(groupId: string): void {
  if (!existsSync(envPath)) {
    console.error('[add-group] .env file not found at', envPath);
    process.exit(1);
  }

  const content = readFileSync(envPath, 'utf8');
  const match = content.match(/^WHATSAPP_ALLOWED_GROUP_IDS=(.*)$/m);

  if (match) {
    const existing = match[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (existing.includes(groupId)) {
      console.log(`[add-group] Group ${groupId} is already in the list — nothing to do.`);
      process.exit(0);
    }
    const updated = content.replace(
      /^WHATSAPP_ALLOWED_GROUP_IDS=.*/m,
      `WHATSAPP_ALLOWED_GROUP_IDS=${[...existing, groupId].join(',')}`,
    );
    writeFileSync(envPath, updated, 'utf8');
  } else {
    writeFileSync(envPath, content + `\nWHATSAPP_ALLOWED_GROUP_IDS=${groupId}\n`, 'utf8');
  }
}

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ['--no-sandbox'] },
});

client.on('qr', (qr) => {
  console.log('[add-group] Scan this QR code to authenticate:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('[add-group] Connected. Send any message in the group you want to ADD to the bot.');
});

client.on('message_create', (msg) => {
  if (!msg.from.endsWith('@g.us')) return;
  if (msg.fromMe) return;

  const groupId = msg.from;

  console.log(`\n[add-group] Detected group message from: ${groupId}`);
  console.log(`[add-group] Adding ${groupId} to WHATSAPP_ALLOWED_GROUP_IDS in .env`);

  addGroupToEnv(groupId);

  console.log('[add-group] Done. Restart the bot with: npm run dev');
  process.exit(0);
});

client.on('disconnected', (reason) => {
  console.error('[add-group] Disconnected:', reason);
  process.exit(1);
});

client.initialize();
