import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { roundChatWindow, getRoundMessages } from '$lib/chat/historyQuery.js';
import { activeKindsForDraft } from '$lib/digest/llm.js';
import type { RoundData } from '$lib/digest/llm.js';

const CHAT_MSGS_DDL = `
  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    group_name TEXT NOT NULL,
    group_key TEXT,
    sender TEXT NOT NULL,
    text TEXT NOT NULL,
    ts TEXT NOT NULL,
    msg_hash TEXT
  );
`;

function seed(db: Database.Database) {
  db.exec(CHAT_MSGS_DDL);

  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1, 'test-league', 'Test League')`).run();
  db.prepare(
    `INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at)
     VALUES (1, 1, 'r1', 'Round 1', '2026-06-01T00:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at)
     VALUES (2, 1, 'r2', 'Round 2', '2026-06-08T00:00:00Z')`,
  ).run();

  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('chat_league_group_map', '{"test-league":"TestGroup"}')`,
  ).run();

  // 2 in-window messages, 1 out-of-window (after round 2 start)
  db.prepare(
    `INSERT INTO chat_messages (id, platform, group_name, sender, text, ts)
     VALUES ('m1', 'whatsapp', 'TestGroup', 'Alice', 'in-window msg 1', '2026-06-02T10:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO chat_messages (id, platform, group_name, sender, text, ts)
     VALUES ('m2', 'whatsapp', 'TestGroup', 'Bob', 'in-window msg 2', '2026-06-05T10:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO chat_messages (id, platform, group_name, sender, text, ts)
     VALUES ('m3', 'whatsapp', 'TestGroup', 'Carol', 'out of window', '2026-06-09T10:00:00Z')`,
  ).run();
}

let db: Database.Database;
beforeEach(() => {
  db = openLeagueDb(':memory:');
});

describe('roundChatWindow', () => {
  it('returns the mapped group and correct ISO bounds for a round with a next round', () => {
    seed(db);
    const w = roundChatWindow(db, 1);
    expect(w.groupName).toBe('TestGroup');
    expect(w.fromIso).toBe('2026-06-01T00:00:00Z');
    expect(w.toIso).toBe('2026-06-08T00:00:00Z');
  });

  it('returns now as toIso when there is no next round (last round in season)', () => {
    seed(db);
    const before = new Date();
    const w = roundChatWindow(db, 2);
    const after = new Date();
    expect(w.groupName).toBe('TestGroup');
    expect(w.fromIso).toBe('2026-06-08T00:00:00Z');
    // toIso should be "now" — somewhere between before and after
    expect(new Date(w.toIso).getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(new Date(w.toIso).getTime()).toBeLessThanOrEqual(after.getTime() + 100);
  });

  it('returns empty strings when the round does not exist', () => {
    seed(db);
    const w = roundChatWindow(db, 999);
    expect(w).toEqual({ groupName: '', fromIso: '', toIso: '' });
  });

  it('returns empty groupName when no league group mapping exists', () => {
    seed(db);
    db.prepare(`DELETE FROM settings WHERE key='chat_league_group_map'`).run();
    const w = roundChatWindow(db, 1);
    expect(w.groupName).toBe('');
    expect(w.fromIso).toBe('2026-06-01T00:00:00Z');
    expect(w.toIso).toBe('2026-06-08T00:00:00Z');
  });

  it('widens the window by bufferDays when roundBoundary is buffer', () => {
    seed(db);
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('chat_round_boundary', 'buffer')`).run();
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('chat_buffer_days', '1')`).run();
    const w = roundChatWindow(db, 1);
    // from should be 1 day before 2026-06-01 = 2026-05-31T00:00:00Z
    expect(w.fromIso).toBe('2026-05-31T00:00:00.000Z');
    // to should be 1 day after 2026-06-08 = 2026-06-09T00:00:00Z
    expect(w.toIso).toBe('2026-06-09T00:00:00.000Z');
  });
});

describe('getRoundMessages over roundChatWindow', () => {
  it('returns only in-window messages (strict boundary)', () => {
    seed(db);
    const w = roundChatWindow(db, 1);
    expect(w.groupName).toBe('TestGroup');
    const msgs = getRoundMessages(db, w.groupName, w.fromIso, w.toIso);
    expect(msgs.length).toBe(2);
    expect(msgs.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('message fields match ChatMessage interface', () => {
    seed(db);
    const w = roundChatWindow(db, 1);
    const msgs = getRoundMessages(db, w.groupName, w.fromIso, w.toIso);
    const m = msgs[0];
    expect(m.id).toBe('m1');
    expect(m.sender).toBe('Alice');
    expect(m.text).toBe('in-window msg 1');
    expect(m.ts).toBe('2026-06-02T10:00:00Z');
    expect(m.group_name).toBe('TestGroup');
  });
});

// Minimal RoundData stub — only the fields activeKindsForDraft reads.
function makeRoundData(overrides: Partial<RoundData> = {}): RoundData {
  return {
    round: { id: 1, name: 'Round 1', description: null },
    league: { id: 1, name: 'Test League' },
    roundSequence: { number: 1, total: 1 },
    priorRounds: [],
    bundle: [],
    submissions: [],
    votes: [],
    chatMentions: [],
    relContext: '',
    chatHistory: undefined,
    ...overrides,
  } as RoundData;
}

describe('activeKindsForDraft — chat section inclusion gate', () => {
  it('includes "chat" when chatHistory is present and no pasted chat or chatMentions', () => {
    const data = makeRoundData({ chatHistory: 'Alice: great track!' });
    const kinds = activeKindsForDraft(data);
    expect(kinds).toContain('chat');
  });

  it('excludes "chat" when chatHistory is undefined, chatMentions is empty, and no pastedChat', () => {
    const data = makeRoundData({ chatHistory: undefined });
    const kinds = activeKindsForDraft(data);
    expect(kinds).not.toContain('chat');
  });

  it('excludes "chat" when chatHistory is an empty/whitespace string', () => {
    const data = makeRoundData({ chatHistory: '   ' });
    const kinds = activeKindsForDraft(data);
    expect(kinds).not.toContain('chat');
  });

  it('includes "chat" when only chatMentions are present (pre-existing behavior)', () => {
    const data = makeRoundData({
      chatMentions: [{ sender: 'Bob', raw_message: 'nice', captured_at: '2026-06-01T00:00:00Z' }],
    });
    const kinds = activeKindsForDraft(data);
    expect(kinds).toContain('chat');
  });

  it('includes "chat" when only pastedChat is provided (pre-existing behavior)', () => {
    const data = makeRoundData();
    const kinds = activeKindsForDraft(data, { sections: [], pastedChat: 'pasted content' });
    expect(kinds).toContain('chat');
  });
});
