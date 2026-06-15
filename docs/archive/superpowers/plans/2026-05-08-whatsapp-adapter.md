# WhatsApp Adapter Implementation Plan

**Date:** 2026-05-08
**Spec:** `docs/superpowers/specs/2026-05-08-whatsapp-adapter-design.md`
**Status:** Ready to execute

---

## Context

Milestone 1 is complete: `parseMessage`, `resolveTrack`, `applyRules`, and `SpotifyAdapter` all exist and are tested. This plan wires them into a working bot. Five tasks, executed in order (each subsequent task may depend on artifacts from prior ones).

Project uses ESM (`"type": "module"`), TypeScript, Vitest for tests, `tsx` for dev. All imports must use `.js` extensions.

---

## Task 1 — Install deps + config extension

**Goal:** Install npm packages, extend `notificationsSchema` with `successReply`, update env files.

### Steps

1. Run:
   ```bash
   npm install whatsapp-web.js qrcode-terminal better-sqlite3
   npm install --save-dev @types/better-sqlite3
   ```

2. Edit `src/config/types.ts` — add `successReply` to `notificationsSchema`:

   ```typescript
   export const notificationsSchema = z.object({
     onFailure: z.boolean().default(true),
     onLowConfidence: z.boolean().default(true),
     confidenceThreshold: z.number().min(0).max(1).default(0.9),
     recipients: z.enum(['me', 'submitter', 'me-and-submitter']).default('me'),
     successReply: z.enum(['simple', 'rich', 'none']).default('simple'),
   });
   ```

   Update the `Notifications` type (it's auto-derived via `z.infer` so no explicit change needed there — just ensure the schema change is correct).

3. Add to `.env` (create if not present):
   ```
   WHATSAPP_ALLOWED_GROUP_IDS=BmCQHGE3k0a0ST5ZDPFmqW
   OWNER_PHONE_NUMBER=16617476822
   ```

4. Add to `.env.example` (create if not present):
   ```
   WHATSAPP_ALLOWED_GROUP_IDS=your-group-id-here
   OWNER_PHONE_NUMBER=1XXXXXXXXXX
   ```

5. Add to `.gitignore` (append if not already present):
   ```
   .wwebjs_auth/
   .env
   ```

6. Run existing tests to confirm nothing broke:
   ```bash
   npm test -- --run
   ```

7. Commit: `feat: install whatsapp/sqlite deps, extend notificationsSchema with successReply`

### Acceptance

- `npm install` completes without errors
- `notificationsSchema` has `successReply` field with correct type
- All existing tests pass
- `.env.example` has the two new vars

---

## Task 2 — SQLite storage layer

**Goal:** Implement `src/storage/db.ts` and `src/storage/submissions.ts` with unit tests.

### `src/storage/db.ts`

```typescript
import Database from 'better-sqlite3';

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS submissions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      submitter_id  TEXT    NOT NULL,
      submitter_name TEXT   NOT NULL,
      raw_text      TEXT    NOT NULL,
      track_title   TEXT,
      track_artist  TEXT,
      spotify_uri   TEXT,
      playlist_id   TEXT,
      playlist_name TEXT,
      status        TEXT    NOT NULL,
      created_at    INTEGER NOT NULL
    )
  `);
  return db;
}
```

### `src/storage/submissions.ts`

```typescript
import type Database from 'better-sqlite3';
import type { ResolvedTrack } from '../music/types.js';

export type SubmissionStatus = 'added' | 'duplicate' | 'not-found' | 'low-confidence' | 'no-rule';

export interface SubmissionRecord {
  submitterId: string;
  submitterName: string;
  rawText: string;
  track?: ResolvedTrack | null;
  playlistId?: string | null;
  playlistName?: string | null;
  status: SubmissionStatus;
}

