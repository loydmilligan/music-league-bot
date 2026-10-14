import Database from 'better-sqlite3';
import { resolve } from 'node:path';

// Emoji reactions, recorded by the bot's own WhatsApp Web session.
//
// The GroupRelay phone only ever sees reactions to ITS OWN messages (that is
// all WhatsApp notifies about), and chat exports drop reactions entirely. The
// bot's session is a member of the league groups and receives every
// `message_reaction` event, so it is the only source for "who 😂'd whom".
//
// wa_messages is a slim index of messages the bot has seen (id → author/text),
// so a reaction can be credited to the person who wrote the message.
// chat_reactions holds one row per (message, reactor): WhatsApp allows one
// reaction per person per message, a change replaces it, an empty reaction
// removes it.

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(resolve(process.env.DATA_DIR ?? 'data', 'league.db'));
  _db.pragma('journal_mode = WAL');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS wa_messages (
      msg_id      TEXT PRIMARY KEY,
      chat_id     TEXT NOT NULL,
      chat_name   TEXT,
      author_id   TEXT,
      author_name TEXT,
      snippet     TEXT,
      ts          TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wa_messages_author ON wa_messages(author_id, ts);
    CREATE TABLE IF NOT EXISTS chat_reactions (
      target_msg_id      TEXT NOT NULL,
      reactor_id         TEXT NOT NULL,
      chat_id            TEXT NOT NULL,
      group_name         TEXT,
      reaction           TEXT NOT NULL,
      reactor_name       TEXT,
      target_author_id   TEXT,
      target_author_name TEXT,
      target_snippet     TEXT,
      ts                 TEXT NOT NULL,
      removed            INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (target_msg_id, reactor_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_reactions_group_ts ON chat_reactions(group_name, ts);
  `);
  return _db;
}

export interface SeenMessage {
  msgId: string;
  chatId: string;
  chatName: string | null;
  authorId: string | null;
  authorName: string | null;
  text: string;
  ts: string;
}

/** Index a message the bot saw, and fill in names on reactions that predate it. */
export function recordSeenMessage(m: SeenMessage): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO wa_messages (msg_id, chat_id, chat_name, author_id, author_name, snippet, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(msg_id) DO NOTHING`,
  ).run(m.msgId, m.chatId, m.chatName, m.authorId, m.authorName, m.text.slice(0, 200), m.ts);
  if (m.authorId && m.authorName) {
    db.prepare(`UPDATE chat_reactions SET reactor_name = ? WHERE reactor_id = ? AND reactor_name IS NULL`).run(
      m.authorName,
      m.authorId,
    );
    db.prepare(
      `UPDATE chat_reactions SET target_author_name = ? WHERE target_author_id = ? AND target_author_name IS NULL`,
    ).run(m.authorName, m.authorId);
  }
}

export interface SeenReaction {
  targetMsgId: string;
  chatId: string;
  reactorId: string;
  reaction: string; // '' = removed
  ts: string;
}

export function recordReaction(r: SeenReaction): void {
  const db = getDb();
  if (!r.reaction) {
    db.prepare(`UPDATE chat_reactions SET removed = 1, ts = ? WHERE target_msg_id = ? AND reactor_id = ?`).run(
      r.ts,
      r.targetMsgId,
      r.reactorId,
    );
    return;
  }
  const target = db
    .prepare(`SELECT chat_name, author_id, author_name, snippet FROM wa_messages WHERE msg_id = ?`)
    .get(r.targetMsgId) as
    | { chat_name: string | null; author_id: string | null; author_name: string | null; snippet: string | null }
    | undefined;
  const chatName =
    target?.chat_name ??
    ((db.prepare(`SELECT chat_name FROM wa_messages WHERE chat_id = ? AND chat_name IS NOT NULL ORDER BY ts DESC LIMIT 1`).get(r.chatId) as
      | { chat_name: string }
      | undefined)?.chat_name ?? null);
  const reactorName =
    (db.prepare(`SELECT author_name FROM wa_messages WHERE author_id = ? AND author_name IS NOT NULL ORDER BY ts DESC LIMIT 1`).get(r.reactorId) as
      | { author_name: string }
      | undefined)?.author_name ?? null;
  db.prepare(
    `INSERT INTO chat_reactions
       (target_msg_id, reactor_id, chat_id, group_name, reaction, reactor_name,
        target_author_id, target_author_name, target_snippet, ts, removed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(target_msg_id, reactor_id) DO UPDATE SET
       reaction = excluded.reaction, ts = excluded.ts, removed = 0,
       group_name = COALESCE(excluded.group_name, chat_reactions.group_name),
       reactor_name = COALESCE(excluded.reactor_name, chat_reactions.reactor_name)`,
  ).run(
    r.targetMsgId,
    r.reactorId,
    r.chatId,
    chatName,
    r.reaction,
    reactorName,
    target?.author_id ?? null,
    target?.author_name ?? null,
    target?.snippet ?? null,
    r.ts,
  );
}
