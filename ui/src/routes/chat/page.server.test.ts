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
  isLive: boolean;
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

/**
 * Season 3 of a single league:
 *   101 — has chat, finished              → shown
 *   102 — no chat, finished               → hidden (historical noise)
 *   103 — no chat, still running (isLive) → shown (a live gap is a signal)
 */
function seedSeason() {
  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1, 'test-league', 'Test League')`).run();
  db.prepare(
    `INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 3, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO rounds (
      id, season_id, ml_round_id, name, created_at, submission_deadline, voting_deadline
    ) VALUES
      (101, 1, 'ml-r1', 'Round 1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-07T00:00:00Z'),
      (102, 1, 'ml-r2', 'Round 2', '2026-01-08T00:00:00Z', '2026-01-08T00:00:00Z', '2026-01-14T00:00:00Z'),
      (103, 1, 'ml-r3', 'Round 3', '2026-01-15T00:00:00Z', '2026-01-15T00:00:00Z', NULL)`,
  ).run();
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('chat_league_group_map', '{"test-league":"Test Group"}')`,
  ).run();
  db.prepare(
    `INSERT INTO chat_messages (id, platform, group_name, sender, text, ts)
     VALUES ('m1', 'whatsapp', 'Test Group', 'Matt', 'hello round one', '2026-01-03T12:00:00Z')`,
  ).run();
}

describe('chat page loader', () => {
  it('hides finished rounds that captured no chat', async () => {
    seedSeason();
    const data = (await load(mkEvent())) as { historyRounds: HistoryRound[] };

    // 102 finished with nothing captured — noise, and nothing to act on.
    expect(data.historyRounds.map((r) => r.id)).not.toContain(102);
    expect(data.historyRounds.find((r) => r.id === 101)).toMatchObject({
      messageCount: 1,
      snippet: 'Matt: hello round one',
    });
  });

  it('keeps a live round with zero messages so a broken capture is visible', async () => {
    seedSeason();
    const data = (await load(mkEvent())) as { historyRounds: HistoryRound[] };

    // A live round with no chat means capture may be broken (bad group mapping,
    // relay down, wrong window). Dropping it hides the league entirely and the
    // failure reads as "nothing is wrong" — the boarz-ii-men bug.
    const live = data.historyRounds.find((r) => r.id === 103);
    expect(live).toBeDefined();
    expect(live).toMatchObject({ messageCount: 0, isLive: true });
  });

  it('reports true season totals, not the filtered count', async () => {
    seedSeason();
    const data = (await load(mkEvent())) as {
      historyRounds: HistoryRound[];
      seasonTotals: Record<string, number>;
    };

    // Two of three rounds render, but the season really has three.
    expect(data.historyRounds).toHaveLength(2);
    expect(data.seasonTotals['Test Group::3']).toBe(3);
  });

  it('newest round first', async () => {
    seedSeason();
    const data = (await load(mkEvent())) as { historyRounds: HistoryRound[] };
    expect(data.historyRounds.map((r) => r.id)).toEqual([103, 101]);
  });
});
