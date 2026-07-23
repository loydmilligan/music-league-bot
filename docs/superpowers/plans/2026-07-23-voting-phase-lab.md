# Voting Phase Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal voting-phase scratchpad where the owner studies a round's playlist, allocates an editable vote budget, gets a personalized per-song LLM "track lens", and drafts vote comments in their own voice.

**Architecture:** One reusable `VotingLab.svelte` component mounted on two existing pages (active-round page when `phase == 'voting'`, and the round-detail page) — no new top-level route. The component is decoupled from either host's `load()` and talks only to its own JSON endpoints under `ui/src/routes/api/voting-lab/[roundId]/…`. All allocation math lives in a pure, heavily-tested module. Two new LLM tasks ride the existing `predict/` framework.

**Tech Stack:** SvelteKit 2.57 + Svelte 5 (runes), TypeScript, better-sqlite3, Zod 4, Vitest 4, TailwindCSS 4, OpenRouter via `callOpenRouter`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-23-voting-phase-lab-design.md`.
- All work happens in `ui/`. Run tests from `ui/` with `npx vitest run <path>`.
- TypeScript imports of local modules use the `.js` extension (ESM), e.g. `./budget.js`.
- Tests are co-located next to source as `*.test.ts` (repo convention), using `import { it, expect } from 'vitest'`.
- New tables go in `ui/src/lib/db/schema.ts` inside the `SCHEMA` template string using `CREATE TABLE IF NOT EXISTS` — this runs on every boot via `openLeagueDb`, so no separate migration file is needed.
- **Never** show submitter identity in the lab UI or in any LLM prompt. Live rounds have `ml_submissions.competitor_id` NULL; keep it hidden on past rounds too.
- The lab **never** submits to Music League. Copy-out only.
- The per-song LLM take must contain **no** vote recommendation, score, or up/down lean — perspective on the track only.
- Voice sample for comment drafting is pulled across **all** leagues.
- Money/points are integers. Up and down are **separate pools**; `is_mine` songs are never allocatable.

---

## File Structure

**Create:**
- `ui/src/lib/voting-lab/types.ts` — shared types for the whole feature
- `ui/src/lib/voting-lab/budget.ts` — pure allocation/budget math (no DB)
- `ui/src/lib/voting-lab/budget.test.ts`
- `ui/src/lib/voting-lab/ballotDb.ts` — read/write ballot rows + budget rows + inheritance resolver
- `ui/src/lib/voting-lab/ballotDb.test.ts`
- `ui/src/lib/voting-lab/labData.ts` — assembles the round payload (songs + metadata + ballot + budget)
- `ui/src/lib/voting-lab/labData.test.ts`
- `ui/src/lib/voting-lab/voiceSample.ts` — pulls the owner's past vote comments
- `ui/src/lib/voting-lab/voiceSample.test.ts`
- `ui/src/lib/voting-lab/liveSync.ts` — musicleague CLI → `ml_submissions` adapter
- `ui/src/lib/voting-lab/liveSync.test.ts`
- `ui/src/lib/predict/tasks/votingTake.ts` — LLM Task 1 (track lens)
- `ui/src/lib/predict/tasks/votingTake.test.ts`
- `ui/src/lib/predict/tasks/voteComment.ts` — LLM Task 2 (comment drafter)
- `ui/src/lib/predict/tasks/voteComment.test.ts`
- `ui/src/lib/components/VotingLab.svelte` — the lab shell (budget meter, rows, summary)
- `ui/src/lib/components/VotingLabSongRow.svelte` — one song row
- `ui/src/routes/api/voting-lab/[roundId]/+server.ts` — GET load
- `ui/src/routes/api/voting-lab/[roundId]/ballot/+server.ts` — PATCH save one song's ballot
- `ui/src/routes/api/voting-lab/[roundId]/budget/+server.ts` — PUT per-round budget override
- `ui/src/routes/api/voting-lab/[roundId]/sync/+server.ts` — POST live sync
- `ui/src/routes/api/voting-lab/[roundId]/take/+server.ts` — POST per-song take
- `ui/src/routes/api/voting-lab/[roundId]/comment/+server.ts` — POST comment draft
- `ui/src/routes/api/settings/season-budget/+server.ts` — PUT season default budget

**Modify:**
- `ui/src/lib/db/schema.ts` — add 3 tables
- `ui/src/routes/+page.svelte` — mount `VotingLab` when the current round is in voting
- `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte` — mount `VotingLab`
- `ui/src/routes/settings/+page.svelte` — season budget editor on each season node

---

### Task 1: Schema — three new tables

**Files:**
- Modify: `ui/src/lib/db/schema.ts`
- Create: `ui/src/lib/voting-lab/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `voting_lab_ballot`, `voting_lab_budget`, `season_vote_budget` available to every later task.

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/voting-lab/schema.test.ts`:

```ts
import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';

function tableNames(): string[] {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  const rows = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table'`,
  ).all() as { name: string }[];
  db.close();
  return rows.map((r) => r.name);
}

it('creates the three voting-lab tables', () => {
  const names = tableNames();
  expect(names).toContain('voting_lab_ballot');
  expect(names).toContain('voting_lab_budget');
  expect(names).toContain('season_vote_budget');
});

