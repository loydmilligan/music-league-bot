# Guess Evidence Horizon (Project C1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the evidence horizon — the single server-side entry point that decides what the guessing workspace is allowed to see for a round — and close spec §14.6 so sync cannot contaminate a rehearsal.

**Architecture:** One new module, `ui/src/lib/guessing/horizon.ts`, exposing `roundEvidence(db, roundId, opts)`. The central insight, which makes §14.3 far simpler than it reads: **rehearsal is not a special case in the evidence layer.** The rules are identical for a live round and a rehearsed one — submission comments filtered to `visible_to_voters = 1`, the round's own votes hidden unconditionally, only strictly-prior rounds included, chat clamped to a cutoff. The only thing rehearsal changes is what "now" means. So `roundEvidence` reads `mode`/`asOf` from `guess_round_state` and sets `now = asOf ?? <wall clock>`; every rule below is then written once. A mode-branching implementation would be a defect, not an alternative.

**Tech Stack:** TypeScript, better-sqlite3, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-31-submitter-guessing-design.md` — §14.3 (the horizon and its trap), §14.5 (fetch skip), §14.6 (sync deferral), §5 (anonymity).

## Global Constraints

- **Anonymity (spec §5):** `horizon.ts` is **not** on the guard's allowlist and must never read `ml_submissions.competitor_id`. `scoring.test.ts` scans the directory and fails the build if it does. `visibleSubmissions` returns comments and titles, never submitter identity. Run `cd ui && npx vitest run src/lib/guessing/scoring.test.ts` after any change here.
- **The §14.3 trap:** clamping evidence by `timestamp < asOf` alone is WRONG. Every vote on the rehearsed round was cast *before* that round's own voting deadline, so a naive timestamp clamp leaks the whole round's votes. The round's own votes are excluded **unconditionally, by round id**, never by time.
- **Submission comments are always filtered to `visible_to_voters = 1`.** On Boarz R148/R149 only 5 of 10 were visible. Showing all ten makes a rehearsal easier than the real thing was and inflates the score.
- **Scoring is derived, never stored.** Nothing in this plan computes or persists correctness.
- **Schema split — read this before writing a fixture.** `ui/src/lib/db/schema.ts`'s `SCHEMA` constant is a *partial* view of the live database. `chat_messages`, `players`, `season_players` and `player_identities` exist in `data/league.db` but are created by the bot side (`src/`) and are absent from `SCHEMA`. `seedRound` only execs `SCHEMA`, so a test needing `chat_messages` must create the table itself (Task 1 does this). Do not "fix" this by adding those tables to `SCHEMA` — the UI does not own them.
- **Tests:** `cd ui && npx vitest run <path>`. The repo root has its own vitest config that excludes `ui/**` — running from the root reports "No test files found", which is not a pass.
- Existing suite is 54 tests across 7 files in `ui/src/lib/guessing/`. Report the new total; do not let it drop.

---

### Task 1: Fixture extensions — prior rounds, votes, and chat

**Files:**
- Modify: `ui/src/lib/guessing/fixtures.ts`
- Test: `ui/src/lib/guessing/fixtures.test.ts` (create)

**Interfaces:**
- Consumes: existing `seedRound` from `./fixtures.js`
- Produces:
  - `seedPriorRound(db, roundId, votingDeadline): void`
  - `seedVote(db, roundId, voterId, spotifyUri, comment, createdAt): void`
  - `seedChat(db, groupName, sender, text, ts): void` — creates `chat_messages` on first call
  - `CHAT_GROUP` constant, `'Boarz Test Group'`

`fixtures.ts` is on the anonymity allowlist, so it may reference identity columns.

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/guessing/fixtures.test.ts
import { describe, it, expect } from 'vitest';
import { seedRound, seedPriorRound, seedVote, seedChat, CHAT_GROUP } from './fixtures.js';

describe('fixture extensions', () => {
  it('seeds a prior round in the same season', () => {
    const { db } = seedRound();
    seedPriorRound(db, 2, '2025-12-01T00:00:00Z');
    const r = db.prepare('SELECT season_id AS s, voting_deadline AS d FROM rounds WHERE id = 2')
      .get() as { s: number; d: string };
    expect(r.s).toBe(1);
    expect(r.d).toBe('2025-12-01T00:00:00Z');
  });

  it('seeds votes with a voter and comment', () => {
    const { db, songs } = seedRound();
    seedVote(db, 1, 2, songs[1], 'sounds like steiny', '2026-01-01T12:00:00Z');
    const v = db.prepare('SELECT voter_id AS v, comment AS c FROM votes WHERE round_id = 1')
      .get() as { v: number; c: string };
    expect(v.v).toBe(2);
    expect(v.c).toBe('sounds like steiny');
  });

  it('creates chat_messages on demand — it is absent from the UI SCHEMA', () => {
    const { db } = seedRound();
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_messages'").get(),
    ).toBeFalsy();

    seedChat(db, CHAT_GROUP, 'Steiny', 'i never comment', '2026-01-01T09:00:00Z');

    const m = db.prepare('SELECT sender AS s, ts FROM chat_messages').get() as { s: string; ts: string };
    expect(m.s).toBe('Steiny');
    expect(m.ts).toBe('2026-01-01T09:00:00Z');
  });

  it('seedChat is idempotent about the table', () => {
    const { db } = seedRound();
    seedChat(db, CHAT_GROUP, 'A', 'one', '2026-01-01T09:00:00Z');
    seedChat(db, CHAT_GROUP, 'B', 'two', '2026-01-01T10:00:00Z');
    const n = db.prepare('SELECT COUNT(*) AS c FROM chat_messages').get() as { c: number };
    expect(n.c).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/guessing/fixtures.test.ts`
Expected: FAIL — `seedPriorRound` is not exported from `./fixtures.js`

- [ ] **Step 3: Append to fixtures.ts**

```ts
/** Chat group name used by the fixtures. Real code resolves this per league. */
export const CHAT_GROUP = 'Boarz Test Group';

