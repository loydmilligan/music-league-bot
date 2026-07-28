import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;
  const path = resolve(process.env.DATA_DIR ?? 'data', 'league.db');
  _db = new Database(path);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id           TEXT PRIMARY KEY,
      platform     TEXT NOT NULL,
      group_name   TEXT NOT NULL,
      group_key    TEXT,
      sender       TEXT NOT NULL,
      -- Stable per-person handle from the relay (phone number / account id).
      -- The display name in the sender column depends on the RELAY PHONE's
      -- contact list, so one person reads as 'Tj Cook' on one device and
      -- '~ Tj' on another, and two people sharing a profile name collapse
      -- into one label. The handle does not move, so identity stays exact.
      sender_handle TEXT,
      text         TEXT NOT NULL,
      ts           TEXT NOT NULL,
      msg_hash     TEXT NOT NULL,
      captured_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_msg_hash    ON chat_messages(msg_hash);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_msg_natural ON chat_messages(group_name, sender, ts, text);
    CREATE INDEX IF NOT EXISTS idx_chat_msg_group_ts  ON chat_messages(group_name, ts);
    CREATE INDEX IF NOT EXISTS idx_chat_msg_platform  ON chat_messages(platform);
  `);
  return _db;
}

// Hash formula matches GroupRelay's brief: source_type|platform|conversation|party|timestamp|text
function msgHash(sourceType: string, platform: string, conversation: string, party: string, tsMs: number, text: string): string {
  return createHash('sha256')
    .update(`${sourceType}|${platform}|${conversation}|${party}|${tsMs}|${text}`)
    .digest('hex');
}

// ── types ─────────────────────────────────────────────────────────────────────

// GroupRelay CaptureBatch format (from grouprelay-android-build-brief.md §12)
export interface CaptureEventPayload {
  platform?: string;
  package_name?: string;
  event_type?: string;
  direction?: string;
  conversation?: string;
  conversation_key?: string;
  party?: string;
  party_handle?: string | null;
  text?: string | null;
  timestamp?: number;
  duration_ms?: number | null;
}

export interface CaptureBatch {
  source_type?: string;
  device_id?: string;
  sent_at?: number;
  events?: CaptureEventPayload[];
}

// Keep the old shape as RelayPayload for backward compat with any direct callers
export type RelayPayload = CaptureBatch;

export interface ChatMessage {
  id: string;
  platform: string;
  group_name: string;
  group_key: string | null;
  sender: string;
  text: string;
  ts: string;
  msg_hash: string;
  captured_at: string;
}

// ── ingest ─────────────────────────────────────────────────────────────────────

const WHATSAPP_PKG = 'com.whatsapp';
const GOOGLECHAT_PKG = 'com.google.android.apps.dynamite';

function pkgToPlatform(pkg: string): string {
  if (pkg === WHATSAPP_PKG) return 'whatsapp';
  if (pkg === GOOGLECHAT_PKG) return 'googlechat';
  return pkg;
}

export function ingestRelayPayload(payload: RelayPayload): { inserted: number; skipped: number } {
  const sourceType = payload.source_type ?? 'unknown';
  if (sourceType === 'test') return { inserted: 0, skipped: 0 };

  const db = getDb();
  const events = (payload.events ?? []).filter(e => e.event_type === 'message');
  if (events.length === 0) return { inserted: 0, skipped: 0 };

  // Additive migration: older databases predate sender_handle.
  const hasHandle = (db.prepare('PRAGMA table_info(chat_messages)').all() as { name: string }[])
    .some((c) => c.name === 'sender_handle');
  if (!hasHandle) db.exec('ALTER TABLE chat_messages ADD COLUMN sender_handle TEXT');

  const insert = db.prepare(`
    INSERT OR IGNORE INTO chat_messages (id, platform, group_name, group_key, sender, sender_handle, text, ts, msg_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0, skipped = 0;

  const debug = !!process.env.RELAY_DEBUG;

  const run = db.transaction(() => {
    for (const e of events) {
      const text = (e.text ?? '').trim();
      if (!text) {
        if (debug) console.log('[chat-relay:ingest] skip — empty text', e);
        continue;
      }
      const platform = pkgToPlatform(e.package_name ?? e.platform ?? '');
      const groupName = (e.conversation ?? '').trim() || 'Unknown Group';
      const groupKey = e.conversation_key ?? null;
      const sender = (e.party ?? 'Unknown').trim();
      const tsMs = e.timestamp ?? Date.now();
      const tsIso = new Date(tsMs).toISOString();
      const hash = msgHash(sourceType, platform, groupName, sender, tsMs, text);

      // party_handle is the relay's stable id for the person; it arrived on
      // every event and used to be discarded, which is why identity had to be
      // reverse-engineered from display names.
      const senderHandle = (e.party_handle ?? '').trim() || null;
      const result = insert.run(randomUUID(), platform, groupName, groupKey, sender, senderHandle, text, tsIso, hash);
      if (result.changes > 0) {
        if (debug) console.log(`[chat-relay:ingest] INSERT  ${platform}/${groupName}/${sender}: "${text.slice(0, 60)}"`);
        inserted++;
      } else {
        if (debug) console.log(`[chat-relay:ingest] SKIPPED ${platform}/${groupName}/${sender}: "${text.slice(0, 60)}"`);
        skipped++;
      }
    }
  });

  run();
  return { inserted, skipped };
}