it('voting_lab_ballot is keyed by (round_id, spotify_uri)', () => {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare(
    `INSERT INTO voting_lab_ballot (round_id, spotify_uri, up_points, down_points, updated_at)
     VALUES (1, 'spotify:track:a', 2, 0, '2026-07-23T00:00:00Z')`,
  ).run();
  // Same key again must conflict (PK), proving the composite primary key exists.
  expect(() =>
    db.prepare(
      `INSERT INTO voting_lab_ballot (round_id, spotify_uri, up_points, down_points, updated_at)
       VALUES (1, 'spotify:track:a', 3, 0, '2026-07-23T00:00:00Z')`,
    ).run(),
  ).toThrow();
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/voting-lab/schema.test.ts`
Expected: FAIL — `expected [...] to contain 'voting_lab_ballot'`

- [ ] **Step 3: Add the tables to SCHEMA**

In `ui/src/lib/db/schema.ts`, append these three tables inside the `SCHEMA` template literal (before its closing backtick):

```sql
  -- Voting Phase Lab (2026-07-23): the owner's private per-round scratchpad.
  -- One row per (round, song). Never submitted anywhere — copy-out only.
  CREATE TABLE IF NOT EXISTS voting_lab_ballot (
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    spotify_uri TEXT NOT NULL,
    up_points INTEGER NOT NULL DEFAULT 0,
    down_points INTEGER NOT NULL DEFAULT 0,
    rating INTEGER,
    notes TEXT NOT NULL DEFAULT '',
    draft_comment TEXT NOT NULL DEFAULT '',
    is_mine INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (round_id, spotify_uri)
  );
  -- Per-round budget override. Absent row => inherit the season default.
  CREATE TABLE IF NOT EXISTS voting_lab_budget (
    round_id INTEGER PRIMARY KEY REFERENCES rounds(id),
    up_total INTEGER NOT NULL,
    down_total INTEGER NOT NULL,
    per_song_cap INTEGER,
    updated_at TEXT NOT NULL
  );
  -- Season-level default budget, edited in Settings. Rosters grow within a
  -- season, so season is the right grain; rounds may still override.
  CREATE TABLE IF NOT EXISTS season_vote_budget (
    season_id INTEGER PRIMARY KEY REFERENCES seasons(id),
    up_total INTEGER NOT NULL,
    down_total INTEGER NOT NULL,
    per_song_cap INTEGER,
    updated_at TEXT NOT NULL
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/voting-lab/schema.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/db/schema.ts ui/src/lib/voting-lab/schema.test.ts
git commit -m "feat(voting-lab): add ballot, round-budget and season-budget tables"
```

---

### Task 2: Pure budget & allocation math

This is the correctness-critical piece. No DB access — pure functions only.

**Files:**
- Create: `ui/src/lib/voting-lab/types.ts`
- Create: `ui/src/lib/voting-lab/budget.ts`
- Create: `ui/src/lib/voting-lab/budget.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface VoteBudget { upTotal: number; downTotal: number; perSongCap: number | null }`
  - `interface BallotEntry { spotifyUri: string; upPoints: number; downPoints: number; rating: number | null; notes: string; draftComment: string; isMine: boolean }`
  - `interface BudgetUsage { upUsed: number; downUsed: number; upRemaining: number; downRemaining: number }`
  - `computeUsage(entries: BallotEntry[], budget: VoteBudget): BudgetUsage`
  - `canAllocate(entries: BallotEntry[], budget: VoteBudget, spotifyUri: string, kind: 'up' | 'down', delta: number): boolean`
  - `validateBallot(entries: BallotEntry[], budget: VoteBudget): string[]`

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/voting-lab/budget.test.ts`:

```ts
import { it, expect } from 'vitest';
import { computeUsage, canAllocate, validateBallot } from './budget.js';
import type { BallotEntry, VoteBudget } from './types.js';

const BUDGET: VoteBudget = { upTotal: 7, downTotal: 2, perSongCap: null };

function entry(p: Partial<BallotEntry> & { spotifyUri: string }): BallotEntry {
  return {
    upPoints: 0, downPoints: 0, rating: null, notes: '',
    draftComment: '', isMine: false, ...p,
  };
}

it('computes usage and remaining for both pools', () => {
  const entries = [entry({ spotifyUri: 'a', upPoints: 3 }), entry({ spotifyUri: 'b', upPoints: 2, downPoints: 1 })];
  expect(computeUsage(entries, BUDGET)).toEqual({
    upUsed: 5, downUsed: 1, upRemaining: 2, downRemaining: 1,
  });
});

it('allows an allocation that fits the pool', () => {
  const entries = [entry({ spotifyUri: 'a', upPoints: 6 })];
  expect(canAllocate(entries, BUDGET, 'a', 'up', 1)).toBe(true);
});

it('blocks an allocation that would exceed the up pool', () => {
  const entries = [entry({ spotifyUri: 'a', upPoints: 7 })];
  expect(canAllocate(entries, BUDGET, 'a', 'up', 1)).toBe(false);
});

it('keeps up and down pools separate', () => {
  const entries = [entry({ spotifyUri: 'a', upPoints: 7 })];
  // up pool exhausted, but down pool is untouched
  expect(canAllocate(entries, BUDGET, 'a', 'down', 1)).toBe(true);
});

it('never allows allocating to your own song', () => {
  const entries = [entry({ spotifyUri: 'mine', isMine: true })];
  expect(canAllocate(entries, BUDGET, 'mine', 'up', 1)).toBe(false);
  expect(canAllocate(entries, BUDGET, 'mine', 'down', 1)).toBe(false);
});

it('blocks going below zero on a song', () => {
  const entries = [entry({ spotifyUri: 'a', upPoints: 0 })];
  expect(canAllocate(entries, BUDGET, 'a', 'up', -1)).toBe(false);
});

it('enforces per-song cap when set', () => {
  const capped: VoteBudget = { upTotal: 7, downTotal: 2, perSongCap: 3 };
  const entries = [entry({ spotifyUri: 'a', upPoints: 3 })];
  expect(canAllocate(entries, capped, 'a', 'up', 1)).toBe(false);
  expect(canAllocate(entries, capped, 'a', 'up', -1)).toBe(true);
});

it('returns no violations for a valid ballot', () => {
  const entries = [entry({ spotifyUri: 'a', upPoints: 7 }), entry({ spotifyUri: 'b', downPoints: 2 })];
  expect(validateBallot(entries, BUDGET)).toEqual([]);
});

it('reports over-spend violations', () => {
  const entries = [entry({ spotifyUri: 'a', upPoints: 9 })];
  const problems = validateBallot(entries, BUDGET);
  expect(problems.length).toBeGreaterThan(0);
  expect(problems[0]).toContain('up');
});

it('reports allocation on your own song as a violation', () => {
  const entries = [entry({ spotifyUri: 'mine', isMine: true, upPoints: 1 })];
  expect(validateBallot(entries, BUDGET).some((p) => p.includes('own'))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/voting-lab/budget.test.ts`
Expected: FAIL — cannot resolve `./budget.js`

- [ ] **Step 3: Write types and implementation**

Create `ui/src/lib/voting-lab/types.ts`:

```ts
/** Shared types for the Voting Phase Lab. */

export interface VoteBudget {
  upTotal: number;
  downTotal: number;
  /** null = no per-song cap. */
  perSongCap: number | null;
}

export interface BallotEntry {
  spotifyUri: string;
  upPoints: number;
  downPoints: number;
  rating: number | null;
  notes: string;
  draftComment: string;
  /** The owner's own submission — never allocatable. */
  isMine: boolean;
}

export interface BudgetUsage {
  upUsed: number;
  downUsed: number;
  upRemaining: number;
  downRemaining: number;
}

/** One song in the lab, with the metadata the UI surfaces. */
export interface LabSong {
  spotifyUri: string;
  title: string;
  artist: string;
  albumArtUrl: string | null;
  spotifyPopularity: number | null;
  listeners: number | null;
  bpm: number | null;
  energy: number | null;
  hasLyrics: boolean | null;
  tags: string[];
}

export interface LabRow {
  song: LabSong;
  ballot: BallotEntry;
}

export type BudgetSource = 'round' | 'season' | 'default';

export interface LabData {
  roundId: number;
  themeName: string;
  themeDescription: string;
  budget: VoteBudget;
  budgetSource: BudgetSource;
  rows: LabRow[];
}
```

Create `ui/src/lib/voting-lab/budget.ts`:

```ts
import type { BallotEntry, BudgetUsage, VoteBudget } from './types.js';

/** Total points spent from each pool, and what's left. */
export function computeUsage(entries: BallotEntry[], budget: VoteBudget): BudgetUsage {
  let upUsed = 0;
  let downUsed = 0;
  for (const e of entries) {
    upUsed += e.upPoints;
    downUsed += e.downPoints;
  }
  return {
    upUsed,
    downUsed,
    upRemaining: budget.upTotal - upUsed,
    downRemaining: budget.downTotal - downUsed,
  };
}

/**
 * Can we apply `delta` (usually +1 / -1) to this song's `kind` pool?
 * Guards: own song, negative result, pool exhaustion, per-song cap.
 */
export function canAllocate(
  entries: BallotEntry[],
  budget: VoteBudget,
  spotifyUri: string,
  kind: 'up' | 'down',
  delta: number,
): boolean {
  const target = entries.find((e) => e.spotifyUri === spotifyUri);
  if (!target) return false;
  if (target.isMine) return false;

  const current = kind === 'up' ? target.upPoints : target.downPoints;
  const next = current + delta;
  if (next < 0) return false;

  if (budget.perSongCap !== null && next > budget.perSongCap) return false;

  const usage = computeUsage(entries, budget);
  const remaining = kind === 'up' ? usage.upRemaining : usage.downRemaining;
  // Spending more than remains is blocked; giving points back always fits.
  if (delta > 0 && delta > remaining) return false;

  return true;
}

/** Human-readable violations. Empty array = ballot is submittable as-is. */
export function validateBallot(entries: BallotEntry[], budget: VoteBudget): string[] {
  const problems: string[] = [];
  const usage = computeUsage(entries, budget);

  if (usage.upUsed > budget.upTotal) {
    problems.push(`Over budget: ${usage.upUsed} up points allocated, only ${budget.upTotal} available.`);
  }
  if (usage.downUsed > budget.downTotal) {
    problems.push(`Over budget: ${usage.downUsed} down points allocated, only ${budget.downTotal} available.`);
  }
  for (const e of entries) {
    if (e.isMine && (e.upPoints > 0 || e.downPoints > 0)) {
      problems.push(`You cannot vote on your own song (${e.spotifyUri}).`);
    }
    if (e.upPoints < 0 || e.downPoints < 0) {
      problems.push(`Negative allocation on ${e.spotifyUri}.`);
    }
    if (budget.perSongCap !== null && (e.upPoints > budget.perSongCap || e.downPoints > budget.perSongCap)) {
      problems.push(`${e.spotifyUri} exceeds the per-song cap of ${budget.perSongCap}.`);
    }
  }
  return problems;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/voting-lab/budget.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/voting-lab/types.ts ui/src/lib/voting-lab/budget.ts ui/src/lib/voting-lab/budget.test.ts
git commit -m "feat(voting-lab): pure budget and allocation math"
```

---

### Task 3: Budget persistence + season→round inheritance

**Files:**
- Create: `ui/src/lib/voting-lab/ballotDb.ts`
- Create: `ui/src/lib/voting-lab/ballotDb.test.ts`

**Interfaces:**
- Consumes: `VoteBudget`, `BudgetSource` from `./types.js`.
- Produces:
  - `DEFAULT_BUDGET: VoteBudget` (`{ upTotal: 7, downTotal: 1, perSongCap: null }`)
  - `resolveBudget(db, roundId): { budget: VoteBudget; source: BudgetSource }`
  - `setRoundBudget(db, roundId, budget): void`
  - `setSeasonBudget(db, seasonId, budget): void`
  - `getSeasonBudget(db, seasonId): VoteBudget | null`

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/voting-lab/ballotDb.test.ts`:

```ts
import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';
import {
  DEFAULT_BUDGET, resolveBudget, setRoundBudget, setSeasonBudget, getSeasonBudget,
} from './ballotDb.js';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1, 'test', 'Test')`).run();
  db.prepare(
    `INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 1, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at, phase)
     VALUES (100, 10, 'ml-100', 'Round 1', '2026-07-01T00:00:00Z', 'voting')`,
  ).run();
  return db;
}

it('falls back to the default budget when nothing is configured', () => {
  const db = freshDb();
  const { budget, source } = resolveBudget(db, 100);
  expect(budget).toEqual(DEFAULT_BUDGET);
  expect(source).toBe('default');
  db.close();
});

it('inherits the season budget when no round override exists', () => {
  const db = freshDb();
  setSeasonBudget(db, 10, { upTotal: 8, downTotal: 2, perSongCap: 4 });
  const { budget, source } = resolveBudget(db, 100);
  expect(budget).toEqual({ upTotal: 8, downTotal: 2, perSongCap: 4 });
  expect(source).toBe('season');
  db.close();
});

it('prefers the round override over the season budget', () => {
  const db = freshDb();
  setSeasonBudget(db, 10, { upTotal: 8, downTotal: 2, perSongCap: null });
  setRoundBudget(db, 100, { upTotal: 6, downTotal: 1, perSongCap: null });
  const { budget, source } = resolveBudget(db, 100);
  expect(budget).toEqual({ upTotal: 6, downTotal: 1, perSongCap: null });
  expect(source).toBe('round');
  db.close();
});

it('upserts the season budget instead of duplicating', () => {
  const db = freshDb();
  setSeasonBudget(db, 10, { upTotal: 8, downTotal: 2, perSongCap: null });
  setSeasonBudget(db, 10, { upTotal: 9, downTotal: 1, perSongCap: null });
  expect(getSeasonBudget(db, 10)).toEqual({ upTotal: 9, downTotal: 1, perSongCap: null });
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/voting-lab/ballotDb.test.ts`
Expected: FAIL — cannot resolve `./ballotDb.js`

- [ ] **Step 3: Write the implementation**

Create `ui/src/lib/voting-lab/ballotDb.ts`:

```ts
import type Database from 'better-sqlite3';
import type { BudgetSource, VoteBudget } from './types.js';

/** Used only when neither a round override nor a season default exists. */
export const DEFAULT_BUDGET: VoteBudget = { upTotal: 7, downTotal: 1, perSongCap: null };

type BudgetRow = { up_total: number; down_total: number; per_song_cap: number | null };

function toBudget(row: BudgetRow): VoteBudget {
  return { upTotal: row.up_total, downTotal: row.down_total, perSongCap: row.per_song_cap };
}

export function getSeasonBudget(db: Database.Database, seasonId: number): VoteBudget | null {
  const row = db.prepare(
    `SELECT up_total, down_total, per_song_cap FROM season_vote_budget WHERE season_id = ?`,
  ).get(seasonId) as BudgetRow | undefined;
  return row ? toBudget(row) : null;
}

export function setSeasonBudget(db: Database.Database, seasonId: number, budget: VoteBudget): void {
  db.prepare(
    `INSERT INTO season_vote_budget (season_id, up_total, down_total, per_song_cap, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(season_id) DO UPDATE SET
       up_total = excluded.up_total,
       down_total = excluded.down_total,
       per_song_cap = excluded.per_song_cap,
       updated_at = excluded.updated_at`,
  ).run(seasonId, budget.upTotal, budget.downTotal, budget.perSongCap, new Date().toISOString());
}

export function setRoundBudget(db: Database.Database, roundId: number, budget: VoteBudget): void {
  db.prepare(
    `INSERT INTO voting_lab_budget (round_id, up_total, down_total, per_song_cap, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(round_id) DO UPDATE SET
       up_total = excluded.up_total,
       down_total = excluded.down_total,
       per_song_cap = excluded.per_song_cap,
       updated_at = excluded.updated_at`,
  ).run(roundId, budget.upTotal, budget.downTotal, budget.perSongCap, new Date().toISOString());
}

/**
 * Round override -> season default -> hardcoded default.
 * `source` tells the UI which level it is showing so it can label it.
 */
export function resolveBudget(
  db: Database.Database,
  roundId: number,
): { budget: VoteBudget; source: BudgetSource } {
  const roundRow = db.prepare(
    `SELECT up_total, down_total, per_song_cap FROM voting_lab_budget WHERE round_id = ?`,
  ).get(roundId) as BudgetRow | undefined;
  if (roundRow) return { budget: toBudget(roundRow), source: 'round' };

  const seasonRow = db.prepare(
    `SELECT b.up_total, b.down_total, b.per_song_cap
     FROM rounds r
     JOIN season_vote_budget b ON b.season_id = r.season_id
     WHERE r.id = ?`,
  ).get(roundId) as BudgetRow | undefined;
  if (seasonRow) return { budget: toBudget(seasonRow), source: 'season' };

  return { budget: DEFAULT_BUDGET, source: 'default' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/voting-lab/ballotDb.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/voting-lab/ballotDb.ts ui/src/lib/voting-lab/ballotDb.test.ts
git commit -m "feat(voting-lab): budget persistence with season-to-round inheritance"
```

---

### Task 4: Ballot row persistence

**Files:**
- Modify: `ui/src/lib/voting-lab/ballotDb.ts`
- Modify: `ui/src/lib/voting-lab/ballotDb.test.ts`

**Interfaces:**
- Consumes: `BallotEntry` from `./types.js`.
- Produces:
  - `getBallot(db, roundId): BallotEntry[]`
  - `saveBallotEntry(db, roundId, entry: BallotEntry): void`

- [ ] **Step 1: Write the failing test**

Append to `ui/src/lib/voting-lab/ballotDb.test.ts` (and extend the import at the top to include `getBallot, saveBallotEntry`):

```ts
import { getBallot, saveBallotEntry } from './ballotDb.js';
import type { BallotEntry } from './types.js';

const ENTRY: BallotEntry = {
  spotifyUri: 'spotify:track:a', upPoints: 2, downPoints: 0, rating: 4,
  notes: 'punchy chorus', draftComment: 'Loved this one.', isMine: false,
};

it('saves and reads back a ballot entry', () => {
  const db = freshDb();
  saveBallotEntry(db, 100, ENTRY);
  expect(getBallot(db, 100)).toEqual([ENTRY]);
  db.close();
});

it('updates in place rather than duplicating', () => {
  const db = freshDb();
  saveBallotEntry(db, 100, ENTRY);
  saveBallotEntry(db, 100, { ...ENTRY, upPoints: 5, notes: 'changed' });
  const rows = getBallot(db, 100);
  expect(rows).toHaveLength(1);
  expect(rows[0].upPoints).toBe(5);
  expect(rows[0].notes).toBe('changed');
  db.close();
});

it('round-trips is_mine as a boolean', () => {
  const db = freshDb();
  saveBallotEntry(db, 100, { ...ENTRY, isMine: true, upPoints: 0 });
  expect(getBallot(db, 100)[0].isMine).toBe(true);
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/voting-lab/ballotDb.test.ts`
Expected: FAIL — `getBallot` is not exported

- [ ] **Step 3: Add the implementation**

Append to `ui/src/lib/voting-lab/ballotDb.ts`:

```ts
import type { BallotEntry } from './types.js';

type BallotRow = {
  spotify_uri: string; up_points: number; down_points: number;
  rating: number | null; notes: string; draft_comment: string; is_mine: number;
};

export function getBallot(db: Database.Database, roundId: number): BallotEntry[] {
  const rows = db.prepare(
    `SELECT spotify_uri, up_points, down_points, rating, notes, draft_comment, is_mine
     FROM voting_lab_ballot WHERE round_id = ? ORDER BY spotify_uri`,
  ).all(roundId) as BallotRow[];
  return rows.map((r) => ({
    spotifyUri: r.spotify_uri,
    upPoints: r.up_points,
    downPoints: r.down_points,
    rating: r.rating,
    notes: r.notes,
    draftComment: r.draft_comment,
    isMine: r.is_mine === 1,
  }));
}

export function saveBallotEntry(db: Database.Database, roundId: number, entry: BallotEntry): void {
  db.prepare(
    `INSERT INTO voting_lab_ballot
       (round_id, spotify_uri, up_points, down_points, rating, notes, draft_comment, is_mine, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(round_id, spotify_uri) DO UPDATE SET
       up_points = excluded.up_points,
       down_points = excluded.down_points,
       rating = excluded.rating,
       notes = excluded.notes,
       draft_comment = excluded.draft_comment,
       is_mine = excluded.is_mine,
       updated_at = excluded.updated_at`,
  ).run(
    roundId, entry.spotifyUri, entry.upPoints, entry.downPoints,
    entry.rating, entry.notes, entry.draftComment, entry.isMine ? 1 : 0,
    new Date().toISOString(),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/voting-lab/ballotDb.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/voting-lab/ballotDb.ts ui/src/lib/voting-lab/ballotDb.test.ts
git commit -m "feat(voting-lab): ballot row read/write"
```

---

### Task 5: Assemble the lab payload

Joins the round's songs with metadata, the saved ballot, and the resolved budget.

**Files:**
- Create: `ui/src/lib/voting-lab/labData.ts`
- Create: `ui/src/lib/voting-lab/labData.test.ts`

**Interfaces:**
- Consumes: `resolveBudget`, `getBallot` from `./ballotDb.js`; `LabData`, `LabRow`, `LabSong`, `BallotEntry` from `./types.js`.
- Produces: `buildLabData(db, roundId): LabData`

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/voting-lab/labData.test.ts`:

```ts
import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';
import { buildLabData } from './labData.js';
import { saveBallotEntry, setRoundBudget } from './ballotDb.js';

function dbWithRound() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1, 'test', 'Test')`).run();
  db.prepare(`INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 1, 'active')`).run();
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, description, created_at, phase)
     VALUES (100, 10, 'ml-100', 'Songs in a language other than English', 'Non-English only', '2026-07-01T00:00:00Z', 'voting')`,
  ).run();
  db.prepare(
    `INSERT INTO ml_submissions (round_id, spotify_uri, title, artists, album, album_art_url, visible_to_voters)
     VALUES (100, 'spotify:track:a', 'Song A', 'Artist A', 'Album A', 'http://art/a.jpg', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO ml_submissions (round_id, spotify_uri, title, artists, album, album_art_url, visible_to_voters)
     VALUES (100, 'spotify:track:b', 'Song B', 'Artist B', 'Album B', NULL, 1)`,
  ).run();
  return db;
}

