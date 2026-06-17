# b-side Season Awareness — S1 (Awareness Backbone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic data backbone for the Season-Update section — a temporal season timeline, a tested `computeSeasonSignals()` engine, and a lean digest→read-model context channel — with **no UI and no LLM calls** (those are S2).

**Architecture:** Reuse the existing per-round primitives (`computeStandings`, `getDiscoverability`) to assemble an ordered `SeasonTimeline` on demand (no new history table). A pure `seasonSignals.ts` generator turns that timeline into a structured `SeasonSignals` object (movers, streaks, discovery shifts, rivalries, upcoming tension). Separately, the digest pipeline captures a non-published `archive_context` payload on each draft for S2 to consume. Every signal is deterministic and unit-tested with synthetic fixtures.

**Tech Stack:** TypeScript, SvelteKit (`adapter-node`), better-sqlite3, vitest, zod. Design spec: `docs/superpowers/specs/2026-06-16-bside-season-awareness-design.md`.

---

## File Structure

- **Create** `ui/src/lib/dashboard/seasonTimeline.ts` — assembles the ordered per-round ladder + tastemaker-by-round + cross-player vote pairs for a league's active season. Pure read (no writes, no LLM).
- **Create** `ui/src/lib/dashboard/seasonTimeline.test.ts` — fixtures + tests.
- **Create** `ui/src/lib/dashboard/seasonSignals.ts` — `computeSeasonSignals(timeline)` → `SeasonSignals`. Pure functions, one per signal. The heart.
- **Create** `ui/src/lib/dashboard/seasonSignals.test.ts` — one describe block per signal.
- **Modify** `ui/src/lib/db/schema.ts` — add `archive_context TEXT` column to the `digest_drafts` CREATE TABLE.
- **Modify** `ui/src/lib/db/client.ts` — additive ALTER TABLE migration for `archive_context` (follow the existing `phase`-column migration pattern).
- **Create** `ui/src/lib/digest/archiveContext.ts` — `buildArchiveContext()` (pure, from genParams + draft output) + `getArchiveContext(db, roundId)` reader.
- **Create** `ui/src/lib/digest/archiveContext.test.ts` — tests.
- **Modify** `ui/src/lib/digest/llm.ts` — in `writeDraft(...)`, persist `archive_context` (computed via `buildArchiveContext`).

S1 deliverable: `computeSeasonSignals(buildSeasonTimeline(db, leagueId))` returns accurate signals, and every finalized draft stores an `archive_context`. No read-model change, no rendering — that's S2.

---

## Task 1: Lean channel — `archive_context` column

**Files:**
- Modify: `ui/src/lib/db/schema.ts` (the `digest_drafts` CREATE TABLE)
- Modify: `ui/src/lib/db/client.ts` (additive migration)

- [ ] **Step 1: Add the column to the canonical schema**

In `schema.ts`, in the `CREATE TABLE digest_drafts (...)` block, add a nullable column after `prep_checks`:

```sql
  archive_context TEXT,                        -- S1: lean digest->read-model channel (JSON), non-published
```

- [ ] **Step 2: Add the additive migration**

In `client.ts`, find the block that ALTERs `rounds` to add `phase` (the `roundsCols... !some(c => c.name === 'phase')` pattern). Directly after it, add the same pattern for `digest_drafts`:

```ts
const draftCols = db.prepare("PRAGMA table_info(digest_drafts)").all() as { name: string }[];
if (draftCols.length && !draftCols.some(c => c.name === 'archive_context')) {
  db.exec("ALTER TABLE digest_drafts ADD COLUMN archive_context TEXT");
}
```

- [ ] **Step 3: Verify migration is idempotent on an existing DB**

Run: `cd ui && npx vitest run src/lib/digest 2>&1 | tail -5`
Expected: existing digest tests still PASS (they open `:memory:` DBs through `client.ts`, exercising the migration). No errors about a duplicate column.

- [ ] **Step 4: Commit**

```bash
git add ui/src/lib/db/schema.ts ui/src/lib/db/client.ts
git commit -m "feat(digest): add archive_context column to digest_drafts (lean channel)"
```

---

## Task 2: Lean channel — capture + reader (`archiveContext.ts`)

**Files:**
- Create: `ui/src/lib/digest/archiveContext.ts`
- Test: `ui/src/lib/digest/archiveContext.test.ts`
- Modify: `ui/src/lib/digest/llm.ts` (`writeDraft`)

The payload captures only what structured data can't: the operator's steer (from `GenParams`) and a one-line "round dynamics" note distilled deterministically from the generated `flow` section.

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/digest/archiveContext.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildArchiveContext } from './archiveContext.js';