// Direct insert for Python scripts (backfill / Google Chat sync) writing into
// the same DB — exposed so the import script can call it via a small TS shim,
// but more typically the Python scripts write directly via sqlite3.
export function ingestMessage(opts: {
  platform: string;
  groupName: string;
  groupKey?: string | null;
  sender: string;
  text: string;
  tsMs: number;
}): boolean {
  const db = getDb();
  const { platform, groupName, groupKey = null, sender, text, tsMs } = opts;
  const tsIso = new Date(tsMs).toISOString();
  const hash = msgHash('import', platform, groupName, sender, tsMs, text);
  const result = db.prepare(`
    INSERT OR IGNORE INTO chat_messages (id, platform, group_name, group_key, sender, text, ts, msg_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), platform, groupName, groupKey, sender, text, tsIso, hash);
  return result.changes > 0;
}

// ── query ──────────────────────────────────────────────────────────────────────

export function listChatGroups(platform?: string): string[] {
  const db = getDb();
  const rows = platform
    ? db.prepare('SELECT DISTINCT group_name FROM chat_messages WHERE platform=? ORDER BY group_name').all(platform) as { group_name: string }[]
    : db.prepare('SELECT DISTINCT group_name FROM chat_messages ORDER BY group_name').all() as { group_name: string }[];
  return rows.map(r => r.group_name);
}

export function exportChatMessages(opts: {
  groupName: string;
  start: string;   // ISO8601
  end: string;     // ISO8601
  platform?: string;
}): ChatMessage[] {
  const db = getDb();
  const { groupName, start, end, platform } = opts;

  const rows = platform
    ? db.prepare(`
        SELECT * FROM chat_messages
        WHERE group_name = ? AND platform = ? AND ts >= ? AND ts <= ?
        ORDER BY ts ASC
      `).all(groupName, platform, start, end) as ChatMessage[]
    : db.prepare(`
        SELECT * FROM chat_messages
        WHERE group_name = ? AND ts >= ? AND ts <= ?
        ORDER BY ts ASC
      `).all(groupName, start, end) as ChatMessage[];

  return rows;
}

// Fetch messages for a league round by fuzzy-matching group name using word overlap.
// Used by mlb-run to get chat content directly from DB.
export function exportByLeagueName(opts: {
  leagueName: string;
  start: string;
  end: string;
  platform?: string;
}): { groupName: string; messages: ChatMessage[] } | null {
  const { leagueName, start, end, platform } = opts;

  const groups = listChatGroups(platform);
  if (groups.length === 0) return null;

  const words = leagueName.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  let bestGroup = '';
  let bestScore = 0;

  for (const g of groups) {
    const gl = g.toLowerCase();
    const score = words.filter(w => gl.includes(w)).length;
    if (score > bestScore) { bestScore = score; bestGroup = g; }
  }

  if (bestScore === 0) return null;

  const messages = exportChatMessages({ groupName: bestGroup, start, end, platform });
  return { groupName: bestGroup, messages };
}

export function formatAsWhatsAppText(messages: ChatMessage[]): string {
  return messages.map(m => {
    const dt = new Date(m.ts);
    const date = `${dt.getMonth() + 1}/${dt.getDate()}/${String(dt.getFullYear()).slice(-2)}`;
    const hours = dt.getHours();
    const mins = String(dt.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 || 12;
    return `${date}, ${h12}:${mins} ${ampm} - ${m.sender}: ${m.text}`;
  }).join('\n');
}
