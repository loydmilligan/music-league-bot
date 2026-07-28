/**
 * SQLite persistence for chat prompts and their answers.
 *
 * The only impure part of the prompt engine. Options and templates are stored as
 * JSON because they are opaque to this layer — a prompt asking about players and
 * one asking about album years are the same row shape.
 */
import type Database from 'better-sqlite3';
import type { ChatPrompt, PromptOption, PromptTemplates, Resolution } from './types.js';

export function createPromptTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_prompts (
      id          TEXT PRIMARY KEY,
      chat_id     TEXT NOT NULL,
      message_id  TEXT,
      hashtag     TEXT,
      subject     TEXT,
      options     TEXT NOT NULL,
      templates   TEXT NOT NULL,
      one_per_person INTEGER NOT NULL DEFAULT 1,
      accept_direct  INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'open',
      kind        TEXT,
      meta        TEXT,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_prompts_open ON chat_prompts(chat_id, status);

    CREATE TABLE IF NOT EXISTS chat_prompt_answers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_id    TEXT NOT NULL REFERENCES chat_prompts(id) ON DELETE CASCADE,
      author_id    TEXT NOT NULL,
      author_name  TEXT,
      answer_text  TEXT NOT NULL,
      resolution   TEXT NOT NULL,
      option_id    TEXT,
      trigger      TEXT NOT NULL,
      created_at   INTEGER NOT NULL
    );
    -- One RESOLVED answer per person per prompt. Unresolved attempts are still
    -- stored (they are how we learn which nicknames to add) but must not lock
    -- anyone out: a typo or an unknown name would otherwise burn their entry.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_answer_once
      ON chat_prompt_answers(prompt_id, author_id) WHERE resolution = 'matched';
  `);

  // Additive migrations for databases created before a column existed —
  // CREATE TABLE IF NOT EXISTS silently leaves an older table untouched.
  for (const ddl of [
    `ALTER TABLE chat_prompts ADD COLUMN accept_direct INTEGER NOT NULL DEFAULT 0`,
  ]) {
    try { db.exec(ddl); } catch { /* column already present */ }
  }

  // Replace the old unconditional uniqueness with the partial index above; an
  // earlier database has the version that locked out unresolved attempts.
  try {
    const idx = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_prompt_answer_once'`,
    ).get() as { sql?: string } | undefined;
    if (idx?.sql && !/WHERE/i.test(idx.sql)) {
      db.exec(`DROP INDEX idx_prompt_answer_once`);
      db.exec(
        `CREATE UNIQUE INDEX idx_prompt_answer_once
           ON chat_prompt_answers(prompt_id, author_id) WHERE resolution = 'matched'`,
      );
    }
  } catch { /* index shape already correct */ }
}

export interface NewPrompt {
  id: string;
  chatId: string;
  messageId?: string | null;
  hashtag?: string | null;
  subject?: string | null;
  options: PromptOption[];
  templates: PromptTemplates;
  onePerPerson?: boolean;
  /** Also accept answers sent privately to the bot. */
  acceptDirect?: boolean;
  /** Caller's own label, e.g. "guess-the-submitter". Opaque here. */
  kind?: string | null;
  /** Anything the caller needs on resolution (round id, spotify uri, …). */
  meta?: unknown;
}

export function insertPrompt(db: Database.Database, p: NewPrompt): void {
  db.prepare(`
    INSERT INTO chat_prompts
      (id, chat_id, message_id, hashtag, subject, options, templates,
       one_per_person, accept_direct, status, kind, meta, created_at)
    VALUES (@id, @chatId, @messageId, @hashtag, @subject, @options, @templates,
            @onePerPerson, @acceptDirect, 'open', @kind, @meta, @createdAt)
  `).run({
    id: p.id,
    chatId: p.chatId,
    messageId: p.messageId ?? null,
    hashtag: p.hashtag ?? null,
    subject: p.subject ?? null,
    options: JSON.stringify(p.options),
    templates: JSON.stringify(p.templates),
    onePerPerson: p.onePerPerson === false ? 0 : 1,
    acceptDirect: p.acceptDirect ? 1 : 0,
    kind: p.kind ?? null,
    meta: p.meta === undefined ? null : JSON.stringify(p.meta),
    createdAt: Date.now(),
  });
}

