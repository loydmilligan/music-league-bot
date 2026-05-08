import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config/loader.js';
import { SpotifyAdapter } from './spotify/adapter.js';
import { openDb } from './storage/db.js';
import { createClient, makeSendDm } from './whatsapp/client.js';
import { handleMessage } from './bot/handler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, '../config/rules.json');

const config = loadConfig(configPath);
const spotify = new SpotifyAdapter();
const db = openDb(path.join(__dirname, '../data/submissions.db'));

const allowedGroupIds = (process.env.WHATSAPP_ALLOWED_GROUP_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const ownerPhone = process.env.OWNER_PHONE_NUMBER ?? '';

if (!ownerPhone) {
  console.warn('[bot] OWNER_PHONE_NUMBER not set — DM notifications will fail');
}

const client = createClient(async (msg) => {
  await handleMessage(msg, {
    config,
    spotify,
    db,
    allowedGroupIds,
    ownerPhone,
    sendDm: makeSendDm(client),
  });
});

console.log('[bot] Starting WhatsApp client...');
client.initialize();
