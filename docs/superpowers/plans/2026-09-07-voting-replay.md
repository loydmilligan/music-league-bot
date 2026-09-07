# Voting Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fourth panel in the `/history` League Research tab that steps through one round's voting phase ballot by ballot, showing what happened, what the public results page showed at that moment, and what a chosen observer could have deduced.

**Architecture:** Mirrors the existing League Research split — a DB service returning a plain payload, a pure math module holding all the logic, an API route, and Svelte panels. The engine is pure so it can be property-tested against all ~40 real rounds in `data/league.db`. Everything recomputes client-side so scenario changes are instant.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, better-sqlite3, vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-07-voting-replay-design.md` — read it first. The measurements in its Findings section are the justification for several non-obvious decisions (no cross-interval solver, pools not names, submitter ID demoted).

## Global Constraints

- Player names come from `players.name` via `competitors.player_id`, never the raw ML handle. `monicac1217` is Michael Black; `Sarah` is Sarah Zucker and `Sarah S` is Sarah Black.
- A ballot is atomic: one timestamp per player per round. Group server-side.
- A submitter's own 0-point comment row is a comment, never a vote. It moves no total and must not feed any deduction rule.
- Candidate pools seed from **submitters**, never voters (the Quinto case).
- Submissions-per-player is derived per round, never assumed to be 1 (the two-fer case).
- The engine never returns a resolved submitter name it has not proven. Views cannot print what the engine does not expose.
- Mechanical deduction is sound; hunches are not. They stay in separate fields with separate provenance in the UI.
- Imports inside `ui/src` use the `$lib/...` alias with an explicit `.js` extension, matching the existing codebase.
- Do not add a cross-interval linear solver. The spec proves it yields exactly zero.

---

### Task 0: Shared type contract  *(OWNER: orchestrator — do this first, it unblocks all four workstreams)*

**Files:**
- Create: `ui/src/lib/league-research/replayTypes.ts`

**Interfaces:**
- Produces: every type below. All four workstreams import from here and nowhere else.

- [ ] **Step 1: Create the contract file**

```ts
// Shared contract for the Voting Replay panel. All four workstreams (engine,
// data, views, tests) import from here so they can be built in parallel.
// See docs/superpowers/specs/2026-09-07-voting-replay-design.md

/** One voter's line on one song. `points` of 0 with a comment is a submitter note. */
export interface ReplayVote { uri: string; points: number; comment: string | null; }

/** One player's whole ballot, filed atomically. */
export interface ReplayBallot { voter: string; castAt: string; votes: ReplayVote[]; }

export interface ReplaySong {
  uri: string; title: string; artist: string;
  submitter: string;
  submitterComment: string | null;
}

export interface ReplayPayload {
  round: {
    id: number; name: string; description: string;
    votingDeadline: string | null;
    /** Last submission time: lower bound on when voting opened. */
    windowOpensAfter: string | null;
  };
  songs: ReplaySong[];
  ballots: ReplayBallot[];          // ordered by castAt ascending
}

export type GlanceSeverity = 1 | 2 | 3 | 4;

export interface Scenario {
  /** 1 = individual, 2 = partner, 3 = double plus. Order is irrelevant. */
  observers: string[];
  gs: GlanceSeverity;
  /** Manual (uri, player) exclusions supplied by the analyst. */
  hunches: Array<{ uri: string; player: string }>;
}

/** A contiguous run of ballots between two consecutive checkpoints. */
export interface Interval {
  voters: string[];                  // who voted in this interval, in order
  delta: Record<string, number>;     // per-song point change across the interval
  /** True when voters.length === 1, i.e. the ballot is exactly recoverable. */
  exact: boolean;
}

export interface SongBoard {
  uri: string; points: number; voterCount: number;
}

export interface SongKnowledge {
  uri: string;
  /** Sound mechanical narrowing. Always contains the true submitter. */
  mechanical: string[];
  /** After the analyst's hunches. Subset of `mechanical`. May be wrong. */
  afterHunches: string[];
  ruledOutByYou: string[];
}

export interface ReplayStep {
  index: number;                     // 0-based position in ballots[]
  ballot: ReplayBallot;
  board: SongBoard[];                // public standings AFTER this ballot
  knownBallots: string[];            // voters whose ballots are exactly known
  partialIntervals: Interval[];      // known-as-a-sum, not individually resolved
  knowledge: SongKnowledge[];
}