interface PromptRow {
  id: string; chat_id: string; message_id: string | null; hashtag: string | null;
  subject: string | null; options: string; templates: string;
  one_per_person: number; accept_direct: number; status: string;
}

/** Oldest first — the engine treats the last as the live one for a shared hashtag. */
export function getOpenPrompts(db: Database.Database, chatId: string): ChatPrompt[] {
  const rows = db.prepare(
    `SELECT * FROM chat_prompts WHERE chat_id = ? AND status = 'open' ORDER BY created_at ASC`,
  ).all(chatId) as PromptRow[];
  return rows.map(rowToPrompt);
}

function rowToPrompt(r: PromptRow): ChatPrompt {
  return {
    id: r.id,
    chatId: r.chat_id,
    messageId: r.message_id ?? undefined,
    hashtag: r.hashtag ?? undefined,
    subject: r.subject ?? undefined,
    options: JSON.parse(r.options) as PromptOption[],
    templates: JSON.parse(r.templates) as PromptTemplates,
    onePerPerson: r.one_per_person === 1,
    acceptDirect: r.accept_direct === 1,
    status: 'open',
  };
}

/**
 * Prompts accepting private answers, across every chat. A DM has no group id to
 * match on, so the engine is handed all of them and refuses if more than one
 * could be meant.
 */
export function getDirectPrompts(db: Database.Database): ChatPrompt[] {
  const rows = db.prepare(
    `SELECT * FROM chat_prompts WHERE status = 'open' AND accept_direct = 1 ORDER BY created_at ASC`,
  ).all() as PromptRow[];
  return rows.map(rowToPrompt);
}

export function hasAnswered(db: Database.Database, promptId: string, authorId: string): boolean {
  // Only a RESOLVED answer counts as having answered.
  const row = db.prepare(
    `SELECT 1 FROM chat_prompt_answers
      WHERE prompt_id = ? AND author_id = ? AND resolution = 'matched' LIMIT 1`,
  ).get(promptId, authorId);
  return row !== undefined;
}

export function recordAnswer(
  db: Database.Database,
  a: {
    promptId: string; authorId: string; authorName?: string;
    answerText: string; resolution: Resolution; trigger: string;
  },
): void {
  db.prepare(`
    INSERT OR IGNORE INTO chat_prompt_answers
      (prompt_id, author_id, author_name, answer_text, resolution, option_id, trigger, created_at)
    VALUES (@promptId, @authorId, @authorName, @answerText, @resolution, @optionId, @trigger, @createdAt)
  `).run({
    promptId: a.promptId,
    authorId: a.authorId,
    authorName: a.authorName ?? null,
    answerText: a.answerText,
    resolution: a.resolution.kind,
    optionId: a.resolution.kind === 'matched' ? a.resolution.option.id : null,
    trigger: a.trigger,
    createdAt: Date.now(),
  });
}

export function closePrompt(db: Database.Database, promptId: string): void {
  db.prepare(`UPDATE chat_prompts SET status = 'closed' WHERE id = ?`).run(promptId);
}

export interface StoredAnswer {
  authorId: string; authorName: string | null; answerText: string;
  resolution: string; optionId: string | null; trigger: string;
}

export function listAnswers(db: Database.Database, promptId: string): StoredAnswer[] {
  return db.prepare(`
    SELECT author_id AS authorId, author_name AS authorName, answer_text AS answerText,
           resolution, option_id AS optionId, trigger
    FROM chat_prompt_answers WHERE prompt_id = ? ORDER BY created_at ASC
  `).all(promptId) as StoredAnswer[];
}