export function insertSubmission(db: Database.Database, record: SubmissionRecord): void {
  db.prepare(`
    INSERT INTO submissions
      (submitter_id, submitter_name, raw_text, track_title, track_artist,
       spotify_uri, playlist_id, playlist_name, status, created_at)
    VALUES
      (@submitterId, @submitterName, @rawText, @trackTitle, @trackArtist,
       @spotifyUri, @playlistId, @playlistName, @status, @createdAt)
  `).run({
    submitterId: record.submitterId,
    submitterName: record.submitterName,
    rawText: record.rawText,
    trackTitle: record.track?.title ?? null,
    trackArtist: record.track?.artist ?? null,
    spotifyUri: record.track?.spotifyUri ?? null,
    playlistId: record.playlistId ?? null,
    playlistName: record.playlistName ?? null,
    status: record.status,
    createdAt: Date.now(),
  });
}
```

### Tests — `tests/storage.test.ts`

Test using an in-memory DB (`:memory:`):

- `openDb(':memory:')` creates the table without error
- `insertSubmission` with status `'added'` inserts a row with all fields
- `insertSubmission` with status `'not-found'` inserts with null track fields
- `insertSubmission` with status `'duplicate'` inserts correctly
- `created_at` is a positive integer

### Steps

1. Create `src/storage/db.ts` per spec above
2. Create `src/storage/submissions.ts` per spec above
3. Create `tests/storage.test.ts` with the above tests
4. Run `npm test -- --run` — all tests must pass
5. Commit: `feat: add SQLite storage layer (db init + submissions insert)`

### Acceptance

- Files created, all tests pass
- No `any` types
- No async code (better-sqlite3 is sync)

---

## Task 3 — Bot handler

**Goal:** Implement `src/bot/handler.ts` — the full pipeline — with unit tests using mocks.

### `src/bot/handler.ts`

The handler receives a WhatsApp message object and runs the full pipeline. It needs:
- `parseMessage` from `../parser/parseMessage.js`
- `resolveTrack` from `../resolver/resolveTrack.js`
- `applyRules` from `../rules/engine.js`
- `getISOWeekNumber` from `../rules/templates.js`
- `ISpotifyAdapter` from `../music/types.js`
- `insertSubmission` from `../storage/submissions.js`
- `Database` from `better-sqlite3`
- `RulesConfig` from `../config/types.js`
- `Notifications` from `../config/types.js`

```typescript
import type Database from 'better-sqlite3';
import type { ISpotifyAdapter } from '../music/types.js';
import type { RulesConfig, Notifications } from '../config/types.js';
import { parseMessage } from '../parser/parseMessage.js';
import { resolveTrack } from '../resolver/resolveTrack.js';
import { applyRules } from '../rules/engine.js';
import { getISOWeekNumber } from '../rules/templates.js';
import { insertSubmission } from '../storage/submissions.js';

export interface WhatsAppMessage {
  body: string;
  from: string;           // group chat id, e.g. "XXXX@g.us"
  author: string;         // sender id, e.g. "16171234567@c.us"
  fromMe: boolean;
  reply(text: string): Promise<void>;
  getContact(): Promise<{ pushname: string }>;
}

export interface BotConfig {
  config: RulesConfig;
  spotify: ISpotifyAdapter;
  db: Database.Database;
  allowedGroupIds: string[];
  ownerPhone: string;
  sendDm(phone: string, text: string): Promise<void>;
}

export async function handleMessage(msg: WhatsAppMessage, botConfig: BotConfig): Promise<void> {
  const { config, spotify, db, allowedGroupIds, ownerPhone, sendDm } = botConfig;

  // Ignore messages not from allowed groups or sent by the bot itself
  if (!allowedGroupIds.some((id) => msg.from.includes(id))) return;
  if (msg.fromMe) return;

  const parsed = parseMessage(msg.body);
  if (!parsed) return;

  const contact = await msg.getContact();
  const submitterName = contact.pushname || msg.author;
  const notifications: Notifications = config.notifications ?? {
    onFailure: true,
    onLowConfidence: true,
    confidenceThreshold: 0.9,
    recipients: 'me',
    successReply: 'simple',
  };

  let track = null;
  try {
    const resolution = await resolveTrack(
      parsed,
      spotify,
      notifications.confidenceThreshold,
    );

    if (resolution.status === 'not-found') {
      if (notifications.onFailure) {
        const failMsg = `❌ Couldn't find a track for: ${parsed.rawText.replace(/^!song\s*/i, '')}`;
        await notifyRecipients(failMsg, msg, ownerPhone, notifications.recipients, sendDm);
      }
      insertSubmission(db, {
        submitterId: msg.author,
        submitterName,
        rawText: msg.body,
        track: null,
        status: 'not-found',
      });
      return;
    }

    track = resolution.track!;

    if (resolution.status === 'low-confidence' && notifications.onLowConfidence) {
      const lowMsg = `⚠️ Added "${track.title}" by ${track.artist} — but I wasn't sure this was the right track. Check it looks right.`;
      await notifyRecipients(lowMsg, msg, ownerPhone, notifications.recipients, sendDm);
    }
  } catch (err) {
    console.error('[handler] Spotify error during resolve:', err);
    await msg.reply('❌ Something went wrong — try again');
    return;
  }

  const weekNumber = getISOWeekNumber(new Date());
  const year = new Date().getFullYear();
  const matches = applyRules(config, {
    command: parsed.command,
    tags: parsed.tags,
    submittedBy: msg.author,
    groupId: msg.from,
  }, { weekNumber, year });

  if (matches.length === 0) {
    insertSubmission(db, {
      submitterId: msg.author,
      submitterName,
      rawText: msg.body,
      track,
      status: 'no-rule',
    });
    return;
  }

  for (const match of matches) {
    if (!match.spotify) continue;

    try {
      const playlistId = await spotify.findOrCreatePlaylist(match.spotify);
      const isDupe = await spotify.isTrackInPlaylist(playlistId, track.spotifyUri);

      if (isDupe) {
        await msg.reply(`⚠️ "${track.title}" by ${track.artist} is already in ${match.spotify} — not added`);
        insertSubmission(db, {
          submitterId: msg.author,
          submitterName,
          rawText: msg.body,
          track,
          playlistId,
          playlistName: match.spotify,
          status: 'duplicate',
        });
      } else {
        await spotify.addTrackToPlaylist(playlistId, track.spotifyUri);
        const successReply = notifications.successReply ?? 'simple';
        if (successReply === 'simple') {
          await msg.reply(`✅ Added "${track.title}" by ${track.artist} to ${match.spotify}`);
        } else if (successReply === 'rich') {
          const dur = msToMinSec(track.durationMs);
          await msg.reply(`✅ Added "${track.title}" by ${track.artist} · ${track.album} · ${dur} → ${match.spotify}\n${track.sourceUrl}`);
        }
        insertSubmission(db, {
          submitterId: msg.author,
          submitterName,
          rawText: msg.body,
          track,
          playlistId,
          playlistName: match.spotify,
          status: 'added',
        });
      }
    } catch (err) {
      console.error('[handler] Spotify error during add:', err);
      await msg.reply('❌ Something went wrong — try again');
    }
  }
}