it('returns one row per submitted song with theme info', () => {
  const db = dbWithRound();
  const data = buildLabData(db, 100);
  expect(data.roundId).toBe(100);
  expect(data.themeName).toBe('Songs in a language other than English');
  expect(data.themeDescription).toBe('Non-English only');
  expect(data.rows).toHaveLength(2);
  expect(data.rows[0].song.title).toBe('Song A');
  expect(data.rows[0].song.artist).toBe('Artist A');
  db.close();
});

it('defaults every song to an empty ballot entry', () => {
  const db = dbWithRound();
  const row = buildLabData(db, 100).rows[0];
  expect(row.ballot.upPoints).toBe(0);
  expect(row.ballot.downPoints).toBe(0);
  expect(row.ballot.notes).toBe('');
  expect(row.ballot.isMine).toBe(false);
  db.close();
});

it('merges saved ballot entries onto the right song', () => {
  const db = dbWithRound();
  saveBallotEntry(db, 100, {
    spotifyUri: 'spotify:track:b', upPoints: 3, downPoints: 0, rating: 5,
    notes: 'banger', draftComment: '', isMine: false,
  });
  const rows = buildLabData(db, 100).rows;
  const b = rows.find((r) => r.song.spotifyUri === 'spotify:track:b')!;
  const a = rows.find((r) => r.song.spotifyUri === 'spotify:track:a')!;
  expect(b.ballot.upPoints).toBe(3);
  expect(b.ballot.notes).toBe('banger');
  expect(a.ballot.upPoints).toBe(0);
  db.close();
});

it('includes the resolved budget and its source', () => {
  const db = dbWithRound();
  setRoundBudget(db, 100, { upTotal: 6, downTotal: 2, perSongCap: 3 });
  const data = buildLabData(db, 100);
  expect(data.budget).toEqual({ upTotal: 6, downTotal: 2, perSongCap: 3 });
  expect(data.budgetSource).toBe('round');
  db.close();
});

it('surfaces song metadata when present', () => {
  const db = dbWithRound();
  db.prepare(
    `INSERT INTO song_popularity (spotify_uri, listeners, spotify_popularity, tags)
     VALUES ('spotify:track:a', 12345, 42, 'shoegaze, dream pop')`,
  ).run();
  db.prepare(
    `INSERT INTO song_audio_features (spotify_uri, bpm, energy) VALUES ('spotify:track:a', 128, 0.7)`,
  ).run();
  db.prepare(
    `INSERT INTO song_lyrics_metrics (spotify_uri, has_lyrics) VALUES ('spotify:track:a', 1)`,
  ).run();
  const a = buildLabData(db, 100).rows.find((r) => r.song.spotifyUri === 'spotify:track:a')!;
  expect(a.song.listeners).toBe(12345);
  expect(a.song.spotifyPopularity).toBe(42);
  expect(a.song.bpm).toBe(128);
  expect(a.song.energy).toBeCloseTo(0.7);
  expect(a.song.hasLyrics).toBe(true);
  expect(a.song.tags).toEqual(['shoegaze', 'dream pop']);
  db.close();
});

it('throws for an unknown round', () => {
  const db = dbWithRound();
  expect(() => buildLabData(db, 999)).toThrow();
  db.close();
});
```

> **Note for the implementer:** if a column referenced above (e.g. `song_popularity.tags`) does not exist in `SCHEMA`, run `sqlite3 data/league.db ".schema song_popularity"` and adjust the SELECT to the real column names rather than adding columns.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/voting-lab/labData.test.ts`
Expected: FAIL — cannot resolve `./labData.js`

- [ ] **Step 3: Write the implementation**

Create `ui/src/lib/voting-lab/labData.ts`:

```ts
import type Database from 'better-sqlite3';
import { getBallot, resolveBudget } from './ballotDb.js';
import type { BallotEntry, LabData, LabRow, LabSong } from './types.js';

type RoundRow = { id: number; name: string; description: string | null };

type SongRow = {
  spotify_uri: string;
  title: string;
  artists: string | null;
  album_art_url: string | null;
  listeners: number | null;
  spotify_popularity: number | null;
  tags: string | null;
  bpm: number | null;
  energy: number | null;
  has_lyrics: number | null;
};

function emptyBallot(spotifyUri: string): BallotEntry {
  return {
    spotifyUri, upPoints: 0, downPoints: 0, rating: null,
    notes: '', draftComment: '', isMine: false,
  };
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

/**
 * Everything the lab needs for one round: the songs (submitter deliberately
 * NOT selected — the lab never shows or sends it), their metadata, the saved
 * ballot merged in, and the resolved budget.
 */
export function buildLabData(db: Database.Database, roundId: number): LabData {
  const round = db.prepare(
    `SELECT id, name, description FROM rounds WHERE id = ?`,
  ).get(roundId) as RoundRow | undefined;
  if (!round) throw new Error(`buildLabData: unknown round ${roundId}`);

  const songRows = db.prepare(
    `SELECT s.spotify_uri, s.title, s.artists, s.album_art_url,
            p.listeners, p.spotify_popularity, p.tags,
            a.bpm, a.energy,
            l.has_lyrics
     FROM ml_submissions s
     LEFT JOIN song_popularity     p ON p.spotify_uri = s.spotify_uri
     LEFT JOIN song_audio_features a ON a.spotify_uri = s.spotify_uri
     LEFT JOIN song_lyrics_metrics l ON l.spotify_uri = s.spotify_uri
     WHERE s.round_id = ?
     ORDER BY s.id`,
  ).all(roundId) as SongRow[];

  const saved = new Map(getBallot(db, roundId).map((e) => [e.spotifyUri, e]));

  const rows: LabRow[] = songRows.map((r) => {
    const song: LabSong = {
      spotifyUri: r.spotify_uri,
      title: r.title,
      artist: r.artists ?? '',
      albumArtUrl: r.album_art_url,
      spotifyPopularity: r.spotify_popularity,
      listeners: r.listeners,
      bpm: r.bpm,
      energy: r.energy,
      hasLyrics: r.has_lyrics === null ? null : r.has_lyrics === 1,
      tags: parseTags(r.tags),
    };
    return { song, ballot: saved.get(r.spotify_uri) ?? emptyBallot(r.spotify_uri) };
  });

  const { budget, source } = resolveBudget(db, roundId);

  return {
    roundId: round.id,
    themeName: round.name,
    themeDescription: round.description ?? '',
    budget,
    budgetSource: source,
    rows,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/voting-lab/labData.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/voting-lab/labData.ts ui/src/lib/voting-lab/labData.test.ts
git commit -m "feat(voting-lab): assemble round payload (songs + metadata + ballot + budget)"
```

