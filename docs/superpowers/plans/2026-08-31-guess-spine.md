# Guess Spine (Project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the storage, rules, and scoring layer for guess-the-submitter — everything the workspace UI, the AI analysis, and the scorecard will sit on top of.

**Architecture:** Five new tables alongside the untouched `voting_lab_ballot`, plus six small pure-ish modules under `ui/src/lib/guessing/`. Every module takes a `Database` handle and returns plain data — no HTTP, no LLM, no Svelte. Scoring is derived at read time by joining `ml_submissions`; nothing about accuracy is ever persisted.

**Tech Stack:** TypeScript, better-sqlite3, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-31-submitter-guessing-design.md`

## Global Constraints

- **Anonymity (spec §5):** nothing in this project may read `ml_submissions.player_id` or `.competitor_id` except `scoring.ts` and `sync.ts`, which run only after a round is revealed. Task 5 adds the test that enforces this.
- **Scoring is derived, never stored (spec §8).** No accuracy/correctness column exists in any table. A re-import must not be able to leave a stale scoreline.
- **Assignment rules (spec §6):** every song gets exactly one guess; each player used at most once; Matt's own song (`voting_lab_ballot.is_mine = 1`) and Matt himself are excluded from the pool and from scoring.
- **Gut immutability (spec §7.1):** once `guess_round_state.gut_locked_at` is set, `guess_picks.gut_pick_player_id` can never change. Every song requires a gut pick — there is no skip.
- **Confidence scale (resolves spec open question 3):** `guess_picks.confidence` and `guess_candidates.certainty` are both `INTEGER 0..100`, the same scale, so they compare directly against the AI's percentages.
- **Schema style:** append to the single `SCHEMA` template literal in `ui/src/lib/db/schema.ts` using `CREATE TABLE IF NOT EXISTS`. `client.ts` runs `db.exec(SCHEMA)` on open; live tables are never altered by it.
- **Tests:** `cd ui && npx vitest run <path>`. Note the repo root has its own vitest config that excludes `ui/**` — running from the root will report "No test files found".

---

### Task 1: Schema and the shared test fixture

**Files:**
- Modify: `ui/src/lib/db/schema.ts` (append before the closing backtick at line 636)
- Create: `ui/src/lib/guessing/fixtures.ts`
- Test: `ui/src/lib/guessing/schema.test.ts`

**Interfaces:**
- Consumes: `SCHEMA` from `ui/src/lib/db/schema.ts`
- Produces: five tables — `guess_round_state`, `guess_picks`, `guess_candidates`, `guess_ai_distribution`, `guess_ai_song`; and `seedRound(): { db, roundId, players }` used by every later task's tests.

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/guessing/schema.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';

function cols(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);
}

describe('guess spine schema', () => {
  const db = new Database(':memory:');
  db.exec(SCHEMA);

  it('creates all five guess tables', () => {
    for (const t of [
      'guess_round_state',
      'guess_picks',
      'guess_candidates',
      'guess_ai_distribution',
      'guess_ai_song',
    ]) {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
      expect(row, `${t} missing`).toBeTruthy();
    }
  });

  it('guess_picks carries both picks, confidence and both comment fields', () => {
    expect(cols(db, 'guess_picks')).toEqual(
      expect.arrayContaining([
        'round_id', 'spotify_uri', 'gut_pick_player_id', 'final_pick_player_id',
        'confidence', 'second_pick_player_id', 'explanation', 'second_explanation',
        'comment', 'comment_notes', 'locked_at', 'updated_at',
      ]),
    );
  });

  it('has NO stored correctness column anywhere — scoring is derived', () => {
    for (const t of ['guess_picks', 'guess_candidates', 'guess_round_state']) {
      const names = cols(db, t).join(',');
      expect(names).not.toMatch(/correct|accura|score/i);
    }
  });

  it('candidate status is constrained to the three states', () => {
    db.exec(`INSERT INTO leagues (id,slug,name) VALUES (1,'l','L');
             INSERT INTO seasons (id,league_id,season_number,status) VALUES (1,1,1,'active');
             INSERT INTO rounds (id,season_id,ml_round_id,name,created_at) VALUES (1,1,'m1','R1','2026-01-01');
             INSERT INTO players (id,name) VALUES (1,'A');`);
    expect(() =>
      db.prepare(
        `INSERT INTO guess_candidates (round_id,spotify_uri,player_id,status,updated_at)
         VALUES (1,'spotify:track:x',1,'bogus','2026-01-01')`,
      ).run(),
    ).toThrow();
  });

  it('confidence and certainty are rejected outside 0..100', () => {
    expect(() =>
      db.prepare(
        `INSERT INTO guess_picks (round_id,spotify_uri,confidence,updated_at)
         VALUES (1,'spotify:track:y',101,'2026-01-01')`,
      ).run(),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/guessing/schema.test.ts`
Expected: FAIL — `guess_round_state missing`

- [ ] **Step 3: Append the tables to schema.ts**

Insert immediately before the closing `` ` `` on line 636 of `ui/src/lib/db/schema.ts`:

```sql
  -- Guess the Submitter (2026-08-31). Per-round state machine for the guessing
  -- workflow. Spec: docs/superpowers/specs/2026-08-31-submitter-guessing-design.md
  -- Scoring is DERIVED at read time by joining ml_submissions; no correctness
  -- column exists here on purpose, so a zip re-import cannot strand a stale
  -- scoreline.
  CREATE TABLE IF NOT EXISTS guess_round_state (
    round_id INTEGER PRIMARY KEY REFERENCES rounds(id),
    phase TEXT NOT NULL DEFAULT 'gut'
      CHECK (phase IN ('gut','fetch','ai','refine','vote','output','done')),
    gut_locked_at TEXT,
    slate_locked_at TEXT,
    votes_locked_at TEXT,
    submitted_at TEXT,
    comments_fetched_at TEXT,
    sync_state TEXT NOT NULL DEFAULT 'unverified'
      CHECK (sync_state IN ('unverified','ok','mismatch')),
    updated_at TEXT NOT NULL
  );
  -- One row per (round, song). gut_pick is frozen once the round's gut_locked_at
  -- is stamped; confidence shares the 0..100 scale with guess_candidates.certainty
  -- so both compare directly against the AI's percentages.
  CREATE TABLE IF NOT EXISTS guess_picks (
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    spotify_uri TEXT NOT NULL,
    gut_pick_player_id INTEGER REFERENCES players(id),
    final_pick_player_id INTEGER REFERENCES players(id),
    confidence INTEGER CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 100)),
    second_pick_player_id INTEGER REFERENCES players(id),
    explanation TEXT NOT NULL DEFAULT '',
    second_explanation TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    comment_notes TEXT NOT NULL DEFAULT '',
    locked_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (round_id, spotify_uri)
  );
  -- The sudoku grid. 'prime' dims that player on other songs (advisory);
  -- 'locked' removes them (hard). Persisted rather than client-side so the
  -- grid survives a refresh mid-round.
  CREATE TABLE IF NOT EXISTS guess_candidates (
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    spotify_uri TEXT NOT NULL,
    player_id INTEGER NOT NULL REFERENCES players(id),
    status TEXT NOT NULL DEFAULT 'possible'
      CHECK (status IN ('possible','prime','locked')),
    certainty INTEGER CHECK (certainty IS NULL OR (certainty BETWEEN 0 AND 100)),
    factors TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (round_id, spotify_uri, player_id)
  );
  -- Project D writes these; A only defines them so the shape is settled.
  CREATE TABLE IF NOT EXISTS guess_ai_distribution (
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    spotify_uri TEXT NOT NULL,
    player_id INTEGER NOT NULL REFERENCES players(id),
    pct REAL NOT NULL,
    reasoning TEXT NOT NULL DEFAULT '',
    generated_at TEXT NOT NULL,
    PRIMARY KEY (round_id, spotify_uri, player_id)
  );
  CREATE TABLE IF NOT EXISTS guess_ai_song (
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    spotify_uri TEXT NOT NULL,
    ai_pick_player_id INTEGER REFERENCES players(id),
    ai_certainty INTEGER CHECK (ai_certainty IS NULL OR (ai_certainty BETWEEN 0 AND 100)),
    ai_factors TEXT NOT NULL DEFAULT '',
    generated_at TEXT NOT NULL,
    PRIMARY KEY (round_id, spotify_uri)
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/guessing/schema.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Create the shared fixture**

```ts
// ui/src/lib/guessing/fixtures.ts
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';

export interface SeededRound {
  db: Database.Database;
  roundId: number;
  /** player ids 1..n, name "P1".."Pn". Player 1 is Matt (the guesser). */
  players: number[];
  /** spotify uris, one per song, in playlist order. */
  songs: string[];
}

