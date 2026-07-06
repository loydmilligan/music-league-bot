import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';

const db = openLeagueDb(':memory:');

vi.mock('$lib/db/client.js', async (orig) => {
  const actual = await orig<typeof import('$lib/db/client.js')>();
  return { ...actual, getDb: () => db };
});

let load: typeof import('./+page.server.js').load;

interface HistoryRound {
  id: number;
  messageCount: number;
  lastTs: string | null;
  snippet: string | null;
}

beforeEach(async () => {
  db.pragma('foreign_keys = OFF');
  for (const table of [
    'chat_messages',
    'chat_assignments',
    'chat_mentions',
    'chat_songs',
    'rounds',
    'seasons',
    'leagues',
    'settings',
  ]) {
    try {
      db.prepare(`DELETE FROM ${table}`).run();
    } catch {
      // Table may not exist yet in this schema variant.
    }
  }
  db.pragma('foreign_keys = ON');

  db.exec(`
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
  `);

  ({ load } = await import('./+page.server.js'));
});

function mkEvent() {
  return {
    url: new URL('http://localhost/chat'),
  } as Parameters<typeof load>[0];
}

describe('chat page loader', () => {
  it('keeps zero-message rounds in history so season counts reflect all rounds', async () => {
    db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1, 'test-league', 'Test League')`).run();
    db.prepare(
      `INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 3, 'active')`,
    ).run();
    db.prepare(
      `INSERT INTO rounds (
        id, season_id, ml_round_id, name, created_at, submission_deadline, voting_deadline
      ) VALUES
        (101, 1, 'ml-r1', 'Round 1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-07T00:00:00Z'),
        (102, 1, 'ml-r2', 'Round 2', '2026-01-08T00:00:00Z', '2026-01-08T00:00:00Z', '2026-01-14T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('chat_league_group_map', '{"test-league":"Test Group"}')`,
    ).run();
    db.prepare(
      `INSERT INTO chat_messages (id, platform, group_name, sender, text, ts)
       VALUES ('m1', 'whatsapp', 'Test Group', 'Matt', 'hello round one', '2026-01-03T12:00:00Z')`,
    ).run();

    const data = await load(mkEvent()) as { historyRounds: HistoryRound[] };

    expect(data.historyRounds).toHaveLength(2);
    expect(data.historyRounds.map((round: HistoryRound) => round.id)).toEqual([102, 101]);
    expect(data.historyRounds[0]).toMatchObject({
      id: 102,
      messageCount: 0,
      lastTs: null,
      snippet: null,
    });
    expect(data.historyRounds[1]).toMatchObject({
      id: 101,
      messageCount: 1,
      lastTs: '2026-01-03T12:00:00Z',
      snippet: 'Matt: hello round one',
    });
  });
});
