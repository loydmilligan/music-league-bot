# Chat Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/chat` route that displays songs auto-captured from WhatsApp group chats, with per-mention context (message + 3 prior messages), intent classification, smart round auto-assignment, and manual assign/shortlist/dismiss actions.

**Architecture:** Two new surfaces: (1) bot-side ingestion — the WhatsApp client buffers recent messages per chat and writes `chat_songs`/`chat_mentions`/`chat_assignments` rows to `league.db` on each URL capture; (2) UI — a SvelteKit page with filter bar, collapsed/expanded rows, and a pull-quote context block. Auto-assignment runs at ingestion time using round phase detection. Shared atoms (`AssignPopover`, `Bookmark`, `ActionButton`) are upgraded and reused from the shortlist screen.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, better-sqlite3, whatsapp-web.js, Tailwind v4 (layout wrapper only), Mash Co. CSS token system (`.cw-*` prefix for new classes), Vitest

**Visual reference:** `docs/chatmention-proto/Mash Co. Design System (1)/chat-watcher-handoff/reference/Music League Bot - Chat Watcher.html` — open in a browser before starting any component work.

---

## File Structure

### New files
| Path | Responsibility |
|------|---------------|
| `ui/src/lib/chat/chat.ts` | All DB functions for `chat_songs`, `chat_mentions`, `chat_assignments` |
| `ui/src/lib/chat/chat.test.ts` | Vitest integration tests for the chat DB module |
| `ui/src/lib/chat/chat.css` | `.cw-*` component styles — copied from handoff reference |
| `ui/src/lib/chat/CwFilterBar.svelte` | Filter pill bar (status + chat + sort) with URL-param persistence |
| `ui/src/lib/chat/CwRow.svelte` | Collapsed + expanded row with ContextStack / PullQuote |
| `ui/src/routes/chat/+page.svelte` | Page shell, row list, keyboard shortcuts |
| `ui/src/routes/chat/+page.server.ts` | Server loader — initial song list |
| `ui/src/routes/api/chat/songs/+server.ts` | `GET /api/chat/songs` (filtered list) |
| `ui/src/routes/api/chat/songs/[id]/dismiss/+server.ts` | `POST/DELETE /api/chat/songs/:id/dismiss` |
| `ui/src/routes/api/chat/songs/[id]/shortlist/+server.ts` | `POST/DELETE /api/chat/songs/:id/shortlist` |
| `ui/src/routes/api/chat/songs/[id]/assign/+server.ts` | `POST /api/chat/songs/:id/assign` |
| `ui/src/routes/api/chat/songs/[id]/assign/[roundId]/+server.ts` | `DELETE /api/chat/songs/:id/assign/:roundId` |
| `src/bot/intentClassifier.ts` | Heuristic intent tagger — returns `alt\|retro\|found\|maybe\|unclassified` |
| `src/storage/chatDb.ts` | Opens `league.db`, provides `insertChatCapture()` for bot-side writes |

### Modified files
| Path | Change |
|------|--------|
| `ui/src/lib/db/schema.ts` | Add `chat_songs`, `chat_mentions`, `chat_assignments` table DDL |
| `ui/src/lib/shortlist/shortlist.css` | Replace with proto updated version — adds `.sl-actionbtn`, `.sl-popover--wide`, `.sl-popover-filter`, `.sl-popover-search`, `.sl-popover-pills` |
| `ui/src/app.css` | Add `@import '$lib/chat/chat.css'` |
| `ui/src/lib/shortlist/AssignPopover.svelte` | Add search input + league pills; replace hardcoded API paths with `onAssign`/`onUnassign` callback props |
| `ui/src/lib/shortlist/ShortlistRow.svelte` | Pass `onAssign`/`onUnassign` callbacks to updated `AssignPopover` |
| `ui/src/routes/+layout.svelte` | Add "Chat watcher" nav entry with unassigned count badge |
| `src/whatsapp/client.ts` | Add per-chat message buffer; include `priorMessages` in `WhatsAppMessage` |
| `src/bot/handler.ts` | Call `insertChatCapture()` in `handleAutoCapture` |

---

## Task 1: DB Schema — chat tables

**Files:**
- Modify: `ui/src/lib/db/schema.ts`

- [ ] **Step 1: Add the three new CREATE TABLE statements to SCHEMA**

Open `ui/src/lib/db/schema.ts`. Find the line containing `shortlist_assignments` index and append the following immediately after it (before the closing backtick of `SCHEMA`):

```ts
  CREATE TABLE IF NOT EXISTS chat_songs (
    id              TEXT PRIMARY KEY,
    spotify_uri     TEXT NOT NULL UNIQUE,
    artist          TEXT NOT NULL,
    title           TEXT NOT NULL,
    album           TEXT,
    year            INTEGER,
    duration_sec    INTEGER,
    album_art_url   TEXT,
    dismissed       INTEGER NOT NULL DEFAULT 0,
    first_seen_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  CREATE TABLE IF NOT EXISTS chat_mentions (
    id              TEXT PRIMARY KEY,
    song_id         TEXT NOT NULL REFERENCES chat_songs(id) ON DELETE CASCADE,
    chat_name       TEXT NOT NULL,
    sender_name     TEXT NOT NULL,
    captured_at     TEXT NOT NULL,
    raw_message     TEXT NOT NULL,
    prior_messages  TEXT NOT NULL DEFAULT '[]',
    intent          TEXT NOT NULL DEFAULT 'unclassified'
  );
  CREATE TABLE IF NOT EXISTS chat_assignments (
    chat_song_id    TEXT NOT NULL REFERENCES chat_songs(id) ON DELETE CASCADE,
    round_id        INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    assigned_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    PRIMARY KEY (chat_song_id, round_id)
  );
  CREATE INDEX IF NOT EXISTS idx_chat_mentions_song ON chat_mentions(song_id);
  CREATE INDEX IF NOT EXISTS idx_chat_assignments_round ON chat_assignments(round_id);
```

- [ ] **Step 2: Run existing DB tests to verify schema is still valid**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx vitest run src/lib/db/client.test.ts
```
Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/db/schema.ts
git commit -m "feat(chat): add chat_songs + chat_mentions + chat_assignments schema"
```

---

## Task 2: DB Module — chat.ts

**Files:**
- Create: `ui/src/lib/chat/chat.ts`

- [ ] **Step 1: Create the chat DB module**

Create `ui/src/lib/chat/chat.ts`:

```ts
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface ChatSong {
  id: string;
  spotifyUri: string;
  artist: string;
  title: string;
  album: string | null;
  year: number | null;
  durationSec: number | null;
  albumArtUrl: string | null;
  dismissed: boolean;
  firstSeenAt: string;
  mentionCount: number;
  latestMentionAt: string;
  chatNames: string[];
  assignedRoundIds: number[];
  onShortlist: boolean;
  mentions?: ChatMention[];
}

export interface ChatMention {
  id: string;
  songId: string;
  chatName: string;
  senderName: string;
  capturedAt: string;
  rawMessage: string;
  priorMessages: PriorMessage[];
  intent: Intent;
}

export type Intent = 'alt' | 'retro' | 'found' | 'maybe' | 'unclassified';

export interface PriorMessage {
  sender: string;
  timeMs: number;
  text: string;
}

function songRow(r: any, mentions: ChatMention[], assignedRoundIds: number[], onShortlist: boolean): ChatSong {
  return {
    id: r.id,
    spotifyUri: r.spotify_uri,
    artist: r.artist,
    title: r.title,
    album: r.album,
    year: r.year,
    durationSec: r.duration_sec,
    albumArtUrl: r.album_art_url,
    dismissed: !!r.dismissed,
    firstSeenAt: r.first_seen_at,
    mentionCount: mentions.length,
    latestMentionAt: mentions.length > 0 ? mentions[mentions.length - 1].capturedAt : r.first_seen_at,
    chatNames: [...new Set(mentions.map(m => m.chatName))],
    assignedRoundIds,
    onShortlist,
  };
}

function mentionRow(r: any): ChatMention {
  return {
    id: r.id,
    songId: r.song_id,
    chatName: r.chat_name,
    senderName: r.sender_name,
    capturedAt: r.captured_at,
    rawMessage: r.raw_message,
    priorMessages: JSON.parse(r.prior_messages ?? '[]'),
    intent: r.intent as Intent,
  };
}

export interface ChatSongsFilter {
  status?: 'unassigned' | 'assigned';
  chatName?: string;
  sort?: 'recent' | 'mentioned';
  includeDismissed?: boolean;
}

export function getChatSongs(db: Database.Database, filter: ChatSongsFilter = {}): ChatSong[] {
  let where = filter.includeDismissed ? '' : 'WHERE cs.dismissed = 0';
  if (filter.status === 'unassigned') {
    where += (where ? ' AND' : 'WHERE') + ' NOT EXISTS (SELECT 1 FROM chat_assignments ca WHERE ca.chat_song_id = cs.id)';
  } else if (filter.status === 'assigned') {
    where += (where ? ' AND' : 'WHERE') + ' EXISTS (SELECT 1 FROM chat_assignments ca WHERE ca.chat_song_id = cs.id)';
  }

  const order = filter.sort === 'mentioned'
    ? 'ORDER BY mention_count DESC, latest_at DESC'
    : 'ORDER BY latest_at DESC';

  const rows = db.prepare(`
    SELECT cs.*,
      COUNT(cm.id) AS mention_count,
      MAX(cm.captured_at) AS latest_at
    FROM chat_songs cs
    LEFT JOIN chat_mentions cm ON cm.song_id = cs.id
    ${where}
    GROUP BY cs.id
    ${order}
  `).all() as any[];

  if (rows.length === 0) return [];

  const allMentions = (db.prepare('SELECT * FROM chat_mentions ORDER BY captured_at ASC').all() as any[]).map(mentionRow);
  const allAssignments = db.prepare('SELECT * FROM chat_assignments').all() as any[];
  const shortlistUris = new Set(
    (db.prepare('SELECT spotify_uri FROM shortlist_songs').all() as any[]).map((r: any) => r.spotify_uri)
  );

  const mentionsBySong: Record<string, ChatMention[]> = {};
  for (const m of allMentions) {
    (mentionsBySong[m.songId] ??= []).push(m);
  }
  const assignmentsBySong: Record<string, number[]> = {};
  for (const a of allAssignments) {
    (assignmentsBySong[a.chat_song_id] ??= []).push(a.round_id);
  }

  // Apply chat filter after GROUP BY (simpler than inline SQL)
  let result = rows.map(r => songRow(
    r,
    mentionsBySong[r.id] ?? [],
    assignmentsBySong[r.id] ?? [],
    shortlistUris.has(r.spotify_uri),
  ));

  if (filter.chatName) {
    result = result.filter(s => s.chatNames.includes(filter.chatName!));
  }

  return result;
}

export function getChatSongById(db: Database.Database, id: string): ChatSong | null {
  const r = db.prepare('SELECT * FROM chat_songs WHERE id=?').get(id) as any;
  if (!r) return null;
  const mentions = (db.prepare('SELECT * FROM chat_mentions WHERE song_id=? ORDER BY captured_at ASC').all(id) as any[]).map(mentionRow);
  const assignedRoundIds = (db.prepare('SELECT round_id FROM chat_assignments WHERE chat_song_id=?').all(id) as any[]).map((a: any) => a.round_id);
  const onShortlist = !!(db.prepare('SELECT 1 FROM shortlist_songs WHERE spotify_uri=?').get(r.spotify_uri));
  return { ...songRow(r, mentions, assignedRoundIds, onShortlist), mentions };
}

export function upsertChatSong(db: Database.Database, s: {
  spotifyUri: string; title: string; artist: string;
  album?: string | null; albumArtUrl?: string | null;
  year?: number | null; durationSec?: number | null;
}): string {
  const existing = db.prepare('SELECT id FROM chat_songs WHERE spotify_uri=?').get(s.spotifyUri) as any;
  if (existing) return existing.id;
  const id = randomUUID();
  db.prepare(`INSERT INTO chat_songs (id, spotify_uri, title, artist, album, album_art_url, year, duration_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, s.spotifyUri, s.title, s.artist, s.album ?? null, s.albumArtUrl ?? null, s.year ?? null, s.durationSec ?? null);
  return id;
}