/**
 * A round with `songCount` anonymous songs and `playerCount` roster players.
 * Song 0 is Matt's own (voting_lab_ballot.is_mine = 1) unless `mineIndex` is null.
 * Submissions are seeded WITHOUT player_id, mirroring a live round; call
 * `reveal()` to attach submitters the way a completed-round export would.
 */
export function seedRound(opts: {
  songCount?: number;
  playerCount?: number;
  mineIndex?: number | null;
} = {}): SeededRound {
  const songCount = opts.songCount ?? 4;
  const playerCount = opts.playerCount ?? 4;
  const mineIndex = opts.mineIndex === undefined ? 0 : opts.mineIndex;

  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec(`INSERT INTO leagues (id,slug,name) VALUES (1,'boarz-ii-men','Boarz');
           INSERT INTO seasons (id,league_id,season_number,status) VALUES (1,1,1,'active');
           INSERT INTO rounds (id,season_id,ml_round_id,name,created_at)
             VALUES (1,1,'ml-1','R1','2026-01-01T00:00:00Z');`);

  const players: number[] = [];
  for (let i = 1; i <= playerCount; i++) {
    db.prepare('INSERT INTO players (id,name) VALUES (?,?)').run(i, `P${i}`);
    players.push(i);
  }

  const songs: string[] = [];
  for (let i = 0; i < songCount; i++) {
    const uri = `spotify:track:s${i}`;
    songs.push(uri);
    db.prepare(
      `INSERT INTO ml_submissions (round_id, spotify_uri, title, artists, created_at, visible_to_voters)
       VALUES (1, ?, ?, ?, '2026-01-01T00:00:00Z', 1)`,
    ).run(uri, `Song ${i}`, `Artist ${i}`);
    db.prepare(
      `INSERT INTO voting_lab_ballot (round_id, spotify_uri, is_mine, updated_at)
       VALUES (1, ?, ?, '2026-01-01T00:00:00Z')`,
    ).run(uri, mineIndex !== null && i === mineIndex ? 1 : 0);
  }

  return { db, roundId: 1, players, songs };
}