---

### Task 6: Load / save / budget endpoints

**Files:**
- Create: `ui/src/routes/api/voting-lab/[roundId]/+server.ts`
- Create: `ui/src/routes/api/voting-lab/[roundId]/ballot/+server.ts`
- Create: `ui/src/routes/api/voting-lab/[roundId]/budget/+server.ts`

**Interfaces:**
- Consumes: `buildLabData`, `saveBallotEntry`, `setRoundBudget`.
- Produces: HTTP contract used by `VotingLab.svelte`:
  - `GET /api/voting-lab/:roundId` → `LabData`
  - `PATCH /api/voting-lab/:roundId/ballot` body `BallotEntry` → `{ ok: true }`
  - `PUT /api/voting-lab/:roundId/budget` body `VoteBudget` → `{ ok: true }`

- [ ] **Step 1: Write the GET endpoint**

Create `ui/src/routes/api/voting-lab/[roundId]/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { buildLabData } from '$lib/voting-lab/labData.js';

export const GET: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');
  try {
    return json(buildLabData(getDb(), roundId));
  } catch (e) {
    throw error(404, e instanceof Error ? e.message : 'round not found');
  }
};
```

- [ ] **Step 2: Write the ballot PATCH endpoint**

Create `ui/src/routes/api/voting-lab/[roundId]/ballot/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/db/client.js';
import { saveBallotEntry } from '$lib/voting-lab/ballotDb.js';

const BallotEntrySchema = z.object({
  spotifyUri: z.string().min(1),
  upPoints: z.number().int().min(0),
  downPoints: z.number().int().min(0),
  rating: z.number().int().min(1).max(5).nullable(),
  notes: z.string(),
  draftComment: z.string(),
  isMine: z.boolean(),
});

export const PATCH: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');

  const parsed = BallotEntrySchema.safeParse(await request.json());
  if (!parsed.success) throw error(400, parsed.error.message);

  saveBallotEntry(getDb(), roundId, parsed.data);
  return json({ ok: true });
};
```

- [ ] **Step 3: Write the budget PUT endpoint**

Create `ui/src/routes/api/voting-lab/[roundId]/budget/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/db/client.js';
import { setRoundBudget } from '$lib/voting-lab/ballotDb.js';

const BudgetSchema = z.object({
  upTotal: z.number().int().min(0),
  downTotal: z.number().int().min(0),
  perSongCap: z.number().int().min(1).nullable(),
});

export const PUT: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');

  const parsed = BudgetSchema.safeParse(await request.json());
  if (!parsed.success) throw error(400, parsed.error.message);

  setRoundBudget(getDb(), roundId, parsed.data);
  return json({ ok: true });
};
```

- [ ] **Step 4: Verify the app still type-checks and builds**

Run: `cd ui && npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json --threshold error`
Expected: no errors referencing `voting-lab`

- [ ] **Step 5: Commit**

```bash
git add ui/src/routes/api/voting-lab
git commit -m "feat(voting-lab): load, ballot-save and budget endpoints"
```

---

### Task 7: `VotingLab` shell mounted on both host pages

Renders the budget meter and a read-only song list. Allocation controls arrive in Task 8.

**Files:**
- Create: `ui/src/lib/components/VotingLab.svelte`
- Modify: `ui/src/routes/+page.svelte`
- Modify: `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte`

**Interfaces:**
- Consumes: `GET /api/voting-lab/:roundId` returning `LabData`.
- Produces: `<VotingLab roundId={number} />` — the mountable component both host pages use.

- [ ] **Step 1: Write the component**

Create `ui/src/lib/components/VotingLab.svelte`:

```svelte
<script lang="ts">
  import type { LabData } from '$lib/voting-lab/types.js';
  import { computeUsage } from '$lib/voting-lab/budget.js';

  let { roundId }: { roundId: number } = $props();

  let data = $state<LabData | null>(null);
  let loadError = $state<string | null>(null);

  async function load() {
    loadError = null;
    const res = await fetch(`/api/voting-lab/${roundId}`);
    if (!res.ok) { loadError = `Failed to load lab (${res.status})`; return; }
    data = (await res.json()) as LabData;
  }

  $effect(() => { void roundId; void load(); });

  const usage = $derived(
    data ? computeUsage(data.rows.map((r) => r.ballot), data.budget) : null,
  );
</script>

<section class="voting-lab">
  <header class="flex items-baseline justify-between gap-4">
    <h2 class="text-lg font-semibold">Voting Lab</h2>
    {#if usage && data}
      <div class="text-sm tabular-nums" class:text-red-500={usage.upRemaining < 0 || usage.downRemaining < 0}>
        Up: {usage.upUsed}/{data.budget.upTotal} · Down: {usage.downUsed}/{data.budget.downTotal}
        <span class="opacity-60">({data.budgetSource})</span>
      </div>
    {/if}
  </header>

  {#if loadError}
    <p class="text-red-500">{loadError}</p>
  {:else if !data}
    <p class="opacity-60">Loading…</p>
  {:else}
    <p class="mt-1 text-sm opacity-70">{data.themeName}</p>
    <ul class="mt-3 space-y-2">
      {#each data.rows as row (row.song.spotifyUri)}
        <li class="flex items-center gap-3 rounded border border-white/10 p-2">
          {#if row.song.albumArtUrl}
            <img src={row.song.albumArtUrl} alt="" class="h-10 w-10 rounded" />
          {/if}
          <div class="min-w-0">
            <div class="truncate font-medium">{row.song.title}</div>
            <div class="truncate text-sm opacity-70">{row.song.artist}</div>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>
```

- [ ] **Step 2: Mount on the active-round page**

In `ui/src/routes/+page.svelte`, add the import alongside the other component imports:

```ts
import VotingLab from '$lib/components/VotingLab.svelte';
```