async function notifyRecipients(
  text: string,
  msg: WhatsAppMessage,
  ownerPhone: string,
  recipients: Notifications['recipients'],
  sendDm: (phone: string, text: string) => Promise<void>,
): Promise<void> {
  if (recipients === 'me' || recipients === 'me-and-submitter') {
    await sendDm(ownerPhone, text);
  }
  if (recipients === 'submitter' || recipients === 'me-and-submitter') {
    await sendDm(msg.author, text);
  }
}

function msToMinSec(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}
```

### Tests — `tests/handler.test.ts`

Use Vitest `vi.fn()` mocks. Create a factory `makeMockMsg(body, opts?)` that returns a `WhatsAppMessage` mock. Create a factory `makeBotConfig(overrides?)` that returns a `BotConfig` with a real in-memory DB, mock spotify, and mock sendDm.

Test cases:
1. Ignores message from non-allowed group (no Spotify calls)
2. Ignores `fromMe: true` messages
3. Ignores messages that don't parse (not a `!song` command)
4. Not-found: calls `sendDm` when `onFailure: true`, inserts row with status `'not-found'`, does NOT call `addTrackToPlaylist`
5. Not-found: does NOT call `sendDm` when `onFailure: false`
6. Low-confidence: calls `sendDm` when `onLowConfidence: true`, still adds track
7. No matching rule: inserts row with status `'no-rule'`, no reply sent
8. Duplicate: replies with ⚠️ message, inserts row with status `'duplicate'`
9. Success (simple): calls `addTrackToPlaylist`, replies with ✅ simple message, inserts status `'added'`
10. Success (rich): replies with rich message including album + duration + URL
11. Success (none): adds track, no reply sent
12. Spotify error during resolve: replies with ❌ generic error, does not crash
13. Spotify error during add: replies with ❌ generic error, does not crash

### Steps

1. Create `src/bot/handler.ts`
2. Create `tests/handler.test.ts` with all 13 tests
3. Run `npm test -- --run` — all tests pass
4. Commit: `feat: add bot handler with full pipeline and tests`

### Acceptance

- All 13 tests pass
- Handler exports `handleMessage` and `WhatsAppMessage` and `BotConfig`
- No `any` types except mocks where unavoidable

---

## Task 4 — WhatsApp client

**Goal:** Implement `src/whatsapp/client.ts` — the whatsapp-web.js wrapper.

### `src/whatsapp/client.ts`

```typescript
import { Client, LocalAuth, type Message } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
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
      reply: (text) => raw.reply(text),
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
```

No unit tests — verified manually by running the bot and scanning QR.

### Steps

1. Create `src/whatsapp/client.ts`
2. Verify TypeScript compiles: `npx tsc --noEmit`
3. Commit: `feat: add WhatsApp client wrapper with QR auth`

### Acceptance

- File created, `npx tsc --noEmit` passes
- Exports `createClient` and `makeSendDm`

---

## Task 5 — Wire index.ts

**Goal:** Replace the demo scaffolding in `src/index.ts` with real bot startup.

### `src/index.ts`

```typescript
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
```

Also create `data/` directory (where the SQLite DB will live) and add it to `.gitignore` except for a `.gitkeep`:
- `mkdir -p data && touch data/.gitkeep`
- Add `data/*.db` to `.gitignore`

### Steps

1. Run `mkdir -p /path/to/project/data && touch data/.gitkeep`
2. Add `data/*.db` to `.gitignore`
3. Replace `src/index.ts` with the code above
4. Verify TypeScript: `npx tsc --noEmit`
5. Run existing tests: `npm test -- --run`
6. Commit: `feat: wire index.ts — real bot startup with WhatsApp + Spotify + SQLite`

### Acceptance

- `npx tsc --noEmit` passes
- All existing tests still pass
- `src/index.ts` no longer contains demo loop
- `data/.gitkeep` exists, `data/*.db` is gitignored