/** Attach real submitters, as a completed-round export would. */
export function reveal(db: Database.Database, assignments: Record<string, number>): void {
  for (const [uri, playerId] of Object.entries(assignments)) {
    db.prepare('UPDATE ml_submissions SET player_id = ? WHERE round_id = 1 AND spotify_uri = ?')
      .run(playerId, uri);
  }
}
```

- [ ] **Step 6: Commit**

```bash
cd /home/loydmilligan/Projects/music-league-bot
git add ui/src/lib/db/schema.ts ui/src/lib/guessing/schema.test.ts ui/src/lib/guessing/fixtures.ts
git commit -m "feat(guessing): guess spine schema — five tables, no stored scoring"
```

---

### Task 2: Round state and the gut lock

**Files:**
- Create: `ui/src/lib/guessing/state.ts`
- Test: `ui/src/lib/guessing/state.test.ts`

**Interfaces:**
- Consumes: `seedRound` from `./fixtures.js`
- Produces:
  - `getRoundState(db, roundId): RoundState` — creates the row on first call
  - `setGutPick(db, roundId, spotifyUri, playerId): void` — **throws** once gut is locked
  - `lockGut(db, roundId, now): void`
  - `GuessPhase = 'gut'|'fetch'|'ai'|'refine'|'vote'|'output'|'done'`

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/guessing/state.test.ts
import { describe, it, expect } from 'vitest';
import { seedRound } from './fixtures.js';
import { getRoundState, setGutPick, lockGut } from './state.js';

describe('guess round state', () => {
  it('creates a default state row on first read', () => {
    const { db, roundId } = seedRound();
    const s = getRoundState(db, roundId);
    expect(s.phase).toBe('gut');
    expect(s.gutLockedAt).toBeNull();
    expect(s.syncState).toBe('unverified');
  });

  it('records gut picks before the lock', () => {
    const { db, roundId, songs, players } = seedRound();
    setGutPick(db, roundId, songs[1], players[1]);
    const row = db.prepare(
      'SELECT gut_pick_player_id AS p FROM guess_picks WHERE round_id=? AND spotify_uri=?',
    ).get(roundId, songs[1]) as { p: number };
    expect(row.p).toBe(players[1]);
  });

  it('refuses to change a gut pick after the lock', () => {
    const { db, roundId, songs, players } = seedRound();
    setGutPick(db, roundId, songs[1], players[1]);
    lockGut(db, roundId, '2026-01-02T00:00:00Z');

    expect(() => setGutPick(db, roundId, songs[1], players[2])).toThrow(/locked/i);

    const row = db.prepare(
      'SELECT gut_pick_player_id AS p FROM guess_picks WHERE round_id=? AND spotify_uri=?',
    ).get(roundId, songs[1]) as { p: number };
    expect(row.p).toBe(players[1]);
  });

  it('lockGut advances the phase and stamps the time', () => {
    const { db, roundId } = seedRound();
    lockGut(db, roundId, '2026-01-02T00:00:00Z');
    const s = getRoundState(db, roundId);
    expect(s.gutLockedAt).toBe('2026-01-02T00:00:00Z');
    expect(s.phase).toBe('fetch');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/guessing/state.test.ts`
Expected: FAIL — cannot resolve `./state.js`

- [ ] **Step 3: Implement state.ts**

```ts
// ui/src/lib/guessing/state.ts
import type Database from 'better-sqlite3';

export type GuessPhase = 'gut' | 'fetch' | 'ai' | 'refine' | 'vote' | 'output' | 'done';
export type SyncState = 'unverified' | 'ok' | 'mismatch';

export interface RoundState {
  roundId: number;
  phase: GuessPhase;
  gutLockedAt: string | null;
  slateLockedAt: string | null;
  votesLockedAt: string | null;
  submittedAt: string | null;
  commentsFetchedAt: string | null;
  syncState: SyncState;
}

interface StateRow {
  round_id: number; phase: GuessPhase;
  gut_locked_at: string | null; slate_locked_at: string | null;
  votes_locked_at: string | null; submitted_at: string | null;
  comments_fetched_at: string | null; sync_state: SyncState;
}

/** Reads the round's state, creating the default row the first time. */
export function getRoundState(db: Database.Database, roundId: number): RoundState {
  db.prepare(
    `INSERT OR IGNORE INTO guess_round_state (round_id, updated_at)
     VALUES (?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  ).run(roundId);
  const r = db.prepare('SELECT * FROM guess_round_state WHERE round_id = ?').get(roundId) as StateRow;
  return {
    roundId: r.round_id,
    phase: r.phase,
    gutLockedAt: r.gut_locked_at,
    slateLockedAt: r.slate_locked_at,
    votesLockedAt: r.votes_locked_at,
    submittedAt: r.submitted_at,
    commentsFetchedAt: r.comments_fetched_at,
    syncState: r.sync_state,
  };
}

/**
 * Set the first-instinct pick for one song. Throws once the round's gut slate is
 * locked — the whole value of the gut baseline is that it cannot be revised after
 * the AI has spoken.
 */
export function setGutPick(
  db: Database.Database,
  roundId: number,
  spotifyUri: string,
  playerId: number,
): void {
  if (getRoundState(db, roundId).gutLockedAt !== null) {
    throw new Error(`gut slate for round ${roundId} is locked; gut picks are immutable`);
  }
  db.prepare(
    `INSERT INTO guess_picks (round_id, spotify_uri, gut_pick_player_id, updated_at)
     VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
     ON CONFLICT(round_id, spotify_uri)
       DO UPDATE SET gut_pick_player_id = excluded.gut_pick_player_id,
                     updated_at = excluded.updated_at`,
  ).run(roundId, spotifyUri, playerId);
}