describe('buildArchiveContext', () => {
  it('captures operator steer from genParams section context', () => {
    const ctx = buildArchiveContext(
      { sections: [{ id: 'flow', context: 'lean into the comeback angle' }] },
      { sections: { flow: { title: 'F', body: 'A surged from last to first.' } } },
    );
    expect(ctx.operatorSteer).toContain('comeback angle');
  });

  it('distills a one-line round-dynamics note from the flow body (first sentence)', () => {
    const ctx = buildArchiveContext(undefined, {
      sections: { flow: { title: 'F', body: 'A surged from last to first. Then more prose.' } },
    });
    expect(ctx.roundDynamics).toBe('A surged from last to first.');
  });

  it('returns empty fields when nothing is available (no throw)', () => {
    const ctx = buildArchiveContext(undefined, { sections: {} });
    expect(ctx).toEqual({ operatorSteer: '', roundDynamics: '' });
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd ui && npx vitest run src/lib/digest/archiveContext.test.ts`
Expected: FAIL — "Cannot find module './archiveContext.js'".

- [ ] **Step 3: Implement `archiveContext.ts`**

Create `ui/src/lib/digest/archiveContext.ts`:

```ts
import type Database from 'better-sqlite3';
import type { GenParams } from './llm.js';

export interface ArchiveContext {
  /** Operator steer/intent for the round — section contexts + pasted-chat presence. */
  operatorSteer: string;
  /** One-line distilled "what happened" note (first sentence of the flow body). */
  roundDynamics: string;
}

function firstSentence(s: string): string {
  const trimmed = s.replace(/\s+/g, ' ').trim();
  const m = trimmed.match(/^(.*?[.!?])(\s|$)/);
  return (m ? m[1] : trimmed).trim();
}

export function buildArchiveContext(
  genParams: GenParams | undefined,
  output: { sections: Record<string, unknown> },
): ArchiveContext {
  const steerParts: string[] = [];
  for (const s of genParams?.sections ?? []) {
    if (s.context?.trim()) steerParts.push(`${s.id}: ${s.context.trim()}`);
  }
  if (genParams?.pastedChat?.trim()) steerParts.push('operator pasted chat transcript');

  const flow = output.sections?.flow as { body?: string } | undefined;
  const roundDynamics = flow?.body ? firstSentence(flow.body) : '';

  return { operatorSteer: steerParts.join(' | '), roundDynamics };
}

export function getArchiveContext(db: Database.Database, roundId: number): ArchiveContext | null {
  const row = db
    .prepare(
      `SELECT archive_context FROM digest_drafts
       WHERE round_id = ? ORDER BY generated_at DESC LIMIT 1`,
    )
    .get(roundId) as { archive_context: string | null } | undefined;
  if (!row?.archive_context) return null;
  try { return JSON.parse(row.archive_context) as ArchiveContext; } catch { return null; }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd ui && npx vitest run src/lib/digest/archiveContext.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire capture into `writeDraft`**

In `ui/src/lib/digest/llm.ts`: add the import at the top — `import { buildArchiveContext } from './archiveContext.js';` — and in `writeDraft`, inside the `tx` transaction, change the `INSERT INTO digest_drafts (...)` to also write `archive_context`:

```ts
const archiveContext = JSON.stringify(buildArchiveContext(genParams, output));
db.prepare(
  `INSERT INTO digest_drafts (id, round_id, generated_at, rel_context, prep_checks, whole_regen_count, llm_cost_usd, recap_enabled, recap_final, archive_context)
   VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
).run(draftId, roundId, now, data.relContext, JSON.stringify(prepChecks ?? {}), output.costUsd ?? 0, recapEnabled, recapFinal, archiveContext);
```

- [ ] **Step 6: Run the digest suite, verify no regression**

Run: `cd ui && npx vitest run src/lib/digest`
Expected: PASS (existing tests + the 3 new archiveContext tests).

- [ ] **Step 7: Commit**

```bash
git add ui/src/lib/digest/archiveContext.ts ui/src/lib/digest/archiveContext.test.ts ui/src/lib/digest/llm.ts
git commit -m "feat(digest): capture lean archive_context (operator steer + round dynamics) on writeDraft"
```

---

## Task 3: Season timeline assembler (`seasonTimeline.ts`)

**Files:**
- Create: `ui/src/lib/dashboard/seasonTimeline.ts`
- Test: `ui/src/lib/dashboard/seasonTimeline.test.ts`

Assembles, for a league's active season: the ordered scored rounds, per-round standings (via `computeStandings`), per-round tastemaker (via `getDiscoverability`), and cross-player vote pairs (for rivalry detection). No new table — computed on demand.

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/dashboard/seasonTimeline.test.ts`. Use the standings-test seeding style (`openLeagueDb(':memory:')`, insert competitors/submissions/votes):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '../db/client.js';
import { buildSeasonTimeline } from './seasonTimeline.js';

let db: Database.Database;
let leagueId: number, seasonId: number;

function comp(name: string): number {
  db.prepare("INSERT INTO competitors (ml_competitor_id, name) VALUES (?, ?)").run(`ml-${name}`, name);
  return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}
function round(n: number): number {
  db.prepare("INSERT INTO rounds (season_id, ml_round_id, name, round_number) VALUES (?, ?, ?, ?)")
    .run(seasonId, `ml-r${n}`, `Round ${n}`, n);
  return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}
function sub(roundId: number, competitorId: number, uri: string) {
  db.prepare("INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists) VALUES (?,?,?,?,?)")
    .run(roundId, competitorId, uri, uri, 'Artist');
}
function vote(roundId: number, voterId: number, uri: string, points: number) {
  db.prepare("INSERT INTO votes (round_id, voter_id, spotify_uri, points) VALUES (?,?,?,?)")
    .run(roundId, voterId, uri, points);
}

beforeEach(() => {
  db = openLeagueDb(':memory:');
  db.prepare("INSERT INTO leagues (slug, name, is_active) VALUES ('t','T',1)").run();
  leagueId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
  db.prepare("INSERT INTO seasons (league_id, season_number, status) VALUES (?,1,'active')").run(leagueId);
  seasonId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
});

it('returns scored rounds in round_number order with per-round standings', () => {
  const a = comp('A'), b = comp('B');
  const r1 = round(1), r2 = round(2);
  sub(r1, a, 'a1'); sub(r1, b, 'b1'); vote(r1, b, 'a1', 5); vote(r1, a, 'b1', 1);
  sub(r2, a, 'a2'); sub(r2, b, 'b2'); vote(r2, b, 'a2', 1); vote(r2, a, 'b2', 5);

  const t = buildSeasonTimeline(db, leagueId);
  expect(t.rounds.map(r => r.roundNumber)).toEqual([1, 2]);
  expect(t.standingsByRound).toHaveLength(2);
  // round 1: A leads (5 vs 1)
  expect(t.standingsByRound[0].standings[0].name).toBe('A');
  // round 2 cumulative: A=6, B=6 — tie, both present
  const r2names = t.standingsByRound[1].standings.map(s => s.name).sort();
  expect(r2names).toEqual(['A', 'B']);
});

it('captures vote pairs linking voter -> submitter with points', () => {
  const a = comp('A'), b = comp('B');
  const r1 = round(1);
  sub(r1, a, 'a1'); sub(r1, b, 'b1');
  vote(r1, b, 'a1', -1);  // B downvoted A's song
  const t = buildSeasonTimeline(db, leagueId);
  const pair = t.votePairs.find(p => p.voterName === 'B' && p.targetName === 'A');
  expect(pair).toBeTruthy();
  expect(pair!.points).toBe(-1);
  expect(pair!.roundNumber).toBe(1);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd ui && npx vitest run src/lib/dashboard/seasonTimeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `seasonTimeline.ts`**

```ts
import type Database from 'better-sqlite3';
import { computeStandings, type StandingRow } from '../db/standings.js';
import { getDiscoverability, type TastemakerPayload } from '../db/discoverability.js';
import { getActiveSeasonId } from '../db/activeRound.js';

export interface RoundRef { roundId: number; roundNumber: number; name: string; }

export interface RoundStandingSnapshot {
  roundId: number;
  roundNumber: number;
  name: string;
  standings: StandingRow[];
}

export interface VotePair {
  voterId: number; voterName: string;
  targetId: number; targetName: string;   // submitter of the voted song
  roundId: number; roundNumber: number;
  points: number;                          // negative = downvote
  song: string;
}

export interface SeasonTimeline {
  leagueId: number;
  seasonId: number | null;
  rounds: RoundRef[];                       // scored rounds, ordered
  standingsByRound: RoundStandingSnapshot[];
  tastemakerByRound: Map<number, TastemakerPayload | null>;
  votePairs: VotePair[];
}

export function buildSeasonTimeline(db: Database.Database, leagueId: number): SeasonTimeline {
  const seasonId = getActiveSeasonId(db, leagueId);
  if (seasonId == null) {
    return { leagueId, seasonId: null, rounds: [], standingsByRound: [], tastemakerByRound: new Map(), votePairs: [] };
  }

  // Scored rounds (have at least one vote), ordered by round_number then id.
  const rounds = db.prepare(
    `SELECT r.id AS roundId, r.round_number AS rn, r.name AS name
     FROM rounds r
     WHERE r.season_id = ?
       AND EXISTS (SELECT 1 FROM votes v WHERE v.round_id = r.id)
     ORDER BY r.round_number IS NULL, r.round_number, r.id`,
  ).all(seasonId) as { roundId: number; rn: number | null; name: string }[];

  const refs: RoundRef[] = rounds.map((r, i) => ({ roundId: r.roundId, roundNumber: r.rn ?? i + 1, name: r.name }));

  const standingsByRound: RoundStandingSnapshot[] = refs.map(ref => ({
    roundId: ref.roundId, roundNumber: ref.roundNumber, name: ref.name,
    standings: computeStandings(db, ref.roundId),
  }));

  const tastemakerByRound = new Map<number, TastemakerPayload | null>();
  for (const ref of refs) tastemakerByRound.set(ref.roundId, getDiscoverability(db, ref.roundId));

  // Vote pairs: each vote -> the submitter of the voted song, across scored rounds.
  const roundIds = refs.map(r => r.roundId);
  const votePairs: VotePair[] = roundIds.length === 0 ? [] : (db.prepare(
    `SELECT v.round_id AS roundId, v.points AS points, v.spotify_uri AS song,
            vc.id AS voterId, vc.name AS voterName,
            sc.id AS targetId, sc.name AS targetName
     FROM votes v
     JOIN competitors vc ON vc.id = v.voter_id
     JOIN ml_submissions m ON m.round_id = v.round_id AND m.spotify_uri = v.spotify_uri
     JOIN competitors sc ON sc.id = m.competitor_id
     WHERE v.round_id IN (${roundIds.map(() => '?').join(',')})`,
  ).all(...roundIds) as Omit<VotePair, 'roundNumber'>[])
    .map(p => ({ ...p, roundNumber: refs.find(r => r.roundId === p.roundId)!.roundNumber }));

  return { leagueId, seasonId, rounds: refs, standingsByRound, tastemakerByRound, votePairs };
}
```

> NOTE for the implementer: confirm `getActiveSeasonId` is exported from `../db/activeRound.js` (it is used by `buildLeagueActiveRound`). If it is not exported, export it (additive) rather than re-implementing.

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd ui && npx vitest run src/lib/dashboard/seasonTimeline.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/dashboard/seasonTimeline.ts ui/src/lib/dashboard/seasonTimeline.test.ts
git commit -m "feat(bside): season timeline assembler (per-round standings + tastemaker + vote pairs)"
```

---

## Task 4: Signals engine — types + movers (bigMover / faller)

**Files:**
- Create: `ui/src/lib/dashboard/seasonSignals.ts`
- Test: `ui/src/lib/dashboard/seasonSignals.test.ts`

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/dashboard/seasonSignals.test.ts`. Build a minimal fake `SeasonTimeline` (no DB needed — the engine is pure over the timeline):

```ts
import { describe, it, expect } from 'vitest';
import { computeSeasonSignals } from './seasonSignals.js';
import type { SeasonTimeline, RoundStandingSnapshot } from './seasonTimeline.js';

function snap(roundNumber: number, name: string, rows: Array<[string, number, number, number, number, number | null]>): RoundStandingSnapshot {
  return {
    roundId: roundNumber, roundNumber, name,
    standings: rows.map(([nm, rank, priorTotal, roundPoints, currentTotal, prevRank], i) => ({
      competitorId: i + 1, name: nm, rank, prevRank, priorTotal, roundPoints, currentTotal,
    })),
  };
}
function timeline(snapshots: RoundStandingSnapshot[]): SeasonTimeline {
  return {
    leagueId: 1, seasonId: 1,
    rounds: snapshots.map(s => ({ roundId: s.roundId, roundNumber: s.roundNumber, name: s.name })),
    standingsByRound: snapshots, tastemakerByRound: new Map(), votePairs: [],
  };
}

describe('movers', () => {
  it('flags the biggest upward mover into the top', () => {
    const t = timeline([
      snap(1, 'R1', [['A', 1, 0, 5, 5, null], ['B', 2, 0, 1, 1, null]]),
      // round 2: B jumps from rank 2 to rank 1
      snap(2, 'R2', [['B', 1, 1, 9, 10, 2], ['A', 2, 5, 1, 6, 1]]),
    ]);
    const sig = computeSeasonSignals(t);
    expect(sig.bigMover?.player).toBe('B');
    expect(sig.bigMover?.fromRank).toBe(2);
    expect(sig.bigMover?.toRank).toBe(1);
  });

  it('flags the biggest faller toward the bottom', () => {
    const t = timeline([
      snap(1, 'R1', [['A', 1, 0, 9, 9, null], ['B', 2, 0, 5, 5, null], ['C', 3, 0, 1, 1, null]]),
      snap(2, 'R2', [['B', 1, 5, 9, 14, 2], ['C', 2, 1, 9, 10, 3], ['A', 3, 9, 0, 9, 1]]),
    ]);
    const sig = computeSeasonSignals(t);
    expect(sig.faller?.player).toBe('A');
    expect(sig.faller?.toRank).toBe(3);
  });

  it('returns null movers for a single-round season', () => {
    const sig = computeSeasonSignals(timeline([snap(1, 'R1', [['A', 1, 0, 5, 5, null]])]));
    expect(sig.bigMover).toBeNull();
    expect(sig.faller).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd ui && npx vitest run src/lib/dashboard/seasonSignals.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement types + movers in `seasonSignals.ts`**

```ts
import type { SeasonTimeline, RoundStandingSnapshot, VotePair } from './seasonTimeline.js';

export interface MoverSignal {
  player: string; fromRank: number; toRank: number; rankDelta: number;
  roundPoints: number; total: number;
}
export interface StreakSignal {
  player: string; direction: 'surging' | 'cooling' | 'coasting'; rounds: number; detail: string;
}
export interface DiscoveryShiftSignal {
  player: string; direction: 'went-safe' | 'went-obscure'; detail: string;
}
export interface RivalrySignal {
  kind: 'reciprocal-downvote' | 'spot-trading'; players: [string, string];
  rounds: number[]; detail: string;
}
export interface UpcomingTension {
  contenders: { player: string; total: number; gapToLeader: number }[];
  nextRound: { roundNumber: number; name: string } | null;
}
export interface SeasonSignals {
  asOfRound: { roundNumber: number; name: string } | null;
  bigMover: MoverSignal | null;
  faller: MoverSignal | null;
  streaks: StreakSignal[];
  discoveryShifts: DiscoveryShiftSignal[];
  rivalries: RivalrySignal[];
  upcomingTension: UpcomingTension | null;
}

function lastTwo(t: SeasonTimeline): [RoundStandingSnapshot, RoundStandingSnapshot] | null {
  const n = t.standingsByRound.length;
  if (n < 2) return null;
  return [t.standingsByRound[n - 2], t.standingsByRound[n - 1]];
}

function computeMovers(t: SeasonTimeline): { bigMover: MoverSignal | null; faller: MoverSignal | null } {
  const latest = t.standingsByRound[t.standingsByRound.length - 1];
  if (!latest) return { bigMover: null, faller: null };
  const moved = latest.standings
    .filter(s => s.prevRank != null)
    .map(s => ({ s, delta: (s.prevRank as number) - s.rank })); // positive = moved up
  if (moved.length === 0) return { bigMover: null, faller: null };

  const up = [...moved].filter(m => m.delta > 0).sort((a, b) => b.delta - a.delta || a.s.rank - b.s.rank)[0];
  const down = [...moved].filter(m => m.delta < 0).sort((a, b) => a.delta - b.delta || b.s.rank - a.s.rank)[0];

  const toSig = (m: { s: RoundStandingSnapshot['standings'][0]; delta: number }): MoverSignal => ({
    player: m.s.name, fromRank: m.s.prevRank as number, toRank: m.s.rank, rankDelta: m.delta,
    roundPoints: m.s.roundPoints, total: m.s.currentTotal,
  });

  return { bigMover: up ? toSig(up) : null, faller: down ? toSig(down) : null };
}

export function computeSeasonSignals(t: SeasonTimeline): SeasonSignals {
  const latest = t.standingsByRound[t.standingsByRound.length - 1];
  const { bigMover, faller } = computeMovers(t);
  return {
    asOfRound: latest ? { roundNumber: latest.roundNumber, name: latest.name } : null,
    bigMover, faller,
    streaks: [],            // Task 5
    discoveryShifts: [],    // Task 6
    rivalries: [],          // Task 7
    upcomingTension: null,  // Task 8
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd ui && npx vitest run src/lib/dashboard/seasonSignals.test.ts`
Expected: PASS (3 tests in `movers`).

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/dashboard/seasonSignals.ts ui/src/lib/dashboard/seasonSignals.test.ts
git commit -m "feat(bside): season signals engine — types + movers (bigMover/faller)"
```

---

## Task 5: Signals engine — streaks

**Files:** Modify `seasonSignals.ts` + `seasonSignals.test.ts`

A streak = a player whose per-round rank moved the same direction for ≥2 consecutive rounds (surging = improving, cooling = worsening). "coasting" = a top-3 player with ≥2 rounds of below-their-own-average roundPoints.

- [ ] **Step 1: Add the failing test** (append a `describe('streaks', ...)` block):

```ts
describe('streaks', () => {
  it('detects a 2+ round surge (rank improving each round)', () => {
    const t = timeline([
      snap(1, 'R1', [['A', 3, 0, 1, 1, null], ['B', 1, 0, 9, 9, null], ['C', 2, 0, 5, 5, null]]),
      snap(2, 'R2', [['A', 2, 1, 6, 7, 3], ['B', 1, 9, 5, 14, 1], ['C', 3, 5, 1, 6, 2]]),
      snap(3, 'R3', [['A', 1, 7, 9, 16, 2], ['B', 2, 14, 1, 15, 1], ['C', 3, 6, 5, 11, 3]]),
    ]);
    const surge = computeSeasonSignals(t).streaks.find(s => s.player === 'A');
    expect(surge?.direction).toBe('surging');
    expect(surge?.rounds).toBe(2);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd ui && npx vitest run src/lib/dashboard/seasonSignals.test.ts -t streaks`
Expected: FAIL — `streaks` is empty.

- [ ] **Step 3: Implement `computeStreaks` and wire it in**

Add to `seasonSignals.ts`:

```ts
function computeStreaks(t: SeasonTimeline): StreakSignal[] {
  const byPlayer = new Map<string, number[]>(); // name -> rank per scored round, in order
  for (const snap of t.standingsByRound) {
    for (const s of snap.standings) {
      if (!byPlayer.has(s.name)) byPlayer.set(s.name, []);
      byPlayer.get(s.name)!.push(s.rank);
    }
  }
  const out: StreakSignal[] = [];
  for (const [player, ranks] of byPlayer) {
    if (ranks.length < 3) continue; // need >=3 snapshots for 2 consecutive same-direction moves
    let run = 0, dir = 0;
    for (let i = ranks.length - 1; i > 0; i--) {
      const step = ranks[i - 1] - ranks[i]; // >0 improved (rank went down)
      const d = Math.sign(step);
      if (d === 0) break;
      if (dir === 0) { dir = d; run = 1; }
      else if (d === dir) run++;
      else break;
    }
    if (run >= 2) {
      out.push({
        player, direction: dir > 0 ? 'surging' : 'cooling', rounds: run,
        detail: `${run} straight rounds ${dir > 0 ? 'climbing' : 'sliding'}`,
      });
    }
  }
  return out.sort((a, b) => b.rounds - a.rounds);
}
```

In `computeSeasonSignals`, replace `streaks: []` with `streaks: computeStreaks(t),`.

- [ ] **Step 4: Run it, verify it passes**

Run: `cd ui && npx vitest run src/lib/dashboard/seasonSignals.test.ts`
Expected: PASS (movers + streaks).

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/dashboard/seasonSignals.ts ui/src/lib/dashboard/seasonSignals.test.ts
git commit -m "feat(bside): season signals — streak detection"
```

---

## Task 6: Signals engine — discovery shifts

**Files:** Modify `seasonSignals.ts` + `seasonSignals.test.ts`

A discovery shift = a player whose most-recent-round tastemaker score diverges meaningfully from their season baseline (≥20 percentile points): "went-safe" (recent more mainstream) or "went-obscure". Uses `tastemakerByRound`.

- [ ] **Step 1: Add the failing test:**

```ts
import type { TastemakerPayload } from '../db/discoverability.js';

function tm(season: string, players: Array<[string, number]>): TastemakerPayload {
  return {
    scope: 'season', season,
    players: players.map(([name, tastemakerScore], i) => ({
      name, rank: i + 1, prevRank: null, tastemakerScore, avgPoints: 0, submissionCount: 1,
      buckets: { radioHit: 0, recognizable: 0, curiousCut: 0, rabbitHole: 0 }, songs: [],
    })),
  };
}

describe('discoveryShifts', () => {
  it('flags a usually-obscure player going radio-safe', () => {
    const base: import('./seasonTimeline.js').SeasonTimeline = {
      leagueId: 1, seasonId: 1,
      rounds: [{ roundId: 1, roundNumber: 1, name: 'R1' }, { roundId: 2, roundNumber: 2, name: 'R2' }],
      standingsByRound: [snap(1, 'R1', [['A', 1, 0, 5, 5, null]]), snap(2, 'R2', [['A', 1, 5, 5, 10, 1]])],
      tastemakerByRound: new Map([
        [1, tm('S', [['A', 80]])],   // baseline obscure
        [2, tm('S', [['A', 30]])],   // recent mainstream
      ]),
      votePairs: [],
    };
    const shift = computeSeasonSignals(base).discoveryShifts.find(s => s.player === 'A');
    expect(shift?.direction).toBe('went-safe');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd ui && npx vitest run src/lib/dashboard/seasonSignals.test.ts -t discoveryShifts`
Expected: FAIL — `discoveryShifts` empty.

- [ ] **Step 3: Implement `computeDiscoveryShifts` and wire in**

```ts
const SHIFT_THRESHOLD = 20;

function computeDiscoveryShifts(t: SeasonTimeline): DiscoveryShiftSignal[] {
  const rounds = t.rounds;
  if (rounds.length < 2) return [];
  const latestId = rounds[rounds.length - 1].roundId;
  const prevId = rounds[rounds.length - 2].roundId;
  const latest = t.tastemakerByRound.get(latestId);
  const prev = t.tastemakerByRound.get(prevId);
  if (!latest || !prev) return [];

  const prevScore = new Map(prev.players.map(p => [p.name, p.tastemakerScore]));
  const out: DiscoveryShiftSignal[] = [];
  for (const p of latest.players) {
    const before = prevScore.get(p.name);
    if (before == null) continue;
    const delta = p.tastemakerScore - before; // positive = more obscure
    if (Math.abs(delta) < SHIFT_THRESHOLD) continue;
    out.push({
      player: p.name,
      direction: delta < 0 ? 'went-safe' : 'went-obscure',
      detail: `tastemaker score ${before} -> ${p.tastemakerScore}`,
    });
  }
  return out;
}
```

In `computeSeasonSignals`, replace `discoveryShifts: []` with `discoveryShifts: computeDiscoveryShifts(t),`.

- [ ] **Step 4: Run it, verify it passes**

Run: `cd ui && npx vitest run src/lib/dashboard/seasonSignals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/dashboard/seasonSignals.ts ui/src/lib/dashboard/seasonSignals.test.ts
git commit -m "feat(bside): season signals — discovery-behavior shifts"
```

---

## Task 7: Signals engine — rivalries (reciprocal downvotes + spot-trading)

**Files:** Modify `seasonSignals.ts` + `seasonSignals.test.ts`

Reciprocal-downvote = an unordered pair (X, Y) where X gave Y a negative vote AND Y gave X a negative vote (any rounds). Spot-trading = a pair who swap relative order (one ahead, then the other) across ≥2 round boundaries. (Chat-barbs are deferred to S2 — LLM-assisted.)

- [ ] **Step 1: Add the failing test:**

```ts
function tlWithPairs(pairs: import('./seasonTimeline.js').VotePair[]): import('./seasonTimeline.js').SeasonTimeline {
  return {
    leagueId: 1, seasonId: 1,
    rounds: [{ roundId: 1, roundNumber: 1, name: 'R1' }, { roundId: 2, roundNumber: 2, name: 'R2' }],
    standingsByRound: [snap(1, 'R1', [['A', 1, 0, 5, 5, null]])],
    tastemakerByRound: new Map(), votePairs: pairs,
  };
}

describe('rivalries', () => {
  it('detects a reciprocal downvote pair', () => {
    const sig = computeSeasonSignals(tlWithPairs([
      { voterId: 1, voterName: 'A', targetId: 2, targetName: 'B', roundId: 1, roundNumber: 1, points: -1, song: 'b1' },
      { voterId: 2, voterName: 'B', targetId: 1, targetName: 'A', roundId: 2, roundNumber: 2, points: -1, song: 'a2' },
      { voterId: 3, voterName: 'C', targetId: 1, targetName: 'A', roundId: 1, roundNumber: 1, points: 3, song: 'a1' },
    ]));
    const r = sig.rivalries.find(x => x.kind === 'reciprocal-downvote');
    expect(r).toBeTruthy();
    expect([...r!.players].sort()).toEqual(['A', 'B']);
    expect(r!.rounds.sort()).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd ui && npx vitest run src/lib/dashboard/seasonSignals.test.ts -t rivalries`
Expected: FAIL — `rivalries` empty.

- [ ] **Step 3: Implement `computeRivalries` and wire in**

```ts
function pairKey(a: string, b: string): string { return [a, b].sort().join(' '); }

function computeRivalries(t: SeasonTimeline): RivalrySignal[] {
  // Directed negative votes: voter -> target.
  const downvotes = t.votePairs.filter(p => p.points < 0 && p.voterName !== p.targetName);
  const directed = new Map<string, Set<number>>(); // "voter target" -> rounds
  for (const d of downvotes) {
    const k = `${d.voterName} ${d.targetName}`;
    if (!directed.has(k)) directed.set(k, new Set());
    directed.get(k)!.add(d.roundNumber);
  }
  const out: RivalrySignal[] = [];
  const seen = new Set<string>();
  for (const [k, rounds] of directed) {
    const [voter, target] = k.split(' ');
    const rev = directed.get(`${target} ${voter}`);
    if (!rev) continue;
    const key = pairKey(voter, target);
    if (seen.has(key)) continue;
    seen.add(key);
    const allRounds = [...new Set([...rounds, ...rev])].sort((a, b) => a - b);
    out.push({
      kind: 'reciprocal-downvote',
      players: [voter, target].sort() as [string, string],
      rounds: allRounds,
      detail: `traded downvotes across ${allRounds.length} round(s)`,
    });
  }
  return out;
}
```

In `computeSeasonSignals`, replace `rivalries: []` with `rivalries: computeRivalries(t),`.

> Spot-trading detection is a follow-on within this task if time permits; if deferred, it MUST be logged in the plan's commit message as deferred to S2 (do not silently drop it). The reciprocal-downvote signal is the required deliverable here.

- [ ] **Step 4: Run it, verify it passes**

Run: `cd ui && npx vitest run src/lib/dashboard/seasonSignals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/dashboard/seasonSignals.ts ui/src/lib/dashboard/seasonSignals.test.ts
git commit -m "feat(bside): season signals — reciprocal-downvote rivalry detection"
```

---

## Task 8: Signals engine — upcoming tension + DB-level integration

**Files:** Modify `seasonSignals.ts` + `seasonSignals.test.ts`; add a DB-backed entry point.

Upcoming tension = the top contenders (top 3) with their gap to the leader, plus the next round's number+name. Next round comes from the season's rounds after the latest scored round.

- [ ] **Step 1: Add the failing test** (pure part — pass nextRound in):

```ts
describe('upcomingTension', () => {
  it('lists top contenders with gap to leader', () => {
    const t = timeline([
      snap(1, 'R1', [['A', 1, 0, 9, 20, 1], ['B', 2, 0, 9, 18, 2], ['C', 3, 0, 9, 5, 3]]),
    ]);
    const sig = computeSeasonSignals(t, { nextRound: { roundNumber: 2, name: 'Pick Me Up' } });
    expect(sig.upcomingTension?.contenders[0]).toEqual({ player: 'A', total: 20, gapToLeader: 0 });
    expect(sig.upcomingTension?.contenders[1].gapToLeader).toBe(2);
    expect(sig.upcomingTension?.nextRound?.name).toBe('Pick Me Up');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd ui && npx vitest run src/lib/dashboard/seasonSignals.test.ts -t upcomingTension`
Expected: FAIL — signature doesn't accept opts / `upcomingTension` null.

- [ ] **Step 3: Implement opts + `computeUpcomingTension`**

Change the signature and wire it:

```ts
export interface SeasonSignalsOpts {
  nextRound?: { roundNumber: number; name: string } | null;
}

function computeUpcomingTension(
  t: SeasonTimeline, nextRound: SeasonSignalsOpts['nextRound'],
): UpcomingTension | null {
  const latest = t.standingsByRound[t.standingsByRound.length - 1];
  if (!latest || latest.standings.length === 0) return null;
  const leaderTotal = latest.standings[0].currentTotal;
  const contenders = latest.standings.slice(0, 3).map(s => ({
    player: s.name, total: s.currentTotal, gapToLeader: leaderTotal - s.currentTotal,
  }));
  return { contenders, nextRound: nextRound ?? null };
}

export function computeSeasonSignals(t: SeasonTimeline, opts: SeasonSignalsOpts = {}): SeasonSignals {
  const latest = t.standingsByRound[t.standingsByRound.length - 1];
  const { bigMover, faller } = computeMovers(t);
  return {
    asOfRound: latest ? { roundNumber: latest.roundNumber, name: latest.name } : null,
    bigMover, faller,
    streaks: computeStreaks(t),
    discoveryShifts: computeDiscoveryShifts(t),
    rivalries: computeRivalries(t),
    upcomingTension: computeUpcomingTension(t, opts.nextRound ?? null),
  };
}
```

- [ ] **Step 4: Add the DB-backed entry point** (a thin wrapper that builds the timeline, resolves the next round, and computes signals):

Append to `seasonSignals.ts`:

```ts
import type Database from 'better-sqlite3';
import { buildSeasonTimeline } from './seasonTimeline.js';
import { getActiveSeasonId } from '../db/activeRound.js';

/** DB entry point: assemble the timeline + resolve next round, then compute signals. */
export function computeSeasonSignalsForLeague(db: Database.Database, leagueId: number): SeasonSignals {
  const timeline = buildSeasonTimeline(db, leagueId);
  let nextRound: SeasonSignalsOpts['nextRound'] = null;
  const seasonId = getActiveSeasonId(db, leagueId);
  if (seasonId != null && timeline.rounds.length > 0) {
    const lastScored = timeline.rounds[timeline.rounds.length - 1].roundId;
    const nr = db.prepare(
      `SELECT round_number AS rn, name FROM rounds
       WHERE season_id = ? AND id > ? ORDER BY round_number IS NULL, round_number, id LIMIT 1`,
    ).get(seasonId, lastScored) as { rn: number | null; name: string } | undefined;
    if (nr) nextRound = { roundNumber: nr.rn ?? timeline.rounds.length + 1, name: nr.name };
  }
  return computeSeasonSignals(timeline, { nextRound });
}
```

- [ ] **Step 5: Run the full signals suite, verify it passes**

Run: `cd ui && npx vitest run src/lib/dashboard/seasonSignals.test.ts`
Expected: PASS (movers + streaks + discoveryShifts + rivalries + upcomingTension).

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/dashboard/seasonSignals.ts ui/src/lib/dashboard/seasonSignals.test.ts
git commit -m "feat(bside): season signals — upcoming tension + computeSeasonSignalsForLeague entry point"
```

---

## Task 9: End-to-end DB integration test + typecheck gate

**Files:** Create `ui/src/lib/dashboard/seasonSignals.integration.test.ts`

- [ ] **Step 1: Write a DB-backed integration test** that seeds a 2-round season and asserts `computeSeasonSignalsForLeague` returns a coherent object (reuse the seeding helpers from `seasonTimeline.test.ts` — copy them into this file; do not import test files):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '../db/client.js';
import { computeSeasonSignalsForLeague } from './seasonSignals.js';

// (copy comp/round/sub/vote + beforeEach seeding from seasonTimeline.test.ts)

it('produces movers + asOfRound from real DB data', () => {
  const a = comp('A'), b = comp('B');
  const r1 = round(1), r2 = round(2);
  sub(r1, a, 'a1'); sub(r1, b, 'b1'); vote(r1, b, 'a1', 9); vote(r1, a, 'b1', 1);
  sub(r2, a, 'a2'); sub(r2, b, 'b2'); vote(r2, b, 'a2', 1); vote(r2, a, 'b2', 9);
  const sig = computeSeasonSignalsForLeague(db, leagueId);
  expect(sig.asOfRound?.roundNumber).toBe(2);
  expect(sig.bigMover || sig.faller).toBeTruthy();
});
```

- [ ] **Step 2: Run it, verify it passes**

Run: `cd ui && npx vitest run src/lib/dashboard/seasonSignals.integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Full dashboard + digest suites + typecheck**

Run: `cd ui && npx vitest run src/lib/dashboard src/lib/digest && npm run check 2>&1 | tail -3`
Expected: all tests PASS; `svelte-check` reports **0 errors**.

- [ ] **Step 4: Commit**

```bash
git add ui/src/lib/dashboard/seasonSignals.integration.test.ts
git commit -m "test(bside): DB-backed integration test for season signals"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** S1 scope from the spec — temporal read-model (Task 3), deterministic season-signals engine (Tasks 4–8: movers, streaks, discovery shifts, rivalries, upcoming tension), lean digest channel (Tasks 1–2). Chat-barbs + punching-bag guard are spec'd as **S2** (narration-time, history-dependent / LLM-assisted) and intentionally excluded here. Read-model wiring + narration + UI are **S2**.
- **Placeholder scan:** every code step has complete code; no TBD/TODO. The one deferral (spot-trading) is explicitly flagged to be logged in its commit, not silently dropped.
- **Type consistency:** `SeasonTimeline`/`RoundStandingSnapshot`/`VotePair` defined in Task 3 are consumed unchanged in Tasks 4–8; `computeSeasonSignals(t, opts?)` signature is introduced in Task 4 and only extended (opts) in Task 8; `StandingRow` reused from `../db/standings.js`; `TastemakerPayload` reused from `../db/discoverability.js`.

## Notes for the executor

- `getActiveSeasonId` must be exported from `ui/src/lib/db/activeRound.js`; if it isn't, export it (additive) — Task 3 depends on it.
- Keep all new logic in the pure modules (`seasonTimeline.ts`, `seasonSignals.ts`, `archiveContext.ts`) — this is deliberately UI-free and LLM-free so it's fully unit-testable (the b-side has no component-test harness).
- This is self-hosted-adjacent prod code: commit path-scoped (as each task shows); do not push.