export function insertChatMention(db: Database.Database, m: {
  songId: string; chatName: string; senderName: string;
  capturedAt: string; rawMessage: string;
  priorMessages: PriorMessage[]; intent: Intent;
}): string {
  const id = randomUUID();
  db.prepare(`INSERT INTO chat_mentions (id, song_id, chat_name, sender_name, captured_at, raw_message, prior_messages, intent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, m.songId, m.chatName, m.senderName, m.capturedAt, m.rawMessage,
      JSON.stringify(m.priorMessages), m.intent);
  return id;
}

export function setChatSongDismissed(db: Database.Database, id: string, dismissed: boolean): void {
  db.prepare('UPDATE chat_songs SET dismissed=? WHERE id=?').run(dismissed ? 1 : 0, id);
}

export function assignChatSongToRound(db: Database.Database, chatSongId: string, roundId: number): void {
  db.prepare(`INSERT OR IGNORE INTO chat_assignments (chat_song_id, round_id) VALUES (?, ?)`)
    .run(chatSongId, roundId);
  const song = db.prepare('SELECT * FROM chat_songs WHERE id=?').get(chatSongId) as any;
  if (song) {
    db.prepare(`INSERT OR IGNORE INTO research_songs (round_id, spotify_uri, title, artist, album, added_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(roundId, song.spotify_uri, song.title, song.artist, song.album ?? null, new Date().toISOString());
  }
}

export function unassignChatSongFromRound(db: Database.Database, chatSongId: string, roundId: number): void {
  db.prepare('DELETE FROM chat_assignments WHERE chat_song_id=? AND round_id=?').run(chatSongId, roundId);
}

export function getDistinctChatNames(db: Database.Database): string[] {
  return (db.prepare('SELECT DISTINCT chat_name FROM chat_mentions ORDER BY chat_name').all() as any[]).map(r => r.chat_name);
}

export function getUnassignedNotDismissedCount(db: Database.Database): number {
  const r = db.prepare(`
    SELECT COUNT(*) AS n FROM chat_songs cs
    WHERE cs.dismissed = 0
    AND NOT EXISTS (SELECT 1 FROM chat_assignments ca WHERE ca.chat_song_id = cs.id)
  `).get() as any;
  return r.n;
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/src/lib/chat/chat.ts
git commit -m "feat(chat): add chat DB module"
```

---

## Task 3: DB Module Tests

**Files:**
- Create: `ui/src/lib/chat/chat.test.ts`

- [ ] **Step 1: Write failing tests**

Create `ui/src/lib/chat/chat.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openLeagueDb } from '../db/client.js';
import {
  upsertChatSong, insertChatMention, getChatSongs, getChatSongById,
  setChatSongDismissed, assignChatSongToRound, unassignChatSongFromRound,
  getDistinctChatNames, getUnassignedNotDismissedCount,
} from './chat.js';
import { unlinkSync, existsSync } from 'node:fs';
import type Database from 'better-sqlite3';

const TMP = '/tmp/test-chat-watcher.db';
let db: Database.Database;

function cleanup() {
  if (db) { try { db.close(); } catch {} }
  for (const s of ['', '-wal', '-shm']) {
    const p = `${TMP}${s}`;
    if (existsSync(p)) unlinkSync(p);
  }
}

function seedRound(db: Database.Database): number {
  db.exec(`
    INSERT OR IGNORE INTO leagues (id, slug, name) VALUES (1, 'test', 'Test League');
    INSERT OR IGNORE INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active');
    INSERT OR IGNORE INTO rounds (id, season_id, ml_round_id, name, description, spotify_playlist_url, created_at)
      VALUES (1, 1, 'r1', 'Round 1', null, null, '2026-01-01T00:00:00Z');
  `);
  return 1;
}

beforeEach(() => { cleanup(); db = openLeagueDb(TMP); });
afterEach(cleanup);

describe('upsertChatSong', () => {
  it('inserts a new song and returns its id', () => {
    const id = upsertChatSong(db, { spotifyUri: 'spotify:track:abc', title: 'Song A', artist: 'Artist X' });
    expect(id).toBeTypeOf('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('is idempotent — duplicate URI returns same id', () => {
    const id1 = upsertChatSong(db, { spotifyUri: 'spotify:track:abc', title: 'Song A', artist: 'X' });
    const id2 = upsertChatSong(db, { spotifyUri: 'spotify:track:abc', title: 'Song A again', artist: 'X' });
    expect(id1).toBe(id2);
  });
});

describe('insertChatMention', () => {
  it('inserts a mention and links it to the song', () => {
    const songId = upsertChatSong(db, { spotifyUri: 'spotify:track:m1', title: 'M', artist: 'X' });
    insertChatMention(db, {
      songId, chatName: 'Hip Jammers', senderName: 'Matt',
      capturedAt: '2026-05-01T20:00:00Z', rawMessage: 'check this https://open.spotify.com/track/m1',
      priorMessages: [{ sender: 'Kieran', timeMs: 1000, text: 'anyone?' }],
      intent: 'found',
    });
    const song = getChatSongById(db, songId)!;
    expect(song.mentions).toHaveLength(1);
    expect(song.mentions![0].senderName).toBe('Matt');
    expect(song.mentions![0].intent).toBe('found');
    expect(song.mentions![0].priorMessages).toHaveLength(1);
  });
});

describe('getChatSongs', () => {
  function seed() {
    const id1 = upsertChatSong(db, { spotifyUri: 'spotify:track:s1', title: 'First', artist: 'A' });
    const id2 = upsertChatSong(db, { spotifyUri: 'spotify:track:s2', title: 'Second', artist: 'B' });
    insertChatMention(db, { songId: id1, chatName: 'Hip Jammers', senderName: 'Matt',
      capturedAt: '2026-05-01T10:00:00Z', rawMessage: 'a', priorMessages: [], intent: 'found' });
    insertChatMention(db, { songId: id2, chatName: 'The Lads', senderName: 'Sam',
      capturedAt: '2026-05-02T10:00:00Z', rawMessage: 'b', priorMessages: [], intent: 'alt' });
    return { id1, id2 };
  }

  it('returns songs sorted by most recent mention by default', () => {
    const { } = seed();
    const songs = getChatSongs(db);
    expect(songs[0].title).toBe('Second');
    expect(songs[1].title).toBe('First');
  });

  it('filters by chat name', () => {
    seed();
    const songs = getChatSongs(db, { chatName: 'Hip Jammers' });
    expect(songs).toHaveLength(1);
    expect(songs[0].title).toBe('First');
  });

  it('filters unassigned', () => {
    seedRound(db);
    const { id1 } = seed();
    assignChatSongToRound(db, id1, 1);
    const unassigned = getChatSongs(db, { status: 'unassigned' });
    expect(unassigned.every(s => s.assignedRoundIds.length === 0)).toBe(true);
    expect(unassigned.find(s => s.title === 'First')).toBeUndefined();
  });

  it('excludes dismissed songs by default', () => {
    seed();
    const songs = getChatSongs(db);
    const id = songs[0].id;
    setChatSongDismissed(db, id, true);
    expect(getChatSongs(db)).toHaveLength(1);
    expect(getChatSongs(db, { includeDismissed: true })).toHaveLength(2);
  });
});

describe('assignChatSongToRound / unassign', () => {
  it('assigns and mirrors into research_songs', () => {
    seedRound(db);
    const id = upsertChatSong(db, { spotifyUri: 'spotify:track:asgn', title: 'Assign Me', artist: 'X' });
    insertChatMention(db, { songId: id, chatName: 'Hip Jammers', senderName: 'Matt',
      capturedAt: '2026-05-01T10:00:00Z', rawMessage: 'x', priorMessages: [], intent: 'maybe' });
    assignChatSongToRound(db, id, 1);
    const songs = getChatSongs(db);
    expect(songs[0].assignedRoundIds).toContain(1);
    const research = db.prepare("SELECT * FROM research_songs WHERE round_id=1 AND spotify_uri='spotify:track:asgn'").get();
    expect(research).toBeTruthy();
  });

  it('unassigns correctly', () => {
    seedRound(db);
    const id = upsertChatSong(db, { spotifyUri: 'spotify:track:u1', title: 'U', artist: 'X' });
    insertChatMention(db, { songId: id, chatName: 'Hip Jammers', senderName: 'Matt',
      capturedAt: '2026-05-01T10:00:00Z', rawMessage: 'x', priorMessages: [], intent: 'found' });
    assignChatSongToRound(db, id, 1);
    unassignChatSongFromRound(db, id, 1);
    expect(getChatSongs(db)[0].assignedRoundIds).toHaveLength(0);
  });
});

describe('getUnassignedNotDismissedCount', () => {
  it('counts correctly', () => {
    seedRound(db);
    const id1 = upsertChatSong(db, { spotifyUri: 'spotify:track:c1', title: 'C1', artist: 'X' });
    const id2 = upsertChatSong(db, { spotifyUri: 'spotify:track:c2', title: 'C2', artist: 'X' });
    insertChatMention(db, { songId: id1, chatName: 'Hip Jammers', senderName: 'Matt',
      capturedAt: '2026-05-01T10:00:00Z', rawMessage: 'x', priorMessages: [], intent: 'found' });
    insertChatMention(db, { songId: id2, chatName: 'Hip Jammers', senderName: 'Sam',
      capturedAt: '2026-05-01T11:00:00Z', rawMessage: 'y', priorMessages: [], intent: 'found' });
    expect(getUnassignedNotDismissedCount(db)).toBe(2);
    assignChatSongToRound(db, id1, 1);
    expect(getUnassignedNotDismissedCount(db)).toBe(1);
    setChatSongDismissed(db, id2, true);
    expect(getUnassignedNotDismissedCount(db)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests — they should FAIL (module not found or test errors)**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx vitest run src/lib/chat/chat.test.ts
```
Expected: FAIL because `chat.ts` needs `getChatSongs` to be fully verified against schema. If all pass, proceed.

- [ ] **Step 3: Run tests after Task 2 is complete**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx vitest run src/lib/chat/chat.test.ts
```
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add ui/src/lib/chat/chat.test.ts
git commit -m "test(chat): add chat DB module tests"
```

---

## Task 4: CSS

**Files:**
- Create: `ui/src/lib/chat/chat.css`
- Replace: `ui/src/lib/shortlist/shortlist.css`
- Modify: `ui/src/app.css`

- [ ] **Step 1: Copy chat CSS from the handoff reference**

```bash
cp "/home/loydmilligan/Projects/music-league-bot/docs/chatmention-proto/Mash Co. Design System (1)/chat-watcher-handoff/reference/ml-chat-styles.css" \
   /home/loydmilligan/Projects/music-league-bot/ui/src/lib/chat/chat.css
```

- [ ] **Step 2: Replace shortlist CSS with the updated proto version**

The proto updated `ml-shortlist-styles.css` adds `.sl-actionbtn`, `.sl-popover--wide`, `.sl-popover-filter`, `.sl-popover-search`, and `.sl-popover-pills`. Replace the existing file:

```bash
cp "/home/loydmilligan/Projects/music-league-bot/docs/chatmention-proto/Mash Co. Design System (1)/chat-watcher-handoff/reference/ml-shortlist-styles.css" \
   /home/loydmilligan/Projects/music-league-bot/ui/src/lib/shortlist/shortlist.css
```

- [ ] **Step 3: Add chat CSS import to app.css**

Open `ui/src/app.css`. After the existing `@import '$lib/shortlist/colors_and_type.css';` line, add:

```css
@import '$lib/chat/chat.css';
```

- [ ] **Step 4: Run type check — verify no CSS parse errors**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "Error" | head -10
```
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/chat/chat.css ui/src/lib/shortlist/shortlist.css ui/src/app.css
git commit -m "feat(chat): add chat CSS + update shortlist CSS with actionbtn + wide popover styles"
```

---

## Task 5: AssignPopover upgrade + ShortlistRow update

The current `AssignPopover` has hardcoded API paths for the shortlist. Upgrading it to accept `onAssign`/`onUnassign` callbacks makes it reusable for the chat watcher.

**Files:**
- Modify: `ui/src/lib/shortlist/AssignPopover.svelte`
- Modify: `ui/src/lib/shortlist/ShortlistRow.svelte`

- [ ] **Step 1: Rewrite AssignPopover.svelte**

Replace the full content of `ui/src/lib/shortlist/AssignPopover.svelte`:

```svelte
<script lang="ts">
  const {
    songTitle,
    assignedRoundIds = [],
    onAssign,
    onUnassign,
    onclose,
  } = $props<{
    songTitle: string;
    assignedRoundIds?: number[];
    onAssign: (roundId: number) => Promise<void>;
    onUnassign: (roundId: number) => Promise<void>;
    onclose: () => void;
  }>();

  type OpenRound = {
    id: number; name: string; description: string | null;
    submissionDeadline: string | null; leagueName: string;
  };

  let rounds = $state<OpenRound[]>([]);
  let pending = $state<Set<number>>(new Set(assignedRoundIds));
  let query = $state('');
  let activeLeague = $state<string | null>(null);

  async function loadRounds() {
    const res = await fetch('/api/rounds/open');
    if (res.ok) rounds = await res.json();
  }

  async function toggle(roundId: number) {
    if (pending.has(roundId)) {
      await onUnassign(roundId);
      pending = new Set([...pending].filter(id => id !== roundId));
    } else {
      await onAssign(roundId);
      pending = new Set([...pending, roundId]);
    }
  }

  const leagues = $derived([...new Set(rounds.map(r => r.leagueName))]);

  const filtered = $derived(rounds.filter(r => {
    if (activeLeague && r.leagueName !== activeLeague) return false;
    const q = query.trim().toLowerCase();
    if (q) {
      return (r.description ?? r.name).toLowerCase().includes(q)
        || r.leagueName.toLowerCase().includes(q)
        || r.name.toLowerCase().includes(q);
    }
    return true;
  }));

  function formatDeadline(iso: string | null): string {
    if (!iso) return '';
    const h = Math.round((Date.parse(iso) - Date.now()) / 3600000);
    if (h < 24) return `${h}h`;
    return `${Math.round(h / 24)}d`;
  }

  loadRounds();
</script>

<div class="sl-popover sl-popover--wide" onclick={(e) => e.stopPropagation()}>
  <div class="sl-popover-arrow"></div>
  <div class="sl-popover-eyebrow">Assign to a round · {songTitle}</div>

  <div class="sl-popover-filter">
    <div class="sl-popover-search">
      <span class="sl-popover-search-glyph">⌕</span>
      <input
        type="text"
        bind:value={query}
        placeholder="Filter themes, leagues, round ids…"
        autocomplete="off"
      />
      {#if query}
        <button type="button" class="sl-popover-search-clear" onclick={() => query = ''}>✕</button>
      {/if}
    </div>
    <div class="sl-popover-pills">
      <button
        type="button"
        class="sl-popover-pill"
        class:is-on={activeLeague === null}
        onclick={() => activeLeague = null}
      >All <span class="n">{rounds.length}</span></button>
      {#each leagues as league}
        <button
          type="button"
          class="sl-popover-pill"
          class:is-on={activeLeague === league}
          onclick={() => activeLeague = activeLeague === league ? null : league}
        >{league} <span class="n">{rounds.filter(r => r.leagueName === league).length}</span></button>
      {/each}
    </div>
  </div>

  <div class="sl-popover-list">
    {#each filtered as round}
      <button
        type="button"
        class="sl-popover-row"
        class:is-on={pending.has(round.id)}
        onclick={() => toggle(round.id)}
      >
        <span class="sl-popover-check">{pending.has(round.id) ? '✓' : ''}</span>
        <div style="min-width: 0">
          <div class="sl-popover-theme">{round.description ?? round.name}</div>
          <div class="sl-popover-league">{round.leagueName} · {round.name}</div>
        </div>
        {#if round.submissionDeadline}
          <span class="sl-popover-meta">{formatDeadline(round.submissionDeadline)}</span>
        {/if}
      </button>
    {:else}
      <div class="sl-popover-empty">
        No rounds match.
        {#if query || activeLeague}
          <button type="button" onclick={() => { query = ''; activeLeague = null; }}>Clear filters</button>
        {/if}
      </div>
    {/each}
  </div>

  <div class="sl-popover-foot">
    <span class="sl-popover-foot-hint">
      {filtered.length === rounds.length
        ? 'Song stays on the shortlist after assigning.'
        : `${filtered.length} of ${rounds.length} shown`}
    </span>
    <button type="button" class="sl-btn sl-btn-primary" onclick={onclose}>Done</button>
  </div>
</div>
```

- [ ] **Step 2: Update ShortlistRow.svelte to pass callbacks to AssignPopover**

In `ui/src/lib/shortlist/ShortlistRow.svelte`, find the `<AssignPopover` usage (two locations — collapsed and expanded states) and replace both with:

```svelte
<AssignPopover
  songTitle={localSong.title}
  assignedRoundIds={assignedRoundIds}
  onAssign={async (roundId) => {
    await fetch(`/api/shortlist/${localSong.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ round_id: roundId }),
    });
    localSong = { ...localSong, assignments: [...(localSong.assignments ?? []), { shortlistSongId: localSong.id, roundId, assignedAt: new Date().toISOString() }] };
  }}
  onUnassign={async (roundId) => {
    await fetch(`/api/shortlist/${localSong.id}/assign/${roundId}`, { method: 'DELETE' });
    localSong = { ...localSong, assignments: (localSong.assignments ?? []).filter(a => a.roundId !== roundId) };
  }}
  onclose={() => showAssignPopover = false}
/>
```

Also remove the old `songId` prop from both `<AssignPopover` tags (it no longer exists).

- [ ] **Step 3: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "Error" | head -10
```
Expected: no errors.

- [ ] **Step 4: Run all tests to verify shortlist is not broken**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx vitest run
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/shortlist/AssignPopover.svelte ui/src/lib/shortlist/ShortlistRow.svelte
git commit -m "feat(chat): upgrade AssignPopover with search + league pills; decouple API via callbacks"
```

---

## Task 6: Bot — message buffer + chat name capture

**Files:**
- Modify: `src/whatsapp/client.ts`
- Modify: `src/bot/handler.ts`

The bot currently has no knowledge of prior messages. We add an in-memory buffer per chat group — last 5 messages. When a URL is captured, the 3 messages before the current one are passed along.

- [ ] **Step 1: Update WhatsAppMessage interface in handler.ts**

In `src/bot/handler.ts`, update the `WhatsAppMessage` interface:

```ts
export interface WhatsAppMessage {
  body: string;
  from: string;           // group chat id, e.g. "XXXX@g.us"
  chatName: string;       // human-readable group name, e.g. "Hip Jammers"
  author: string;         // sender id, e.g. "16171234567@c.us"
  fromMe: boolean;
  capturedAt: string;     // ISO timestamp of the message
  priorMessages: Array<{ sender: string; timeMs: number; text: string }>;
  reply(text: string): Promise<void>;
  getContact(): Promise<{ pushname: string }>;
}
```

- [ ] **Step 2: Update client.ts to buffer messages and populate new fields**

Replace the content of `src/whatsapp/client.ts`:

```ts
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

    // Snapshot prior messages BEFORE adding current to buffer
    const priors = (chatBuffer.get(chatId) ?? []).slice(-3);

    // Add current message to buffer
    pushToBuffer(chatId, {
      sender: raw.author ?? raw.from,
      timeMs,
      text: raw.body,
    });

    // Resolve chat name
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
```

- [ ] **Step 3: Run bot type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot
npx tsc --noEmit 2>&1 | head -20
```
Expected: no new errors from the changed files.

- [ ] **Step 4: Commit**

```bash
git add src/whatsapp/client.ts src/bot/handler.ts
git commit -m "feat(chat): add per-chat message buffer + chatName + capturedAt to WhatsAppMessage"
```

---

## Task 7: Bot — intent classifier

**Files:**
- Create: `src/bot/intentClassifier.ts`

- [ ] **Step 1: Create intentClassifier.ts**

Create `src/bot/intentClassifier.ts`:

```ts
export type Intent = 'alt' | 'retro' | 'found' | 'maybe' | 'unclassified';

const TRIGGERS: Array<{ intent: Intent; phrases: string[] }> = [
  {
    intent: 'alt',
    phrases: [
      'almost picked', 'was going to', "was gonna", 'yes/no/maybe', 'wildcard',
      'backup', 'thinking about', 'considering', 'nearly went with',
      'still thinking', 'on my list', 'shortlist',
    ],
  },
  {
    intent: 'retro',
    phrases: [
      'rediscovering', 'still holds up', 'remember when', 'going through old',
      'throwback', 'nostalgia', 'forgot about', 'used to love', 'back in the day',
      'holds up', 'still good',
    ],
  },
  {
    intent: 'maybe',
    phrases: [
      'what about', 'did anyone', 'anyone think', 'wondering if', 'could work',
      'might work', 'possibly', 'maybe', 'not sure if',
    ],
  },
  {
    intent: 'found',
    phrases: [
      'check this', 'found this', 'this band', 'best x song', 'best song',
      'this one', 'have you heard', 'listen to this', 'new to me',
      'just found', 'just heard', 'discovered',
    ],
  },
];

// Priority order: alt > retro > maybe > found > unclassified
const PRIORITY: Intent[] = ['alt', 'retro', 'maybe', 'found'];

export function classifyIntent(message: string, lastPrior?: string): Intent {
  const haystack = `${message} ${lastPrior ?? ''}`.toLowerCase();
  for (const intent of PRIORITY) {
    const trigger = TRIGGERS.find(t => t.intent === intent)!;
    if (trigger.phrases.some(p => haystack.includes(p))) return intent;
  }
  return 'unclassified';
}
```

- [ ] **Step 2: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot
npx tsc --noEmit 2>&1 | head -10
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/bot/intentClassifier.ts
git commit -m "feat(chat): add intent classifier (alt/retro/found/maybe heuristic)"
```

---

## Task 8: Bot — chatDb.ts (write to league.db)

**Files:**
- Create: `src/storage/chatDb.ts`

This module opens `$DATA_DIR/league.db` (the same DB as the UI) and provides `insertChatCapture()` which upserts into `chat_songs`, inserts into `chat_mentions`, and auto-assigns to a round if appropriate.

- [ ] **Step 1: Create src/storage/chatDb.ts**

Create `src/storage/chatDb.ts`:

```ts
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { classifyIntent, type Intent } from '../bot/intentClassifier.js';

let _db: Database.Database | null = null;

function getChatLeagueDb(): Database.Database | null {
  if (_db) return _db;
  const path = resolve(process.env.DATA_DIR ?? 'data', 'league.db');
  try {
    _db = new Database(path);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    // Ensure tables exist (idempotent — UI schema also creates them)
    _db.exec(`
      CREATE TABLE IF NOT EXISTS chat_songs (
        id TEXT PRIMARY KEY, spotify_uri TEXT NOT NULL UNIQUE,
        artist TEXT NOT NULL, title TEXT NOT NULL, album TEXT,
        year INTEGER, duration_sec INTEGER, album_art_url TEXT,
        dismissed INTEGER NOT NULL DEFAULT 0,
        first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
      CREATE TABLE IF NOT EXISTS chat_mentions (
        id TEXT PRIMARY KEY, song_id TEXT NOT NULL REFERENCES chat_songs(id) ON DELETE CASCADE,
        chat_name TEXT NOT NULL, sender_name TEXT NOT NULL, captured_at TEXT NOT NULL,
        raw_message TEXT NOT NULL, prior_messages TEXT NOT NULL DEFAULT '[]',
        intent TEXT NOT NULL DEFAULT 'unclassified'
      );
      CREATE TABLE IF NOT EXISTS chat_assignments (
        chat_song_id TEXT NOT NULL REFERENCES chat_songs(id) ON DELETE CASCADE,
        round_id INTEGER NOT NULL, assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        PRIMARY KEY (chat_song_id, round_id)
      );
    `);
    return _db;
  } catch (err) {
    console.error('[chatDb] Could not open league.db:', err);
    return null;
  }
}

function autoAssignRoundId(db: Database.Database, capturedAt: string): number | null {
  const ts = Date.parse(capturedAt);

  // Voting phase: submission_deadline < captured_at <= voting_deadline
  const voting = db.prepare(`
    SELECT id FROM rounds
    WHERE submission_deadline IS NOT NULL
    AND voting_deadline IS NOT NULL
    AND datetime(submission_deadline) < datetime(?)
    AND datetime(?) <= datetime(voting_deadline)
    ORDER BY voting_deadline ASC
    LIMIT 1
  `).get(capturedAt, capturedAt) as { id: number } | undefined;
  if (voting) return voting.id;

  // Gap case: captured_at > voting_deadline, within 2 hours of the most recently ended round
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const recent = db.prepare(`
    SELECT id, voting_deadline FROM rounds
    WHERE voting_deadline IS NOT NULL
    AND datetime(voting_deadline) < datetime(?)
    ORDER BY voting_deadline DESC
    LIMIT 1
  `).get(capturedAt) as { id: number; voting_deadline: string } | undefined;

  if (recent) {
    const gap = ts - Date.parse(recent.voting_deadline);
    if (gap <= TWO_HOURS_MS) return recent.id;
  }

  return null;
}

export interface ChatCaptureInput {
  spotifyUri: string;
  title: string;
  artist: string;
  album?: string | null;
  albumArtUrl?: string | null;
  year?: number | null;
  durationSec?: number | null;
  chatName: string;
  senderName: string;
  capturedAt: string;
  rawMessage: string;
  priorMessages: Array<{ sender: string; timeMs: number; text: string }>;
}

export function insertChatCapture(input: ChatCaptureInput): void {
  const db = getChatLeagueDb();
  if (!db) return;

  // Upsert song
  const existing = db.prepare('SELECT id FROM chat_songs WHERE spotify_uri=?').get(input.spotifyUri) as { id: string } | undefined;
  let songId: string;
  if (existing) {
    songId = existing.id;
  } else {
    songId = randomUUID();
    db.prepare(`INSERT INTO chat_songs (id, spotify_uri, title, artist, album, album_art_url, year, duration_sec)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(songId, input.spotifyUri, input.title, input.artist,
        input.album ?? null, input.albumArtUrl ?? null, input.year ?? null, input.durationSec ?? null);
  }

  // Classify intent
  const lastPrior = input.priorMessages.at(-1)?.text;
  const intent: Intent = classifyIntent(input.rawMessage, lastPrior);

  // Insert mention
  const mentionId = randomUUID();
  db.prepare(`INSERT INTO chat_mentions (id, song_id, chat_name, sender_name, captured_at, raw_message, prior_messages, intent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(mentionId, songId, input.chatName, input.senderName, input.capturedAt,
      input.rawMessage, JSON.stringify(input.priorMessages), intent);

  // Auto-assign
  const roundId = autoAssignRoundId(db, input.capturedAt);
  if (roundId) {
    db.prepare(`INSERT OR IGNORE INTO chat_assignments (chat_song_id, round_id) VALUES (?, ?)`).run(songId, roundId);
    const song = db.prepare('SELECT * FROM chat_songs WHERE id=?').get(songId) as any;
    if (song) {
      db.prepare(`INSERT OR IGNORE INTO research_songs (round_id, spotify_uri, title, artist, album, added_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(roundId, song.spotify_uri, song.title, song.artist, song.album ?? null, input.capturedAt);
    }
  }
}
```

- [ ] **Step 2: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot
npx tsc --noEmit 2>&1 | head -10
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/storage/chatDb.ts
git commit -m "feat(chat): add chatDb — insertChatCapture with intent classification + auto-assignment"
```

---

## Task 9: Bot — wire handler.ts to chatDb

**Files:**
- Modify: `src/bot/handler.ts`

- [ ] **Step 1: Import insertChatCapture and call it in handleAutoCapture**

In `src/bot/handler.ts`, add the import at the top:

```ts
import { insertChatCapture } from '../storage/chatDb.js';
```

In the `handleAutoCapture` function, after the `insertSubmission(db, {...})` call for a successfully resolved track (the `!isDupe` branch and the `isDupe` branch both), add the chat capture. Find the two `insertSubmission` calls inside `handleAutoCapture` where `status` is `'added'` or `'duplicate'` and the track was resolved. After each one, add:

```ts
    insertChatCapture({
      spotifyUri: track.spotifyUri!,
      title: track.title,
      artist: track.artist,
      album: track.album ?? null,
      albumArtUrl: track.albumArtUrl ?? null,
      year: track.year ?? null,
      durationSec: track.durationMs ? Math.round(track.durationMs / 1000) : null,
      chatName: msg.chatName,
      senderName: submitterName,
      capturedAt: msg.capturedAt,
      rawMessage: msg.body,
      priorMessages: msg.priorMessages,
    });
```

There are two resolution paths in `handleAutoCapture` — one for non-Spotify platforms (via Songlink) and one for direct Spotify URLs. Add the call in both paths, after the `insertSubmission` line for resolved tracks. Add it only when `resolution.track` is non-null (i.e. the track was found).

- [ ] **Step 2: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot
npx tsc --noEmit 2>&1 | head -10
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/bot/handler.ts
git commit -m "feat(chat): wire bot handler to insertChatCapture on URL auto-capture"
```

---

## Task 10: API Routes — chat endpoints

**Files:**
- Create: `ui/src/routes/api/chat/songs/+server.ts`
- Create: `ui/src/routes/api/chat/songs/[id]/dismiss/+server.ts`
- Create: `ui/src/routes/api/chat/songs/[id]/shortlist/+server.ts`
- Create: `ui/src/routes/api/chat/songs/[id]/assign/+server.ts`
- Create: `ui/src/routes/api/chat/songs/[id]/assign/[roundId]/+server.ts`

- [ ] **Step 1: GET /api/chat/songs**

Create `ui/src/routes/api/chat/songs/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getChatSongs, type ChatSongsFilter } from '$lib/chat/chat.js';

export const GET: RequestHandler = async ({ url }) => {
  const status = url.searchParams.get('status') as ChatSongsFilter['status'] | null;
  const chatName = url.searchParams.get('chat') ?? undefined;
  const sort = (url.searchParams.get('sort') ?? 'recent') as ChatSongsFilter['sort'];
  const includeDismissed = url.searchParams.get('include_dismissed') === '1';
  const db = getDb();
  return json(getChatSongs(db, { status: status ?? undefined, chatName, sort, includeDismissed }));
};
```

- [ ] **Step 2: POST/DELETE /api/chat/songs/[id]/dismiss**

Create `ui/src/routes/api/chat/songs/[id]/dismiss/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { setChatSongDismissed } from '$lib/chat/chat.js';

export const POST: RequestHandler = async ({ params }) => {
  getDb(); // ensure open
  setChatSongDismissed(getDb(), params.id, true);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
  setChatSongDismissed(getDb(), params.id, false);
  return json({ ok: true });
};
```

- [ ] **Step 3: POST/DELETE /api/chat/songs/[id]/shortlist**

Create `ui/src/routes/api/chat/songs/[id]/shortlist/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getChatSongById } from '$lib/chat/chat.js';
import { addShortlistSong, deleteShortlistSongByUri } from '$lib/shortlist/shortlist.js';

export const POST: RequestHandler = async ({ params }) => {
  const db = getDb();
  const song = getChatSongById(db, params.id);
  if (!song) throw error(404, 'song not found');
  addShortlistSong(db, {
    spotifyUri: song.spotifyUri, title: song.title, artist: song.artist,
    album: song.album, albumArtUrl: song.albumArtUrl,
    year: song.year, durationSec: song.durationSec,
  });
  return json({ ok: true }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const db = getDb();
  const song = getChatSongById(db, params.id);
  if (!song) throw error(404, 'song not found');
  deleteShortlistSongByUri(db, song.spotifyUri);
  return json({ ok: true });
};
```

- [ ] **Step 4: POST /api/chat/songs/[id]/assign**

Create `ui/src/routes/api/chat/songs/[id]/assign/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { assignChatSongToRound } from '$lib/chat/chat.js';

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json() as { round_id?: number };
  if (typeof body.round_id !== 'number') throw error(400, 'round_id required');
  assignChatSongToRound(getDb(), params.id, body.round_id);
  return json({ ok: true }, { status: 201 });
};
```

- [ ] **Step 5: DELETE /api/chat/songs/[id]/assign/[roundId]**

Create `ui/src/routes/api/chat/songs/[id]/assign/[roundId]/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { unassignChatSongFromRound } from '$lib/chat/chat.js';

export const DELETE: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');
  unassignChatSongFromRound(getDb(), params.id, roundId);
  return new Response(null, { status: 204 });
};
```

- [ ] **Step 6: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "Error" | head -10
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add ui/src/routes/api/chat/
git commit -m "feat(chat): add chat API routes (list, dismiss, shortlist, assign)"
```

---

## Task 11: CwFilterBar component

**Files:**
- Create: `ui/src/lib/chat/CwFilterBar.svelte`

- [ ] **Step 1: Create CwFilterBar.svelte**

Create `ui/src/lib/chat/CwFilterBar.svelte`:

```svelte
<script lang="ts">
  const {
    total,
    unassignedCount,
    assignedCount,
    chatNames,
    status,
    activeChatName,
    sort,
    onStatusChange,
    onChatChange,
    onSortChange,
  } = $props<{
    total: number;
    unassignedCount: number;
    assignedCount: number;
    chatNames: string[];
    status: 'all' | 'unassigned' | 'assigned';
    activeChatName: string | null;
    sort: 'recent' | 'mentioned';
    onStatusChange: (s: 'all' | 'unassigned' | 'assigned') => void;
    onChatChange: (name: string | null) => void;
    onSortChange: (s: 'recent' | 'mentioned') => void;
  }>();
</script>

<div class="cw-bar">
  <div class="cw-bar-left">
    <div class="cw-filter-group">
      {#each ([['all', `All ${total}`], ['unassigned', `Unassigned ${unassignedCount}`], ['assigned', `Assigned ${assignedCount}`]] as const) as [key, label]}
        <button
          type="button"
          class="sl-sort-pill"
          class:is-active={status === key}
          onclick={() => onStatusChange(key)}
        >{label}</button>
      {/each}
    </div>

    {#if chatNames.length > 0}
      <div class="cw-filter-divider"></div>
      <div class="cw-filter-group">
        {#each chatNames as name}
          <button
            type="button"
            class="cw-chat-chip cw-chat-chip--{name === 'Hip Jammers' ? 'sky' : name === 'The Lads' ? 'amber' : 'muted'}"
            class:is-active={activeChatName === name}
            onclick={() => onChatChange(activeChatName === name ? null : name)}
          >{name}</button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="cw-bar-right">
    <div class="cw-sort-group">
      {#each ([['recent', '↓ recent'], ['mentioned', '↓ mentioned']] as const) as [key, label]}
        <button
          type="button"
          class="sl-sort-pill"
          class:is-active={sort === key}
          onclick={() => onSortChange(key)}
        >{label}</button>
      {/each}
    </div>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add ui/src/lib/chat/CwFilterBar.svelte
git commit -m "feat(chat): add CwFilterBar component"
```

---

## Task 12: CwRow component (collapsed + expanded with pull-quote)

**Files:**
- Create: `ui/src/lib/chat/CwRow.svelte`

This is the most complex component. Read `docs/chatmention-proto/Mash Co. Design System (1)/chat-watcher-handoff/reference/Music League Bot - Chat Watcher.html` in a browser before implementing. Study the `.cw-pull` block closely — it is the screen's signature element.

- [ ] **Step 1: Create CwRow.svelte**

Create `ui/src/lib/chat/CwRow.svelte`:

```svelte
<script lang="ts">
  import AssignPopover from '$lib/shortlist/AssignPopover.svelte';
  import Bookmark from '$lib/shortlist/Bookmark.svelte';
  import type { ChatSong, ChatMention, PriorMessage } from './chat.js';

  const { song, open = false, ontoggle, onupdated } = $props<{
    song: ChatSong;
    open?: boolean;
    ontoggle: () => void;
    onupdated: (updated: Partial<ChatSong> & { id: string }) => void;
  }>();

  let showAssignPopover = $state(false);
  let localSong = $state({ ...song });
  let dismissConfirm = $state(false);

  const SENDER_TONE: Record<string, string> = {
    Matt: 'sky', Kieran: 'amber', Sam: 'moss', Mira: 'pulp', Davey: 'ember',
  };
  const CHAT_TONE: Record<string, string> = {
    'Hip Jammers': 'sky', 'The Lads': 'amber',
  };

  function chatTone(name: string) { return CHAT_TONE[name] ?? 'muted'; }
  function senderTone(name: string) { return SENDER_TONE[name] ?? 'muted'; }

  function humaneTime(iso: string): string {
    const ms = Date.now() - Date.parse(iso);
    const min = Math.floor(ms / 60000);
    if (min < 60) return min <= 1 ? 'just now' : `${min} min ago`;
    const h = Math.floor(ms / 3600000);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(ms / 86400000);
    if (d === 1) return '1 day ago';
    if (d < 30) return `${d} days ago`;
    return `${Math.round(d / 30)} months ago`;
  }

  function strippedMessage(raw: string): string {
    return raw.replace(/https?:\/\/\S+/g, '').trim();
  }

  async function dismiss() {
    if (!dismissConfirm) { dismissConfirm = true; setTimeout(() => dismissConfirm = false, 3000); return; }
    await fetch(`/api/chat/songs/${localSong.id}/dismiss`, { method: 'POST' });
    onupdated({ id: localSong.id, dismissed: true });
  }

  async function undismiss() {
    await fetch(`/api/chat/songs/${localSong.id}/dismiss`, { method: 'DELETE' });
    onupdated({ id: localSong.id, dismissed: false });
  }

  const assignedRoundIds = $derived(localSong.assignedRoundIds ?? []);
</script>

{#if open}
  <!-- EXPANDED -->
  <div class="cw-row is-open">
    <div class="cw-row-open-head">
      <span class="cw-row-open-eyebrow">
        {localSong.mentionCount} {localSong.mentionCount === 1 ? 'mention' : 'mentions'} · context
      </span>
      <button type="button" class="sl-collapse-btn" onclick={ontoggle}>
        <span>↑</span><span class="sl-kbd">esc</span>
      </button>
    </div>

    <div class="cw-expanded">
      <!-- Art column -->
      <div class="cw-expanded-art">
        {#if localSong.albumArtUrl}
          <img src={localSong.albumArtUrl} alt="" width="180" height="180" style="border-radius: var(--r-2)" />
        {:else}
          <span class="sl-row-art-placeholder" style="width:180px;height:180px"></span>
        {/if}
        <div class="cw-expanded-meta">
          <div class="cw-expanded-title">{localSong.title}</div>
          <div class="cw-expanded-sub">
            {localSong.artist}{localSong.album ? ` · ${localSong.album}` : ''}
            {#if localSong.year} · {localSong.year}{/if}
          </div>
        </div>
      </div>

      <!-- Body column — context stack -->
      <div class="cw-expanded-body">
        {#if (song.mentions ?? []).length > 1}
          <div class="cw-timeline">
            {#each (song.mentions ?? []) as m, i}
              <span class="cw-timeline-pip">
                {i + 1}
                <span class="cw-chat-chip cw-chat-chip--{chatTone(m.chatName)}">{m.chatName}</span>
                <span class="cw-timeline-time">{humaneTime(m.capturedAt)}</span>
              </span>
            {/each}
          </div>
        {/if}

        {#each (song.mentions ?? []) as mention}
          <div class="cw-context-head">
            <span class="cw-chat-chip cw-chat-chip--{chatTone(mention.chatName)}">{mention.chatName}</span>
            <span class="cw-context-time">{humaneTime(mention.capturedAt)}</span>
          </div>

          <!-- Pull-quote block -->
          <div class="cw-pull">
            {#if mention.priorMessages.length > 0}
              <div class="cw-priors-eyebrow">{mention.priorMessages.length} messages before</div>
              <div class="cw-priors">
                {#each mention.priorMessages as prior}
                  <div class="cw-prior">
                    <span class="cw-prior-sender cw-prior-sender--{senderTone(prior.sender)}">{prior.sender}</span>
                    <span class="cw-prior-text">{prior.text}</span>
                  </div>
                {/each}
              </div>
            {/if}

            <div class="cw-pull-quote">
              <span class="cw-pull-deco">"</span>
              <span class="cw-pull-text">{strippedMessage(mention.rawMessage) || mention.rawMessage}</span>
            </div>

            <div class="cw-pull-attrib">
              <span class="cw-avatar cw-avatar--{senderTone(mention.senderName)}">{mention.senderName[0]}</span>
              <span class="cw-attrib-sender cw-attrib-sender--{senderTone(mention.senderName)}">{mention.senderName}</span>
              <span class="cw-chat-chip cw-chat-chip--{chatTone(mention.chatName)}">{mention.chatName}</span>
              <span class="cw-attrib-time">{humaneTime(mention.capturedAt)}</span>
              {#if mention.intent !== 'unclassified'}
                <span class="cw-intent cw-intent--{mention.intent === 'alt' ? 'pulp' : mention.intent === 'retro' ? 'amber' : mention.intent === 'found' ? 'sky' : 'muted'}">{mention.intent.toUpperCase()}</span>
              {/if}
              <span class="cw-spotify-badge">spotify</span>
            </div>
          </div>
        {/each}
      </div>

      <!-- Actions column -->
      <div class="cw-expanded-actions">
        <a
          href="https://open.spotify.com/track/{localSong.spotifyUri.split(':').at(-1)}"
          target="_blank" rel="noopener"
          class="sl-actionbtn sl-actionbtn--spotify"
        >
          <span class="sl-actionbtn-glyph">▶</span>
          <span class="sl-actionbtn-label">Play on Spotify</span>
        </a>

        <div class="sl-popover-anchor" style="display:inline-flex">
          <button
            type="button"
            class="sl-actionbtn sl-actionbtn--assign"
            onclick={() => showAssignPopover = !showAssignPopover}
          >
            <span class="sl-actionbtn-glyph">⊕</span>
            {#if assignedRoundIds.length > 0}
              <span class="sl-actionbtn-badge">{assignedRoundIds.length}</span>
            {/if}
            <span class="sl-actionbtn-label">Assign to round</span>
          </button>
          {#if showAssignPopover}
            <AssignPopover
              songTitle={localSong.title}
              assignedRoundIds={assignedRoundIds}
              onAssign={async (roundId) => {
                await fetch(`/api/chat/songs/${localSong.id}/assign`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ round_id: roundId }),
                });
                localSong = { ...localSong, assignedRoundIds: [...assignedRoundIds, roundId] };
              }}
              onUnassign={async (roundId) => {
                await fetch(`/api/chat/songs/${localSong.id}/assign/${roundId}`, { method: 'DELETE' });
                localSong = { ...localSong, assignedRoundIds: assignedRoundIds.filter(id => id !== roundId) };
              }}
              onclose={() => showAssignPopover = false}
            />
          {/if}
        </div>

        <Bookmark
          spotifyUri={localSong.spotifyUri}
          title={localSong.title}
          artist={localSong.artist}
          album={localSong.album}
          albumArtUrl={localSong.albumArtUrl}
          year={localSong.year}
          durationSec={localSong.durationSec}
          onShortlist={localSong.onShortlist}
        />

        {#if localSong.dismissed}
          <button type="button" class="sl-actionbtn" onclick={undismiss}>
            <span class="sl-actionbtn-glyph">↩</span>
            <span class="sl-actionbtn-label">Restore</span>
          </button>
        {:else}
          <button
            type="button"
            class="sl-actionbtn sl-actionbtn--remove"
            onclick={dismiss}
          >
            <span class="sl-actionbtn-glyph">⊘</span>
            <span class="sl-actionbtn-label">{dismissConfirm ? 'Confirm dismiss' : 'Not interested'}</span>
          </button>
        {/if}
      </div>
    </div>
  </div>

{:else}
  <!-- COLLAPSED -->
  <button
    type="button"
    class="cw-row"
    class:is-dismissed={localSong.dismissed}
    onclick={ontoggle}
  >
    {#if localSong.albumArtUrl}
      <img src={localSong.albumArtUrl} alt="" class="sl-row-art" width="44" height="44" />
    {:else}
      <span class="sl-row-art-placeholder"></span>
    {/if}

    <span class="cw-row-text">
      <span class="cw-row-title">{localSong.title}</span>
      <span class="cw-row-artist">{localSong.artist}</span>
    </span>

    {#each localSong.chatNames as name}
      <span class="cw-chat-chip cw-chat-chip--{chatTone(name)}">{name}</span>
    {/each}

    {#if (song.mentions ?? []).length > 0}
      {@const latestIntent = (song.mentions ?? []).at(-1)?.intent}
      {#if latestIntent && latestIntent !== 'unclassified'}
        <span class="cw-intent cw-intent--{latestIntent === 'alt' ? 'pulp' : latestIntent === 'retro' ? 'amber' : latestIntent === 'found' ? 'sky' : 'muted'}">{latestIntent.toUpperCase()}</span>
      {/if}
    {/if}

    {#if localSong.mentionCount > 1}
      <span class="cw-count">{localSong.mentionCount}×</span>
    {/if}

    <span class="cw-row-time">{humaneTime(localSong.latestMentionAt)}</span>

    {#if assignedRoundIds.length > 0}
      <span class="cw-assigned-chip">→ R-{assignedRoundIds[0]}</span>
    {/if}

    <span onclick={(e) => e.stopPropagation()}>
      <Bookmark
        spotifyUri={localSong.spotifyUri}
        title={localSong.title}
        artist={localSong.artist}
        album={localSong.album}
        albumArtUrl={localSong.albumArtUrl}
        year={localSong.year}
        durationSec={localSong.durationSec}
        onShortlist={localSong.onShortlist}
      />
    </span>

    <span onclick={(e) => e.stopPropagation()} style="position:relative">
      <button
        type="button"
        class="sl-iconbtn"
        onclick={() => showAssignPopover = !showAssignPopover}
      >⊕{#if assignedRoundIds.length > 0}<span class="badge">{assignedRoundIds.length}</span>{/if}</button>
      {#if showAssignPopover}
        <AssignPopover
          songTitle={localSong.title}
          assignedRoundIds={assignedRoundIds}
          onAssign={async (roundId) => {
            await fetch(`/api/chat/songs/${localSong.id}/assign`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ round_id: roundId }),
            });
            localSong = { ...localSong, assignedRoundIds: [...assignedRoundIds, roundId] };
          }}
          onUnassign={async (roundId) => {
            await fetch(`/api/chat/songs/${localSong.id}/assign/${roundId}`, { method: 'DELETE' });
            localSong = { ...localSong, assignedRoundIds: assignedRoundIds.filter(id => id !== roundId) };
          }}
          onclose={() => showAssignPopover = false}
        />
      {/if}
    </span>
  </button>
{/if}
```

- [ ] **Step 2: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "Error" | head -10
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/chat/CwRow.svelte
git commit -m "feat(chat): add CwRow component (collapsed + expanded with pull-quote)"
```

---

## Task 13: Page route

**Files:**
- Create: `ui/src/routes/chat/+page.server.ts`
- Create: `ui/src/routes/chat/+page.svelte`

- [ ] **Step 1: Create the server loader**

Create `ui/src/routes/chat/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { getChatSongs, getDistinctChatNames, getUnassignedNotDismissedCount } from '$lib/chat/chat.js';

export const load: PageServerLoad = async ({ url }) => {
  const db = getDb();
  const status = (url.searchParams.get('status') as 'all' | 'unassigned' | 'assigned') || 'all';
  const chatName = url.searchParams.get('chat') ?? undefined;
  const sort = (url.searchParams.get('sort') as 'recent' | 'mentioned') || 'recent';

  const songs = getChatSongs(db, {
    status: status === 'all' ? undefined : status,
    chatName,
    sort,
  });
  const allSongs = getChatSongs(db);
  const chatNames = getDistinctChatNames(db);
  const unassignedCount = getUnassignedNotDismissedCount(db);

  return {
    songs,
    chatNames,
    unassignedCount,
    assignedCount: allSongs.filter(s => s.assignedRoundIds.length > 0).length,
    totalCount: allSongs.length,
    status,
    chatName: chatName ?? null,
    sort,
  };
};
```

- [ ] **Step 2: Create the page**

Create `ui/src/routes/chat/+page.svelte`:

```svelte
<script lang="ts">
  import '$lib/chat/chat.css';
  import CwFilterBar from '$lib/chat/CwFilterBar.svelte';
  import CwRow from '$lib/chat/CwRow.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import type { PageData } from './$types.js';
  import type { ChatSong } from '$lib/chat/chat.js';

  const { data } = $props<{ data: PageData }>();

  let songs = $state<ChatSong[]>(data.songs);
  let openId = $state<string | null>(null);

  function updateParams(patch: Record<string, string | null>) {
    const params = new URLSearchParams($page.url.searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === 'all' || v === 'recent') params.delete(k);
      else params.set(k, v);
    }
    goto(`?${params.toString()}`, { replaceState: true, keepFocus: true });
  }

  function handleUpdated(patch: Partial<ChatSong> & { id: string }) {
    songs = songs.map(s => s.id === patch.id ? { ...s, ...patch } : s);
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'Escape') openId = null;
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="cw-main">
  <header class="mb-6">
    <p class="font-mono text-xs text-fg-dim mb-1">music-league-bot · /chat</p>
    <h1 class="font-display text-3xl font-bold text-fg">Chat watcher</h1>
    <p class="text-fg-muted text-sm mt-1">Songs that came up in your WhatsApp chats. Rate, assign, or shortlist.</p>
  </header>

  <CwFilterBar
    total={data.totalCount}
    unassignedCount={data.unassignedCount}
    assignedCount={data.assignedCount}
    chatNames={data.chatNames}
    status={data.status}
    activeChatName={data.chatName}
    sort={data.sort}
    onStatusChange={(s) => updateParams({ status: s })}
    onChatChange={(n) => updateParams({ chat: n })}
    onSortChange={(s) => updateParams({ sort: s })}
  />

  <div class="sl-rows mt-4">
    {#each songs as song (song.id)}
      <CwRow
        {song}
        open={openId === song.id}
        ontoggle={() => openId = openId === song.id ? null : song.id}
        onupdated={handleUpdated}
      />
    {/each}
    {#if songs.length === 0}
      <p class="font-mono text-sm text-fg-faint italic mt-8 text-center">
        No songs yet — they appear here when group members share music links in chat.
      </p>
    {/if}
  </div>
</div>
```

- [ ] **Step 3: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "Error" | head -10
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add ui/src/routes/chat/
git commit -m "feat(chat): add /chat page route + server loader"
```

---

## Task 14: Sidebar nav update

**Files:**
- Modify: `ui/src/routes/+layout.svelte`
- Modify: `ui/src/routes/+layout.server.ts`

- [ ] **Step 1: Add chatCount to layout server load**

Open `ui/src/routes/+layout.server.ts`. Add the import and return value:

```ts
import { getUnassignedNotDismissedCount } from '$lib/chat/chat.js';
```

In the `load` function, add to the return object:
```ts
chatUnassignedCount: getUnassignedNotDismissedCount(db),
```

- [ ] **Step 2: Add Chat watcher nav entry**

Open `ui/src/routes/+layout.svelte`. Find the `navItems` array and add the Chat watcher entry after the Shortlist entry:

```ts
{ href: '/chat', label: 'Chat watcher', glyph: '▸', count: String(data.chatUnassignedCount || '') },
```

Also update the `PageData` type import if needed to include `chatUnassignedCount: number`.

- [ ] **Step 3: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "Error" | head -10
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add ui/src/routes/+layout.svelte ui/src/routes/+layout.server.ts
git commit -m "feat(chat): add Chat watcher to sidebar nav with unassigned count badge"
```

---

## Task 15: Final check

- [ ] **Step 1: Run full type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "^(Error|Warning)"
```
Expected: zero errors.

- [ ] **Step 2: Run all tests**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx vitest run
```
Expected: all tests PASS including new chat DB tests.

- [ ] **Step 3: Run bot type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 4: Visual reference check**

Open `docs/chatmention-proto/Mash Co. Design System (1)/chat-watcher-handoff/reference/Music League Bot - Chat Watcher.html` in a browser. Start the dev server (`cd ui && npm run dev`) and navigate to `http://localhost:5173/chat`. Compare:

- [ ] Collapsed rows: art / title+artist / chat chip(s) / intent chip / mention count (if >1) / time / assigned chip / bookmark / assign
- [ ] Expanded card: pull-quote with priors stacked above, quote in italic Bricolage with decorative `"`, attribution row with avatar + sender name + chat chip + time + intent chip + spotify badge
- [ ] Multi-mention song shows `.cw-timeline` strip
- [ ] AssignPopover: search input + league pills + scrollable list
- [ ] Filter bar: status pills + chat pills + sort; URL params update on click
- [ ] Sidebar nav shows "Chat watcher" with count badge
- [ ] Esc collapses open row
- [ ] No console errors

- [ ] **Step 5: Final commit**

```bash
git add -p
git commit -m "feat(chat): chat watcher complete — all definition-of-done items verified"
```