export interface ReplayAnalysis {
  steps: ReplayStep[];
  /** Ballots strictly between the two observers. Caps everything. */
  windowSize: number;
  observerPositions: Record<string, number>;
  /** Hunch leverage: songs resolved by hunches that mechanics alone did not. */
  hunchesApplied: number;
  songsResolvedByHunches: number;
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
cd ui && npx tsc --noEmit -p tsconfig.json 2>&1 | grep replayTypes; cd ..
git add ui/src/lib/league-research/replayTypes.ts
git commit -m "feat(replay): shared type contract for the voting replay panel"
```

---

## Workstream A — ENGINE  🔵  `ui/src/lib/league-research/deduce.ts`

Pure functions only. No DB, no Svelte, no `fetch`. Everything here is unit-testable.

### Task A1: Checkpoint schedule

**Files:**
- Create: `ui/src/lib/league-research/deduce.ts`
- Test: `ui/src/lib/league-research/deduce.test.ts`

**Interfaces:**
- Consumes: `Scenario`, `GlanceSeverity` from `replayTypes.js`
- Produces: `export function checkpoints(myPos: number, partnerPos: number, gs: GlanceSeverity): number[]`

Checkpoint at fraction `f` lands after ballot `myPos + ceil(f * N)` where `N = partnerPos - myPos - 1`. 4GS checks after every voter in the window. Returns sorted unique ballot indices.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { checkpoints } from './deduce.js';

describe('checkpoints', () => {
  // Worked example from the spec: I vote 1st (index 0), partner votes 11th
  // (index 10), so N = 9 ballots sit between us.
  it('2GS checks at 0, 50, 100 — after voters 1, 6, 10', () => {
    expect(checkpoints(0, 10, 2)).toEqual([0, 5, 9]);
  });

  it('3GS checks at 0, 25, 50, 75, 100 — after voters 1, 4, 6, 8, 10', () => {
    expect(checkpoints(0, 10, 3)).toEqual([0, 3, 5, 7, 9]);
  });

  it('1GS checks only at the ends', () => {
    expect(checkpoints(0, 10, 1)).toEqual([0, 9]);
  });

  it('4GS checks after every voter in the window', () => {
    expect(checkpoints(0, 10, 4)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('adjacent voters leave no window', () => {
    expect(checkpoints(3, 4, 4)).toEqual([3]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ui && npx vitest run src/lib/league-research/deduce.test.ts`
Expected: FAIL — `checkpoints` is not exported.

- [ ] **Step 3: Implement**

```ts
import type { GlanceSeverity } from './replayTypes.js';

const FRACTIONS: Record<Exclude<GlanceSeverity, 4>, number[]> = {
  1: [0, 1],
  2: [0, 0.5, 1],
  3: [0, 0.25, 0.5, 0.75, 1],
};

/**
 * Ballot-indexed glance schedule. The Music League page shows who has voted, so
 * a "glance" is anchored to ballots, not to the clock.
 */
export function checkpoints(myPos: number, partnerPos: number, gs: GlanceSeverity): number[] {
  const n = partnerPos - myPos - 1;
  if (n <= 0) return [myPos];
  if (gs === 4) return Array.from({ length: n + 1 }, (_, i) => myPos + i);
  return [...new Set(FRACTIONS[gs].map((f) => myPos + Math.ceil(f * n)))].sort((a, b) => a - b);
}
```

- [ ] **Step 4: Run and confirm green**

Run: `cd ui && npx vitest run src/lib/league-research/deduce.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/league-research/deduce.ts ui/src/lib/league-research/deduce.test.ts
git commit -m "feat(replay): ballot-indexed glance checkpoints"
```

### Task A2: Intervals and ballot recovery

**Files:**
- Modify: `ui/src/lib/league-research/deduce.ts`
- Test: `ui/src/lib/league-research/deduce.test.ts`

**Interfaces:**
- Produces: `export function intervals(ballots: ReplayBallot[], cps: number[]): Interval[]`
- Produces: `export function recoveredVoters(ivs: Interval[]): string[]`

The union of all observers' checkpoints forms the partition. An interval whose `voters` has length 1 is `exact` and yields that ballot. Larger intervals are retained as partial knowledge.

- [ ] **Step 1: Write the failing test**

```ts
import { intervals, recoveredVoters } from './deduce.js';
import type { ReplayBallot } from './replayTypes.js';

const b = (voter: string, ...pairs: Array<[string, number]>): ReplayBallot => ({
  voter, castAt: `2026-09-0${voter.length}T00:00:00Z`,
  votes: pairs.map(([uri, points]) => ({ uri, points, comment: null })),
});

describe('intervals', () => {
  const ballots = [b('A', ['s1', 2]), b('B', ['s1', 1]), b('C', ['s2', 3]), b('D', ['s1', 1])];

  it('an interval containing one ballot is exact', () => {
    const ivs = intervals(ballots, [0, 1, 2]);
    expect(ivs.map((i) => i.voters)).toEqual([['B'], ['C']]);
    expect(ivs.every((i) => i.exact)).toBe(true);
  });

  it('an interval containing two ballots is not exact but keeps the summed delta', () => {
    const ivs = intervals(ballots, [0, 2]);
    expect(ivs).toHaveLength(1);
    expect(ivs[0].voters).toEqual(['B', 'C']);
    expect(ivs[0].exact).toBe(false);
    expect(ivs[0].delta).toEqual({ s1: 1, s2: 3 });
  });

  it('recoveredVoters returns only the exactly-known ballots', () => {
    expect(recoveredVoters(intervals(ballots, [0, 1, 3]))).toEqual(['B']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ui && npx vitest run src/lib/league-research/deduce.test.ts -t intervals`
Expected: FAIL — `intervals` is not exported.

- [ ] **Step 3: Implement**

```ts
import type { Interval, ReplayBallot } from './replayTypes.js';

/**
 * Split the ballots between consecutive checkpoints. A single observer's
 * checkpoints PARTITION the timeline — the intervals are disjoint, so no
 * interval shares an unknown with another and cross-interval solving yields
 * exactly nothing (measured in the spec). Do not add a solver here.
 */
export function intervals(ballots: ReplayBallot[], cps: number[]): Interval[] {
  const out: Interval[] = [];
  for (let i = 0; i < cps.length - 1; i++) {
    const slice = ballots.slice(cps[i] + 1, cps[i + 1] + 1);
    if (!slice.length) continue;
    const delta: Record<string, number> = {};
    for (const ballot of slice) {
      for (const v of ballot.votes) delta[v.uri] = (delta[v.uri] ?? 0) + v.points;
    }
    out.push({ voters: slice.map((s) => s.voter), delta, exact: slice.length === 1 });
  }
  return out;
}

export function recoveredVoters(ivs: Interval[]): string[] {
  return ivs.filter((i) => i.exact).map((i) => i.voters[0]);
}
```

- [ ] **Step 4: Run and confirm green**

Run: `cd ui && npx vitest run src/lib/league-research/deduce.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/league-research/deduce.ts ui/src/lib/league-research/deduce.test.ts
git commit -m "feat(replay): interval partition and exact ballot recovery"
```

### Task A3: Submitter candidate pools

**Files:**
- Modify: `ui/src/lib/league-research/deduce.ts`
- Test: `ui/src/lib/league-research/deduce.test.ts`

**Interfaces:**
- Produces: `export function candidatePools(songs: ReplaySong[], ballots: ReplayBallot[], knownVoters: string[], observers: string[]): Record<string, string[]>`

Four sound rules: observers know their own songs; every song a known ballot **scored** eliminates that voter; each player submits exactly `k` songs where `k` is derived per round; propagate the quota. Never eliminate on a 0-point row.

- [ ] **Step 1: Write the failing test**

```ts
import { candidatePools } from './deduce.js';
import type { ReplaySong } from './replayTypes.js';

const song = (uri: string, submitter: string): ReplaySong =>
  ({ uri, title: uri, artist: 'x', submitter, submitterComment: null });

describe('candidatePools', () => {
  const songs = [song('s1', 'A'), song('s2', 'B'), song('s3', 'C')];

  it('a known ballot eliminates its voter from every song it scored', () => {
    const ballots = [b('A', ['s2', 3], ['s3', -1])];
    expect(candidatePools(songs, ballots, ['A'], [])['s2']).not.toContain('A');
    expect(candidatePools(songs, ballots, ['A'], [])['s3']).not.toContain('A');
  });

  it('a 0-point row eliminates nobody — it is a submitter comment, not a vote', () => {
    const ballots = [b('A', ['s1', 0])];
    expect(candidatePools(songs, ballots, ['A'], [])['s1']).toContain('A');
  });

  it('an observer knows their own song exactly', () => {
    expect(candidatePools(songs, [], [], ['B'])['s2']).toEqual(['B']);
  });

  // The Quinto case: a submitter who never voted must survive in his own pool.
  it('keeps a submitter who cast no ballot at all', () => {
    const ballots = [b('A', ['s2', 1], ['s3', 1]), b('B', ['s1', 1], ['s3', 1])];
    expect(candidatePools(songs, ballots, ['A', 'B'], [])['s3']).toContain('C');
  });

  // The two-fer case: pinning a player to one song must not evict them from another.
  it('respects a per-round quota above one song per player', () => {
    const twofer = [song('s1', 'A'), song('s2', 'A'), song('s3', 'B')];
    const pools = candidatePools(twofer, [], [], ['A']);
    expect(pools['s1']).toEqual(['A']);
    expect(pools['s2']).toEqual(['A']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ui && npx vitest run src/lib/league-research/deduce.test.ts -t candidatePools`
Expected: FAIL — `candidatePools` is not exported.

- [ ] **Step 3: Implement**

```ts
import type { ReplaySong } from './replayTypes.js';

/**
 * Sound narrowing only: every rule here must be one that CANNOT exclude the
 * true submitter. The invariant test in deduceInvariants.test.ts runs this
 * against every real round in the database and fails if it ever does.
 */
export function candidatePools(
  songs: ReplaySong[],
  ballots: ReplayBallot[],
  knownVoters: string[],
  observers: string[],
): Record<string, string[]> {
  // Seed from SUBMITTERS, not voters. A player who never voted is still a
  // submitter, and seeding from voters would exclude them from their own pool.
  const universe = [...new Set(songs.map((s) => s.submitter))];
  const quota = new Map<string, number>();
  for (const s of songs) quota.set(s.submitter, (quota.get(s.submitter) ?? 0) + 1);

  const pools = new Map<string, Set<string>>(songs.map((s) => [s.uri, new Set(universe)]));
  const known = new Set(knownVoters);

  for (const ballot of ballots) {
    if (!known.has(ballot.voter)) continue;
    for (const v of ballot.votes) {
      if (v.points === 0) continue;          // a comment, not a vote
      pools.get(v.uri)?.delete(ballot.voter);
    }
  }
  for (const s of songs) {
    if (observers.includes(s.submitter)) pools.set(s.uri, new Set([s.submitter]));
  }

  // Quota propagation: once a player is pinned to k songs, evict them elsewhere.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [player, k] of quota) {
      const pinned = [...pools.entries()].filter(([, c]) => c.size === 1 && c.has(player));
      if (pinned.length !== k) continue;
      const pinnedUris = new Set(pinned.map(([uri]) => uri));
      for (const [uri, c] of pools) {
        if (!pinnedUris.has(uri) && c.delete(player)) changed = true;
      }
    }
  }
  return Object.fromEntries([...pools].map(([uri, c]) => [uri, [...c].sort()]));
}
```

- [ ] **Step 4: Run and confirm green**

Run: `cd ui && npx vitest run src/lib/league-research/deduce.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/league-research/deduce.ts ui/src/lib/league-research/deduce.test.ts
git commit -m "feat(replay): sound submitter candidate pools with per-round quota"
```

### Task A4: Hunch layer and the analyse() entry point

**Files:**
- Modify: `ui/src/lib/league-research/deduce.ts`
- Test: `ui/src/lib/league-research/deduce.test.ts`

**Interfaces:**
- Produces: `export function analyse(payload: ReplayPayload, scenario: Scenario): ReplayAnalysis`

Hunches apply **after** the sound pass and are reported separately so the UI can label provenance. A hunch must never widen a pool, and must never empty one — if it would, the hunch is contradicted by sound deduction and is ignored for that song.

- [ ] **Step 1: Write the failing test**

```ts
import { analyse } from './deduce.js';
import type { ReplayPayload } from './replayTypes.js';

const payload = (): ReplayPayload => ({
  round: { id: 1, name: 'R', description: '', votingDeadline: null, windowOpensAfter: null },
  songs: [song('s1', 'A'), song('s2', 'B'), song('s3', 'C')],
  ballots: [b('A', ['s2', 1]), b('B', ['s1', 1]), b('C', ['s1', 1])],
});

describe('analyse', () => {
  it('reports the window size between the two observers', () => {
    const r = analyse(payload(), { observers: ['A', 'C'], gs: 4, hunches: [] });
    expect(r.windowSize).toBe(1);
    expect(r.observerPositions).toEqual({ A: 0, C: 2 });
  });

  it('a hunch narrows afterHunches but leaves mechanical untouched', () => {
    const r = analyse(payload(), { observers: ['A'], gs: 4, hunches: [{ uri: 's3', player: 'B' }] });
    const k = r.steps.at(-1)!.knowledge.find((x) => x.uri === 's3')!;
    expect(k.mechanical).toContain('B');
    expect(k.afterHunches).not.toContain('B');
    expect(k.ruledOutByYou).toEqual(['B']);
  });

  it('a hunch that would empty a pool is ignored — sound deduction wins', () => {
    const r = analyse(payload(), { observers: ['A'], gs: 4, hunches: [{ uri: 's1', player: 'A' }] });
    const k = r.steps.at(-1)!.knowledge.find((x) => x.uri === 's1')!;
    expect(k.afterHunches).toEqual(['A']);
    expect(k.ruledOutByYou).toEqual([]);
  });

  it('counts hunch leverage', () => {
    const r = analyse(payload(), { observers: ['A'], gs: 4, hunches: [{ uri: 's3', player: 'B' }] });
    expect(r.hunchesApplied).toBe(1);
    expect(r.songsResolvedByHunches).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ui && npx vitest run src/lib/league-research/deduce.test.ts -t analyse`
Expected: FAIL — `analyse` is not exported.

- [ ] **Step 3: Implement**

```ts
import type { ReplayAnalysis, ReplayPayload, ReplayStep, Scenario, SongBoard, SongKnowledge } from './replayTypes.js';

export function analyse(payload: ReplayPayload, scenario: Scenario): ReplayAnalysis {
  const { ballots, songs } = payload;
  const pos: Record<string, number> = {};
  ballots.forEach((bal, i) => { if (scenario.observers.includes(bal.voter)) pos[bal.voter] = i; });
  const idxs = Object.values(pos).sort((a, b) => a - b);
  const windowSize = idxs.length >= 2 ? idxs.at(-1)! - idxs[0] - 1 : 0;

  // Union of every observer's schedule: two people refreshing at different
  // moments partition the timeline more finely than either alone. That, not
  // shared secrets, is the mechanical benefit of a partnership.
  const cps = idxs.length >= 2
    ? [...new Set(idxs.flatMap((s, i) => (i < idxs.length - 1 ? checkpoints(s, idxs[i + 1], scenario.gs) : [s])))]
        .sort((a, b) => a - b)
    : idxs;

  const running: Record<string, number> = {};
  const voterCount: Record<string, number> = {};
  const steps: ReplayStep[] = [];

  ballots.forEach((ballot, index) => {
    for (const v of ballot.votes) {
      running[v.uri] = (running[v.uri] ?? 0) + v.points;
      if (v.points !== 0) voterCount[v.uri] = (voterCount[v.uri] ?? 0) + 1;
    }
    const seen = cps.filter((c) => c <= index);
    const ivs = intervals(ballots.slice(0, index + 1), seen);
    const known = [...new Set([...recoveredVoters(ivs), ...scenario.observers])];
    const mech = candidatePools(songs, ballots.slice(0, index + 1), known, scenario.observers);

    const knowledge: SongKnowledge[] = songs.map((s) => {
      const mechanical = mech[s.uri] ?? [];
      const cut = scenario.hunches.filter((h) => h.uri === s.uri).map((h) => h.player);
      const after = mechanical.filter((p) => !cut.includes(p));
      // A hunch that contradicts sound deduction is discarded, not obeyed.
      const usable = after.length ? after : mechanical;
      return {
        uri: s.uri, mechanical, afterHunches: usable,
        ruledOutByYou: after.length ? mechanical.filter((p) => cut.includes(p)) : [],
      };
    });

    const board: SongBoard[] = songs
      .map((s) => ({ uri: s.uri, points: running[s.uri] ?? 0, voterCount: voterCount[s.uri] ?? 0 }))
      .sort((a, b) => b.points - a.points);

    steps.push({ index, ballot, board, knownBallots: known, partialIntervals: ivs.filter((i) => !i.exact), knowledge });
  });

  // Count at the LAST step, not an average across steps: the view renders this
  // as "N songs resolved", so it must be a count of songs, not a rate.
  const final = steps.at(-1);
  const songsResolvedByHunches = final
    ? final.knowledge.filter((k) => k.mechanical.length > 1 && k.afterHunches.length === 1).length
    : 0;

  return { steps, windowSize, observerPositions: pos, hunchesApplied: scenario.hunches.length, songsResolvedByHunches };
}
```

- [ ] **Step 4: Run and confirm green**

Run: `cd ui && npx vitest run src/lib/league-research/deduce.test.ts`
Expected: PASS (17 tests)

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/league-research/deduce.ts ui/src/lib/league-research/deduce.test.ts
git commit -m "feat(replay): hunch layer and the analyse() entry point"
```

---

## Workstream B — DATA  🟢  `ui/src/lib/db/votingReplay.ts` + API

### Task B1: The DB service

**Files:**
- Create: `ui/src/lib/db/votingReplay.ts`
- Test: `ui/src/lib/db/votingReplay.test.ts`

**Interfaces:**
- Consumes: `ReplayPayload` from `$lib/league-research/replayTypes.js`
- Produces: `export function getVotingReplay(db: Database.Database, roundId: number): ReplayPayload | null`

Group votes into atomic ballots ordered by `castAt`. Resolve names through `players.name`. `windowOpensAfter` is the round's last submission time.

- [ ] **Step 1: Write the failing test**

Follow the fixture style in `ui/src/lib/db/themeHistory.test.ts` (`openLeagueDb`, `seedLeagues`, `upsertSeason`, `upsertRound`, then raw inserts).

```ts
import { it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound } from './rounds.js';
import { getVotingReplay } from './votingReplay.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

it('groups each voter into one ballot, ordered by cast time', () => {
  // ... build a round with two voters, three songs, one voter casting two rows
  const payload = getVotingReplay(db, roundId)!;
  expect(payload.ballots.map((b) => b.voter)).toEqual(['Early Voter', 'Late Voter']);
  expect(payload.ballots[0].votes).toHaveLength(2);
});

it('prefers players.name over the music league handle', () => {
  const payload = getVotingReplay(db, roundId)!;
  expect(payload.songs[0].submitter).toBe('Michael Black');
});

it('keeps a 0-point submitter comment in the ballot', () => {
  const payload = getVotingReplay(db, roundId)!;
  const zero = payload.ballots.flatMap((b) => b.votes).find((v) => v.points === 0);
  expect(zero?.comment).toBe('my own song');
});

it('windowOpensAfter is the last submission time', () => {
  expect(getVotingReplay(db, roundId)!.round.windowOpensAfter).toBe('2026-09-02T02:56:25Z');
});

it('returns null for an unknown round', () => {
  expect(getVotingReplay(db, 999999)).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ui && npx vitest run src/lib/db/votingReplay.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type Database from 'better-sqlite3';
import type { ReplayBallot, ReplayPayload, ReplaySong } from '$lib/league-research/replayTypes.js';

/** One round's voting timeline. Ballots are atomic: one timestamp per player. */
export function getVotingReplay(db: Database.Database, roundId: number): ReplayPayload | null {
  const round = db.prepare(
    'SELECT id, name, COALESCE(description, \'\') AS description, voting_deadline FROM rounds WHERE id = ?',
  ).get(roundId) as { id: number; name: string; description: string; voting_deadline: string | null } | undefined;
  if (!round) return null;

  const songs = db.prepare(
    `SELECT m.spotify_uri AS uri, m.title, m.artists AS artist, m.comment AS submitterComment,
            COALESCE(p.name, c.name) AS submitter
       FROM ml_submissions m
       JOIN competitors c ON c.id = m.competitor_id
       LEFT JOIN players p ON p.id = c.player_id
      WHERE m.round_id = ?
      ORDER BY m.spotify_uri`,
  ).all(roundId) as ReplaySong[];

  const rows = db.prepare(
    `SELECT COALESCE(p.name, c.name) AS voter, v.created_at AS castAt,
            v.spotify_uri AS uri, v.points, v.comment
       FROM votes v
       JOIN competitors c ON c.id = v.voter_id
       LEFT JOIN players p ON p.id = c.player_id
      WHERE v.round_id = ?
      ORDER BY v.created_at, v.id`,
  ).all(roundId) as Array<{ voter: string; castAt: string; uri: string; points: number; comment: string | null }>;

  const byVoter = new Map<string, ReplayBallot>();
  for (const r of rows) {
    const existing = byVoter.get(r.voter);
    if (existing) {
      existing.votes.push({ uri: r.uri, points: r.points, comment: r.comment });
      if (r.castAt > existing.castAt) existing.castAt = r.castAt;
    } else {
      byVoter.set(r.voter, { voter: r.voter, castAt: r.castAt, votes: [{ uri: r.uri, points: r.points, comment: r.comment }] });
    }
  }
  const ballots = [...byVoter.values()].sort((a, b) => a.castAt.localeCompare(b.castAt));

  const lastSub = db.prepare(
    'SELECT MAX(created_at) AS t FROM ml_submissions WHERE round_id = ?',
  ).get(roundId) as { t: string | null };

  return {
    round: {
      id: round.id, name: round.name, description: round.description,
      votingDeadline: round.voting_deadline, windowOpensAfter: lastSub.t,
    },
    songs, ballots,
  };
}
```

- [ ] **Step 4: Run and confirm green**

Run: `cd ui && npx vitest run src/lib/db/votingReplay.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/db/votingReplay.ts ui/src/lib/db/votingReplay.test.ts
git commit -m "feat(replay): round voting timeline DB service"
```

### Task B2: The API route

**Files:**
- Create: `ui/src/routes/api/history/round/[roundId]/replay/+server.ts`

**Interfaces:**
- Consumes: `getVotingReplay` from Task B1
- Produces: `GET /api/history/round/:roundId/replay` → `ReplayPayload`

- [ ] **Step 1: Implement, matching the existing route style**

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getVotingReplay } from '$lib/db/votingReplay.js';

// GET /api/history/round/:roundId/replay — one round's voting timeline for the
// Voting Replay panel. Carries the full truth; the public view hides fields at
// render time, which is a presentation choice, not a security boundary.
export const GET: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId) || roundId <= 0) throw error(400, 'invalid round id');

  const data = getVotingReplay(getDb(), roundId);
  if (!data) throw error(404, 'round not found');
  return json(data);
};
```

- [ ] **Step 2: Verify against the real database**

Run: `curl -s localhost:3002/api/history/round/142/replay | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['songs']),'songs',len(d['ballots']),'ballots'); print([b['voter'] for b in d['ballots']][:3])"`
Expected: `13 songs 13 ballots` and the first voters in cast order.

- [ ] **Step 3: Commit**

```bash
git add "ui/src/routes/api/history/round/[roundId]/replay/+server.ts"
git commit -m "feat(replay): GET /api/history/round/:roundId/replay"
```

### Task B3: Round list endpoint for the picker

**Files:**
- Create: `ui/src/routes/api/history/league/[leagueId]/rounds/+server.ts`

**Interfaces:**
- Produces: `GET /api/history/league/:leagueId/rounds` → `[{ id, name, season, ballots }]`,
  ordered season ascending then round id ascending.

Added mid-sprint. The plan assumed a browser-callable round list existed; it does
not. `/api/rounds/list` and `/api/rounds/resolve` are both `requireBearerToken`,
and `/api/leagues/:leagueId/rounds` is POST-only (it creates rounds). Workstream
C's round picker has no source without this.

`ballots` is the distinct voter count, so the picker can disable rounds with
nothing to replay.

- [ ] **Step 1: Implement**

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

// GET /api/history/league/:leagueId/rounds — round picker source for the Voting
// Replay panel. Unauthenticated, like the sibling League Research endpoint.
export const GET: RequestHandler = async ({ params }) => {
  const leagueId = Number(params.leagueId);
  if (!Number.isInteger(leagueId) || leagueId <= 0) throw error(400, 'invalid league id');

  const rows = getDb().prepare(
    `SELECT r.id, r.name, s.season_number AS season,
            (SELECT COUNT(DISTINCT v.voter_id) FROM votes v WHERE v.round_id = r.id) AS ballots
       FROM rounds r
       JOIN seasons s ON s.id = r.season_id
      WHERE s.league_id = ?
      ORDER BY s.season_number, r.id`,
  ).all(leagueId);
  return json(rows);
};
```

- [ ] **Step 2: Verify against the real database**

Run: `curl -s localhost:3002/api/history/league/3/rounds | python3 -m json.tool | head -20`
Expected: 16 rounds across two seasons; round 142 shows `"ballots": 13`.

- [ ] **Step 3: Commit**

```bash
git add "ui/src/routes/api/history/league/[leagueId]/rounds/+server.ts"
git commit -m "feat(replay): round list endpoint for the replay picker"
```

---

## Workstream C — VIEWS  🟣  Svelte panels

Svelte 5 runes (`$props`, `$derived`, `$state`), matching `DriftPanel.svelte`. Every `{#each}` must be index-keyed — a hydration crash on a League Research panel takes the page down.

### Task C1: ReplayPanel shell — scrubber and scenario controls

**Files:**
- Create: `ui/src/lib/components/league/ReplayPanel.svelte`

**Interfaces:**
- Consumes: `analyse` (Task A4), `ReplayPayload`, `Scenario`
- Produces: the panel, rendering `<ReplayFullView>`, `<ReplayPublicView>`, `<ReplayDeducibleView>`

- [ ] **Step 1: Build the shell**

Requirements, all load-bearing:
- Round picker (rounds for the selected league), fetching `/api/history/round/:id/replay`.
- Observer multi-select from `payload.ballots[].voter`, GS 1–4 selector, and four preset buttons: Individual, Partner (2 obs, GS 1), Partner plus (2 obs, GS 3), Partner double plus (3 obs, GS 4).
- Ballot-indexed scrubber: `<input type="range" min="0" max={payload.ballots.length - 1}>`, one notch per ballot, plus prev/next buttons.
- Mark the observer positions on the track and shade the window between them.
- Show `N` (`analysis.windowSize`) prominently with the caption `N ballots between them — this caps everything`. When `N === 0`, render `No window: these two voted back to back, so nothing is learnable at any severity.`
- `const analysis = $derived(analyse(payload, scenario))` — recompute client-side on every scenario change.

- [ ] **Step 2: Verify in a production build**

The digest/history pages crash under `npm run dev` (node:crypto via llm.ts), so verify with a production build against a copy of the DB, not the dev server.

Run: `docker compose build bot-ui && docker compose up -d bot-ui && curl -s -o /dev/null -w '%{http_code}\n' 'localhost:3002/history?tab=league'`
Expected: `200`

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/components/league/ReplayPanel.svelte
git commit -m "feat(replay): panel shell with ballot scrubber and scenario controls"
```

### Task C2: Full and Public views

**Files:**
- Create: `ui/src/lib/components/league/ReplayFullView.svelte`
- Create: `ui/src/lib/components/league/ReplayPublicView.svelte`

- [ ] **Step 1: Build ReplayFullView**

Props: `{ step: ReplayStep, songs: ReplaySong[] }`. Every song with artist, submitter, current points, and both comment kinds — **submitter comments styled distinctly from voter comments** (different background and an explicit `submitter` chip). Show only comments from ballots cast at or before this step.

- [ ] **Step 2: Build ReplayPublicView**

Props: `{ step: ReplayStep }`. Sorted by `points` descending, showing **only** total points and voter count. No submitter, no comments of any kind, no artist-level extras. Add a caption: `This is exactly what the results page showed at this moment.`

- [ ] **Step 3: Verify the public view leaks nothing**

Run: `cd ui && npx vitest run src/lib/components/league/` — and confirm by reading the template that `submitter`, `comment` and `submitterComment` appear nowhere in `ReplayPublicView.svelte`.

Run: `grep -c 'submitter\|comment' ui/src/lib/components/league/ReplayPublicView.svelte`
Expected: `0`

- [ ] **Step 4: Commit**

```bash
git add ui/src/lib/components/league/ReplayFullView.svelte ui/src/lib/components/league/ReplayPublicView.svelte
git commit -m "feat(replay): full and public views"
```

### Task C3: Deducible view with hunch controls

**Files:**
- Create: `ui/src/lib/components/league/ReplayDeducibleView.svelte`

- [ ] **Step 1: Build it**

Props: `{ step: ReplayStep, analysis: ReplayAnalysis, onHunch: (uri: string, player: string) => void }`.

- Per song: the candidate pool, rendered as a **count and a list of names**, never as a single resolved name unless `afterHunches.length === 1`.
- Provenance is mandatory. A pool cut by hunches renders `1 candidate — 4 ruled out by you`; a pool narrowed only by deduction renders `5 candidates`. Never label a hunch result as a deduction.
- Ballot ledger: each voter tagged `exact` / `part of a sum` / `unknown`, from `step.knownBallots` and `step.partialIntervals`.
- Partial intervals render in words: `Tommy, Brian and Jac together gave Bro Hymn +4`.
- Hunch control per song: click a candidate to rule them out; clicking again restores.
- Leverage readout: `{analysis.hunchesApplied} hunches → {analysis.songsResolvedByHunches} songs resolved`.
- Standing caption: `Mechanical deduction alone rarely resolves a submitter — under 1% even with every ballot known. The pools are the honest answer.`

- [ ] **Step 2: Verify no resolved name is printed without proof**

Run: `cd ui && npx vitest run src/lib/league-research/deduce.test.ts`
Expected: PASS — the engine is the guard; the view only renders what it exposes.

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/components/league/ReplayDeducibleView.svelte
git commit -m "feat(replay): deducible view with hunch layer and provenance labels"
```

### Task C4: Wire the panel into the tab

**Files:**
- Modify: `ui/src/lib/components/LeagueResearchTab.svelte`

- [ ] **Step 1: Add the fourth switcher entry**

Follow the existing pattern at lines 131–151: add a `replay` entry to the `lr-switcher` `role="tablist"`, and render `<ReplayPanel />` in the matching branch alongside `HeatmapPanel` / `DriftPanel` / `GenrePanel`.

- [ ] **Step 2: Verify the tab renders in production**

Run: `docker compose build bot-ui && docker compose up -d bot-ui && curl -s 'localhost:3002/history?tab=league' | grep -c 'Replay'`
Expected: `≥1`

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/components/LeagueResearchTab.svelte
git commit -m "feat(replay): add Replay to the League Research switcher"
```

---

## Workstream D — TESTS  🟠  invariants against real rounds

These are the tests that make the tool trustworthy. They read `data/league.db` directly and are the reason two modelling bugs were caught before any code existed. **Write these first** — they should fail until Workstream A lands.

### Task D1: Soundness across every real round

**Files:**
- Create: `ui/src/lib/league-research/deduceInvariants.test.ts`

**Interfaces:**
- Consumes: `candidatePools`, `checkpoints`, `intervals`, `recoveredVoters` from `deduce.js`; `getVotingReplay` from `$lib/db/votingReplay.js`

- [ ] **Step 1: Write the invariant**

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { getVotingReplay } from '$lib/db/votingReplay.js';
import { candidatePools, checkpoints, intervals, recoveredVoters } from './deduce.js';

const DB = 'data/league.db';
const rounds = (db: Database.Database) =>
  (db.prepare('SELECT DISTINCT round_id AS id FROM votes').all() as { id: number }[]).map((r) => r.id);

describe.skipIf(!existsSync(DB))('soundness against every real round', () => {
  it('mechanical narrowing NEVER excludes the true submitter', () => {
    const db = new Database(DB, { readonly: true });
    const failures: string[] = [];
    let checked = 0;
    for (const roundId of rounds(db)) {
      const p = getVotingReplay(db, roundId);
      if (!p || p.ballots.length < 3 || !p.songs.length) continue;
      for (let a = 0; a < p.ballots.length; a++) {
        for (let z = a + 1; z < p.ballots.length; z++) {
          for (const gs of [1, 2, 3, 4] as const) {
            const cps = checkpoints(a, z, gs);
            const known = [...recoveredVoters(intervals(p.ballots, cps)), p.ballots[a].voter, p.ballots[z].voter];
            const obs = [p.ballots[a].voter, p.ballots[z].voter];
            const pools = candidatePools(p.songs, p.ballots, known, obs);
            checked++;
            for (const s of p.songs) {
              if (!pools[s.uri].includes(s.submitter)) {
                failures.push(`r${roundId} ${obs.join('+')} gs${gs}: ${s.uri} lost ${s.submitter}`);
              }
            }
          }
        }
      }
    }
    db.close();
    expect(checked).toBeGreaterThan(20000);
    expect(failures).toEqual([]);
  }, 120_000);
});
```

- [ ] **Step 2: Run it — it must fail until Workstream A lands**

Run: `cd .. && cd ui && npx vitest run src/lib/league-research/deduceInvariants.test.ts`
Expected: FAIL (module not found) before A3; PASS with 0 failures after.

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/league-research/deduceInvariants.test.ts
git commit -m "test(replay): soundness invariant across every real round"
```

### Task D2: Named regressions — Quinto and the two-fer

**Files:**
- Modify: `ui/src/lib/league-research/deduceInvariants.test.ts`

- [ ] **Step 1: Add both regressions**

```ts
it('R139 — a submitter who never voted stays in his own pool (the Quinto case)', () => {
  const db = new Database(DB, { readonly: true });
  const p = getVotingReplay(db, 139)!;
  const voters = new Set(p.ballots.map((b) => b.voter));
  const ghost = p.songs.find((s) => !voters.has(s.submitter));
  expect(ghost, 'R139 should contain a submitter who cast no ballot').toBeDefined();
  const pools = candidatePools(p.songs, p.ballots, p.ballots.map((b) => b.voter), []);
  expect(pools[ghost!.uri]).toContain(ghost!.submitter);
  db.close();
});

it('R97 — a two-songs-each round does not evict a player from their second song', () => {
  const db = new Database(DB, { readonly: true });
  const p = getVotingReplay(db, 97)!;
  const counts = new Map<string, number>();
  for (const s of p.songs) counts.set(s.submitter, (counts.get(s.submitter) ?? 0) + 1);
  expect([...counts.values()].some((n) => n > 1), 'R97 should be a two-fer round').toBe(true);
  const pools = candidatePools(p.songs, p.ballots, p.ballots.map((b) => b.voter), []);
  for (const s of p.songs) expect(pools[s.uri]).toContain(s.submitter);
  db.close();
});
```

- [ ] **Step 2: Run and confirm**

Run: `cd ui && npx vitest run src/lib/league-research/deduceInvariants.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/league-research/deduceInvariants.test.ts
git commit -m "test(replay): Quinto and two-fer regressions"
```

### Task D3: Partition and recovery-rate properties

**Files:**
- Modify: `ui/src/lib/league-research/deduceInvariants.test.ts`

- [ ] **Step 1: Add both properties**

```ts
it('a single observer schedule produces disjoint intervals', () => {
  const db = new Database(DB, { readonly: true });
  for (const roundId of rounds(db).slice(0, 10)) {
    const p = getVotingReplay(db, roundId);
    if (!p || p.ballots.length < 4) continue;
    const ivs = intervals(p.ballots, checkpoints(0, p.ballots.length - 1, 3));
    const seen = new Set<string>();
    for (const iv of ivs) for (const v of iv.voters) {
      expect(seen.has(v), `${v} appears in two intervals`).toBe(false);
      seen.add(v);
    }
  }
  db.close();
});

it('recovery rises monotonically with glance severity', () => {
  const db = new Database(DB, { readonly: true });
  const rate = (gs: 1 | 2 | 3 | 4) => {
    let got = 0, tot = 0;
    for (const roundId of rounds(db)) {
      const p = getVotingReplay(db, roundId);
      if (!p || p.ballots.length < 4) continue;
      const n = p.ballots.length - 1;
      got += recoveredVoters(intervals(p.ballots, checkpoints(0, n, gs))).length;
      tot += n - 1;
    }
    return got / tot;
  };
  const [r1, r2, r3, r4] = [rate(1), rate(2), rate(3), rate(4)];
  expect(r1).toBeLessThan(r2);
  expect(r2).toBeLessThan(r3);
  expect(r3).toBeLessThan(r4);
  expect(r4).toBeCloseTo(1, 1);   // 4GS recovers every ballot in the window
  db.close();
}, 60_000);
```

- [ ] **Step 2: Run and confirm**

Run: `cd ui && npx vitest run src/lib/league-research/deduceInvariants.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/league-research/deduceInvariants.test.ts
git commit -m "test(replay): partition disjointness and monotone recovery"
```

### Task D4: Full-suite regression gate

- [ ] **Step 1: Establish the baseline before touching anything**

Run: `cd ui && npx vitest run 2>&1 | grep -E '^ FAIL' | sort > /tmp/replay-baseline.txt; wc -l < /tmp/replay-baseline.txt`
Expected: `12` — these are pre-existing failures in `leagues`, `metadataQueue`, `queueWorker`, `adapters`, `content` and `model-vars`, unrelated to this work.

- [ ] **Step 2: After every workstream lands, confirm the list is byte-identical**

Run: `cd ui && npx vitest run 2>&1 | grep -E '^ FAIL' | sort > /tmp/replay-after.txt; diff /tmp/replay-baseline.txt /tmp/replay-after.txt && echo IDENTICAL`
Expected: `IDENTICAL`. Any new line is a regression this sprint introduced and must be fixed before merge.

### Task A5: The "just enough" detector

**Files:**
- Modify: `ui/src/lib/league-research/deduce.ts`
- Test: `ui/src/lib/league-research/deduce.test.ts`

**Interfaces:**
- Produces: `export function justEnough(payload: ReplayPayload, target: string): Array<{ uri: string; submitter: string; margin: number }>`

An outcome pattern over FINAL standings, not something an observer knows — which
is why it lives outside `analyse()`. Flags songs finishing 1–2 points under the
target player's own song.

- [ ] **Step 1: Write the failing test**

```ts
import { justEnough } from './deduce.js';

it('flags songs landing just under the target player', () => {
  const p = payload();                       // A's song s1 finishes on 2
  const flags = justEnough(p, 'A');
  expect(flags.map((f) => f.uri)).toContain('s2');
  expect(flags.find((f) => f.uri === 's2')!.margin).toBeLessThanOrEqual(2);
});

it('ignores songs that beat the target', () => {
  expect(justEnough(payload(), 'C').some((f) => f.margin < 0)).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ui && npx vitest run src/lib/league-research/deduce.test.ts -t justEnough`
Expected: FAIL — `justEnough` is not exported.

- [ ] **Step 3: Implement**

```ts
/**
 * Outcome pattern, NOT a deduction: songs finishing 1-2 points below the
 * target's own song. Kept out of analyse() because an observer cannot know it
 * during voting -- it only exists once the round is closed.
 */
export function justEnough(
  payload: ReplayPayload,
  target: string,
): Array<{ uri: string; submitter: string; margin: number }> {
  const totals: Record<string, number> = {};
  for (const b of payload.ballots) {
    for (const v of b.votes) totals[v.uri] = (totals[v.uri] ?? 0) + v.points;
  }
  const mine = payload.songs.filter((s) => s.submitter === target).map((s) => totals[s.uri] ?? 0);
  if (!mine.length) return [];
  const top = Math.max(...mine);
  return payload.songs
    .filter((s) => s.submitter !== target)
    .map((s) => ({ uri: s.uri, submitter: s.submitter, margin: top - (totals[s.uri] ?? 0) }))
    .filter((f) => f.margin >= 1 && f.margin <= 2);
}
```

- [ ] **Step 4: Run and confirm green**

Run: `cd ui && npx vitest run src/lib/league-research/deduce.test.ts`
Expected: PASS (19 tests)

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/league-research/deduce.ts ui/src/lib/league-research/deduce.test.ts
git commit -m "feat(replay): just-enough margin detector"
```

Render it in `ReplayDeducibleView.svelte` under a heading that names it an
outcome pattern, never a deduction.

---

## Parallelisation

Task 0 unblocks everything. Then:

| Pane | Workstream | Depends on |
| --- | --- | --- |
| 🔵 %6 | A — engine | Task 0 |
| 🟢 %7 | B — data + API (B1, B2, B3) | Task 0 |
| 🟣 %8 | C — views | Task 0 (stubs `analyse` until A4 lands) |
| 🟠 %9 | D — tests | Task 0; D1–D3 fail until A3/A4, which is correct TDD |

C4 (tab wiring) lands last. D4 runs at the end, by the orchestrator.