/**
 * Add an earlier round to the same season. `seedRound` only creates round 1;
 * horizon tests need neighbours to prove the strictly-prior rule.
 */
export function seedPriorRound(
  db: Database.Database,
  roundId: number,
  votingDeadline: string | null,
): void {
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at, voting_deadline)
     VALUES (?, 1, ?, ?, '2026-01-01T00:00:00Z', ?)`,
  ).run(roundId, `ml-${roundId}`, `R${roundId}`, votingDeadline);
}

export function seedVote(
  db: Database.Database,
  roundId: number,
  voterId: number,
  spotifyUri: string,
  comment: string,
  createdAt: string,
): void {
  db.prepare(
    `INSERT INTO votes (round_id, voter_id, spotify_uri, points, comment, created_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run(roundId, voterId, spotifyUri, comment, createdAt);
}

/**
 * `chat_messages` lives in the live database but NOT in the UI's SCHEMA constant —
 * the bot side (src/) owns it. Tests therefore create it themselves. The DDL below
 * mirrors the live table's shape for the columns this project reads.
 */
export function seedChat(
  db: Database.Database,
  groupName: string,
  sender: string,
  text: string,
  ts: string,
): void {
  db.exec(`CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY, platform TEXT NOT NULL, group_name TEXT NOT NULL,
    group_key TEXT, sender TEXT NOT NULL, text TEXT NOT NULL, ts TEXT NOT NULL,
    msg_hash TEXT NOT NULL, captured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    sender_handle TEXT, source_path TEXT
  )`);
  const id = `${groupName}|${sender}|${ts}`;
  db.prepare(
    `INSERT OR IGNORE INTO chat_messages (id, platform, group_name, sender, text, ts, msg_hash, captured_at)
     VALUES (?, 'whatsapp', ?, ?, ?, ?, ?, '2026-01-01T00:00:00Z')`,
  ).run(id, groupName, sender, text, ts, id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/guessing/fixtures.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd /home/loydmilligan/Projects/music-league-bot
git add ui/src/lib/guessing/fixtures.ts ui/src/lib/guessing/fixtures.test.ts
git commit -m "test(guessing): fixture helpers for prior rounds, votes and chat"
```

---

### Task 2: Visible submissions — the comment filter

**Files:**
- Create: `ui/src/lib/guessing/horizon.ts`
- Test: `ui/src/lib/guessing/horizon.test.ts`

**Interfaces:**
- Consumes: `seedRound` from `./fixtures.js`
- Produces: `visibleSubmissions(db, roundId): VisibleSubmission[]` where
  `VisibleSubmission = { spotifyUri: string; title: string; artists: string; comment: string | null }`

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/guessing/horizon.test.ts
import { describe, it, expect } from 'vitest';
import { seedRound } from './fixtures.js';
import { visibleSubmissions } from './horizon.js';

describe('visible submissions (spec §14.3, §14.5)', () => {
  it('returns only comments that were visible to voters', () => {
    const { db, songs } = seedRound({ songCount: 4, mineIndex: null });
    db.prepare('UPDATE ml_submissions SET comment = ? WHERE spotify_uri = ?').run('shown', songs[0]);
    db.prepare('UPDATE ml_submissions SET comment = ?, visible_to_voters = 0 WHERE spotify_uri = ?')
      .run('hidden', songs[1]);

    const out = visibleSubmissions(db, 1);
    const byUri = new Map(out.map((s) => [s.spotifyUri, s]));
    expect(byUri.get(songs[0])!.comment).toBe('shown');
    expect(byUri.get(songs[1])!.comment).toBeNull();
  });

  it('still lists the song when its comment was not visible', () => {
    const { db, songs } = seedRound({ songCount: 4, mineIndex: null });
    db.prepare('UPDATE ml_submissions SET visible_to_voters = 0').run();
    const out = visibleSubmissions(db, 1);
    expect(out.map((s) => s.spotifyUri)).toEqual(songs);
    expect(out.every((s) => s.comment === null)).toBe(true);
  });

  it('never exposes submitter identity', () => {
    const { db } = seedRound({ songCount: 2, mineIndex: null });
    db.prepare('UPDATE ml_submissions SET competitor_id = 2').run();
    const out = visibleSubmissions(db, 1);
    for (const s of out) {
      expect(Object.keys(s)).toEqual(['spotifyUri', 'title', 'artists', 'comment']);
    }
  });

  it('returns playlist order', () => {
    const { db, songs } = seedRound({ songCount: 4, mineIndex: null });
    expect(visibleSubmissions(db, 1).map((s) => s.spotifyUri)).toEqual(songs);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/guessing/horizon.test.ts`
Expected: FAIL — cannot resolve `./horizon.js`

- [ ] **Step 3: Implement visibleSubmissions**

```ts
// ui/src/lib/guessing/horizon.ts
import type Database from 'better-sqlite3';

export interface VisibleSubmission {
  spotifyUri: string;
  title: string;
  artists: string;
  /** null when the submitter's comment was NOT visible to voters that round. */
  comment: string | null;
}

/**
 * The round's songs as a voter saw them (spec §14.3).
 *
 * The `visible_to_voters` filter is load-bearing, not a nicety: on Boarz R148 and
 * R149 only 5 of 10 comments were visible during voting. Returning all ten would
 * make a rehearsal easier than the real round was and inflate the score.
 *
 * §14.5: no CLI fetch is needed — the comments are already here.
 *
 * This module is NOT on the §5 anonymity allowlist and must never select
 * competitor_id. The shape returned deliberately has no identity field.
 */
export function visibleSubmissions(db: Database.Database, roundId: number): VisibleSubmission[] {
  return db.prepare(
    `SELECT spotify_uri AS spotifyUri,
            title,
            artists,
            CASE WHEN visible_to_voters = 1 THEN comment ELSE NULL END AS comment
       FROM ml_submissions
      WHERE round_id = ?
      ORDER BY id`,
  ).all(roundId) as VisibleSubmission[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/guessing/horizon.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Verify the anonymity guard still passes**

Run: `cd ui && npx vitest run src/lib/guessing/scoring.test.ts`
Expected: PASS — `horizon.ts` must NOT appear as an offender. If it does, the query is reaching identity; fix the query, do not add the file to the allowlist.

- [ ] **Step 6: Commit**

```bash
cd /home/loydmilligan/Projects/music-league-bot
git add ui/src/lib/guessing/horizon.ts ui/src/lib/guessing/horizon.test.ts
git commit -m "feat(guessing): visible submissions honour voter comment visibility"
```

---

### Task 3: Prior-round evidence — and the votes trap

**Files:**
- Modify: `ui/src/lib/guessing/horizon.ts`
- Test: `ui/src/lib/guessing/horizon.test.ts` (append)

**Interfaces:**
- Consumes: `seedRound`, `seedPriorRound`, `seedVote` from `./fixtures.js`; `priorRoundIds` from `./rehearsal.js`
- Produces: `priorVotes(db, roundId): PriorVote[]` where
  `PriorVote = { roundId: number; voterId: number; spotifyUri: string; points: number; comment: string | null }`

- [ ] **Step 1: Write the failing test**

```ts
// append to ui/src/lib/guessing/horizon.test.ts
import { seedPriorRound, seedVote } from './fixtures.js';
import { priorVotes } from './horizon.js';

describe('prior votes (spec §14.3 — the trap)', () => {
  function setup() {
    const s = seedRound({ songCount: 3, playerCount: 4, mineIndex: null });
    // round 1 is the round under study; give it a deadline
    s.db.prepare("UPDATE rounds SET voting_deadline = '2026-02-01T00:00:00Z' WHERE id = 1").run();
    seedPriorRound(s.db, 2, '2026-01-01T00:00:00Z'); // earlier
    seedPriorRound(s.db, 3, '2026-03-01T00:00:00Z'); // later
    return s;
  }

  it('EXCLUDES the round under study by id, not by time', () => {
    const { db, songs } = setup();
    // cast BEFORE this round's own deadline — a naive `ts < asOf` clamp would leak it
    seedVote(db, 1, 2, songs[0], 'this is obviously steiny', '2026-01-15T00:00:00Z');
    expect(priorVotes(db, 1).map((v) => v.roundId)).not.toContain(1);
  });

  it('includes votes from strictly earlier rounds', () => {
    const { db, songs } = setup();
    seedVote(db, 2, 2, songs[0], 'earlier round', '2025-12-15T00:00:00Z');
    const out = priorVotes(db, 1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ roundId: 2, voterId: 2, comment: 'earlier round' });
  });

  it('excludes votes from later rounds', () => {
    const { db, songs } = setup();
    seedVote(db, 3, 2, songs[0], 'the future', '2026-02-15T00:00:00Z');
    expect(priorVotes(db, 1)).toEqual([]);
  });

  it('excludes rounds with no voting deadline', () => {
    const { db, songs } = setup();
    seedPriorRound(db, 4, null);
    seedVote(db, 4, 2, songs[0], 'undated', '2025-11-01T00:00:00Z');
    expect(priorVotes(db, 1).map((v) => v.roundId)).not.toContain(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/guessing/horizon.test.ts`
Expected: FAIL — `priorVotes` is not exported

- [ ] **Step 3: Implement priorVotes**

```ts
// add to ui/src/lib/guessing/horizon.ts
import { priorRoundIds } from './rehearsal.js';

export interface PriorVote {
  roundId: number;
  voterId: number;
  spotifyUri: string;
  points: number;
  comment: string | null;
}

/**
 * Votes from rounds that had already closed before the round under study.
 *
 * SPEC §14.3 TRAP: the round's own votes are excluded **by round id, never by
 * timestamp**. Every vote on a round is cast BEFORE that round's voting deadline,
 * so a `created_at < asOf` clamp would leak the entire round — which is the answer
 * in all but name. `priorRoundIds` already excludes the round itself, rounds that
 * close later, and rounds with a NULL deadline.
 */
export function priorVotes(db: Database.Database, roundId: number): PriorVote[] {
  const ids = priorRoundIds(db, roundId);
  if (ids.length === 0) return [];
  return db.prepare(
    `SELECT round_id AS roundId, voter_id AS voterId, spotify_uri AS spotifyUri,
            points, comment
       FROM votes
      WHERE round_id IN (${ids.map(() => '?').join(',')})
      ORDER BY round_id, id`,
  ).all(...ids) as PriorVote[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/guessing/horizon.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
cd /home/loydmilligan/Projects/music-league-bot
git add ui/src/lib/guessing/horizon.ts ui/src/lib/guessing/horizon.test.ts
git commit -m "feat(guessing): prior-round votes excluded by round id, never by time"
```

---

### Task 4: Chat clamped to the cutoff

**Files:**
- Modify: `ui/src/lib/guessing/horizon.ts`
- Test: `ui/src/lib/guessing/horizon.test.ts` (append)

**Interfaces:**
- Consumes: `seedChat`, `CHAT_GROUP` from `./fixtures.js`
- Produces: `chatBefore(db, groupName, cutoff): ChatLine[]` where
  `ChatLine = { sender: string; text: string; ts: string }`

The caller supplies `groupName`; resolving league → chat group is the workspace's job (Project C2), not this module's.

- [ ] **Step 1: Write the failing test**

```ts
// append to ui/src/lib/guessing/horizon.test.ts
import { seedChat, CHAT_GROUP } from './fixtures.js';
import { chatBefore } from './horizon.js';

describe('chat horizon (spec §14.3)', () => {
  it('returns only messages strictly before the cutoff, oldest first', () => {
    const { db } = seedRound({ mineIndex: null });
    seedChat(db, CHAT_GROUP, 'A', 'before', '2026-01-01T00:00:00Z');
    seedChat(db, CHAT_GROUP, 'B', 'on the boundary', '2026-02-01T00:00:00Z');
    seedChat(db, CHAT_GROUP, 'C', 'after', '2026-03-01T00:00:00Z');

    const out = chatBefore(db, CHAT_GROUP, '2026-02-01T00:00:00Z');
    expect(out.map((m) => m.text)).toEqual(['before']);
  });

  it('ignores other groups', () => {
    const { db } = seedRound({ mineIndex: null });
    seedChat(db, CHAT_GROUP, 'A', 'ours', '2026-01-01T00:00:00Z');
    seedChat(db, 'Some Other Group', 'B', 'theirs', '2026-01-01T00:00:00Z');
    expect(chatBefore(db, CHAT_GROUP, '2026-02-01T00:00:00Z').map((m) => m.text)).toEqual(['ours']);
  });

  it('returns empty when chat_messages does not exist at all', () => {
    const { db } = seedRound({ mineIndex: null });
    expect(chatBefore(db, CHAT_GROUP, '2026-02-01T00:00:00Z')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/guessing/horizon.test.ts`
Expected: FAIL — `chatBefore` is not exported

- [ ] **Step 3: Implement chatBefore**

```ts
// add to ui/src/lib/guessing/horizon.ts
export interface ChatLine {
  sender: string;
  text: string;
  ts: string;
}

/**
 * Group chat strictly before `cutoff`, oldest first.
 *
 * Chat IS clamped by timestamp — unlike votes, a message's own timestamp is
 * exactly when it became knowable, so the naive comparison is the correct one here.
 *
 * `chat_messages` is created by the bot side (src/) and is absent from the UI's
 * SCHEMA constant, so it may legitimately not exist in a test database. Returning
 * empty is correct in that case: no chat evidence, not an error.
 */
export function chatBefore(
  db: Database.Database,
  groupName: string,
  cutoff: string,
): ChatLine[] {
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_messages'")
    .get();
  if (!exists) return [];

  return db.prepare(
    `SELECT sender, text, ts
       FROM chat_messages
      WHERE group_name = ? AND ts < ?
      ORDER BY ts`,
  ).all(groupName, cutoff) as ChatLine[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/guessing/horizon.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
cd /home/loydmilligan/Projects/music-league-bot
git add ui/src/lib/guessing/horizon.ts ui/src/lib/guessing/horizon.test.ts
git commit -m "feat(guessing): chat evidence clamped to the horizon cutoff"
```

---

### Task 5: `roundEvidence` — one entry point, one rule set

**Files:**
- Modify: `ui/src/lib/guessing/horizon.ts`
- Test: `ui/src/lib/guessing/horizon.test.ts` (append)

**Interfaces:**
- Consumes: `getRoundState` from `./state.js`; `visibleSubmissions`, `priorVotes`, `chatBefore` from this module
- Produces: `roundEvidence(db, roundId, opts): RoundEvidence` where
  `opts = { chatGroup?: string; now?: string }` and
  `RoundEvidence = { roundId, mode, cutoff, submissions, priorVotes, chat, priorRoundIds }`

- [ ] **Step 1: Write the failing test**

```ts
// append to ui/src/lib/guessing/horizon.test.ts
import { roundEvidence } from './horizon.js';
import { startRehearsal } from './rehearsal.js';

describe('roundEvidence assembly', () => {
  function setup() {
    const s = seedRound({ songCount: 3, playerCount: 4, mineIndex: null });
    s.db.prepare("UPDATE rounds SET voting_deadline = '2026-02-01T00:00:00Z' WHERE id = 1").run();
    seedPriorRound(s.db, 2, '2026-01-01T00:00:00Z');
    seedVote(s.db, 2, 2, s.songs[0], 'earlier', '2025-12-15T00:00:00Z');
    seedChat(s.db, CHAT_GROUP, 'A', 'old chatter', '2025-12-01T00:00:00Z');
    seedChat(s.db, CHAT_GROUP, 'B', 'new chatter', '2026-06-01T00:00:00Z');
    return s;
  }

  it('a live round uses wall-clock now, so all chat is in scope', () => {
    const { db } = setup();
    const ev = roundEvidence(db, 1, { chatGroup: CHAT_GROUP, now: '2026-09-01T00:00:00Z' });
    expect(ev.mode).toBe('live');
    expect(ev.cutoff).toBe('2026-09-01T00:00:00Z');
    expect(ev.chat.map((c) => c.text)).toEqual(['old chatter', 'new chatter']);
  });

  it('a rehearsed round uses as_of, cutting later chat', () => {
    const { db } = setup();
    startRehearsal(db, 1, '2026-02-01T00:00:00Z');
    const ev = roundEvidence(db, 1, { chatGroup: CHAT_GROUP, now: '2026-09-01T00:00:00Z' });
    expect(ev.mode).toBe('rehearsal');
    expect(ev.cutoff).toBe('2026-02-01T00:00:00Z');
    expect(ev.chat.map((c) => c.text)).toEqual(['old chatter']);
  });

  it('applies the same submission and vote rules in both modes', () => {
    const { db } = setup();
    const live = roundEvidence(db, 1, { chatGroup: CHAT_GROUP, now: '2026-09-01T00:00:00Z' });
    startRehearsal(db, 1, '2026-02-01T00:00:00Z');
    const reh = roundEvidence(db, 1, { chatGroup: CHAT_GROUP, now: '2026-09-01T00:00:00Z' });
    expect(reh.submissions).toEqual(live.submissions);
    expect(reh.priorVotes).toEqual(live.priorVotes);
    expect(reh.priorRoundIds).toEqual(live.priorRoundIds);
  });

  it('omits chat entirely when no group is given', () => {
    const { db } = setup();
    const ev = roundEvidence(db, 1, { now: '2026-09-01T00:00:00Z' });
    expect(ev.chat).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/guessing/horizon.test.ts`
Expected: FAIL — `roundEvidence` is not exported

- [ ] **Step 3: Implement roundEvidence**

```ts
// add to ui/src/lib/guessing/horizon.ts
import { getRoundState, type RehearsalMode } from './state.js';

export interface RoundEvidence {
  roundId: number;
  mode: RehearsalMode;
  /** The effective "now": as_of for a rehearsal, wall clock for a live round. */
  cutoff: string;
  submissions: VisibleSubmission[];
  priorVotes: PriorVote[];
  chat: ChatLine[];
  priorRoundIds: number[];
}

/**
 * Everything the guessing workspace is allowed to see for one round (spec §14.3).
 *
 * The rules below are IDENTICAL for a live round and a rehearsed one — comments
 * filtered to what voters saw, the round's own votes excluded by id, only
 * strictly-prior rounds, chat clamped to a cutoff. Rehearsal changes exactly one
 * thing: what "now" means. Do not add a `mode === 'rehearsal'` branch here; if a
 * rule needs one, the rule is wrong.
 */
export function roundEvidence(
  db: Database.Database,
  roundId: number,
  opts: { chatGroup?: string; now?: string } = {},
): RoundEvidence {
  const state = getRoundState(db, roundId);
  const wallClock = opts.now ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const cutoff = state.asOf ?? wallClock;

  return {
    roundId,
    mode: state.mode,
    cutoff,
    submissions: visibleSubmissions(db, roundId),
    priorVotes: priorVotes(db, roundId),
    chat: opts.chatGroup ? chatBefore(db, opts.chatGroup, cutoff) : [],
    priorRoundIds: priorRoundIds(db, roundId),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/guessing/horizon.test.ts`
Expected: PASS (15 tests)

- [ ] **Step 5: Commit**

```bash
cd /home/loydmilligan/Projects/music-league-bot
git add ui/src/lib/guessing/horizon.ts ui/src/lib/guessing/horizon.test.ts
git commit -m "feat(guessing): roundEvidence — one horizon entry point for live and rehearsal"
```

---

### Task 6: The §14.6 sync gate

**Files:**
- Modify: `ui/src/lib/guessing/sync.ts`
- Test: `ui/src/lib/guessing/sync.test.ts` (append)

**Interfaces:**
- Consumes: `getRoundState` from `./state.js` (already imported by `sync.ts`'s test)
- Produces: unchanged signature — `verifyRoundSync` returns `{ state: 'unverified', songs: [] }` and writes nothing when the round is in rehearsal mode

`sync.ts` IS on the anonymity allowlist; that does not change here.

- [ ] **Step 1: Write the failing test**

```ts
// append to ui/src/lib/guessing/sync.test.ts
import { startRehearsal } from './rehearsal.js';

describe('sync is suppressed during a rehearsal (spec §14.6)', () => {
  it('returns unverified and inspects nothing while mode is rehearsal', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 3, playerCount: 3 });
    db.prepare('UPDATE competitors SET name = ? WHERE id = ?').run('Jensen', players[1]);
    storeComment(db, songs[1], players[1], 'has to be jensen');
    postedVote(db, songs[1], 'changed my mind, steiny');

    startRehearsal(db, roundId, '2026-01-02T00:00:00Z');

    const r = verifyRoundSync(db, roundId, ME, '2026-01-03T00:00:00Z');
    expect(r.state).toBe('unverified');
    expect(r.songs).toEqual([]);
  });

  it('does not overwrite a previously recorded sync_state', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 3, playerCount: 3 });
    db.prepare('UPDATE competitors SET name = ? WHERE id = ?').run('Jensen', players[1]);
    storeComment(db, songs[1], players[1], 'close enough for me jensen');
    postedVote(db, songs[1], 'close enough for me jensen');

    expect(verifyRoundSync(db, roundId, ME, '2026-01-03T00:00:00Z').state).toBe('ok');

    startRehearsal(db, roundId, '2026-01-02T00:00:00Z');
    verifyRoundSync(db, roundId, ME, '2026-01-04T00:00:00Z');

    expect(getRoundState(db, roundId).syncState).toBe('ok');
  });

  it('resumes normally once the rehearsal is archived', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 3, playerCount: 3 });
    db.prepare('UPDATE competitors SET name = ? WHERE id = ?').run('Jensen', players[1]);
    startRehearsal(db, roundId, '2026-01-02T00:00:00Z');
    archiveRehearsal(db, roundId);

    storeComment(db, songs[1], players[1], 'close enough for me jensen');
    postedVote(db, songs[1], 'close enough for me jensen');
    expect(verifyRoundSync(db, roundId, ME, '2026-01-05T00:00:00Z').state).toBe('ok');
  });
});
```

Add `archiveRehearsal` to the `./rehearsal.js` import at the top of the new describe block.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/guessing/sync.test.ts`
Expected: FAIL — first test gets `'mismatch'`, not `'unverified'`

- [ ] **Step 3: Add the gate to verifyRoundSync**

Insert at the very top of `verifyRoundSync`'s body, before any query:

```ts
  // Spec §14.6: never sync a round being rehearsed. The posted comment names
  // Matt's PRIOR conclusion — not the answer, but enough to contaminate the
  // experiment. Return the neutral state and write nothing, so an existing
  // sync_state from a real sitting survives the rehearsal untouched.
  if (getRoundState(db, roundId).mode === 'rehearsal') {
    return { state: 'unverified', songs: [] };
  }
```

and add `getRoundState` to the imports from `./state.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/guessing/sync.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Run the whole guessing suite and the guard**

Run: `cd ui && npx vitest run src/lib/guessing/`
Expected: PASS — 69 tests across 9 files (54 existing + 4 fixtures + 15 horizon − overlap; report the real number). `horizon.ts` must not be flagged by the anonymity guard.

- [ ] **Step 6: Commit**

```bash
cd /home/loydmilligan/Projects/music-league-bot
git add ui/src/lib/guessing/sync.ts ui/src/lib/guessing/sync.test.ts
git commit -m "feat(guessing): suppress sync during a rehearsal (spec §14.6)"
```

---

## Self-review notes

**Spec coverage.** §14.3 → Tasks 2 (submissions), 3 (votes), 4 (chat), 5 (assembly). §14.5 → Task 2, which makes the CLI fetch unnecessary by reading the comments already stored. §14.6 → Task 6. §5 anonymity → enforced by the existing guard, checked explicitly in Tasks 2 and 6.

**Deliberately out of scope.** §4 placement, §7.4 grid, §7.5 comment, §7.6 vote, §7.7 output — all Project C2/C3/C4. This plan is the server-side half only and ships no UI.

**Known soft spot.** `roundEvidence` takes `chatGroup` as a parameter rather than resolving league → chat group itself. That resolution is by exact `group_name` match and belongs to the workspace, which knows the league. If C2 finds no natural home for it, move it here rather than duplicating the lookup.

**A trap worth restating for the executor.** Task 3's first test is the whole reason this plan exists. Votes on a round are cast *before* that round's deadline, so the obvious `created_at < asOf` filter leaks the answer. If that test is ever "simplified" to a timestamp comparison, the feature is silently broken and every rehearsal becomes worthless.