/** Freeze the gut slate and move to the comment-fetch phase. Idempotent. */
export function lockGut(db: Database.Database, roundId: number, now: string): void {
  getRoundState(db, roundId);
  db.prepare(
    `UPDATE guess_round_state
        SET gut_locked_at = COALESCE(gut_locked_at, ?), phase = 'fetch', updated_at = ?
      WHERE round_id = ?`,
  ).run(now, now, roundId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/guessing/state.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd /home/loydmilligan/Projects/music-league-bot
git add ui/src/lib/guessing/state.ts ui/src/lib/guessing/state.test.ts
git commit -m "feat(guessing): round state machine with immutable gut lock"
```

---

### Task 3: Assignment rules

**Files:**
- Create: `ui/src/lib/guessing/assignment.ts`
- Test: `ui/src/lib/guessing/assignment.test.ts`

**Interfaces:**
- Consumes: `seedRound` from `./fixtures.js`
- Produces:
  - `eligibleSongs(db, roundId): string[]` — playlist order, excludes `is_mine`
  - `eligiblePlayers(db, roundId, mePlayerId): number[]` — roster minus Matt
  - `validateGutSlate(db, roundId, mePlayerId): Validation` where `Validation = { ok: boolean; missingSongs: string[]; duplicatePlayerIds: number[] }`

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/guessing/assignment.test.ts
import { describe, it, expect } from 'vitest';
import { seedRound } from './fixtures.js';
import { setGutPick } from './state.js';
import { eligibleSongs, eligiblePlayers, validateGutSlate } from './assignment.js';

const ME = 1;

describe('assignment rules', () => {
  it('excludes my own song and me from the pool', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 4, playerCount: 4, mineIndex: 0 });
    expect(eligibleSongs(db, roundId)).toEqual([songs[1], songs[2], songs[3]]);
    expect(eligiblePlayers(db, roundId, ME)).toEqual([players[1], players[2], players[3]]);
  });

  it('is incomplete until every eligible song has a pick', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 4, playerCount: 4 });
    setGutPick(db, roundId, songs[1], players[1]);
    const v = validateGutSlate(db, roundId, ME);
    expect(v.ok).toBe(false);
    expect(v.missingSongs).toEqual([songs[2], songs[3]]);
  });

  it('reports duplicates but still lets them be stored while editing', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 4, playerCount: 4 });
    setGutPick(db, roundId, songs[1], players[1]);
    setGutPick(db, roundId, songs[2], players[1]); // same person twice — allowed in-flight
    setGutPick(db, roundId, songs[3], players[3]);
    const v = validateGutSlate(db, roundId, ME);
    expect(v.ok).toBe(false);
    expect(v.duplicatePlayerIds).toEqual([players[1]]);
  });

  it('passes when every song has a pick and nobody repeats', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 4, playerCount: 4 });
    setGutPick(db, roundId, songs[1], players[1]);
    setGutPick(db, roundId, songs[2], players[2]);
    setGutPick(db, roundId, songs[3], players[3]);
    expect(validateGutSlate(db, roundId, ME)).toEqual({
      ok: true, missingSongs: [], duplicatePlayerIds: [],
    });
  });

  // spec §6: the rule that would otherwise deadlock 2 of the last 10 real rounds
  it('is satisfiable when a player skipped the round (more players than songs)', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 3, playerCount: 4 });
    setGutPick(db, roundId, songs[1], players[1]);
    setGutPick(db, roundId, songs[2], players[2]);
    // players[3] submitted nothing and is simply left over
    expect(validateGutSlate(db, roundId, ME).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/guessing/assignment.test.ts`
Expected: FAIL — cannot resolve `./assignment.js`

- [ ] **Step 3: Implement assignment.ts**

```ts
// ui/src/lib/guessing/assignment.ts
import type Database from 'better-sqlite3';

export interface Validation {
  ok: boolean;
  missingSongs: string[];
  duplicatePlayerIds: number[];
}

/**
 * Songs that need a guess, in playlist order. Excludes the owner's own
 * submission (voting_lab_ballot.is_mine), which he already knows and must not
 * get credit for identifying.
 */
export function eligibleSongs(db: Database.Database, roundId: number): string[] {
  return (
    db.prepare(
      `SELECT ms.spotify_uri AS uri
         FROM ml_submissions ms
         LEFT JOIN voting_lab_ballot b
                ON b.round_id = ms.round_id AND b.spotify_uri = ms.spotify_uri
        WHERE ms.round_id = ?
          AND COALESCE(b.is_mine, 0) = 0
        ORDER BY ms.id`,
    ).all(roundId) as { uri: string }[]
  ).map((r) => r.uri);
}

/** Roster for the round's league, minus the owner. */
export function eligiblePlayers(
  db: Database.Database,
  roundId: number,
  mePlayerId: number,
): number[] {
  return (
    db.prepare(
      `SELECT DISTINCT p.id AS id
         FROM players p
         JOIN ml_submissions ms ON ms.player_id = p.id
         JOIN rounds r2 ON r2.id = ms.round_id
         JOIN seasons se2 ON se2.id = r2.season_id
        WHERE se2.league_id = (
                SELECT se.league_id FROM rounds r JOIN seasons se ON se.id = r.season_id
                 WHERE r.id = ?)
          AND p.id <> ?
        UNION
       SELECT id FROM players WHERE id <> ?
          AND id IN (SELECT player_id FROM season_players)
        ORDER BY id`,
    ).all(roundId, mePlayerId, mePlayerId) as { id: number }[]
  ).map((r) => r.id);
}

/**
 * Spec §6: every eligible song must carry exactly one guess, and each player may
 * be used at most once. Phrasing it the other way round ("each player exactly
 * one song") deadlocks any round where somebody skipped — you cannot place 10
 * players one-each into 9 songs.
 */
export function validateGutSlate(
  db: Database.Database,
  roundId: number,
  mePlayerId: number,
): Validation {
  const songs = eligibleSongs(db, roundId);
  const picks = new Map(
    (
      db.prepare(
        `SELECT spotify_uri AS uri, gut_pick_player_id AS pid
           FROM guess_picks
          WHERE round_id = ? AND gut_pick_player_id IS NOT NULL`,
      ).all(roundId) as { uri: string; pid: number }[]
    ).map((r) => [r.uri, r.pid]),
  );

  const missingSongs = songs.filter((s) => !picks.has(s));

  const seen = new Map<number, number>();
  for (const s of songs) {
    const pid = picks.get(s);
    if (pid === undefined) continue;
    seen.set(pid, (seen.get(pid) ?? 0) + 1);
  }
  const duplicatePlayerIds = [...seen.entries()]
    .filter(([, n]) => n > 1)
    .map(([pid]) => pid)
    .sort((a, b) => a - b);

  void mePlayerId; // owner exclusion is applied in eligibleSongs/eligiblePlayers
  return {
    ok: missingSongs.length === 0 && duplicatePlayerIds.length === 0,
    missingSongs,
    duplicatePlayerIds,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/guessing/assignment.test.ts`
Expected: PASS (5 tests)

If `eligiblePlayers` returns unexpected ids, simplify its query to select from `players` joined to this league's `ml_submissions` only — the `season_players` UNION is a convenience for rosters that have not submitted yet and can be dropped without affecting any test above.

- [ ] **Step 5: Commit**

```bash
cd /home/loydmilligan/Projects/music-league-bot
git add ui/src/lib/guessing/assignment.ts ui/src/lib/guessing/assignment.test.ts
git commit -m "feat(guessing): assignment rules — every song once, each player at most once"
```

---

### Task 4: The candidate state machine

**Files:**
- Create: `ui/src/lib/guessing/candidates.ts`
- Test: `ui/src/lib/guessing/candidates.test.ts`

**Interfaces:**
- Consumes: `seedRound` from `./fixtures.js`
- Produces:
  - `setCandidate(db, roundId, spotifyUri, playerId, patch): void` where `patch = { status?, certainty?, factors?, notes? }`
  - `removeCandidate(db, roundId, spotifyUri, playerId): void`
  - `candidatesForSong(db, roundId, spotifyUri): Candidate[]`
  - `playerAvailability(db, roundId, mePlayerId): Map<number, 'free'|'dimmed'|'taken'>`

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/guessing/candidates.test.ts
import { describe, it, expect } from 'vitest';
import { seedRound } from './fixtures.js';
import {
  setCandidate, removeCandidate, candidatesForSong, playerAvailability,
} from './candidates.js';

const ME = 1;

describe('candidate grid', () => {
  it('stores a pencil mark with certainty and notes', () => {
    const { db, roundId, songs, players } = seedRound();
    setCandidate(db, roundId, songs[1], players[2], {
      status: 'possible', certainty: 40, notes: 'feels like him', factors: 'genre',
    });
    const [c] = candidatesForSong(db, roundId, songs[1]);
    expect(c).toMatchObject({ playerId: players[2], status: 'possible', certainty: 40 });
  });

  it('prime dims that player elsewhere but does not remove them', () => {
    const { db, roundId, songs, players } = seedRound();
    setCandidate(db, roundId, songs[1], players[2], { status: 'prime' });
    const avail = playerAvailability(db, roundId, ME);
    expect(avail.get(players[2])).toBe('dimmed');
  });

  it('locked marks that player taken', () => {
    const { db, roundId, songs, players } = seedRound();
    setCandidate(db, roundId, songs[1], players[2], { status: 'locked' });
    expect(playerAvailability(db, roundId, ME).get(players[2])).toBe('taken');
  });

  it('locked outranks prime when a player is both somewhere', () => {
    const { db, roundId, songs, players } = seedRound();
    setCandidate(db, roundId, songs[1], players[2], { status: 'prime' });
    setCandidate(db, roundId, songs[2], players[2], { status: 'locked' });
    expect(playerAvailability(db, roundId, ME).get(players[2])).toBe('taken');
  });

  it('demoting a lock frees the player again', () => {
    const { db, roundId, songs, players } = seedRound();
    setCandidate(db, roundId, songs[1], players[2], { status: 'locked' });
    setCandidate(db, roundId, songs[1], players[2], { status: 'possible' });
    expect(playerAvailability(db, roundId, ME).get(players[2])).toBe('free');
  });

  it('removing a candidate frees the player', () => {
    const { db, roundId, songs, players } = seedRound();
    setCandidate(db, roundId, songs[1], players[2], { status: 'locked' });
    removeCandidate(db, roundId, songs[1], players[2]);
    expect(candidatesForSong(db, roundId, songs[1])).toEqual([]);
    expect(playerAvailability(db, roundId, ME).get(players[2])).toBe('free');
  });

  it('patches only the fields given', () => {
    const { db, roundId, songs, players } = seedRound();
    setCandidate(db, roundId, songs[1], players[2], { status: 'possible', certainty: 30 });
    setCandidate(db, roundId, songs[1], players[2], { status: 'prime' });
    const [c] = candidatesForSong(db, roundId, songs[1]);
    expect(c.certainty).toBe(30);
    expect(c.status).toBe('prime');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/guessing/candidates.test.ts`
Expected: FAIL — cannot resolve `./candidates.js`

- [ ] **Step 3: Implement candidates.ts**

```ts
// ui/src/lib/guessing/candidates.ts
import type Database from 'better-sqlite3';
import { eligiblePlayers } from './assignment.js';

export type CandidateStatus = 'possible' | 'prime' | 'locked';
/** free = untouched · dimmed = prime somewhere (advisory) · taken = locked somewhere (hard) */
export type Availability = 'free' | 'dimmed' | 'taken';

export interface Candidate {
  playerId: number;
  status: CandidateStatus;
  certainty: number | null;
  factors: string;
  notes: string;
}

export interface CandidatePatch {
  status?: CandidateStatus;
  certainty?: number | null;
  factors?: string;
  notes?: string;
}

/** Upsert one candidate row, patching only the supplied fields. */
export function setCandidate(
  db: Database.Database,
  roundId: number,
  spotifyUri: string,
  playerId: number,
  patch: CandidatePatch,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO guess_candidates (round_id, spotify_uri, player_id, updated_at)
     VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  ).run(roundId, spotifyUri, playerId);

  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.status !== undefined) { sets.push('status = ?'); args.push(patch.status); }
  if (patch.certainty !== undefined) { sets.push('certainty = ?'); args.push(patch.certainty); }
  if (patch.factors !== undefined) { sets.push('factors = ?'); args.push(patch.factors); }
  if (patch.notes !== undefined) { sets.push('notes = ?'); args.push(patch.notes); }
  if (sets.length === 0) return;

  sets.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`);
  args.push(roundId, spotifyUri, playerId);
  db.prepare(
    `UPDATE guess_candidates SET ${sets.join(', ')}
      WHERE round_id = ? AND spotify_uri = ? AND player_id = ?`,
  ).run(...args);
}

export function removeCandidate(
  db: Database.Database,
  roundId: number,
  spotifyUri: string,
  playerId: number,
): void {
  db.prepare(
    'DELETE FROM guess_candidates WHERE round_id = ? AND spotify_uri = ? AND player_id = ?',
  ).run(roundId, spotifyUri, playerId);
}

export function candidatesForSong(
  db: Database.Database,
  roundId: number,
  spotifyUri: string,
): Candidate[] {
  return (
    db.prepare(
      `SELECT player_id AS playerId, status, certainty, factors, notes
         FROM guess_candidates
        WHERE round_id = ? AND spotify_uri = ?
        ORDER BY player_id`,
    ).all(roundId, spotifyUri) as Candidate[]
  );
}

/**
 * Grid-wide availability, the input to the sudoku dimming. A player locked on any
 * song is 'taken' everywhere; prime-but-not-locked is 'dimmed'. Locked outranks
 * prime, so a player who is prime on one song and locked on another reads taken.
 */
export function playerAvailability(
  db: Database.Database,
  roundId: number,
  mePlayerId: number,
): Map<number, Availability> {
  const out = new Map<number, Availability>();
  for (const pid of eligiblePlayers(db, roundId, mePlayerId)) out.set(pid, 'free');

  const rows = db.prepare(
    `SELECT player_id AS pid, status FROM guess_candidates
      WHERE round_id = ? AND status IN ('prime','locked')`,
  ).all(roundId) as { pid: number; status: 'prime' | 'locked' }[];

  for (const r of rows) {
    if (r.status === 'locked') out.set(r.pid, 'taken');
    else if (out.get(r.pid) !== 'taken') out.set(r.pid, 'dimmed');
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/guessing/candidates.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
cd /home/loydmilligan/Projects/music-league-bot
git add ui/src/lib/guessing/candidates.ts ui/src/lib/guessing/candidates.test.ts
git commit -m "feat(guessing): candidate grid — possible/prime/locked with sudoku availability"
```

---

### Task 5: Derived scoring

**Files:**
- Create: `ui/src/lib/guessing/scoring.ts`
- Test: `ui/src/lib/guessing/scoring.test.ts`

**Interfaces:**
- Consumes: `seedRound`, `reveal` from `./fixtures.js`; `setGutPick`, `lockGut` from `./state.js`
- Produces: `scoreRound(db, roundId, mePlayerId): RoundScore` with
  `RoundScore = { songs: SongScore[]; gutCorrect: number; finalCorrect: number; scored: number }`
  and `SongScore = { spotifyUri, actualPlayerId, gutPickPlayerId, finalPickPlayerId, gutHit, finalHit, confidence, commentWasVisible }`

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/guessing/scoring.test.ts
import { describe, it, expect } from 'vitest';
import { seedRound, reveal } from './fixtures.js';
import { scoreRound } from './scoring.js';

const ME = 1;

function setFinal(db: any, uri: string, pid: number, confidence = 50) {
  db.prepare(
    `INSERT INTO guess_picks (round_id, spotify_uri, final_pick_player_id, confidence, updated_at)
     VALUES (1, ?, ?, ?, '2026-01-01T00:00:00Z')
     ON CONFLICT(round_id, spotify_uri) DO UPDATE
       SET final_pick_player_id = excluded.final_pick_player_id,
           confidence = excluded.confidence`,
  ).run(uri, pid, confidence);
}
function setGut(db: any, uri: string, pid: number) {
  db.prepare(
    `INSERT INTO guess_picks (round_id, spotify_uri, gut_pick_player_id, updated_at)
     VALUES (1, ?, ?, '2026-01-01T00:00:00Z')
     ON CONFLICT(round_id, spotify_uri) DO UPDATE
       SET gut_pick_player_id = excluded.gut_pick_player_id`,
  ).run(uri, pid);
}

describe('derived scoring', () => {
  it('scores gut and final independently, and refinement can beat instinct', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 4, playerCount: 4 });
    reveal(db, { [songs[1]]: players[1], [songs[2]]: players[2], [songs[3]]: players[3] });

    setGut(db, songs[1], players[1]);   // gut right
    setGut(db, songs[2], players[3]);   // gut wrong
    setGut(db, songs[3], players[3]);   // gut right
    setFinal(db, songs[1], players[1]); // stays right
    setFinal(db, songs[2], players[2]); // research fixed it
    setFinal(db, songs[3], players[2]); // research broke it

    const s = scoreRound(db, roundId, ME);
    expect(s.scored).toBe(3);
    expect(s.gutCorrect).toBe(2);
    expect(s.finalCorrect).toBe(2);
    expect(s.songs.find((x) => x.spotifyUri === songs[2])).toMatchObject({
      gutHit: false, finalHit: true,
    });
  });

  it('never scores my own song', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 4, playerCount: 4, mineIndex: 0 });
    reveal(db, { [songs[0]]: players[2], [songs[1]]: players[1] });
    setFinal(db, songs[0], players[2]); // a pick on my own song, which must not score
    const s = scoreRound(db, roundId, ME);
    expect(s.songs.map((x) => x.spotifyUri)).not.toContain(songs[0]);
  });

  it('ignores songs that have not been revealed yet', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 4, playerCount: 4 });
    reveal(db, { [songs[1]]: players[1] }); // only one revealed
    setFinal(db, songs[1], players[1]);
    setFinal(db, songs[2], players[2]);
    const s = scoreRound(db, roundId, ME);
    expect(s.scored).toBe(1);
  });

  it('carries comment visibility through for the scorecard cut', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 4, playerCount: 4 });
    db.prepare('UPDATE ml_submissions SET visible_to_voters = 0 WHERE spotify_uri = ?').run(songs[2]);
    reveal(db, { [songs[1]]: players[1], [songs[2]]: players[2] });
    setFinal(db, songs[1], players[1]);
    setFinal(db, songs[2], players[2]);
    const s = scoreRound(db, roundId, ME);
    expect(s.songs.find((x) => x.spotifyUri === songs[1])!.commentWasVisible).toBe(true);
    expect(s.songs.find((x) => x.spotifyUri === songs[2])!.commentWasVisible).toBe(false);
  });

  it('stores nothing — scoring the same round twice cannot drift', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 3, playerCount: 3 });
    reveal(db, { [songs[1]]: players[1], [songs[2]]: players[2] });
    setFinal(db, songs[1], players[1]);
    const a = scoreRound(db, roundId, ME);
    const b = scoreRound(db, roundId, ME);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/guessing/scoring.test.ts`
Expected: FAIL — cannot resolve `./scoring.js`

- [ ] **Step 3: Implement scoring.ts**

```ts
// ui/src/lib/guessing/scoring.ts
import type Database from 'better-sqlite3';

