import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { roundChatWindow, getRoundMessages, dedupeRelayEdits } from '$lib/chat/historyQuery.js';
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

// ── lifecycle-anchored window ─────────────────────────────────────────────────
//
// `rounds.created_at` is the row's insert time, so a league re-import rewrites it
// for every round at once. On 2026-09-10 that put all ten Boarz rounds within
// 8ms of each other and collapsed every chat window onto the same ±2-day buffer
// around that instant — R150's digest saw the last two days of the group and
// nothing of its own week. The window is anchored on the round lifecycle instead.
function seedLifecycle(db: Database.Database) {
  db.exec(CHAT_MSGS_DDL);
  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1, 'test-league', 'Test League')`).run();
  db.prepare(`INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')`).run();
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('chat_league_group_map', '{"test-league":"TestGroup"}')`,
  ).run();
  // Both rounds imported in the same instant, as a re-import leaves them, and in
  // the WRONG chronological order to prove created_at is not used for ordering.
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at, round_started_at, voting_deadline, voting_ended_at)
     VALUES (1, 1, 'r1', 'Round 1', '2026-09-10T04:03:18.338Z', '2026-06-01T00:00:00Z', '2026-06-08T00:00:00Z', '2026-06-08T01:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at, round_started_at, voting_deadline, voting_ended_at)
     VALUES (2, 1, 'r2', 'Round 2', '2026-09-10T04:03:18.330Z', '2026-06-08T01:00:00Z', '2026-06-15T00:00:00Z', NULL)`,
  ).run();
  // One message in each round's week; both fall inside the collapsed created_at
  // ±2-day window, so a window that still used created_at would return both.
  db.prepare(
    `INSERT INTO chat_messages (id, platform, group_name, sender, text, ts)
     VALUES ('w1', 'whatsapp', 'TestGroup', 'Alice', 'round one week', '2026-06-03T10:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO chat_messages (id, platform, group_name, sender, text, ts)
     VALUES ('w2', 'whatsapp', 'TestGroup', 'Bob', 'round two week', '2026-06-10T10:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO chat_messages (id, platform, group_name, sender, text, ts)
     VALUES ('w3', 'whatsapp', 'TestGroup', 'Carol', 're-import instant', '2026-09-10T04:03:18.000Z')`,
  ).run();
}

describe('roundChatWindow (lifecycle-anchored)', () => {
  it('runs from round start to voting end, ignoring a re-import created_at', () => {
    seedLifecycle(db);
    const w = roundChatWindow(db, 1);
    expect(w.fromIso).toBe('2026-06-01T00:00:00Z');
    expect(w.toIso).toBe('2026-06-08T01:00:00Z');
  });

  it("starts the next round's window where the previous round ended (no gap, no overlap)", () => {
    seedLifecycle(db);
    const prev = roundChatWindow(db, 1);
    const w = roundChatWindow(db, 2);
    expect(w.fromIso).toBe(prev.toIso);
    // voting_ended_at is NULL for an open round, so the deadline bounds it.
    expect(w.toIso).toBe('2026-06-15T00:00:00Z');
  });

  it('does not apply the buffer to a lifecycle window (it is already gapless)', () => {
    seedLifecycle(db);
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('chat_round_boundary', 'buffer')`).run();
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('chat_buffer_days', '2')`).run();
    const w = roundChatWindow(db, 1);
    expect(w.fromIso).toBe('2026-06-01T00:00:00Z');
    expect(w.toIso).toBe('2026-06-08T01:00:00Z');
  });

  it("fetches each round's own week rather than the re-import instant", () => {
    seedLifecycle(db);
    const w1 = roundChatWindow(db, 1);
    const w2 = roundChatWindow(db, 2);
    expect(getRoundMessages(db, w1.groupName, w1.fromIso, w1.toIso).map((m) => m.id)).toEqual(['w1']);
    expect(getRoundMessages(db, w2.groupName, w2.fromIso, w2.toIso).map((m) => m.id)).toEqual(['w2']);
  });
});

describe('dedupeRelayEdits', () => {
  const msg = (sender: string, text: string) => ({ sender, text });

  it('collapses a typo correction the relay recorded as a new message', () => {
    const out = dedupeRelayEdits([
      msg('Jon', "yes, but she's actually a lot smart than Sugar"),
      msg('Jon', "yes, but she's actually a lot smarter than Sugar"),
    ]);
    // The correction wins, so the digest never quotes the typo'd version.
    expect(out).toEqual([msg('Jon', "yes, but she's actually a lot smarter than Sugar")]);
  });

  it('collapses an exact double-send', () => {
    const out = dedupeRelayEdits([
      msg('Conor', 'Next time you show up uninvited to Reno, explain your unc strategies'),
      msg('Conor', 'Next time you show up uninvited to Reno, explain your unc strategies'),
    ]);
    expect(out.length).toBe(1);
  });

  it('keeps two short messages that merely look alike', () => {
    // "Me ?" and "Umm" are 2 edits apart but are not the same message; the
    // 20-character floor is what keeps real back-and-forth intact.
    const out = dedupeRelayEdits([msg('Grant', 'Me ?'), msg('Grant', 'Umm')]);
    expect(out.length).toBe(2);
  });

  it('keeps a near-identical message from a different sender', () => {
    const out = dedupeRelayEdits([
      msg('Jon', 'Not sure that this song is moshable at all'),
      msg('Shane', 'Not sure that this song is moshable at all'),
    ]);
    expect(out.length).toBe(2);
  });

  it('keeps two genuinely different long messages from the same sender', () => {
    const out = dedupeRelayEdits([
      msg('Shane', 'Next let us do movie league where we watch 25 hours of movies'),
      msg('Shane', 'I get so much delta eta spam these days I do not even notice'),
    ]);
    expect(out.length).toBe(2);
  });
});