Then render it where the round detail is shown, gated on the voting phase (use the page's existing current-round variable; if it is named differently, substitute the real name):

```svelte
{#if currentRound && currentRound.phase === 'voting'}
  <VotingLab roundId={currentRound.id} />
{/if}
```

- [ ] **Step 3: Mount on the round-detail page**

In `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte`, add the same import and render it unconditionally for any round:

```svelte
<VotingLab roundId={data.round.id} />
```

(If the page's loaded round is exposed under a different name, substitute the real one.)

- [ ] **Step 4: Verify it renders**

Run: `cd ui && npm run dev` then open the active-round page during a voting round and a round-detail page.
Expected: the "Voting Lab" header, the theme name, the budget meter (e.g. `Up: 0/7 · Down: 0/1 (default)`), and the song list.
Then stop the dev server (see the repo convention: don't leave `npm run dev` running).

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/components/VotingLab.svelte ui/src/routes/+page.svelte "ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte"
git commit -m "feat(voting-lab): mount lab shell on active-round and round-detail pages"
```

---

### Task 8: Allocation controls with autosave

**Files:**
- Create: `ui/src/lib/components/VotingLabSongRow.svelte`
- Modify: `ui/src/lib/components/VotingLab.svelte`

**Interfaces:**
- Consumes: `canAllocate` from `$lib/voting-lab/budget.js`; `PATCH /api/voting-lab/:roundId/ballot`.
- Produces: `<VotingLabSongRow row canAlloc onchange />` where `onchange: (ballot: BallotEntry) => void`.

- [ ] **Step 1: Write the row component**

Create `ui/src/lib/components/VotingLabSongRow.svelte`:

```svelte
<script lang="ts">
  import type { BallotEntry, LabRow } from '$lib/voting-lab/types.js';

  let {
    row,
    canAlloc,
    onchange,
  }: {
    row: LabRow;
    canAlloc: (uri: string, kind: 'up' | 'down', delta: number) => boolean;
    onchange: (ballot: BallotEntry) => void;
  } = $props();

  function bump(kind: 'up' | 'down', delta: number) {
    if (!canAlloc(row.song.spotifyUri, kind, delta)) return;
    const next: BallotEntry = { ...row.ballot };
    if (kind === 'up') next.upPoints += delta;
    else next.downPoints += delta;
    onchange(next);
  }

  function setNotes(value: string) {
    onchange({ ...row.ballot, notes: value });
  }

  function toggleMine() {
    // Clearing points keeps the ballot valid the moment it is marked as yours.
    onchange({ ...row.ballot, isMine: !row.ballot.isMine, upPoints: 0, downPoints: 0 });
  }

  /** Clicking the active star clears the rating. */
  function setRating(value: number) {
    onchange({ ...row.ballot, rating: row.ballot.rating === value ? null : value });
  }
</script>

<li class="rounded border border-white/10 p-3">
  <div class="flex items-center gap-3">
    {#if row.song.albumArtUrl}
      <img src={row.song.albumArtUrl} alt="" class="h-10 w-10 rounded" />
    {/if}
    <div class="min-w-0 flex-1">
      <div class="truncate font-medium">{row.song.title}</div>
      <div class="truncate text-sm opacity-70">{row.song.artist}</div>
      <div class="mt-1 flex flex-wrap gap-1 text-xs opacity-60">
        {#if row.song.spotifyPopularity !== null}<span>pop {row.song.spotifyPopularity}</span>{/if}
        {#if row.song.bpm !== null}<span>{row.song.bpm} bpm</span>{/if}
        {#if row.song.energy !== null}<span>energy {row.song.energy.toFixed(2)}</span>{/if}
        {#if row.song.hasLyrics === false}<span>instrumental</span>{/if}
        {#each row.song.tags.slice(0, 3) as tag}<span>{tag}</span>{/each}
      </div>
    </div>

    {#if row.ballot.isMine}
      <span class="text-xs opacity-60">your song</span>
    {:else}
      <div class="flex items-center gap-1">
        <button class="px-2" onclick={() => bump('up', -1)} aria-label="one less up point">−</button>
        <span class="w-8 text-center tabular-nums">▲{row.ballot.upPoints}</span>
        <button class="px-2" onclick={() => bump('up', 1)} aria-label="one more up point">+</button>
      </div>
      <div class="flex items-center gap-1">
        <button class="px-2" onclick={() => bump('down', -1)} aria-label="one less down point">−</button>
        <span class="w-8 text-center tabular-nums">▼{row.ballot.downPoints}</span>
        <button class="px-2" onclick={() => bump('down', 1)} aria-label="one more down point">+</button>
      </div>
    {/if}

    <button class="text-xs underline opacity-60" onclick={toggleMine}>
      {row.ballot.isMine ? 'not mine' : 'mine'}
    </button>
  </div>

  <div class="mt-2 flex items-center gap-1 text-xs">
    <span class="opacity-60">Your rating</span>
    {#each [1, 2, 3, 4, 5] as star}
      <button
        class="px-1"
        class:opacity-100={row.ballot.rating !== null && star <= row.ballot.rating}
        class:opacity-30={row.ballot.rating === null || star > row.ballot.rating}
        onclick={() => setRating(star)}
        aria-label={`rate ${star} of 5`}
      >★</button>
    {/each}
  </div>

  <textarea
    class="mt-2 w-full rounded bg-black/20 p-2 text-sm"
    rows="2"
    placeholder="Your notes on this track…"
    value={row.ballot.notes}
    oninput={(e) => setNotes((e.currentTarget as HTMLTextAreaElement).value)}
  ></textarea>
</li>
```

- [ ] **Step 2: Wire the row into `VotingLab.svelte`**

In `ui/src/lib/components/VotingLab.svelte`, add the import:

```ts
import VotingLabSongRow from './VotingLabSongRow.svelte';
import { canAllocate } from '$lib/voting-lab/budget.js';
import type { BallotEntry } from '$lib/voting-lab/types.js';
```

Add the save logic inside `<script>`:

```ts
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function canAlloc(uri: string, kind: 'up' | 'down', delta: number): boolean {
    if (!data) return false;
    return canAllocate(data.rows.map((r) => r.ballot), data.budget, uri, kind, delta);
  }

  /** Update local state immediately, then debounce the PATCH per song. */
  function applyBallot(next: BallotEntry) {
    if (!data) return;
    data.rows = data.rows.map((r) =>
      r.song.spotifyUri === next.spotifyUri ? { ...r, ballot: next } : r,
    );
    const existing = saveTimers.get(next.spotifyUri);
    if (existing) clearTimeout(existing);
    saveTimers.set(
      next.spotifyUri,
      setTimeout(() => {
        void fetch(`/api/voting-lab/${roundId}/ballot`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        });
      }, 400),
    );
  }
```

Replace the `{#each}` list body with:

```svelte
      {#each data.rows as row (row.song.spotifyUri)}
        <VotingLabSongRow {row} {canAlloc} onchange={applyBallot} />
      {/each}
```

- [ ] **Step 3: Verify allocation and persistence by hand**

Run: `cd ui && npm run dev`, open a round's lab, click `+` on up points until the pool is exhausted.
Expected: the meter climbs, further `+` clicks do nothing once `upRemaining` hits 0, notes persist across a page reload, and marking a song "mine" zeroes and disables its steppers.
Stop the dev server when done.

- [ ] **Step 4: Run the full test suite**

Run: `cd ui && npx vitest run`
Expected: PASS — no regressions

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/components/VotingLabSongRow.svelte ui/src/lib/components/VotingLab.svelte
git commit -m "feat(voting-lab): allocation steppers, notes and debounced autosave"
```

---

### Task 9: Ballot summary and copy-out

**Files:**
- Modify: `ui/src/lib/components/VotingLab.svelte`

**Interfaces:**
- Consumes: `validateBallot` from `$lib/voting-lab/budget.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add summary state and the clipboard text builder**

In `ui/src/lib/components/VotingLab.svelte`, extend the budget import:

```ts
import { canAllocate, computeUsage, validateBallot } from '$lib/voting-lab/budget.js';
```

Add to `<script>`:

```ts
  const problems = $derived(
    data ? validateBallot(data.rows.map((r) => r.ballot), data.budget) : [],
  );

  /** The text you paste into Music League. */
  function ballotText(): string {
    if (!data) return '';
    const lines: string[] = [`${data.themeName}`, ''];
    for (const r of data.rows) {
      const { upPoints, downPoints, draftComment } = r.ballot;
      if (upPoints === 0 && downPoints === 0) continue;
      const pts = downPoints > 0 ? `-${downPoints}` : `+${upPoints}`;
      lines.push(`${pts}  ${r.song.artist} — ${r.song.title}`);
      if (draftComment) lines.push(`     "${draftComment}"`);
    }
    return lines.join('\n');
  }

  let copied = $state(false);
  async function copyBallot() {
    await navigator.clipboard.writeText(ballotText());
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
```

- [ ] **Step 2: Render the summary block**

Add before the closing `</section>` in `ui/src/lib/components/VotingLab.svelte`:

```svelte
  {#if data}
    <footer class="mt-4 border-t border-white/10 pt-3">
      {#if problems.length}
        <ul class="mb-2 text-sm text-red-500">
          {#each problems as p}<li>{p}</li>{/each}
        </ul>
      {/if}
      <pre class="whitespace-pre-wrap rounded bg-black/20 p-2 text-sm">{ballotText() || 'No votes allocated yet.'}</pre>
      <button class="mt-2 rounded border border-white/20 px-3 py-1 text-sm" onclick={copyBallot}>
        {copied ? 'Copied!' : 'Copy whole ballot'}
      </button>
    </footer>
  {/if}
```

- [ ] **Step 3: Verify by hand**

Run: `cd ui && npm run dev`, allocate a few points, click "Copy whole ballot", paste into a text editor.
Expected: only allocated songs listed, downvotes rendered as `-1`, drafted comments quoted beneath their song.
Stop the dev server when done.

- [ ] **Step 4: Run the full test suite**

Run: `cd ui && npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/components/VotingLab.svelte
git commit -m "feat(voting-lab): ballot summary with validation and copy-out"
```

---

### Task 10: Season budget editor in Settings

**Files:**
- Create: `ui/src/routes/api/settings/season-budget/+server.ts`
- Modify: `ui/src/routes/settings/+page.svelte`

**Interfaces:**
- Consumes: `setSeasonBudget`, `getSeasonBudget` from `$lib/voting-lab/ballotDb.js`.
- Produces: `PUT /api/settings/season-budget` body `{ seasonId: number } & VoteBudget` → `{ ok: true }`.

- [ ] **Step 1: Write the endpoint**

Create `ui/src/routes/api/settings/season-budget/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/db/client.js';
import { setSeasonBudget } from '$lib/voting-lab/ballotDb.js';

const Body = z.object({
  seasonId: z.number().int().positive(),
  upTotal: z.number().int().min(0),
  downTotal: z.number().int().min(0),
  perSongCap: z.number().int().min(1).nullable(),
});

export const PUT: RequestHandler = async ({ request }) => {
  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) throw error(400, parsed.error.message);
  const { seasonId, ...budget } = parsed.data;
  setSeasonBudget(getDb(), seasonId, budget);
  return json({ ok: true });
};
```

- [ ] **Step 2: Load current season budgets into the settings page**

In `ui/src/routes/settings/+page.server.ts`, add to the returned `load()` object (merging with whatever it already returns):

```ts
import { getSeasonBudget } from '$lib/voting-lab/ballotDb.js';

// inside load(), after the existing hierarchy query:
const seasonBudgets: Record<number, { upTotal: number; downTotal: number; perSongCap: number | null }> = {};
for (const league of hierarchy) {
  for (const season of league.seasons) {
    const b = getSeasonBudget(db, season.id);
    if (b) seasonBudgets[season.id] = b;
  }
}
// add `seasonBudgets` to the object this load() returns
```

- [ ] **Step 3: Add the editor UI to each season node**

In `ui/src/routes/settings/+page.svelte`, add to `<script>`:

```ts
  let seasonBudgets = $state<Record<number, { upTotal: number; downTotal: number; perSongCap: number | null }>>(
    data.seasonBudgets ?? {},
  );

  async function saveSeasonBudget(seasonId: number) {
    const b = seasonBudgets[seasonId] ?? { upTotal: 7, downTotal: 1, perSongCap: null };
    await fetch('/api/settings/season-budget', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonId, ...b }),
    });
  }

  function budgetFor(seasonId: number) {
    if (!seasonBudgets[seasonId]) {
      seasonBudgets[seasonId] = { upTotal: 7, downTotal: 1, perSongCap: null };
    }
    return seasonBudgets[seasonId];
  }
```

Inside the markup where each season row is rendered in the hierarchy, add:

```svelte
  <div class="mt-1 flex items-center gap-2 text-xs">
    <span class="opacity-60">Vote budget</span>
    <label>up
      <input type="number" min="0" class="w-14 rounded bg-black/20 px-1"
        bind:value={budgetFor(season.id).upTotal} onchange={() => saveSeasonBudget(season.id)} />
    </label>
    <label>down
      <input type="number" min="0" class="w-14 rounded bg-black/20 px-1"
        bind:value={budgetFor(season.id).downTotal} onchange={() => saveSeasonBudget(season.id)} />
    </label>
    <label>per-song cap
      <input type="number" min="1" placeholder="none" class="w-16 rounded bg-black/20 px-1"
        bind:value={budgetFor(season.id).perSongCap} onchange={() => saveSeasonBudget(season.id)} />
    </label>
  </div>
```

- [ ] **Step 4: Verify inheritance end to end**

Run: `cd ui && npm run dev`. In Settings set a season's budget to up 8 / down 2. Open a lab for a round in that season with no override.
Expected: the meter reads `Up: 0/8 · Down: 0/2 (season)`. Change the numbers in the lab header (Task 11 wires that) or via the budget endpoint and it flips to `(round)`.
Stop the dev server when done.

- [ ] **Step 5: Commit**

```bash
git add ui/src/routes/api/settings/season-budget ui/src/routes/settings/+page.svelte ui/src/routes/settings/+page.server.ts
git commit -m "feat(voting-lab): season vote-budget editor in settings"
```

---

### Task 11: Editable budget in the lab header (round override)

**Files:**
- Modify: `ui/src/lib/components/VotingLab.svelte`

**Interfaces:**
- Consumes: `PUT /api/voting-lab/:roundId/budget`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the save-budget function**

In `ui/src/lib/components/VotingLab.svelte` `<script>`:

```ts
  async function saveBudget() {
    if (!data) return;
    await fetch(`/api/voting-lab/${roundId}/budget`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data.budget),
    });
    data.budgetSource = 'round';
  }
```

- [ ] **Step 2: Replace the read-only meter with editable inputs**

Replace the meter `<div>` in the header with:

```svelte
    {#if usage && data}
      <div class="flex items-center gap-2 text-sm tabular-nums">
        <span class:text-red-500={usage.upRemaining < 0}>Up: {usage.upUsed}/</span>
        <input type="number" min="0" class="w-14 rounded bg-black/20 px-1"
          bind:value={data.budget.upTotal} onchange={saveBudget} />
        <span class:text-red-500={usage.downRemaining < 0}>Down: {usage.downUsed}/</span>
        <input type="number" min="0" class="w-14 rounded bg-black/20 px-1"
          bind:value={data.budget.downTotal} onchange={saveBudget} />
        <span class="opacity-60">({data.budgetSource})</span>
      </div>
    {/if}
```

- [ ] **Step 3: Verify the override**

Run: `cd ui && npm run dev`, change the up total in the lab header, reload.
Expected: the new value persists and the source label reads `(round)`.
Stop the dev server when done.

- [ ] **Step 4: Run the full test suite**

Run: `cd ui && npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/components/VotingLab.svelte
git commit -m "feat(voting-lab): per-round budget override in the lab header"
```

---

### Task 12: Live-round sync from the musicleague CLI

**Files:**
- Create: `ui/src/lib/voting-lab/liveSync.ts`
- Create: `ui/src/lib/voting-lab/liveSync.test.ts`
- Create: `ui/src/routes/api/voting-lab/[roundId]/sync/+server.ts`
- Modify: `ui/src/lib/components/VotingLab.svelte`

**Interfaces:**
- Consumes: nothing from earlier tasks except the DB.
- Produces:
  - `interface CliSong { spotifyUri: string; title: string; artist: string; albumArtUrl: string | null }`
  - `syncRoundSongs(db, roundId, songs: CliSong[]): { inserted: number; skipped: number }`

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/voting-lab/liveSync.test.ts`:

```ts
import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';
import { syncRoundSongs } from './liveSync.js';
import type { CliSong } from './liveSync.js';

function dbWithRound() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1, 'test', 'Test')`).run();
  db.prepare(`INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 1, 'active')`).run();
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at, phase)
     VALUES (100, 10, 'ml-100', 'R1', '2026-07-01T00:00:00Z', 'voting')`,
  ).run();
  return db;
}

const SONGS: CliSong[] = [
  { spotifyUri: 'spotify:track:a', title: 'Song A', artist: 'Artist A', albumArtUrl: null },
  { spotifyUri: 'spotify:track:b', title: 'Song B', artist: 'Artist B', albumArtUrl: 'http://art/b.jpg' },
];

it('inserts songs as anonymous and visible to voters', () => {
  const db = dbWithRound();
  expect(syncRoundSongs(db, 100, SONGS)).toEqual({ inserted: 2, skipped: 0 });
  const rows = db.prepare(
    `SELECT spotify_uri, competitor_id, visible_to_voters FROM ml_submissions WHERE round_id = 100`,
  ).all() as { spotify_uri: string; competitor_id: number | null; visible_to_voters: number }[];
  expect(rows).toHaveLength(2);
  // Voting-phase songs must stay anonymous.
  expect(rows.every((r) => r.competitor_id === null)).toBe(true);
  expect(rows.every((r) => r.visible_to_voters === 1)).toBe(true);
  db.close();
});

it('is idempotent — re-syncing does not duplicate', () => {
  const db = dbWithRound();
  syncRoundSongs(db, 100, SONGS);
  expect(syncRoundSongs(db, 100, SONGS)).toEqual({ inserted: 0, skipped: 2 });
  const count = db.prepare(`SELECT COUNT(*) AS c FROM ml_submissions WHERE round_id = 100`)
    .get() as { c: number };
  expect(count.c).toBe(2);
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/voting-lab/liveSync.test.ts`
Expected: FAIL — cannot resolve `./liveSync.js`

- [ ] **Step 3: Write the implementation**

Create `ui/src/lib/voting-lab/liveSync.ts`:

```ts
import type Database from 'better-sqlite3';

/** One song as returned by the musicleague CLI for the open round. */
export interface CliSong {
  spotifyUri: string;
  title: string;
  artist: string;
  albumArtUrl: string | null;
}

/**
 * Upsert the live round's playlist into ml_submissions.
 *
 * Submitters are deliberately left NULL: during the voting phase Music League
 * hides who submitted what, and the lab must never learn it.
 * Idempotent — re-syncing an already-synced round inserts nothing.
 */
export function syncRoundSongs(
  db: Database.Database,
  roundId: number,
  songs: CliSong[],
): { inserted: number; skipped: number } {
  const existing = new Set(
    (db.prepare(`SELECT spotify_uri FROM ml_submissions WHERE round_id = ?`)
      .all(roundId) as { spotify_uri: string }[]).map((r) => r.spotify_uri),
  );

  const insert = db.prepare(
    `INSERT INTO ml_submissions
       (round_id, competitor_id, spotify_uri, title, artists, album_art_url, visible_to_voters)
     VALUES (?, NULL, ?, ?, ?, ?, 1)`,
  );

  let inserted = 0;
  let skipped = 0;
  const run = db.transaction(() => {
    for (const s of songs) {
      if (existing.has(s.spotifyUri)) { skipped++; continue; }
      insert.run(roundId, s.spotifyUri, s.title, s.artist, s.albumArtUrl);
      inserted++;
    }
  });
  run();
  return { inserted, skipped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/voting-lab/liveSync.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the sync endpoint**

Create `ui/src/routes/api/voting-lab/[roundId]/sync/+server.ts`. It shells out to the musicleague CLI and maps its JSON to `CliSong[]`.

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb } from '$lib/db/client.js';
import { syncRoundSongs } from '$lib/voting-lab/liveSync.js';
import type { CliSong } from '$lib/voting-lab/liveSync.js';

const run = promisify(execFile);

/** Path to the musicleague CLI; override with MUSICLEAGUE_CLI when it moves. */
const CLI = process.env.MUSICLEAGUE_CLI ?? 'cli-web-musicleague';

type CliRow = {
  spotify_uri?: string; uri?: string;
  track_name?: string; title?: string;
  artist?: string; artists?: string;
  album_art_url?: string | null;
};

function toCliSongs(rows: CliRow[]): CliSong[] {
  return rows
    .map((r) => ({
      spotifyUri: r.spotify_uri ?? r.uri ?? '',
      title: r.track_name ?? r.title ?? '',
      artist: r.artist ?? r.artists ?? '',
      albumArtUrl: r.album_art_url ?? null,
    }))
    .filter((s) => s.spotifyUri && s.title);
}

export const POST: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');

  const db = getDb();
  const round = db.prepare(`SELECT ml_round_id FROM rounds WHERE id = ?`)
    .get(roundId) as { ml_round_id: string } | undefined;
  if (!round) throw error(404, 'round not found');

  let rows: CliRow[];
  try {
    const { stdout } = await run(CLI, ['songs', 'list', '--round', round.ml_round_id, '--json'], {
      timeout: 30_000,
    });
    rows = JSON.parse(stdout) as CliRow[];
  } catch (e) {
    throw error(502, `musicleague CLI failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return json(syncRoundSongs(db, roundId, toCliSongs(rows)));
};
```

> **Implementer note:** confirm the real subcommand and JSON field names with
> `cli-web-musicleague songs list --help` (or the MCP tool `list_round_songs`)
> before finalizing; adjust the argv array and `CliRow` keys to match. The
> mapping in `toCliSongs` already tolerates the two most likely key spellings.

- [ ] **Step 6: Add the sync button**

In `ui/src/lib/components/VotingLab.svelte` `<script>`:

```ts
  let syncing = $state(false);
  let syncMsg = $state<string | null>(null);

  async function syncLive() {
    syncing = true;
    syncMsg = null;
    try {
      const res = await fetch(`/api/voting-lab/${roundId}/sync`, { method: 'POST' });
      const body = await res.json();
      syncMsg = res.ok ? `Synced: ${body.inserted} new, ${body.skipped} already had.` : `Sync failed: ${body.message ?? res.status}`;
      if (res.ok) await load();
    } finally {
      syncing = false;
    }
  }
```

And in the header markup, after the meter:

```svelte
    <button class="rounded border border-white/20 px-2 py-1 text-xs" onclick={syncLive} disabled={syncing}>
      {syncing ? 'Syncing…' : 'Sync live round'}
    </button>
```

Render `syncMsg` under the header:

```svelte
  {#if syncMsg}<p class="text-xs opacity-70">{syncMsg}</p>{/if}
```

- [ ] **Step 7: Commit**

```bash
git add ui/src/lib/voting-lab/liveSync.ts ui/src/lib/voting-lab/liveSync.test.ts "ui/src/routes/api/voting-lab/[roundId]/sync" ui/src/lib/components/VotingLab.svelte
git commit -m "feat(voting-lab): sync the live round's anonymous playlist via the musicleague CLI"
```

---

### Task 13: `votingTake` — the personalized track lens

**Files:**
- Create: `ui/src/lib/predict/tasks/votingTake.ts`
- Create: `ui/src/lib/predict/tasks/votingTake.test.ts`
- Create: `ui/src/routes/api/voting-lab/[roundId]/take/+server.ts`
- Modify: `ui/src/lib/components/VotingLabSongRow.svelte`

**Interfaces:**
- Consumes: `runPrediction`, `PredictionTask`, `PredictionMeta` from `../predict.js`; `modelForSection`.
- Produces:
  - `VotingTakeOutputSchema` / `VotingTakeOutput` = `{ theme_read: string; taste_note: string; angles: string[]; signals: string[] }`
  - `votingTakeTask: PredictionTask<VotingTakeInput, VotingTakeOutput>` with `id: 'voting-take'`
  - `runVotingTake(db, opts): Promise<{ output; meta; cacheHit; generatedAt }>`

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/predict/tasks/votingTake.test.ts`:

```ts
import { it, expect } from 'vitest';
import { VotingTakeOutputSchema, votingTakeTask, buildVotingTakeMessages } from './votingTake.js';
import type { VotingTakeInput } from './votingTake.js';

const INPUT: VotingTakeInput = {
  song: { title: 'Song A', artist: 'Artist A', spotifyPopularity: 12, listeners: 900, bpm: 128, energy: 0.7, hasLyrics: true, tags: ['shoegaze'] },
  theme: { name: 'Non-English', description: 'Songs not in English' },
  tasteFingerprint: 'Rewards obscure, texture-forward records; punishes novelty songs.',
};

it('accepts a well-formed output', () => {
  const parsed = VotingTakeOutputSchema.parse({
    theme_read: 'Squarely on-theme: Portuguese vocal throughout.',
    taste_note: 'Texture-forward and obscure — squarely your lane.',
    angles: ['The drum machine is doing the emotional work', 'Compare to the Cocteau Twins record you rewarded'],
    signals: ['shoegaze', 'obscure'],
  });
  expect(parsed.angles).toHaveLength(2);
});

it('rejects output that smuggles in a vote recommendation field', () => {
  expect(() =>
    VotingTakeOutputSchema.parse({
      theme_read: 'x', taste_note: 'y', angles: ['a'], signals: [], lean: 'up',
    }),
  ).toThrow();
});

it('requires at least one angle', () => {
  expect(() =>
    VotingTakeOutputSchema.parse({ theme_read: 'x', taste_note: 'y', angles: [], signals: [] }),
  ).toThrow();
});

it('is registered with a stable task id', () => {
  expect(votingTakeTask.id).toBe('voting-take');
});

it('never puts submitter identity in the prompt and forbids recommendations', () => {
  const messages = buildVotingTakeMessages(INPUT);
  const all = messages.map((m) => m.content).join('\n');
  expect(all).not.toMatch(/submitter|submitted by/i);
  expect(all).toContain('Song A');
  expect(all).toContain('Non-English');
  // The system prompt must forbid telling the user how to vote.
  expect(all.toLowerCase()).toContain('do not recommend');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/predict/tasks/votingTake.test.ts`
Expected: FAIL — cannot resolve `./votingTake.js`

- [ ] **Step 3: Write the task**

Create `ui/src/lib/predict/tasks/votingTake.ts`:

```ts
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { runPrediction } from '../predict.js';
import type { PredictionTask, PredictionMeta } from '../predict.js';
import { modelForSection } from '../../digest/modelFor.js';

export interface VotingTakeSong {
  title: string;
  artist: string;
  spotifyPopularity: number | null;
  listeners: number | null;
  bpm: number | null;
  energy: number | null;
  hasLyrics: boolean | null;
  tags: string[];
}

export interface VotingTakeTheme {
  name: string;
  description: string;
}

export interface VotingTakeInput {
  song: VotingTakeSong;
  theme: VotingTakeTheme;
  /** The owner's taste fingerprint; '' when none is stored yet. */
  tasteFingerprint: string;
}

/**
 * Perspective only. `.strict()` is load-bearing: it makes the schema reject any
 * extra key (e.g. a smuggled-in "lean"/"recommendation"), which is how we keep
 * this from drifting into a vote recommender.
 */
export const VotingTakeOutputSchema = z.object({
  theme_read: z.string().min(1),
  taste_note: z.string().min(1),
  angles: z.array(z.string()).min(1).max(3),
  signals: z.array(z.string()),
}).strict();

export type VotingTakeOutput = z.infer<typeof VotingTakeOutputSchema>;

const VotingTakeInputSchema = z.custom<VotingTakeInput>(
  (v) =>
    v !== null && v !== undefined &&
    typeof (v as VotingTakeInput).song === 'object' &&
    typeof (v as VotingTakeInput).theme === 'object',
);

export function buildVotingTakeMessages(input: VotingTakeInput) {
  const { song, theme, tasteFingerprint } = input;
  const lines: string[] = [];

  lines.push('--- Track ---');
  lines.push(`Title: ${song.title}`);
  lines.push(`Artist: ${song.artist}`);
  if (song.spotifyPopularity !== null) lines.push(`Spotify popularity: ${song.spotifyPopularity}/100`);
  if (song.listeners !== null) lines.push(`Last.fm listeners: ${song.listeners}`);
  if (song.bpm !== null) lines.push(`BPM: ${song.bpm}`);
  if (song.energy !== null) lines.push(`Energy: ${song.energy}`);
  if (song.hasLyrics !== null) lines.push(`Has lyrics: ${song.hasLyrics ? 'yes' : 'no (instrumental)'}`);
  if (song.tags.length) lines.push(`Tags: ${song.tags.join(', ')}`);

  lines.push('\n--- Round theme ---');
  lines.push(`Name: ${theme.name}`);
  lines.push(`Description: ${theme.description}`);

  lines.push('\n--- The listener (you are writing for this person) ---');
  lines.push(tasteFingerprint || 'No taste profile on file yet.');

  return [
    {
      role: 'system' as const,
      content: `You are a sharp, opinionated music friend helping someone think about ONE track in a themed music-league round.

Your job is to give them ANGLES — interesting ways to think about this track. You are a second opinion, not a judge.

CRITICAL RULES:
- DO NOT recommend how to vote. No scores, no rankings, no "you should upvote/downvote this", no lean in any direction.
- You do not know who submitted this track. Never speculate about the submitter.
- Be concrete about the music itself (production, arrangement, vocal delivery, lyrical angle, mood, lineage) rather than generic praise.
- "taste_note" should connect the track to the listener's stated taste honestly — including when it cuts against it.

Output a JSON object with EXACTLY these fields and no others:
{
  "theme_read": "<1-2 sentences: how this track relates to the round's theme>",
  "taste_note": "<1-2 sentences: how it sits against this listener's taste>",
  "angles": [<1-3 short, specific 'ways to think about this one'>],
  "signals": [<2-5 short descriptive tags, e.g. genre, obscurity, energy>]
}`,
    },
    { role: 'user' as const, content: lines.join('\n') },
  ];
}

export const votingTakeTask: PredictionTask<VotingTakeInput, VotingTakeOutput> = {
  id: 'voting-take',
  inputSchema: VotingTakeInputSchema,
  buildMessages: buildVotingTakeMessages,
  model: (db) => modelForSection('voting-take', db),
  outputSchema: VotingTakeOutputSchema,
};

export interface RunVotingTakeResult {
  output: VotingTakeOutput;
  meta: PredictionMeta;
  cacheHit: boolean;
  generatedAt: string;
}

type CachedRun = { output_json: string; model: string; cost_usd: number; latency_ms: number; created_at: string };

function lookupCache(db: Database.Database, roundId: number, title: string, artist: string): CachedRun | undefined {
  return db.prepare(
    `SELECT output_json, model, cost_usd, latency_ms, created_at
     FROM prediction_runs
     WHERE task_id = 'voting-take'
       AND round_id = ?
       AND json_extract(input_json, '$.song.title') = ?
       AND json_extract(input_json, '$.song.artist') = ?
     ORDER BY created_at DESC
     LIMIT 1`,
  ).get(roundId, title, artist) as CachedRun | undefined;
}

export async function runVotingTake(
  db: Database.Database,
  opts: { roundId: number; song: VotingTakeSong; theme: VotingTakeTheme; tasteFingerprint: string; forceRegen?: boolean },
): Promise<RunVotingTakeResult> {
  if (!opts.forceRegen) {
    const cached = lookupCache(db, opts.roundId, opts.song.title, opts.song.artist);
    if (cached) {
      return {
        output: VotingTakeOutputSchema.parse(JSON.parse(cached.output_json)),
        meta: { model: cached.model, costUsd: cached.cost_usd, latencyMs: cached.latency_ms, rowId: '' },
        cacheHit: true,
        generatedAt: cached.created_at,
      };
    }
  }

  const input: VotingTakeInput = {
    song: opts.song, theme: opts.theme, tasteFingerprint: opts.tasteFingerprint,
  };
  const { output, meta } = await runPrediction(db, votingTakeTask, input, { roundId: opts.roundId });
  return { output, meta, cacheHit: false, generatedAt: new Date().toISOString() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/predict/tasks/votingTake.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the endpoint**

Create `ui/src/routes/api/voting-lab/[roundId]/take/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/db/client.js';
import { buildLabData } from '$lib/voting-lab/labData.js';
import { runVotingTake } from '$lib/predict/tasks/votingTake.js';
import { getOwnerTasteFingerprint } from '$lib/voting-lab/voiceSample.js';

const Body = z.object({ spotifyUri: z.string().min(1), forceRegen: z.boolean().optional() });

export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) throw error(400, parsed.error.message);

  const db = getDb();
  const data = buildLabData(db, roundId);
  const row = data.rows.find((r) => r.song.spotifyUri === parsed.data.spotifyUri);
  if (!row) throw error(404, 'song not in this round');

  const result = await runVotingTake(db, {
    roundId,
    song: {
      title: row.song.title, artist: row.song.artist,
      spotifyPopularity: row.song.spotifyPopularity, listeners: row.song.listeners,
      bpm: row.song.bpm, energy: row.song.energy,
      hasLyrics: row.song.hasLyrics, tags: row.song.tags,
    },
    theme: { name: data.themeName, description: data.themeDescription },
    tasteFingerprint: getOwnerTasteFingerprint(db),
    forceRegen: parsed.data.forceRegen,
  });

  return json(result);
};
```

> **Dependency:** this endpoint imports `getOwnerTasteFingerprint` from
> `$lib/voting-lab/voiceSample.js`, which Task 14 creates. **Implement Task 14
> before this step** (it is independent and has no dependency back on Task 13).

- [ ] **Step 6: Add the take UI to the song row**

In `ui/src/lib/components/VotingLabSongRow.svelte`, first extend the **existing**
`$props()` destructure (Svelte 5 allows only ONE `$props()` call per component —
do not add a second one) to accept `roundId`:

```ts
  let {
    row,
    roundId,
    canAlloc,
    onchange,
  }: {
    row: LabRow;
    roundId: number;
    canAlloc: (uri: string, kind: 'up' | 'down', delta: number) => boolean;
    onchange: (ballot: BallotEntry) => void;
  } = $props();
```

Then add to `<script>`:

```ts
  import type { VotingTakeOutput } from '$lib/predict/tasks/votingTake.js';

  let take = $state<VotingTakeOutput | null>(null);
  let takeLoading = $state(false);

  async function getTake() {
    takeLoading = true;
    try {
      const res = await fetch(`/api/voting-lab/${roundId}/take`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spotifyUri: row.song.spotifyUri }),
      });
      if (res.ok) take = (await res.json()).output as VotingTakeOutput;
    } finally {
      takeLoading = false;
    }
  }
```

Add to the markup, before the `<textarea>`:

```svelte
  {#if take}
    <div class="mt-2 rounded bg-black/20 p-2 text-sm">
      <p><span class="opacity-60">Theme:</span> {take.theme_read}</p>
      <p><span class="opacity-60">Your taste:</span> {take.taste_note}</p>
      <ul class="mt-1 list-disc pl-5">
        {#each take.angles as a}<li>{a}</li>{/each}
      </ul>
      <div class="mt-1 flex flex-wrap gap-1 text-xs opacity-60">
        {#each take.signals as s}<span class="rounded bg-white/10 px-1">{s}</span>{/each}
      </div>
    </div>
  {:else}
    <button class="mt-2 text-xs underline opacity-70" onclick={getTake} disabled={takeLoading}>
      {takeLoading ? 'Thinking…' : 'Get take'}
    </button>
  {/if}
```

Pass `roundId` down in `VotingLab.svelte`:

```svelte
        <VotingLabSongRow {row} {roundId} {canAlloc} onchange={applyBallot} />
```

- [ ] **Step 7: Commit**

```bash
git add ui/src/lib/predict/tasks/votingTake.ts ui/src/lib/predict/tasks/votingTake.test.ts "ui/src/routes/api/voting-lab/[roundId]/take" ui/src/lib/components/VotingLabSongRow.svelte ui/src/lib/components/VotingLab.svelte
git commit -m "feat(voting-lab): personalized per-song track lens (no vote recommendation)"
```

---

### Task 14: Owner voice sample + taste fingerprint

**Files:**
- Create: `ui/src/lib/voting-lab/voiceSample.ts`
- Create: `ui/src/lib/voting-lab/voiceSample.test.ts`

**Interfaces:**
- Consumes: the DB only.
- Produces:
  - `getOwnerPlayerId(db): number | null`
  - `getOwnerTasteFingerprint(db): string`
  - `getVoiceSample(db, limit?): string[]` — the owner's past vote comments, **all leagues**

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/voting-lab/voiceSample.test.ts`:

```ts
import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';
import { getVoiceSample, getOwnerTasteFingerprint, getOwnerPlayerId } from './voiceSample.js';

function dbWithOwner() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1, 'l1', 'L1')`).run();
  db.prepare(`INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 1, 'active')`).run();
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at, phase)
     VALUES (100, 10, 'ml-100', 'R1', '2026-07-01T00:00:00Z', 'complete')`,
  ).run();
  db.prepare(`INSERT INTO competitors (id, ml_competitor_id, name) VALUES (5, 'c5', 'Owner')`).run();
  db.prepare(`INSERT INTO players (id, name, is_owner) VALUES (5, 'Owner', 1)`).run();
  return db;
}

it('finds the owner player', () => {
  const db = dbWithOwner();
  expect(getOwnerPlayerId(db)).toBe(5);
  db.close();
});

it('returns the owner past comments, newest first, skipping empties', () => {
  const db = dbWithOwner();
  const ins = db.prepare(
    `INSERT INTO votes (round_id, voter_id, spotify_uri, points, comment, created_at, player_id)
     VALUES (100, 5, ?, 1, ?, ?, 5)`,
  );
  ins.run('spotify:track:a', 'older take', '2026-07-01T00:00:00Z');
  ins.run('spotify:track:b', '', '2026-07-02T00:00:00Z');
  ins.run('spotify:track:c', 'newer take', '2026-07-03T00:00:00Z');
  expect(getVoiceSample(db)).toEqual(['newer take', 'older take']);
  db.close();
});

it('returns an empty fingerprint when none is stored', () => {
  const db = dbWithOwner();
  expect(getOwnerTasteFingerprint(db)).toBe('');
  db.close();
});
```

> **Implementer note:** the `players` / owner flag and `player_profiles.taste_fingerprint`
> column names must match the real schema. Run
> `sqlite3 data/league.db ".schema players"` and `".schema player_profiles"` first
> and adjust both the fixture inserts and the queries to the actual columns. If
> ownership is stored elsewhere (e.g. a `settings` key), read it from there instead
> and update this test to seed that source.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/voting-lab/voiceSample.test.ts`
Expected: FAIL — cannot resolve `./voiceSample.js`

- [ ] **Step 3: Write the implementation**

Create `ui/src/lib/voting-lab/voiceSample.ts`:

```ts
import type Database from 'better-sqlite3';

/** The app owner's player id — the person whose ballot this lab is for. */
export function getOwnerPlayerId(db: Database.Database): number | null {
  const row = db.prepare(
    `SELECT id FROM players WHERE is_owner = 1 ORDER BY id LIMIT 1`,
  ).get() as { id: number } | undefined;
  return row?.id ?? null;
}

/** Free-text taste profile used to personalize the per-song take. */
export function getOwnerTasteFingerprint(db: Database.Database): string {
  const playerId = getOwnerPlayerId(db);
  if (playerId === null) return '';
  const row = db.prepare(
    `SELECT taste_fingerprint FROM player_profiles WHERE player_id = ?`,
  ).get(playerId) as { taste_fingerprint: string | null } | undefined;
  return row?.taste_fingerprint ?? '';
}

/**
 * The owner's own past vote comments, newest first, across ALL leagues
 * (per spec) — used as few-shot voice examples for comment drafting.
 */
export function getVoiceSample(db: Database.Database, limit = 8): string[] {
  const playerId = getOwnerPlayerId(db);
  if (playerId === null) return [];
  const rows = db.prepare(
    `SELECT comment FROM votes
     WHERE player_id = ? AND comment IS NOT NULL AND TRIM(comment) != ''
     ORDER BY created_at DESC
     LIMIT ?`,
  ).all(playerId, limit) as { comment: string }[];
  return rows.map((r) => r.comment);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/voting-lab/voiceSample.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/voting-lab/voiceSample.ts ui/src/lib/voting-lab/voiceSample.test.ts
git commit -m "feat(voting-lab): owner taste fingerprint and cross-league voice sample"
```

---

### Task 15: `voteComment` — the comment drafter

**Files:**
- Create: `ui/src/lib/predict/tasks/voteComment.ts`
- Create: `ui/src/lib/predict/tasks/voteComment.test.ts`
- Create: `ui/src/routes/api/voting-lab/[roundId]/comment/+server.ts`
- Modify: `ui/src/lib/components/VotingLabSongRow.svelte`

**Interfaces:**
- Consumes: `runPrediction`, `modelForSection`, `getVoiceSample`.
- Produces:
  - `VoteCommentOutputSchema` / `VoteCommentOutput` = `{ draft: string }`
  - `voteCommentTask: PredictionTask<VoteCommentInput, VoteCommentOutput>` with `id: 'vote-comment'`
  - `runVoteComment(db, opts): Promise<{ output; meta }>`

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/predict/tasks/voteComment.test.ts`:

```ts
import { it, expect } from 'vitest';
import { VoteCommentOutputSchema, voteCommentTask, buildVoteCommentMessages } from './voteComment.js';
import type { VoteCommentInput } from './voteComment.js';

const BASE: VoteCommentInput = {
  song: { title: 'Song A', artist: 'Artist A' },
  theme: { name: 'Non-English', description: 'Songs not in English' },
  rating: 4,
  notes: 'the drum machine carries it',
  upPoints: 2,
  downPoints: 0,
  voiceSample: ['Absolute banger, no notes.', 'This one lost me at the sax solo.'],
};

it('accepts a draft', () => {
  expect(VoteCommentOutputSchema.parse({ draft: 'That drum machine does all the work — love it.' }).draft).toBeTruthy();
});

it('rejects an empty draft', () => {
  expect(() => VoteCommentOutputSchema.parse({ draft: '' })).toThrow();
});

it('has a stable task id', () => {
  expect(voteCommentTask.id).toBe('vote-comment');
});

it('includes the voice sample and the user notes in the prompt', () => {
  const all = buildVoteCommentMessages(BASE).map((m) => m.content).join('\n');
  expect(all).toContain('Absolute banger, no notes.');
  expect(all).toContain('the drum machine carries it');
  expect(all).toContain('Song A');
});

it('tells the model this is a downvote when points are negative', () => {
  const all = buildVoteCommentMessages({ ...BASE, upPoints: 0, downPoints: 1 })
    .map((m) => m.content).join('\n').toLowerCase();
  expect(all).toContain('downvote');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/predict/tasks/voteComment.test.ts`
Expected: FAIL — cannot resolve `./voteComment.js`

- [ ] **Step 3: Write the task**

Create `ui/src/lib/predict/tasks/voteComment.ts`:

```ts
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { runPrediction } from '../predict.js';
import type { PredictionTask, PredictionMeta } from '../predict.js';
import { modelForSection } from '../../digest/modelFor.js';

export interface VoteCommentInput {
  song: { title: string; artist: string };
  theme: { name: string; description: string };
  rating: number | null;
  notes: string;
  upPoints: number;
  downPoints: number;
  /** The owner's past vote comments, newest first — few-shot voice examples. */
  voiceSample: string[];
}

export const VoteCommentOutputSchema = z.object({
  draft: z.string().min(1),
}).strict();

export type VoteCommentOutput = z.infer<typeof VoteCommentOutputSchema>;

const VoteCommentInputSchema = z.custom<VoteCommentInput>(
  (v) => v !== null && v !== undefined && typeof (v as VoteCommentInput).song === 'object',
);

export function buildVoteCommentMessages(input: VoteCommentInput) {
  const { song, theme, rating, notes, upPoints, downPoints, voiceSample } = input;
  const isDownvote = downPoints > 0;

  const lines: string[] = [];
  lines.push('--- Track ---');
  lines.push(`${song.artist} — "${song.title}"`);
  lines.push(`Round theme: ${theme.name} (${theme.description})`);
  lines.push(`\nMy allocation: ${isDownvote ? `DOWNVOTE (${downPoints})` : `${upPoints} up point(s)`}`);
  if (rating !== null) lines.push(`My private rating: ${rating}/5`);
  lines.push(`\nMy notes: ${notes || '(none)'}`);

  if (voiceSample.length) {
    lines.push('\n--- How I usually write vote comments (my past comments) ---');
    for (const c of voiceSample) lines.push(`- ${c}`);
  }

  return [
    {
      role: 'system' as const,
      content: `You draft a short public vote comment for a private music league, written AS the user, in the user's own voice.

Rules:
- Match the voice, length and register of the user's past comments shown below. If they are terse, be terse. If they swear, you may swear.
- Ground the comment in the user's own notes. Do not invent opinions they did not express.
- This is a public comment other league members will read. Never mention scores, points, strategy, or that it was AI-written.
- ${isDownvote ? 'This is a DOWNVOTE. Be honest about why it did not land, in the user\'s voice — punchy, not cruel.' : 'This is an upvote. Say what worked.'}
- One short paragraph at most. No preamble, no sign-off.

Output a JSON object with EXACTLY this field:
{ "draft": "<the comment text>" }`,
    },
    { role: 'user' as const, content: lines.join('\n') },
  ];
}

export const voteCommentTask: PredictionTask<VoteCommentInput, VoteCommentOutput> = {
  id: 'vote-comment',
  inputSchema: VoteCommentInputSchema,
  buildMessages: buildVoteCommentMessages,
  model: (db) => modelForSection('vote-comment', db),
  outputSchema: VoteCommentOutputSchema,
};

/**
 * Always generates fresh: the draft depends on the user's notes and allocation,
 * which change constantly, and "regenerate" is an explicit product affordance.
 */
export async function runVoteComment(
  db: Database.Database,
  opts: { roundId: number; input: VoteCommentInput },
): Promise<{ output: VoteCommentOutput; meta: PredictionMeta }> {
  return runPrediction(db, voteCommentTask, opts.input, { roundId: opts.roundId });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/predict/tasks/voteComment.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the endpoint**

Create `ui/src/routes/api/voting-lab/[roundId]/comment/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/db/client.js';
import { buildLabData } from '$lib/voting-lab/labData.js';
import { runVoteComment } from '$lib/predict/tasks/voteComment.js';
import { getVoiceSample } from '$lib/voting-lab/voiceSample.js';

const Body = z.object({ spotifyUri: z.string().min(1) });

export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) throw error(400, parsed.error.message);

  const db = getDb();
  const data = buildLabData(db, roundId);
  const row = data.rows.find((r) => r.song.spotifyUri === parsed.data.spotifyUri);
  if (!row) throw error(404, 'song not in this round');

  const { output } = await runVoteComment(db, {
    roundId,
    input: {
      song: { title: row.song.title, artist: row.song.artist },
      theme: { name: data.themeName, description: data.themeDescription },
      rating: row.ballot.rating,
      notes: row.ballot.notes,
      upPoints: row.ballot.upPoints,
      downPoints: row.ballot.downPoints,
      voiceSample: getVoiceSample(db),
    },
  });

  return json(output);
};
```

- [ ] **Step 6: Add the drafter UI to the song row**

In `ui/src/lib/components/VotingLabSongRow.svelte` `<script>`:

```ts
  let drafting = $state(false);

  async function draftComment() {
    drafting = true;
    try {
      const res = await fetch(`/api/voting-lab/${roundId}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spotifyUri: row.song.spotifyUri }),
      });
      if (res.ok) {
        const { draft } = (await res.json()) as { draft: string };
        onchange({ ...row.ballot, draftComment: draft });
      }
    } finally {
      drafting = false;
    }
  }

  async function copyComment() {
    await navigator.clipboard.writeText(row.ballot.draftComment);
  }
```

Add to the markup after the notes `<textarea>`:

```svelte
  <div class="mt-2">
    <textarea
      class="w-full rounded bg-black/20 p-2 text-sm"
      rows="2"
      placeholder="Drafted vote comment…"
      value={row.ballot.draftComment}
      oninput={(e) => onchange({ ...row.ballot, draftComment: (e.currentTarget as HTMLTextAreaElement).value })}
    ></textarea>
    <div class="mt-1 flex gap-3 text-xs">
      <button class="underline opacity-70" onclick={draftComment} disabled={drafting}>
        {drafting ? 'Drafting…' : row.ballot.draftComment ? 'Regenerate' : 'Draft comment'}
      </button>
      {#if row.ballot.draftComment}
        <button class="underline opacity-70" onclick={copyComment}>Copy</button>
      {/if}
    </div>
  </div>
```

- [ ] **Step 7: Run the full suite and commit**

Run: `cd ui && npx vitest run`
Expected: PASS

```bash
git add ui/src/lib/predict/tasks/voteComment.ts ui/src/lib/predict/tasks/voteComment.test.ts "ui/src/routes/api/voting-lab/[roundId]/comment" ui/src/lib/components/VotingLabSongRow.svelte
git commit -m "feat(voting-lab): draft vote comments in the owner's voice"
```

---

## Final verification

- [ ] **Run the whole suite**

Run: `cd ui && npx vitest run`
Expected: all tests pass

- [ ] **Type-check**

Run: `cd ui && npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json --threshold error`
Expected: no errors

- [ ] **Manual end-to-end on a live voting round**

1. Open the active-round page during a voting round → the Voting Lab appears.
2. Click "Sync live round" → songs populate, submitters are not shown anywhere.
3. Set the budget in Settings for the season → the meter reflects it as `(season)`.
4. Allocate points until a pool is exhausted → further `+` is refused.
5. "Get take" on a song → perspective only, no vote recommendation.
6. Add notes, "Draft comment" → reads in your voice; edit and copy it.
7. "Copy whole ballot" → paste shows only allocated songs with their comments.
8. Reload the page → every allocation, note and draft persisted.