export interface SongScore {
  spotifyUri: string;
  actualPlayerId: number;
  gutPickPlayerId: number | null;
  finalPickPlayerId: number | null;
  gutHit: boolean;
  finalHit: boolean;
  confidence: number | null;
  commentWasVisible: boolean;
}

export interface RoundScore {
  songs: SongScore[];
  /** songs with a revealed submitter AND a final pick */
  scored: number;
  gutCorrect: number;
  finalCorrect: number;
}

interface Row {
  uri: string;
  actual: number;
  gut: number | null;
  final: number | null;
  confidence: number | null;
  visible: number;
}

/**
 * Accuracy for one revealed round. DERIVED — nothing here is written back.
 * A zip re-import changes ml_submissions and the next call simply reflects it,
 * so there is no stored scoreline that can go stale (spec §8).
 *
 * This is one of only two modules permitted to read ml_submissions.player_id;
 * it runs after reveal, never during a live round.
 */
export function scoreRound(
  db: Database.Database,
  roundId: number,
  mePlayerId: number,
): RoundScore {
  const rows = db.prepare(
    `SELECT ms.spotify_uri            AS uri,
            ms.player_id              AS actual,
            gp.gut_pick_player_id     AS gut,
            gp.final_pick_player_id   AS final,
            gp.confidence             AS confidence,
            ms.visible_to_voters      AS visible
       FROM ml_submissions ms
       LEFT JOIN voting_lab_ballot b
              ON b.round_id = ms.round_id AND b.spotify_uri = ms.spotify_uri
       LEFT JOIN guess_picks gp
              ON gp.round_id = ms.round_id AND gp.spotify_uri = ms.spotify_uri
      WHERE ms.round_id = ?
        AND COALESCE(b.is_mine, 0) = 0
        AND ms.player_id IS NOT NULL
        AND ms.player_id <> ?
      ORDER BY ms.id`,
  ).all(roundId, mePlayerId) as Row[];

  const songs: SongScore[] = rows.map((r) => ({
    spotifyUri: r.uri,
    actualPlayerId: r.actual,
    gutPickPlayerId: r.gut,
    finalPickPlayerId: r.final,
    gutHit: r.gut !== null && r.gut === r.actual,
    finalHit: r.final !== null && r.final === r.actual,
    confidence: r.confidence,
    commentWasVisible: r.visible === 1,
  }));

  const scored = songs.filter((s) => s.finalPickPlayerId !== null).length;
  return {
    songs,
    scored,
    gutCorrect: songs.filter((s) => s.gutHit).length,
    finalCorrect: songs.filter((s) => s.finalHit).length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/guessing/scoring.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Add the anonymity guard test**

```ts
// append to ui/src/lib/guessing/scoring.test.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

it('no live-phase module can read submitter identity (spec §5)', () => {
  const dir = join(process.cwd(), 'src/lib/guessing');
  const allowed = new Set(['scoring.ts', 'sync.ts', 'fixtures.ts']);
  const offenders: string[] = [];

  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts') || f.endsWith('.test.ts') || allowed.has(f)) continue;
    const src = readFileSync(join(dir, f), 'utf8');
    if (/ms\.player_id|ms\.competitor_id|ml_submissions[\s\S]{0,200}?\bplayer_id\b/.test(src)) {
      offenders.push(f);
    }
  }
  expect(offenders, `these modules reach submitter identity: ${offenders.join(', ')}`).toEqual([]);
});
```

- [ ] **Step 6: Run the guard and commit**

Run: `cd ui && npx vitest run src/lib/guessing/scoring.test.ts`
Expected: PASS (6 tests)

```bash
cd /home/loydmilligan/Projects/music-league-bot
git add ui/src/lib/guessing/scoring.ts ui/src/lib/guessing/scoring.test.ts
git commit -m "feat(guessing): derived scoring + anonymity guard test"
```

---

### Task 6: Sync verification against the posted comment

**Files:**
- Create: `ui/src/lib/guessing/sync.ts`
- Test: `ui/src/lib/guessing/sync.test.ts`

**Interfaces:**
- Consumes: `buildGuessMatcher`, `GuessCandidate` from `../digest/guessResolver.js`; `seedRound`, `reveal` from `./fixtures.js`
- Produces: `verifyRoundSync(db, roundId, mePlayerId, now): SyncReport` with
  `SyncReport = { state: 'unverified'|'ok'|'mismatch'; songs: SyncSongReport[] }`

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/guessing/sync.test.ts
import { describe, it, expect } from 'vitest';
import { seedRound } from './fixtures.js';
import { verifyRoundSync } from './sync.js';
import { getRoundState } from './state.js';

const ME = 1;

function storeComment(db: any, uri: string, pid: number, comment: string) {
  db.prepare(
    `INSERT INTO guess_picks (round_id, spotify_uri, final_pick_player_id, comment, updated_at)
     VALUES (1, ?, ?, ?, '2026-01-01T00:00:00Z')`,
  ).run(uri, pid, comment);
}
function postedVote(db: any, uri: string, comment: string) {
  db.prepare(
    `INSERT INTO votes (round_id, voter_id, spotify_uri, points, comment, created_at, player_id)
     VALUES (1, 99, ?, 1, ?, '2026-01-02T00:00:00Z', 1)`,
  ).run(uri, comment);
}

describe('sync verification', () => {
  it('reports ok when the posted comment names the stored pick', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 3, playerCount: 3 });
    db.prepare('UPDATE players SET name = ? WHERE id = ?').run('Jensen', players[1]);
    storeComment(db, songs[1], players[1], 'close enough for me jensen');
    postedVote(db, songs[1], 'close enough for me jensen');

    const r = verifyRoundSync(db, roundId, ME, '2026-01-03T00:00:00Z');
    expect(r.state).toBe('ok');
    expect(getRoundState(db, roundId).syncState).toBe('ok');
  });

  it('flags a mismatch when the posted comment names someone else', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 3, playerCount: 3 });
    db.prepare('UPDATE players SET name = ? WHERE id = ?').run('Jensen', players[1]);
    db.prepare('UPDATE players SET name = ? WHERE id = ?').run('Steiny', players[2]);
    storeComment(db, songs[1], players[1], 'has to be jensen');
    postedVote(db, songs[1], 'changed my mind, steiny');

    const r = verifyRoundSync(db, roundId, ME, '2026-01-03T00:00:00Z');
    expect(r.state).toBe('mismatch');
    expect(r.songs[0]).toMatchObject({ storedPlayerId: players[1], postedPlayerId: players[2] });
  });

  it('never overwrites the stored pick — the report is advisory', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 3, playerCount: 3 });
    db.prepare('UPDATE players SET name = ? WHERE id = ?').run('Jensen', players[1]);
    db.prepare('UPDATE players SET name = ? WHERE id = ?').run('Steiny', players[2]);
    storeComment(db, songs[1], players[1], 'has to be jensen');
    postedVote(db, songs[1], 'changed my mind, steiny');

    verifyRoundSync(db, roundId, ME, '2026-01-03T00:00:00Z');
    const row = db.prepare(
      'SELECT final_pick_player_id AS p FROM guess_picks WHERE round_id=1 AND spotify_uri=?',
    ).get(songs[1]) as { p: number };
    expect(row.p).toBe(players[1]);
  });

  it('stays unverified while no votes have imported yet', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 3, playerCount: 3 });
    storeComment(db, songs[1], players[1], 'jensen');
    const r = verifyRoundSync(db, roundId, ME, '2026-01-03T00:00:00Z');
    expect(r.state).toBe('unverified');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/guessing/sync.test.ts`
Expected: FAIL — cannot resolve `./sync.js`

- [ ] **Step 3: Implement sync.ts**

```ts
// ui/src/lib/guessing/sync.ts
import type Database from 'better-sqlite3';
import { buildGuessMatcher, type GuessCandidate } from '../digest/guessResolver.js';
import { eligiblePlayers } from './assignment.js';

export interface SyncSongReport {
  spotifyUri: string;
  storedPlayerId: number | null;
  postedPlayerId: number | null;
  storedComment: string;
  postedComment: string | null;
  agrees: boolean;
}

export interface SyncReport {
  state: 'unverified' | 'ok' | 'mismatch';
  songs: SyncSongReport[];
}

/**
 * Spec §2: the posted Music League comment is canonical. Once the round's votes
 * import, re-derive the guess from the owner's own posted comment with the same
 * matcher The Guesser uses, and compare it to what we stored.
 *
 * Advisory only. A disagreement is surfaced as a sync error for a human to
 * resolve; nothing is silently rewritten in either direction.
 */
export function verifyRoundSync(
  db: Database.Database,
  roundId: number,
  mePlayerId: number,
  now: string,
): SyncReport {
  const pool = eligiblePlayers(db, roundId, mePlayerId);
  const candidates: GuessCandidate[] =
    pool.length === 0
      ? []
      : (db
          .prepare(
            `SELECT id AS playerId, name AS label FROM players
              WHERE id IN (${pool.map(() => '?').join(',')})`,
          )
          .all(...pool) as GuessCandidate[]);
  const match = buildGuessMatcher(candidates);

  const rows = db.prepare(
    `SELECT gp.spotify_uri          AS uri,
            gp.final_pick_player_id AS stored,
            gp.comment              AS storedComment,
            v.comment               AS postedComment
       FROM guess_picks gp
       LEFT JOIN votes v
              ON v.round_id = gp.round_id
             AND v.spotify_uri = gp.spotify_uri
             AND v.player_id = ?
      WHERE gp.round_id = ?
      ORDER BY gp.spotify_uri`,
  ).all(mePlayerId, roundId) as {
    uri: string; stored: number | null; storedComment: string; postedComment: string | null;
  }[];

  const songs: SyncSongReport[] = rows.map((r) => {
    const postedPlayerId = r.postedComment ? match(r.postedComment) : null;
    return {
      spotifyUri: r.uri,
      storedPlayerId: r.stored,
      postedPlayerId,
      storedComment: r.storedComment,
      postedComment: r.postedComment,
      agrees: postedPlayerId !== null && postedPlayerId === r.stored,
    };
  });

  const anyPosted = songs.some((s) => s.postedComment !== null);
  const state: SyncReport['state'] = !anyPosted
    ? 'unverified'
    : songs.filter((s) => s.postedComment !== null).every((s) => s.agrees)
      ? 'ok'
      : 'mismatch';

  db.prepare(
    `INSERT INTO guess_round_state (round_id, sync_state, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(round_id) DO UPDATE SET sync_state = excluded.sync_state, updated_at = excluded.updated_at`,
  ).run(roundId, state, now);

  return { state, songs };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/guessing/sync.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the whole guessing suite**

Run: `cd ui && npx vitest run src/lib/guessing/`
Expected: PASS — 31 tests across 6 files

- [ ] **Step 6: Commit**

```bash
cd /home/loydmilligan/Projects/music-league-bot
git add ui/src/lib/guessing/sync.ts ui/src/lib/guessing/sync.test.ts
git commit -m "feat(guessing): sync verification — posted comment is canonical"
```

---

## Self-review notes

**Spec coverage.** §2 sync → Task 6. §3 vocabulary → Task 4 status enum. §5 anonymity → Task 5 Step 5 guard. §6 assignment → Task 3. §7.1 gut lock → Task 2. §8 data model → Task 1. Deliberately out of scope for A and unimplemented here: §4 placement, §7.2–7.7 (projects B/C/D), §9 scorecard (E), §11 staged, §12's scorecard-with-no-data case (E).

**Deviation from the spec worth noting at review.** §8 lists four tables; this plan creates **five**, splitting the per-song AI headline (`ai_pick` / `ai_certainty` / `ai_factors`) into `guess_ai_song` rather than hanging it off `guess_ai_distribution`, whose grain is per-player. The spec's "+ per-song ai_pick / ai_certainty / ai_factors" line anticipated it without naming a table.

**Known soft spot.** `eligiblePlayers` in Task 3 uses a UNION against `season_players` to include roster members who have not submitted in the league yet. No test in this plan depends on that branch, and Task 3 Step 4 says so — if it misbehaves against real data, drop the UNION.

**Open questions carried forward** (spec §13): which leagues opt in; whether to backfill the two existing Boarz rounds of hand-written guesses; round-over-round candidate memory. None block this plan. Open question 3 (confidence scale) is **resolved** in Global Constraints.
