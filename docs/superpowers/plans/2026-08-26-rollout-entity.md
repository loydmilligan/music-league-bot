# The Rollout Entity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a per-league "what happens when a round ends" entity — a configurable, resumable list of cuts (script / agent / human) resolved into EPs by skips, executed by two cooperating executors.

**Architecture:** Generalize the existing `digest_jobs` runner. A pure engine decides what is claimable and what happens next; a thin store persists it; two executors (bot-ui for `app` cuts, a host Python poller for `host` cuts) claim work from the same SQLite DB. EP/Skip/Cover semantics and the solver core are shared with the digest pipeline rather than reimplemented.

**Tech Stack:** TypeScript + SvelteKit 2 + Svelte 5 runes, better-sqlite3, vitest (`ui/`); Python 3 + pytest (`scripts/`).

**Spec:** `docs/superpowers/specs/2026-08-26-rollout-entity-design.md`

## Global Constraints

- **Degenerate safety is the top invariant.** A league with no `rollout_configs` row, or with `enabled = 0`, must behave exactly as today: same `digest_jobs` path, same states, same notifications. Every task preserves this; Task 3 tests it explicitly.
- **No DDL mirrored into `src/`.** `src/` (bot, api) and `ui/` are separate TS projects with no shared imports. All rollout code lives in `ui/` and `scripts/`. The email-ingest trigger (`src/email/emailIngest.ts`) is **not modified**.
- **No third copy of the EP algorithm.** `resolvePipeline` (server) and `solveClientEPs` (client) already exist and are kept honest by `ui/src/lib/digest/pipeline-parity.test.ts`. Task 1 extracts the shared core; later tasks call it.
- **Never open `data/league.db` in a test.** It is production data. TS tests use `new Database(':memory:')`; Python tests use the fixture in `scripts/digest-qa/tests/conftest.py`.
- Cut ids are unique within a rollout. A script run twice is two cuts with distinct ids (`verify`, `verify-post-punchup`).
- Model resolution for `agent` cuts reuses `modelFor` / `SECTION_BUCKET_MAP` from `ui/src/lib/digest/modelFor.ts`. No parallel resolver.
- Alert types come from the existing union in `ui/src/lib/notifications/config.ts`: `'pipeline_failure' | 'ml_auth_expired' | 'digest_ready' | 'digest_sent'`. Do not add new ones.
- Run tests with `cd ui && npm test` (vitest) and `python3 -m pytest scripts/digest-qa/tests -q` (pytest, config in `pytest.ini` at repo root).
- Commit after every task. Do not push — `master` is 26+ commits ahead of `origin/master` and pushing requires Matt's explicit OK.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `ui/src/lib/digest/epCore.ts` | Shared EP primitives: `bucketBySkip`, `placeCovers`. Called by both pipeline solvers and the rollout solver. |
| `ui/src/lib/rollout/types.ts` | `Rollout`, `CutDef`, `Check`, `Runtime`, `RunState`, `CutRunState`. No logic. |
| `ui/src/lib/rollout/defaults.ts` | `DEFAULT_ROLLOUT` — the EP0–EP10 definition from spec §8. |
| `ui/src/lib/rollout/validate.ts` | `isValidRollout` — structural validation for the config endpoint. |
| `ui/src/lib/rollout/solve.ts` | `resolveRollout(rollout, active) → RolloutEP[]`. Thin wrapper over `epCore`. |
| `ui/src/lib/rollout/engine.ts` | Pure decisions: `claimable`, `epComplete`, `advance`, `evaluateCheck`, `applyCheckResult`. No DB, no IO. |
| `ui/src/lib/rollout/context.ts` | `contextFor(run, rollout, cutId)` — the dossier slice, derived from position. |
| `ui/src/lib/rollout/store.ts` | All SQL: config CRUD, run creation, cut claim/complete, lease reaping. |
| `ui/src/lib/rollout/holds.ts` | Park a run, mint a resume token, fire `notify()`; lift a hold. |
| `ui/src/lib/rollout/appExecutor.ts` | bot-ui loop: promote pending digest jobs, run `app` cuts. |
| `ui/src/routes/api/rollout/config/+server.ts` | GET/PUT per-league rollout config. |
| `ui/src/routes/api/rollout/runs/+server.ts` | GET run list / detail. |
| `ui/src/routes/api/rollout/resume/+server.ts` | POST lift a hold (UI action or ntfy tap). |
| `ui/src/lib/rollout/RolloutTab.svelte` | The Rollouts tab: Definition editor + Runs view. |
| `scripts/rollout/host_executor.py` | Host loop: claim `host` cuts, run script + agent cuts. |
| `scripts/rollout/tests/` | pytest for the host executor. |

**Modified:** `ui/src/lib/digest/pipeline.ts` and `ui/src/lib/models/pipelineSolver.ts` (call `epCore`), `ui/src/lib/db/schema.ts` (3 tables), `ui/src/hooks.server.ts` (start the app executor), `ui/src/lib/models/ModelsScreen.svelte` (third tab).

---

## Phase 1 — Foundations (no behaviour change)

### Task 1: Extract the shared EP core

**Files:**
- Create: `ui/src/lib/digest/epCore.ts`
- Create: `ui/src/lib/digest/epCore.test.ts`
- Modify: `ui/src/lib/digest/pipeline.ts` (the bucketing + cover-placement blocks inside `resolvePipeline`)
- Modify: `ui/src/lib/models/pipelineSolver.ts` (same blocks inside `solveClientEPs`)

**Interfaces:**
- Consumes: nothing.
- Produces: `bucketBySkip(order: string[], skipAfter: Record<string, boolean | undefined>, active: string[]): string[][]` and `placeCovers<C extends { of: string }>(buckets: string[][], covers: C[]): Map<number, C[]>`.

**Why this is first:** the algorithm exists twice already. Extracting before adding a third caller is the difference between three copies and one.

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/digest/epCore.test.ts
import { describe, it, expect } from 'vitest';
import { bucketBySkip, placeCovers } from './epCore.js';

describe('bucketBySkip', () => {
  it('splits at a skip boundary', () => {
    expect(bucketBySkip(['a', 'b', 'c'], { b: true }, ['a', 'b', 'c']))
      .toEqual([['a', 'b'], ['c']]);
  });

  it('drops inactive members but still fires their boundary (OQ-2)', () => {
    // `b` is the skip anchor and is inactive; the boundary must still split.
    expect(bucketBySkip(['a', 'b', 'c'], { b: true }, ['a', 'c']))
      .toEqual([['a'], ['c']]);
  });

  it('returns one bucket when there are no skips', () => {
    expect(bucketBySkip(['a', 'b'], {}, ['a', 'b'])).toEqual([['a', 'b']]);
  });

  it('elides a bucket that ends up empty', () => {
    expect(bucketBySkip(['a', 'b'], { a: true }, ['b'])).toEqual([['b']]);
  });
});

describe('placeCovers', () => {
  it('places a cover in the EP after its original', () => {
    const m = placeCovers([['a', 'b'], ['c']], [{ of: 'a' }]);
    expect(m.get(1)).toEqual([{ of: 'a' }]);
  });

  it('places a cover of a last-EP track in a trailing EP', () => {
    const m = placeCovers([['a']], [{ of: 'a' }]);
    expect(m.get(1)).toEqual([{ of: 'a' }]);
  });

  it('drops a cover whose original is inactive', () => {
    expect(placeCovers([['a']], [{ of: 'zzz' }]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/digest/epCore.test.ts`
Expected: FAIL — `Failed to resolve import "./epCore.js"`

- [ ] **Step 3: Write the implementation**

```ts
// ui/src/lib/digest/epCore.ts
/**
 * Shared EP resolution primitives.
 *
 * Extracted from resolvePipeline (pipeline.ts) and solveClientEPs
 * (models/pipelineSolver.ts), which implemented this identically. The Rollout
 * solver is the third caller — hence one home rather than three copies.
 *
 * Deliberately knows nothing about models, merging, or runtimes: those differ
 * per level and stay with their own solver.
 */

/**
 * Split `order` into EP buckets at `skipAfter` boundaries, keeping only
 * members present in `active`.
 *
 * OQ-2: a skip whose anchor is NOT active still fires its boundary. The
 * boundary therefore lands after the last active member preceding the anchor.
 * Empty buckets are elided.
 */
export function bucketBySkip(
  order: string[],
  skipAfter: Record<string, boolean | undefined>,
  active: string[],
): string[][] {
  const activeSet = new Set(active);
  const buckets: string[][] = [];
  let current: string[] = [];

  for (const id of order) {
    if (activeSet.has(id)) current.push(id);
    // The skip sits AFTER this member, and fires whether or not it is active.
    if (skipAfter[id] === true && current.length > 0) {
      buckets.push(current);
      current = [];
    }
  }
  if (current.length > 0) buckets.push(current);
  return buckets;
}

/**
 * Map each cover to the EP index it fires in: one after the EP containing its
 * original. A cover of a member in the last EP creates a trailing EP. A cover
 * whose original is not in any bucket (inactive) is dropped.
 */
export function placeCovers<C extends { of: string }>(
  buckets: string[][],
  covers: C[],
): Map<number, C[]> {
  const byEp = new Map<number, C[]>();
  for (const cover of covers) {
    const originalEp = buckets.findIndex((b) => b.includes(cover.of));
    if (originalEp === -1) continue;
    const target = originalEp + 1;
    if (!byEp.has(target)) byEp.set(target, []);
    byEp.get(target)!.push(cover);
  }
  return byEp;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/digest/epCore.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Rewire `resolvePipeline` to call the core**

In `ui/src/lib/digest/pipeline.ts`, add `import { bucketBySkip, placeCovers } from './epCore.js';` and replace the two hand-rolled blocks. The block that builds `epBuckets` becomes:

```ts
  const epBuckets = bucketBySkip(pipeline.order, pipeline.skipAfter as Record<string, boolean>, activeSections);
```

and the block that builds `coversByEp` becomes:

```ts
  const coversByEp = placeCovers(epBuckets, pipeline.covers);
```

Leave everything else — merge, model grouping, archive no-merge, empty-EP elision, the `totalEps` computation — exactly as it is.

- [ ] **Step 6: Rewire `solveClientEPs` to call the core**

In `ui/src/lib/models/pipelineSolver.ts`, add `import { bucketBySkip, placeCovers } from '../digest/epCore.js';` and make the identical two replacements:

```ts
  const epBuckets = bucketBySkip(pipeline.order, skipAfter, activeSections);
  const coversByEp = placeCovers(epBuckets, pipeline.covers as { of: string; model: string }[]);
```

- [ ] **Step 7: Run the full pipeline suite to prove nothing moved**

Run: `cd ui && npx vitest run src/lib/digest/pipeline.test.ts src/lib/digest/pipeline-parity.test.ts src/lib/digest/pipeline-a2.test.ts src/lib/digest/pipeline-a3.test.ts src/lib/digest/pipeline-a4.test.ts src/lib/digest/pipeline-a5.test.ts src/lib/digest/epCore.test.ts`
Expected: PASS, all of them. **If any pipeline test fails, the extraction changed behaviour — revert and re-read the original blocks rather than editing the test.**

- [ ] **Step 8: Commit**

```bash
git add ui/src/lib/digest/epCore.ts ui/src/lib/digest/epCore.test.ts \
        ui/src/lib/digest/pipeline.ts ui/src/lib/models/pipelineSolver.ts
git commit -m "refactor(pipeline): extract shared EP bucketing and cover placement

resolvePipeline and solveClientEPs implemented the same algorithm twice. The
rollout solver would have been a third. One home, both callers rewired, all
existing pipeline and parity tests green."
```

---

### Task 2: Rollout types, default definition, and validation

**Files:**
- Create: `ui/src/lib/rollout/types.ts`
- Create: `ui/src/lib/rollout/defaults.ts`
- Create: `ui/src/lib/rollout/validate.ts`
- Create: `ui/src/lib/rollout/validate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: types `Runtime`, `Check`, `RolloutCover`, `CutDef`, `Rollout`, `CutRunState`, `RunState`; value `DEFAULT_ROLLOUT: Rollout`; function `isValidRollout(v: unknown): v is Rollout`.

- [ ] **Step 1: Write the types (no test — types only)**

```ts
// ui/src/lib/rollout/types.ts
import type { AlertType } from '$lib/notifications/config.js';

export type Runtime = 'app' | 'host';

/** How to read pass/fail from a cut's captured output. */
export type Check =
  /** The command exited 0. */
  | { rule: 'exit-zero' }
  /** The cut's JSON output has no entries at `fail` severity (verify_facts). */
  | { rule: 'no-fail-checks' };

/**
 * Replay a cut in a later EP with accumulated context.
 *
 * Shared concept with the pipeline level. `remaster` is the rollout addition:
 * a remaster cover fires ONLY when the original's check failed, which is how
 * repair is expressed. `budget` caps how many times it may fire.
 */
export type RolloutCover = {
  of: string;
  model?: string;
  remaster?: true;
  budget?: number;
};

export type CutDef =
  | { kind: 'script'; runtime: Runtime; command: string[]; check?: Check; label: string }
  | { kind: 'agent'; runtime: 'host'; job: string; model?: string; check?: Check; label: string }
  | { kind: 'human'; label: string; reviewPath: string; alertType: AlertType };

export type Rollout = {
  order: string[];
  cuts: Record<string, CutDef>;
  skipAfter: Partial<Record<string, true>>;
  covers: RolloutCover[];
  /** Cut ids excluded from this rollout. Active = order minus disabled. */
  disabled?: string[];
};

export type CutRunState = {
  cutId: string;
  ep: number;
  runtime: Runtime | null; // null for human cuts
  state: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  attempts: number;
  remasters: number;
  /** undefined = no check declared, or not yet evaluated. */
  checkPassed?: boolean;
  outputJson?: string;
};

export type RunState = {
  runId: string;
  leagueId: number;
  roundId: number;
  currentEp: number;
  state: 'running' | 'parked' | 'done' | 'failed';
  cuts: CutRunState[];
};

/** Active cut ids: declaration order minus anything disabled. */
export function activeCuts(rollout: Rollout): string[] {
  const off = new Set(rollout.disabled ?? []);
  return rollout.order.filter((id) => !off.has(id));
}
```

- [ ] **Step 2: Write the default rollout**

```ts
// ui/src/lib/rollout/defaults.ts
/**
 * The process run by hand every week, written down. See spec §8.
 *
 * `verify` and `verify-post-punchup` are two cuts running the same script:
 * checks re-run AFTER punch-up because punch-up is when fabricated quotes are
 * actually introduced. Cut ids must be unique, hence the distinct id.
 *
 * `bridge` is a cut so it cannot be forgotten — the class of bug currently
 * live on R148, whose bridge row was never generated.
 */
import type { Rollout } from './types.js';

const QA = 'scripts/digest-qa';

export const DEFAULT_ROLLOUT: Rollout = {
  order: [
    'capture', 'generate',
    'verify', 'dedupe', 'mentions', 'participation',
    'ledes',
    'hold-ledes',
    'punchup',
    'verify-post-punchup', 'dedupe-post-punchup', 'dupe-findings',
    'dupe-page', 'cover-art',
    'hold-approve',
    'send',
    'bridge', 'archive-refresh',
  ],
  cuts: {
    capture:  { kind: 'script', runtime: 'app',  label: 'Capture round data', command: ['capture'] },
    generate: { kind: 'script', runtime: 'app',  label: 'Generate draft',     command: ['generate'] },

    verify:      { kind: 'script', runtime: 'host', label: 'Verify facts',
                   command: ['python3', `${QA}/verify_facts.py`, '{roundId}', '--json'],
                   check: { rule: 'no-fail-checks' } },
    dedupe:      { kind: 'script', runtime: 'host', label: 'Dedupe scan',
                   command: ['python3', `${QA}/dedupe_scan.py`, '{roundId}'],
                   check: { rule: 'exit-zero' } },
    mentions:    { kind: 'script', runtime: 'host', label: 'Mention matrix',
                   command: ['python3', `${QA}/mention_matrix.py`, '{roundId}', '--json'] },
    participation: { kind: 'script', runtime: 'host', label: 'Participation report',
                   command: ['python3', `${QA}/participation.py`, '{leagueSlug}', '--round', '{roundId}', '--report'] },

    ledes: { kind: 'agent', runtime: 'host', label: 'Story ledes', job: 'ledes' },

    'hold-ledes': { kind: 'human', label: 'Rate ledes & give direction',
                    reviewPath: '/digest/{roundId}/hil', alertType: 'digest_ready' },

    punchup: { kind: 'agent', runtime: 'host', label: 'Punch-up pass', job: 'punchup' },

    'verify-post-punchup': { kind: 'script', runtime: 'host', label: 'Re-verify facts',
                   command: ['python3', `${QA}/verify_facts.py`, '{roundId}', '--json'],
                   check: { rule: 'no-fail-checks' } },
    'dedupe-post-punchup': { kind: 'script', runtime: 'host', label: 'Re-scan dupes',
                   command: ['python3', `${QA}/dedupe_scan.py`, '{roundId}'],
                   check: { rule: 'exit-zero' } },
    'dupe-findings': { kind: 'agent', runtime: 'host', label: 'Semantic dupe findings', job: 'dupe-findings' },

    'dupe-page': { kind: 'script', runtime: 'host', label: 'Render dupe review page',
                   command: ['python3', `${QA}/dupe_review_page.py`, '{roundId}'] },
    'cover-art': { kind: 'script', runtime: 'host', label: 'Cover art',
                   command: ['python3', 'scripts/cover-gen/cli.py', '{roundId}'] },

    'hold-approve': { kind: 'human', label: 'Approve & send',
                      reviewPath: '/digest/{roundId}', alertType: 'digest_ready' },

    send: { kind: 'script', runtime: 'app', label: 'Finalize & send', command: ['send'] },

    bridge: { kind: 'agent', runtime: 'host', label: 'Round bridge', job: 'bridge' },
    'archive-refresh': { kind: 'script', runtime: 'app', label: 'Archive refresh', command: ['archive'] },
  },
  skipAfter: {
    capture: true, generate: true, participation: true, ledes: true,
    'hold-ledes': true, punchup: true, 'dupe-findings': true,
    'cover-art': true, 'hold-approve': true, send: true,
  },
  covers: [
    { of: 'verify', remaster: true, budget: 1 },
    { of: 'dedupe', remaster: true, budget: 1 },
    { of: 'verify-post-punchup', remaster: true, budget: 1 },
    { of: 'dedupe-post-punchup', remaster: true, budget: 1 },
  ],
};
```

- [ ] **Step 3: Write the failing validation test**

```ts
// ui/src/lib/rollout/validate.test.ts
import { describe, it, expect } from 'vitest';
import { isValidRollout } from './validate.js';
import { DEFAULT_ROLLOUT } from './defaults.js';

describe('isValidRollout', () => {
  it('accepts the default rollout', () => {
    expect(isValidRollout(DEFAULT_ROLLOUT)).toBe(true);
  });

  it('rejects non-objects', () => {
    for (const v of [null, undefined, 42, 'x', []]) expect(isValidRollout(v)).toBe(false);
  });

  it('rejects an empty order', () => {
    expect(isValidRollout({ ...DEFAULT_ROLLOUT, order: [] })).toBe(false);
  });

  it('rejects an order entry with no cut definition', () => {
    expect(isValidRollout({ ...DEFAULT_ROLLOUT, order: [...DEFAULT_ROLLOUT.order, 'ghost'] })).toBe(false);
  });

  it('rejects a duplicate cut id in order', () => {
    expect(isValidRollout({ ...DEFAULT_ROLLOUT, order: [...DEFAULT_ROLLOUT.order, 'capture'] })).toBe(false);
  });

  it('rejects a cover whose original is not a known cut', () => {
    expect(isValidRollout({ ...DEFAULT_ROLLOUT, covers: [{ of: 'nope', remaster: true }] })).toBe(false);
  });

  it('rejects an agent cut with runtime app', () => {
    const bad = structuredClone(DEFAULT_ROLLOUT) as Record<string, never>;
    (bad.cuts as Record<string, Record<string, unknown>>).ledes.runtime = 'app';
    expect(isValidRollout(bad)).toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/rollout/validate.test.ts`
Expected: FAIL — `Failed to resolve import "./validate.js"`

- [ ] **Step 5: Write the implementation**

```ts
// ui/src/lib/rollout/validate.ts
/**
 * Structural validation for a stored Rollout. Deliberately structural, not
 * semantic — mirrors isValidPipeline in the pipeline-config endpoint, whose
 * contract is "never return an invalid object, fall back to the default".
 */
import type { Rollout, CutDef } from './types.js';

function isCutDef(v: unknown): v is CutDef {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  if (typeof c.label !== 'string' || !c.label) return false;
  if (c.kind === 'script') {
    return (c.runtime === 'app' || c.runtime === 'host')
      && Array.isArray(c.command) && c.command.length > 0
      && (c.command as unknown[]).every((s) => typeof s === 'string');
  }
  if (c.kind === 'agent') {
    // Agent cuts need python3 + the claude CLI, which exist only on the host.
    return c.runtime === 'host' && typeof c.job === 'string' && !!c.job;
  }
  if (c.kind === 'human') {
    return typeof c.reviewPath === 'string' && !!c.reviewPath && typeof c.alertType === 'string';
  }
  return false;
}

export function isValidRollout(v: unknown): v is Rollout {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;

  if (!Array.isArray(r.order) || r.order.length === 0) return false;
  if (!r.order.every((id) => typeof id === 'string')) return false;
  if (new Set(r.order as string[]).size !== (r.order as string[]).length) return false;

  if (!r.cuts || typeof r.cuts !== 'object' || Array.isArray(r.cuts)) return false;
  const cuts = r.cuts as Record<string, unknown>;
  for (const id of r.order as string[]) {
    if (!(id in cuts) || !isCutDef(cuts[id])) return false;
  }

  if (!r.skipAfter || typeof r.skipAfter !== 'object' || Array.isArray(r.skipAfter)) return false;

  if (!Array.isArray(r.covers)) return false;
  for (const cover of r.covers as unknown[]) {
    if (!cover || typeof cover !== 'object' || Array.isArray(cover)) return false;
    const c = cover as Record<string, unknown>;
    if (typeof c.of !== 'string' || !(r.order as string[]).includes(c.of)) return false;
    if (c.budget !== undefined && (typeof c.budget !== 'number' || c.budget < 0)) return false;
  }

  if (r.disabled !== undefined) {
    if (!Array.isArray(r.disabled) || !r.disabled.every((s) => typeof s === 'string')) return false;
  }
  return true;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/rollout/validate.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 7: Commit**

```bash
git add ui/src/lib/rollout/types.ts ui/src/lib/rollout/defaults.ts \
        ui/src/lib/rollout/validate.ts ui/src/lib/rollout/validate.test.ts
git commit -m "feat(rollout): types, default definition, and structural validation

DEFAULT_ROLLOUT encodes the weekly process as EP0-EP10, including the two
things it does not currently guarantee: checks re-run after punch-up, and
bridge as a cut that cannot be forgotten."
```

---

### Task 3: Schema and the degenerate-safety test

**Files:**
- Modify: `ui/src/lib/db/schema.ts` (append three tables to `SCHEMA`)
- Create: `ui/src/lib/rollout/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `rollout_configs`, `rollout_runs`, `rollout_cut_runs`, available anywhere `getDb()` is used.

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/rollout/schema.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';

function db() {
  const d = new Database(':memory:');
  d.exec(SCHEMA);
  return d;
}

describe('rollout schema', () => {
  it('creates the three rollout tables', () => {
    const names = db().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rollout_%' ORDER BY name",
    ).all() as { name: string }[];
    expect(names.map((r) => r.name)).toEqual(['rollout_cut_runs', 'rollout_configs', 'rollout_runs'].sort());
  });

  it('defaults a config to disabled — degenerate safety', () => {
    const d = db();
    d.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('x', 'X');
    d.prepare('INSERT INTO rollout_configs (league_id, definition_json, updated_at) VALUES (1, ?, ?)')
      .run('{}', '2026-08-26T00:00:00Z');
    const row = d.prepare('SELECT enabled FROM rollout_configs WHERE league_id=1').get() as { enabled: number };
    expect(row.enabled).toBe(0);
  });

  it('cascades cut runs when a run is deleted', () => {
    const d = db();
    d.pragma('foreign_keys = ON');
    d.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('x', 'X');
    d.prepare('INSERT INTO seasons (id, league_id, season_number) VALUES (1, 1, 1)').run();
    d.prepare('INSERT INTO rounds (id, season_id, name) VALUES (9, 1, ?)').run('R');
    d.prepare(`INSERT INTO rollout_runs (id, league_id, round_id, definition_json, state, current_ep, started_at, updated_at)
               VALUES ('r1', 1, 9, '{}', 'running', 0, ?, ?)`).run('t', 't');
    d.prepare(`INSERT INTO rollout_cut_runs (run_id, cut_id, ep, runtime, state)
               VALUES ('r1', 'capture', 0, 'app', 'pending')`).run();
    d.prepare("DELETE FROM rollout_runs WHERE id='r1'").run();
    const n = d.prepare('SELECT COUNT(*) AS n FROM rollout_cut_runs').get() as { n: number };
    expect(n.n).toBe(0);
  });

  it('permits at most one run per round', () => {
    const d = db();
    const ins = (id: string) => d.prepare(
      `INSERT INTO rollout_runs (id, league_id, round_id, definition_json, state, current_ep, started_at, updated_at)
       VALUES (?, 1, 9, '{}', 'running', 0, 't', 't')`).run(id);
    ins('r1');
    expect(() => ins('r2')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/rollout/schema.test.ts`
Expected: FAIL — `no such table: rollout_configs`

- [ ] **Step 3: Append the tables to `SCHEMA`**

In `ui/src/lib/db/schema.ts`, append inside the `SCHEMA` template literal, after the existing `digest_*` tables:

```sql
  CREATE TABLE IF NOT EXISTS rollout_configs (
    league_id       INTEGER PRIMARY KEY REFERENCES leagues(id),
    definition_json TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rollout_runs (
    id              TEXT PRIMARY KEY,
    league_id       INTEGER NOT NULL REFERENCES leagues(id),
    round_id        INTEGER NOT NULL REFERENCES rounds(id),
    definition_json TEXT NOT NULL,
    state           TEXT NOT NULL CHECK(state IN ('running','parked','done','failed')),
    current_ep      INTEGER NOT NULL DEFAULT 0,
    resume_token    TEXT,
    review_url      TEXT,
    error           TEXT,
    started_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    finished_at     TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS rollout_runs_round ON rollout_runs(round_id);

  CREATE TABLE IF NOT EXISTS rollout_cut_runs (
    run_id       TEXT NOT NULL REFERENCES rollout_runs(id) ON DELETE CASCADE,
    cut_id       TEXT NOT NULL,
    ep           INTEGER NOT NULL,
    runtime      TEXT,
    state        TEXT NOT NULL CHECK(state IN ('pending','running','done','failed','skipped')),
    attempts     INTEGER NOT NULL DEFAULT 0,
    remasters    INTEGER NOT NULL DEFAULT 0,
    claimed_at   TEXT,
    heartbeat_at TEXT,
    output_json  TEXT,
    error        TEXT,
    started_at   TEXT,
    finished_at  TEXT,
    PRIMARY KEY (run_id, cut_id)
  );
```

`definition_json` on `rollout_runs` is a snapshot taken at run start, so editing a league's config never mutates a run in flight.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/rollout/schema.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Prove the whole existing suite is untouched**

Run: `cd ui && npm test`
Expected: PASS. New tables are additive `CREATE TABLE IF NOT EXISTS`; nothing else changed.

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/db/schema.ts ui/src/lib/rollout/schema.test.ts
git commit -m "feat(rollout): rollout_configs, rollout_runs, rollout_cut_runs

Additive only. enabled defaults to 0, so every league keeps the existing
digest_jobs path until explicitly switched over."
```

---

**Phase 1 checkpoint.** Stop here and report: `epCore` extracted with both pipeline solvers rewired and all pipeline tests green; types, `DEFAULT_ROLLOUT`, and validation landed; three tables created with degenerate safety proven. No behaviour has changed for any league.

---

*Phases 2–4 (engine, executors, surfaces) continue in this document below.*

## Phase 2 — The pure engine (no DB, no IO)

Everything in this phase is a pure function over `RunState` + `Rollout`. That is
deliberate: it is the part with the interesting decisions, and it is far easier
to test as data-in/data-out than through two executors and a database.

### Task 4: The rollout solver

**Files:**
- Create: `ui/src/lib/rollout/solve.ts`
- Create: `ui/src/lib/rollout/solve.test.ts`

**Interfaces:**
- Consumes: `bucketBySkip`, `placeCovers` from `$lib/digest/epCore.js` (Task 1); `Rollout`, `RolloutCover`, `activeCuts` from `./types.js` (Task 2).
- Produces: `type RolloutEP = { cuts: string[]; covers: RolloutCover[] }` and `resolveRollout(rollout: Rollout): RolloutEP[]`, plus `epOfCut(eps: RolloutEP[], cutId: string): number`.

**Note:** unlike the pipeline solver there is **no merge and no model grouping**. Merging adjacent agent cuts into one call would destroy the context isolation that makes parallel cuts meaningful (spec §2).

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/rollout/solve.test.ts
import { describe, it, expect } from 'vitest';
import { resolveRollout, epOfCut } from './solve.js';
import { DEFAULT_ROLLOUT } from './defaults.js';
import type { Rollout } from './types.js';

const tiny: Rollout = {
  order: ['a', 'b', 'c'],
  cuts: {
    a: { kind: 'script', runtime: 'host', label: 'A', command: ['a'], check: { rule: 'exit-zero' } },
    b: { kind: 'script', runtime: 'host', label: 'B', command: ['b'] },
    c: { kind: 'script', runtime: 'app', label: 'C', command: ['c'] },
  },
  skipAfter: { b: true },
  covers: [],
};

describe('resolveRollout', () => {
  it('groups cuts into EPs at skip boundaries', () => {
    expect(resolveRollout(tiny).map((ep) => ep.cuts)).toEqual([['a', 'b'], ['c']]);
  });

  it('never merges — each EP keeps its cuts as a plain list', () => {
    const eps = resolveRollout(tiny);
    expect(eps[0]).toEqual({ cuts: ['a', 'b'], covers: [] });
  });

  it('drops disabled cuts', () => {
    const eps = resolveRollout({ ...tiny, disabled: ['b'] });
    expect(eps.map((ep) => ep.cuts)).toEqual([['a'], ['c']]);
  });

  it('places a remaster cover in the EP after its original', () => {
    const eps = resolveRollout({ ...tiny, covers: [{ of: 'a', remaster: true, budget: 1 }] });
    expect(eps[1].covers).toEqual([{ of: 'a', remaster: true, budget: 1 }]);
  });

  it('resolves the default rollout into the spec EP layout', () => {
    const eps = resolveRollout(DEFAULT_ROLLOUT);
    expect(eps[0].cuts).toEqual(['capture']);
    expect(eps[1].cuts).toEqual(['generate']);
    expect(eps[2].cuts).toEqual(['verify', 'dedupe', 'mentions', 'participation']);
    expect(eps[3].cuts).toEqual(['ledes']);
    expect(eps[4].cuts).toEqual(['hold-ledes']);
    expect(eps[5].cuts).toEqual(['punchup']);
    expect(eps[6].cuts).toEqual(['verify-post-punchup', 'dedupe-post-punchup', 'dupe-findings']);
    expect(eps[7].cuts).toEqual(['dupe-page', 'cover-art']);
    expect(eps[8].cuts).toEqual(['hold-approve']);
    expect(eps[9].cuts).toEqual(['send']);
    expect(eps[10].cuts).toEqual(['bridge', 'archive-refresh']);
  });
});

describe('epOfCut', () => {
  it('finds the EP index a cut sits in', () => {
    expect(epOfCut(resolveRollout(tiny), 'c')).toBe(1);
  });
  it('returns -1 for an unknown cut', () => {
    expect(epOfCut(resolveRollout(tiny), 'zzz')).toBe(-1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/rollout/solve.test.ts`
Expected: FAIL — `Failed to resolve import "./solve.js"`

- [ ] **Step 3: Write the implementation**

```ts
// ui/src/lib/rollout/solve.ts
/**
 * Resolve a Rollout into ordered EPs.
 *
 * Same algorithm as the pipeline solver, via the shared epCore primitives,
 * minus two things that do not belong at this level:
 *   - no merge: collapsing adjacent agent cuts into one call would destroy
 *     the context isolation that makes a parallel EP meaningful;
 *   - no model grouping: agent cuts resolve their model individually via
 *     modelFor, and script/human cuts have no model at all.
 */
import { bucketBySkip, placeCovers } from '$lib/digest/epCore.js';
import { activeCuts, type Rollout, type RolloutCover } from './types.js';

export type RolloutEP = { cuts: string[]; covers: RolloutCover[] };

export function resolveRollout(rollout: Rollout): RolloutEP[] {
  const active = activeCuts(rollout);
  const buckets = bucketBySkip(
    rollout.order,
    rollout.skipAfter as Record<string, boolean>,
    active,
  );
  const coversByEp = placeCovers(buckets, rollout.covers);

  const total = coversByEp.size > 0
    ? Math.max(buckets.length, ...Array.from(coversByEp.keys()).map((k) => k + 1))
    : buckets.length;

  const eps: RolloutEP[] = [];
  for (let i = 0; i < total; i++) {
    const cuts = buckets[i] ?? [];
    const covers = coversByEp.get(i) ?? [];
    if (cuts.length === 0 && covers.length === 0) continue; // elide empty EPs
    eps.push({ cuts, covers });
  }
  return eps;
}

/** EP index containing `cutId`, or -1 if it is not active. */
export function epOfCut(eps: RolloutEP[], cutId: string): number {
  return eps.findIndex((ep) => ep.cuts.includes(cutId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/rollout/solve.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/rollout/solve.ts ui/src/lib/rollout/solve.test.ts
git commit -m "feat(rollout): EP solver over the shared epCore primitives

No merge and no model grouping at this level — merging adjacent agent cuts
would destroy the context isolation a parallel EP exists to provide."
```

---

### Task 5: Claiming, EP advance, parking

**Files:**
- Create: `ui/src/lib/rollout/engine.ts`
- Create: `ui/src/lib/rollout/engine.test.ts`

**Interfaces:**
- Consumes: `resolveRollout`, `RolloutEP` from `./solve.js` (Task 4); `Rollout`, `RunState`, `CutRunState`, `Runtime` from `./types.js` (Task 2).
- Produces:
  - `initialCutRuns(rollout: Rollout): CutRunState[]`
  - `claimable(run: RunState, rollout: Rollout, runtime: Runtime): string[]`
  - `epComplete(run: RunState, ep: number): boolean`
  - `advance(run: RunState, rollout: Rollout): RunState` — pure; returns the next state.

**Terminal states** for a cut are `done`, `failed`, `skipped`. A `human` cut has `runtime: null` and is never claimable by an executor — reaching its EP parks the run.

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/rollout/engine.test.ts
import { describe, it, expect } from 'vitest';
import { initialCutRuns, claimable, epComplete, advance } from './engine.js';
import type { Rollout, RunState, CutRunState } from './types.js';

const rollout: Rollout = {
  order: ['a', 'b', 'hold', 'c'],
  cuts: {
    a: { kind: 'script', runtime: 'host', label: 'A', command: ['a'] },
    b: { kind: 'script', runtime: 'app', label: 'B', command: ['b'] },
    hold: { kind: 'human', label: 'Hold', reviewPath: '/x', alertType: 'digest_ready' },
    c: { kind: 'script', runtime: 'app', label: 'C', command: ['c'] },
  },
  skipAfter: { b: true, hold: true },
  covers: [],
};

function run(over: Partial<RunState> = {}, cuts?: CutRunState[]): RunState {
  return {
    runId: 'r1', leagueId: 1, roundId: 9, currentEp: 0, state: 'running',
    cuts: cuts ?? initialCutRuns(rollout),
    ...over,
  };
}
const set = (cuts: CutRunState[], id: string, patch: Partial<CutRunState>) =>
  cuts.map((c) => (c.cutId === id ? { ...c, ...patch } : c));

describe('initialCutRuns', () => {
  it('creates one pending row per active cut, tagged with its EP', () => {
    const rows = initialCutRuns(rollout);
    expect(rows.map((r) => [r.cutId, r.ep, r.state]))
      .toEqual([['a', 0, 'pending'], ['b', 0, 'pending'], ['hold', 1, 'pending'], ['c', 2, 'pending']]);
  });
  it('gives a human cut a null runtime', () => {
    expect(initialCutRuns(rollout).find((r) => r.cutId === 'hold')!.runtime).toBeNull();
  });
});

describe('claimable', () => {
  it('returns only pending cuts in the current EP matching the runtime', () => {
    expect(claimable(run(), rollout, 'host')).toEqual(['a']);
    expect(claimable(run(), rollout, 'app')).toEqual(['b']);
  });
  it('returns nothing for a cut already running', () => {
    expect(claimable(run({}, set(initialCutRuns(rollout), 'a', { state: 'running' })), rollout, 'host')).toEqual([]);
  });
  it('returns nothing while the run is parked', () => {
    expect(claimable(run({ state: 'parked' }), rollout, 'host')).toEqual([]);
  });
  it('never returns a human cut', () => {
    expect(claimable(run({ currentEp: 1 }), rollout, 'app')).toEqual([]);
  });
});

describe('epComplete', () => {
  it('is false while any cut in the EP is unfinished', () => {
    expect(epComplete(run(), 0)).toBe(false);
  });
  it('is true when every cut in the EP is terminal', () => {
    let cuts = set(initialCutRuns(rollout), 'a', { state: 'done' });
    cuts = set(cuts, 'b', { state: 'skipped' });
    expect(epComplete(run({}, cuts), 0)).toBe(true);
  });
});

describe('advance', () => {
  it('holds position while the EP is incomplete', () => {
    expect(advance(run(), rollout).currentEp).toBe(0);
  });

  it('moves to the next EP when the current one completes', () => {
    let cuts = set(initialCutRuns(rollout), 'a', { state: 'done' });
    cuts = set(cuts, 'b', { state: 'done' });
    const next = advance(run({}, cuts), rollout);
    expect(next.currentEp).toBe(1);
    expect(next.state).toBe('parked'); // EP1 is the hold
  });

  it('parks when the new EP contains a human cut', () => {
    let cuts = set(initialCutRuns(rollout), 'a', { state: 'done' });
    cuts = set(cuts, 'b', { state: 'done' });
    expect(advance(run({}, cuts), rollout).state).toBe('parked');
  });

  it('resumes past a lifted hold', () => {
    let cuts = set(initialCutRuns(rollout), 'a', { state: 'done' });
    cuts = set(cuts, 'b', { state: 'done' });
    cuts = set(cuts, 'hold', { state: 'done' });
    const next = advance(run({ currentEp: 1 }, cuts), rollout);
    expect(next.currentEp).toBe(2);
    expect(next.state).toBe('running');
  });

  it('finishes when the last EP completes', () => {
    const cuts = initialCutRuns(rollout).map((c) => ({ ...c, state: 'done' as const }));
    const next = advance(run({ currentEp: 2 }, cuts), rollout);
    expect(next.state).toBe('done');
  });

  it('is a no-op on a run that is already done', () => {
    const done = run({ state: 'done' });
    expect(advance(done, rollout)).toEqual(done);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/rollout/engine.test.ts`
Expected: FAIL — `Failed to resolve import "./engine.js"`

- [ ] **Step 3: Write the implementation**

```ts
// ui/src/lib/rollout/engine.ts
/**
 * Pure rollout decisions. No database, no IO, no clock.
 *
 * The executors are deliberately dumb: they ask this module what is claimable,
 * run it, write the result, and ask what happens next. Everything interesting
 * is here, where it can be tested as data in / data out.
 */
import { resolveRollout, type RolloutEP } from './solve.js';
import type { CutRunState, Rollout, RunState, Runtime } from './types.js';

const TERMINAL = new Set(['done', 'failed', 'skipped']);

/** One pending row per active cut, tagged with the EP it resolved into. */
export function initialCutRuns(rollout: Rollout): CutRunState[] {
  const eps = resolveRollout(rollout);
  const rows: CutRunState[] = [];
  eps.forEach((ep, i) => {
    for (const cutId of ep.cuts) {
      const def = rollout.cuts[cutId];
      rows.push({
        cutId,
        ep: i,
        runtime: def.kind === 'human' ? null : def.runtime,
        state: 'pending',
        attempts: 0,
        remasters: 0,
      });
    }
  });
  return rows;
}

/**
 * Cut ids an executor of `runtime` may claim right now: pending, in the run's
 * current EP, and matching that runtime. A parked or finished run offers
 * nothing, and a human cut is never claimable — reaching it parks the run.
 */
export function claimable(run: RunState, _rollout: Rollout, runtime: Runtime): string[] {
  if (run.state !== 'running') return [];
  return run.cuts
    .filter((c) => c.ep === run.currentEp && c.state === 'pending' && c.runtime === runtime)
    .map((c) => c.cutId);
}

/** True when every cut in `ep` has reached a terminal state. */
export function epComplete(run: RunState, ep: number): boolean {
  const inEp = run.cuts.filter((c) => c.ep === ep);
  return inEp.length > 0 && inEp.every((c) => TERMINAL.has(c.state));
}

function epHasHuman(run: RunState, ep: number): boolean {
  return run.cuts.some((c) => c.ep === ep && c.runtime === null && c.state === 'pending');
}

/**
 * Move the run forward if its current EP is complete.
 *
 * Returns a NEW RunState; never mutates. Parks when the EP it moves into
 * contains an unlifted human cut. Marks done when it moves past the last EP.
 */
export function advance(run: RunState, rollout: Rollout): RunState {
  if (run.state === 'done' || run.state === 'failed') return run;
  if (!epComplete(run, run.currentEp)) return run;

  const eps: RolloutEP[] = resolveRollout(rollout);
  const nextEp = run.currentEp + 1;
  if (nextEp >= eps.length) {
    return { ...run, state: 'done' };
  }
  return {
    ...run,
    currentEp: nextEp,
    state: epHasHuman(run, nextEp) ? 'parked' : 'running',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/rollout/engine.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/rollout/engine.ts ui/src/lib/rollout/engine.test.ts
git commit -m "feat(rollout): pure engine — claiming, EP advance, parking

Executors stay dumb: ask what is claimable, run it, write the result, ask what
happens next. All decisions live here as pure functions over RunState."
```

---

### Task 6: Checks, remaster covers, and the forced hold

**Files:**
- Modify: `ui/src/lib/rollout/engine.ts` (add check handling)
- Create: `ui/src/lib/rollout/engine.checks.test.ts`

**Interfaces:**
- Consumes: everything from Task 5.
- Produces:
  - `evaluateCheck(check: Check | undefined, result: CutResult): boolean | undefined` — `undefined` means no check declared.
  - `applyCutResult(run: RunState, rollout: Rollout, cutId: string, result: CutResult): RunState`
  - `type CutResult = { exitCode: number; outputJson?: string; error?: string }`

**The two budgets, never conflated** (spec §7):
- `attempts` — transient failure (non-zero exit *with* an `error`, e.g. timeout). Retries the same cut, max 3, mirroring `failOrRetry`.
- `remasters` — a declared **check** failed. Fires the remaster cover, max `budget` (default 1).

**Forced hold:** when the remaster budget is exhausted, the run parks *immediately* with `error` naming the unresolved cuts. It does not die, and it does not skip ahead to the next configured hold — parking where the failure happened is simpler and more informative (spec §7).

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/rollout/engine.checks.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateCheck, applyCutResult, initialCutRuns } from './engine.js';
import type { Rollout, RunState } from './types.js';

const rollout: Rollout = {
  order: ['verify', 'next'],
  cuts: {
    verify: { kind: 'script', runtime: 'host', label: 'Verify', command: ['v'], check: { rule: 'no-fail-checks' } },
    next: { kind: 'script', runtime: 'host', label: 'Next', command: ['n'] },
  },
  skipAfter: { verify: true },
  covers: [{ of: 'verify', remaster: true, budget: 1 }],
};

const run = (): RunState => ({
  runId: 'r1', leagueId: 1, roundId: 9, currentEp: 0, state: 'running',
  cuts: initialCutRuns(rollout),
});
const cut = (r: RunState, id: string) => r.cuts.find((c) => c.cutId === id)!;

describe('evaluateCheck', () => {
  it('is undefined when no check is declared', () => {
    expect(evaluateCheck(undefined, { exitCode: 1 })).toBeUndefined();
  });
  it('exit-zero passes on 0 and fails otherwise', () => {
    expect(evaluateCheck({ rule: 'exit-zero' }, { exitCode: 0 })).toBe(true);
    expect(evaluateCheck({ rule: 'exit-zero' }, { exitCode: 1 })).toBe(false);
  });
  it('no-fail-checks reads severities out of the JSON payload', () => {
    const ok = JSON.stringify({ checks: [{ severity: 'ok' }, { severity: 'warn' }] });
    const bad = JSON.stringify({ checks: [{ severity: 'ok' }, { severity: 'fail' }] });
    expect(evaluateCheck({ rule: 'no-fail-checks' }, { exitCode: 1, outputJson: ok })).toBe(true);
    expect(evaluateCheck({ rule: 'no-fail-checks' }, { exitCode: 1, outputJson: bad })).toBe(false);
  });
  it('no-fail-checks fails closed on unparseable output', () => {
    expect(evaluateCheck({ rule: 'no-fail-checks' }, { exitCode: 0, outputJson: 'not json' })).toBe(false);
  });
});

describe('applyCutResult', () => {
  it('marks a passing cut done', () => {
    const r = applyCutResult(run(), rollout, 'verify', {
      exitCode: 0, outputJson: JSON.stringify({ checks: [] }),
    });
    expect(cut(r, 'verify').state).toBe('done');
    expect(cut(r, 'verify').checkPassed).toBe(true);
  });

  it('retries a transient failure without spending a remaster', () => {
    const r = applyCutResult(run(), rollout, 'verify', { exitCode: 1, error: 'timeout' });
    expect(cut(r, 'verify').state).toBe('pending');
    expect(cut(r, 'verify').attempts).toBe(1);
    expect(cut(r, 'verify').remasters).toBe(0);
  });

  it('fails a cut for good after 3 transient attempts', () => {
    let r = run();
    for (let i = 0; i < 3; i++) r = applyCutResult(r, rollout, 'verify', { exitCode: 1, error: 'timeout' });
    expect(cut(r, 'verify').state).toBe('failed');
  });

  it('spends a remaster and re-queues the cut when its check fails', () => {
    const bad = JSON.stringify({ checks: [{ severity: 'fail', id: 'quote fabricated?' }] });
    const r = applyCutResult(run(), rollout, 'verify', { exitCode: 1, outputJson: bad });
    expect(cut(r, 'verify').state).toBe('pending');
    expect(cut(r, 'verify').remasters).toBe(1);
    expect(cut(r, 'verify').attempts).toBe(0); // NOT a transient retry
    expect(r.state).toBe('running');
  });

  it('parks at a forced hold when the remaster budget is exhausted', () => {
    const bad = JSON.stringify({ checks: [{ severity: 'fail', id: 'quote fabricated?' }] });
    let r = applyCutResult(run(), rollout, 'verify', { exitCode: 1, outputJson: bad });
    r = applyCutResult(r, rollout, 'verify', { exitCode: 1, outputJson: bad });
    expect(r.state).toBe('parked');
    expect(cut(r, 'verify').state).toBe('failed');
    expect(r.error).toContain('verify');
  });

  it('never advances past a forced hold', () => {
    const bad = JSON.stringify({ checks: [{ severity: 'fail' }] });
    let r = applyCutResult(run(), rollout, 'verify', { exitCode: 1, outputJson: bad });
    r = applyCutResult(r, rollout, 'verify', { exitCode: 1, outputJson: bad });
    expect(r.currentEp).toBe(0);
  });

  it('does not fire a remaster for a cut with no remaster cover', () => {
    const noCover: Rollout = { ...rollout, covers: [] };
    const r = applyCutResult(run(), noCover, 'verify', {
      exitCode: 1, outputJson: JSON.stringify({ checks: [{ severity: 'fail' }] }),
    });
    expect(cut(r, 'verify').state).toBe('failed');
    expect(r.state).toBe('parked');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/rollout/engine.checks.test.ts`
Expected: FAIL — `evaluateCheck is not a function`

- [ ] **Step 3: Extend `engine.ts`**

Append to `ui/src/lib/rollout/engine.ts`, and add `Check` to the type import:

```ts
export type CutResult = { exitCode: number; outputJson?: string; error?: string };

const MAX_ATTEMPTS = 3;      // mirrors failOrRetry's default
const DEFAULT_BUDGET = 1;    // spec §7: remaster budget defaults to 1

/**
 * Did this cut's declared check pass?
 *
 * `undefined` means no check was declared — the cut simply succeeds or fails
 * on its exit code. Fails CLOSED: unparseable output is a failure, because a
 * check we cannot read is not a check we can trust.
 */
export function evaluateCheck(check: Check | undefined, result: CutResult): boolean | undefined {
  if (!check) return undefined;
  if (check.rule === 'exit-zero') return result.exitCode === 0;

  // 'no-fail-checks': verify_facts --json grades each check ok | warn | fail
  // and exits non-zero if ANY failed. Warnings must not block the run.
  try {
    const parsed = JSON.parse(result.outputJson ?? '') as { checks?: { severity?: string }[] };
    if (!Array.isArray(parsed.checks)) return false;
    return !parsed.checks.some((c) => c.severity === 'fail');
  } catch {
    return false;
  }
}

function remasterFor(rollout: Rollout, cutId: string) {
  return rollout.covers.find((c) => c.of === cutId && c.remaster === true);
}

/**
 * Fold a finished cut's result into the run.
 *
 * Three outcomes, in priority order:
 *   1. transient failure (non-zero exit WITH an error string) → spend an
 *      attempt and re-queue, up to MAX_ATTEMPTS. Never spends a remaster.
 *   2. declared check failed → fire the remaster cover: spend a remaster and
 *      re-queue. Budget exhausted (or no remaster cover) → the cut fails and
 *      the run parks at a FORCED HOLD, carrying the unresolved cut ids.
 *   3. otherwise → done.
 *
 * Advancing the EP is NOT done here; the caller calls advance() afterwards.
 */
export function applyCutResult(
  run: RunState, rollout: Rollout, cutId: string, result: CutResult,
): RunState {
  const def = rollout.cuts[cutId];
  const idx = run.cuts.findIndex((c) => c.cutId === cutId);
  if (idx === -1) return run;
  const prev = run.cuts[idx];
  const write = (patch: Partial<CutRunState>): CutRunState[] =>
    run.cuts.map((c, i) => (i === idx ? { ...c, ...patch } : c));

  // 1. Transient failure — the command itself did not complete.
  if (result.error) {
    const attempts = prev.attempts + 1;
    if (attempts < MAX_ATTEMPTS) {
      return { ...run, cuts: write({ state: 'pending', attempts }) };
    }
    return {
      ...run,
      cuts: write({ state: 'failed', attempts }),
      state: 'parked',
      error: `cut "${cutId}" failed after ${attempts} attempts: ${result.error}`,
    };
  }

  // 2. Declared check.
  const checkPassed = evaluateCheck('check' in def ? def.check : undefined, result);
  if (checkPassed === false) {
    const cover = remasterFor(rollout, cutId);
    const budget = cover?.budget ?? DEFAULT_BUDGET;
    if (cover && prev.remasters < budget) {
      return {
        ...run,
        cuts: write({
          state: 'pending', remasters: prev.remasters + 1,
          checkPassed: false, outputJson: result.outputJson,
        }),
      };
    }
    // Forced hold: park where the failure happened, evidence attached.
    return {
      ...run,
      cuts: write({ state: 'failed', checkPassed: false, outputJson: result.outputJson }),
      state: 'parked',
      error: `cut "${cutId}" check failed and could not be repaired`,
    };
  }

  // 3. Success.
  return {
    ...run,
    cuts: write({ state: 'done', checkPassed, outputJson: result.outputJson }),
  };
}
```

Also add `error?: string` to `RunState` in `ui/src/lib/rollout/types.ts`:

```ts
export type RunState = {
  runId: string;
  leagueId: number;
  roundId: number;
  currentEp: number;
  state: 'running' | 'parked' | 'done' | 'failed';
  error?: string;
  cuts: CutRunState[];
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/rollout/engine.checks.test.ts src/lib/rollout/engine.test.ts`
Expected: PASS (both files)

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/rollout/engine.ts ui/src/lib/rollout/engine.checks.test.ts ui/src/lib/rollout/types.ts
git commit -m "feat(rollout): checks, remaster covers, forced hold

Two budgets that are never conflated: attempts for transient failure, remasters
for a failed check. Budget exhausted parks the run where the failure happened
rather than killing it — a fixable problem never stops the run, an unfixable
one never gets past a human."
```

---

### Task 7: Context assembly — the dossier slice

**Files:**
- Create: `ui/src/lib/rollout/context.ts`
- Create: `ui/src/lib/rollout/context.test.ts`

**Interfaces:**
- Consumes: `RunState`, `Rollout` from `./types.js`.
- Produces: `contextFor(run: RunState, cutId: string): CutContext` where `type CutContext = { cutId: string; ep: number; upstream: { cutId: string; ep: number; label?: string; outputJson?: string }[] }`.

**The rule this enforces** (spec §3): a cut sees the output of every cut in a *strictly earlier* EP, and **never** a sibling in its own EP. There is no separate dossier object — the dossier is the accumulated `output_json` of upstream cut runs, sliced by position.

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/rollout/context.test.ts
import { describe, it, expect } from 'vitest';
import { contextFor } from './context.js';
import type { RunState, CutRunState } from './types.js';

const c = (cutId: string, ep: number, outputJson?: string): CutRunState => ({
  cutId, ep, runtime: 'host', state: outputJson ? 'done' : 'pending',
  attempts: 0, remasters: 0, outputJson,
});

const run: RunState = {
  runId: 'r1', leagueId: 1, roundId: 9, currentEp: 2, state: 'running',
  cuts: [
    c('capture', 0, '{"ok":true}'),
    c('verify', 1, '{"checks":[]}'),
    c('dedupe', 1, '{"runs":[]}'),
    c('punchup', 2),
    c('sibling', 2, '{"leaked":true}'),
    c('later', 3),
  ],
};

describe('contextFor', () => {
  it('includes every cut from a strictly earlier EP', () => {
    expect(contextFor(run, 'punchup').upstream.map((u) => u.cutId))
      .toEqual(['capture', 'verify', 'dedupe']);
  });

  it('never includes a sibling in the same EP', () => {
    expect(contextFor(run, 'punchup').upstream.some((u) => u.cutId === 'sibling')).toBe(false);
  });

  it('never includes a downstream cut', () => {
    expect(contextFor(run, 'punchup').upstream.some((u) => u.cutId === 'later')).toBe(false);
  });

  it('carries each upstream cut output verbatim', () => {
    const verify = contextFor(run, 'punchup').upstream.find((u) => u.cutId === 'verify')!;
    expect(verify.outputJson).toBe('{"checks":[]}');
  });

  it('gives an EP0 cut an empty upstream', () => {
    expect(contextFor(run, 'capture').upstream).toEqual([]);
  });

  it('omits upstream cuts that produced no output', () => {
    const partial: RunState = { ...run, cuts: [c('a', 0), c('b', 1)] };
    expect(contextFor(partial, 'b').upstream).toEqual([]);
  });

  it('throws for an unknown cut rather than silently returning everything', () => {
    expect(() => contextFor(run, 'ghost')).toThrow(/unknown cut/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/rollout/context.test.ts`
Expected: FAIL — `Failed to resolve import "./context.js"`

- [ ] **Step 3: Write the implementation**

```ts
// ui/src/lib/rollout/context.ts
/**
 * The dossier slice for one cut.
 *
 * Spec §3: context visibility is declared by POSITION, not wired by hand. A
 * cut reads the output of everything in a strictly earlier EP and never a
 * sibling in its own EP — which is what makes a parallel EP meaningful and
 * what makes adding a cut wire its own inputs.
 *
 * There is no separate dossier object. The dossier IS the accumulated
 * output_json of upstream cut runs.
 */
import type { RunState } from './types.js';

export type UpstreamOutput = { cutId: string; ep: number; outputJson: string };
export type CutContext = { cutId: string; ep: number; upstream: UpstreamOutput[] };

export function contextFor(run: RunState, cutId: string): CutContext {
  const self = run.cuts.find((c) => c.cutId === cutId);
  if (!self) throw new Error(`unknown cut "${cutId}" in run ${run.runId}`);

  const upstream = run.cuts
    .filter((c) => c.ep < self.ep && typeof c.outputJson === 'string')
    .sort((a, b) => a.ep - b.ep)
    .map((c) => ({ cutId: c.cutId, ep: c.ep, outputJson: c.outputJson as string }));

  return { cutId, ep: self.ep, upstream };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/rollout/context.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/rollout/context.ts ui/src/lib/rollout/context.test.ts
git commit -m "feat(rollout): position-derived context slice

A cut reads every strictly-earlier EP and never a sibling. No dossier object
and no input wiring — adding a cut wires its own context by where it sits."
```

---

**Phase 2 checkpoint.** Stop and report: solver, engine (claiming / advance / parking), checks with remaster covers and the forced hold, and the position-derived context slice — all pure, all tested, no database and no executor yet. Run `cd ui && npm test` to confirm the whole suite is green before starting Phase 3.

## Phase 3 — Persistence and executors

### Task 8: The store — config, runs, atomic claims, lease reaping

**Files:**
- Create: `ui/src/lib/rollout/store.ts`
- Create: `ui/src/lib/rollout/store.test.ts`

**Interfaces:**
- Consumes: `Rollout`, `RunState`, `CutRunState` (Task 2); `initialCutRuns` (Task 5); `isValidRollout` (Task 2); `DEFAULT_ROLLOUT` (Task 2).
- Produces:
  - `getRolloutConfig(db, leagueId): { rollout: Rollout; enabled: boolean }` — never throws, never returns null; falls back to `DEFAULT_ROLLOUT` disabled.
  - `putRolloutConfig(db, leagueId, rollout, enabled, nowIso): void`
  - `createRun(db, leagueId, roundId, rollout, nowIso): string`
  - `loadRun(db, runId): RunState | null`
  - `loadRunByRound(db, roundId): RunState | null`
  - `saveRun(db, run, nowIso): void`
  - `claimCut(db, runId, cutId, nowIso): boolean`
  - `heartbeat(db, runId, cutId, nowIso): void`
  - `reapStaleCuts(db, nowIso, leaseSeconds?): number`
  - `hasActiveRun(db, leagueId): boolean`

**Why a lease** (spec §7): `digest_jobs` gets away with `hasActiveJob` because one process owns the whole path. A host executor can be killed mid-cut, leaving a row in `running` forever; without reaping, the first host crash silently wedges a round.

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/rollout/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';
import {
  getRolloutConfig, putRolloutConfig, createRun, loadRun, loadRunByRound,
  saveRun, claimCut, heartbeat, reapStaleCuts, hasActiveRun,
} from './store.js';
import { DEFAULT_ROLLOUT } from './defaults.js';
import type { Rollout } from './types.js';

const T0 = '2026-08-26T00:00:00Z';
const tiny: Rollout = {
  order: ['a', 'b'],
  cuts: {
    a: { kind: 'script', runtime: 'host', label: 'A', command: ['a'] },
    b: { kind: 'script', runtime: 'app', label: 'B', command: ['b'] },
  },
  skipAfter: { a: true },
  covers: [],
};

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('sb', 'Second Best');
  db.prepare('INSERT INTO seasons (id, league_id, season_number) VALUES (1, 1, 1)').run();
  db.prepare('INSERT INTO rounds (id, season_id, name) VALUES (9, 1, ?)').run('R9');
});

describe('config', () => {
  it('falls back to the default rollout, disabled, when unset', () => {
    const cfg = getRolloutConfig(db, 1);
    expect(cfg.enabled).toBe(false);
    expect(cfg.rollout.order).toEqual(DEFAULT_ROLLOUT.order);
  });

  it('round-trips a stored config', () => {
    putRolloutConfig(db, 1, tiny, true, T0);
    const cfg = getRolloutConfig(db, 1);
    expect(cfg.enabled).toBe(true);
    expect(cfg.rollout.order).toEqual(['a', 'b']);
  });

  it('falls back to the default when the stored JSON is malformed', () => {
    db.prepare('INSERT INTO rollout_configs (league_id, definition_json, enabled, updated_at) VALUES (1, ?, 1, ?)')
      .run('{ not json', T0);
    expect(getRolloutConfig(db, 1).rollout.order).toEqual(DEFAULT_ROLLOUT.order);
  });

  it('falls back to the default when the stored config is structurally invalid', () => {
    db.prepare('INSERT INTO rollout_configs (league_id, definition_json, enabled, updated_at) VALUES (1, ?, 1, ?)')
      .run(JSON.stringify({ order: [], cuts: {}, skipAfter: {}, covers: [] }), T0);
    expect(getRolloutConfig(db, 1).rollout.order).toEqual(DEFAULT_ROLLOUT.order);
  });
});

describe('runs', () => {
  it('creates a run with one pending cut row per active cut', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    const run = loadRun(db, id)!;
    expect(run.state).toBe('running');
    expect(run.currentEp).toBe(0);
    expect(run.cuts.map((c) => [c.cutId, c.ep, c.state]))
      .toEqual([['a', 0, 'pending'], ['b', 1, 'pending']]);
  });

  it('snapshots the definition so later config edits do not mutate the run', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    putRolloutConfig(db, 1, { ...tiny, order: ['a'] }, true, T0);
    const snap = db.prepare('SELECT definition_json FROM rollout_runs WHERE id=?').get(id) as { definition_json: string };
    expect((JSON.parse(snap.definition_json) as Rollout).order).toEqual(['a', 'b']);
  });

  it('finds a run by round', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    expect(loadRunByRound(db, 9)!.runId).toBe(id);
  });

  it('persists a modified RunState', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    const run = loadRun(db, id)!;
    saveRun(db, { ...run, currentEp: 1, state: 'parked', error: 'boom' }, T0);
    const back = loadRun(db, id)!;
    expect([back.currentEp, back.state, back.error]).toEqual([1, 'parked', 'boom']);
  });

  it('persists cut state and output', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    const run = loadRun(db, id)!;
    const cuts = run.cuts.map((c) => (c.cutId === 'a' ? { ...c, state: 'done' as const, outputJson: '{"x":1}', attempts: 2 } : c));
    saveRun(db, { ...run, cuts }, T0);
    const a = loadRun(db, id)!.cuts.find((c) => c.cutId === 'a')!;
    expect([a.state, a.outputJson, a.attempts]).toEqual(['done', '{"x":1}', 2]);
  });
});

describe('claiming', () => {
  it('claims a pending cut exactly once', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    expect(claimCut(db, id, 'a', T0)).toBe(true);
    expect(claimCut(db, id, 'a', T0)).toBe(false); // already running
  });

  it('records the claim time and heartbeat', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    claimCut(db, id, 'a', T0);
    const row = db.prepare('SELECT state, claimed_at, heartbeat_at FROM rollout_cut_runs WHERE run_id=? AND cut_id=?')
      .get(id, 'a') as { state: string; claimed_at: string; heartbeat_at: string };
    expect(row.state).toBe('running');
    expect(row.claimed_at).toBe(T0);
    expect(row.heartbeat_at).toBe(T0);
  });

  it('heartbeat refreshes the lease', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    claimCut(db, id, 'a', T0);
    heartbeat(db, id, 'a', '2026-08-26T00:05:00Z');
    const row = db.prepare('SELECT heartbeat_at FROM rollout_cut_runs WHERE run_id=? AND cut_id=?')
      .get(id, 'a') as { heartbeat_at: string };
    expect(row.heartbeat_at).toBe('2026-08-26T00:05:00Z');
  });
});

describe('reapStaleCuts', () => {
  it('returns an abandoned cut to pending and spends an attempt', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    claimCut(db, id, 'a', T0);
    const n = reapStaleCuts(db, '2026-08-26T01:00:00Z', 600);
    expect(n).toBe(1);
    const a = loadRun(db, id)!.cuts.find((c) => c.cutId === 'a')!;
    expect([a.state, a.attempts]).toEqual(['pending', 1]);
  });

  it('leaves a cut whose lease is still fresh', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    claimCut(db, id, 'a', T0);
    expect(reapStaleCuts(db, '2026-08-26T00:01:00Z', 600)).toBe(0);
  });
});

describe('hasActiveRun', () => {
  it('is true for a running run and false once done', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    expect(hasActiveRun(db, 1)).toBe(true);
    saveRun(db, { ...loadRun(db, id)!, state: 'done' }, T0);
    expect(hasActiveRun(db, 1)).toBe(false);
  });

  it('counts a PARKED run as active — a parked run still owns its league', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    saveRun(db, { ...loadRun(db, id)!, state: 'parked' }, T0);
    expect(hasActiveRun(db, 1)).toBe(true);
  });

  it('does not let one league block another', () => {
    db.prepare('INSERT INTO leagues (id, slug, name) VALUES (2, ?, ?)').run('bz', 'Boarz');
    createRun(db, 1, 9, tiny, T0);
    expect(hasActiveRun(db, 2)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/rollout/store.test.ts`
Expected: FAIL — `Failed to resolve import "./store.js"`

- [ ] **Step 3: Write the implementation**

```ts
// ui/src/lib/rollout/store.ts
/**
 * All rollout SQL. The engine stays pure; this is the only module that knows
 * the tables exist.
 */
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { DEFAULT_ROLLOUT } from './defaults.js';
import { isValidRollout } from './validate.js';
import { initialCutRuns } from './engine.js';
import type { CutRunState, Rollout, RunState } from './types.js';

/** Default lease: a cut unheard-from for this long is presumed abandoned. */
const LEASE_SECONDS = 600;

/**
 * Never throws, never returns null — mirrors the pipeline-config contract.
 * A malformed or structurally invalid stored config degrades to the default,
 * DISABLED, so a bad edit can never start running something unexpected.
 */
export function getRolloutConfig(
  db: Database.Database, leagueId: number,
): { rollout: Rollout; enabled: boolean } {
  const row = db.prepare('SELECT definition_json, enabled FROM rollout_configs WHERE league_id=?')
    .get(leagueId) as { definition_json: string; enabled: number } | undefined;
  if (!row) return { rollout: DEFAULT_ROLLOUT, enabled: false };
  try {
    const parsed: unknown = JSON.parse(row.definition_json);
    if (!isValidRollout(parsed)) return { rollout: DEFAULT_ROLLOUT, enabled: false };
    return { rollout: parsed, enabled: row.enabled === 1 };
  } catch {
    return { rollout: DEFAULT_ROLLOUT, enabled: false };
  }
}

export function putRolloutConfig(
  db: Database.Database, leagueId: number, rollout: Rollout, enabled: boolean, nowIso: string,
): void {
  db.prepare(
    `INSERT INTO rollout_configs (league_id, definition_json, enabled, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(league_id) DO UPDATE SET
       definition_json=excluded.definition_json,
       enabled=excluded.enabled,
       updated_at=excluded.updated_at`,
  ).run(leagueId, JSON.stringify(rollout), enabled ? 1 : 0, nowIso);
}

/**
 * Create a run and its pending cut rows in one transaction.
 * The definition is SNAPSHOT into the run, so editing the league's config
 * never mutates a run already in flight.
 */
export function createRun(
  db: Database.Database, leagueId: number, roundId: number, rollout: Rollout, nowIso: string,
): string {
  const runId = randomUUID();
  const rows = initialCutRuns(rollout);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO rollout_runs (id, league_id, round_id, definition_json, state, current_ep, started_at, updated_at)
       VALUES (?, ?, ?, ?, 'running', 0, ?, ?)`,
    ).run(runId, leagueId, roundId, JSON.stringify(rollout), nowIso, nowIso);
    const ins = db.prepare(
      `INSERT INTO rollout_cut_runs (run_id, cut_id, ep, runtime, state, attempts, remasters)
       VALUES (?, ?, ?, ?, 'pending', 0, 0)`,
    );
    for (const r of rows) ins.run(runId, r.cutId, r.ep, r.runtime);
  })();
  return runId;
}

function hydrate(
  run: { id: string; league_id: number; round_id: number; current_ep: number; state: string; error: string | null },
  cuts: Record<string, unknown>[],
): RunState {
  return {
    runId: run.id,
    leagueId: run.league_id,
    roundId: run.round_id,
    currentEp: run.current_ep,
    state: run.state as RunState['state'],
    error: run.error ?? undefined,
    cuts: cuts.map((c) => ({
      cutId: c.cut_id as string,
      ep: c.ep as number,
      runtime: (c.runtime as CutRunState['runtime']) ?? null,
      state: c.state as CutRunState['state'],
      attempts: c.attempts as number,
      remasters: c.remasters as number,
      checkPassed: c.check_passed === null || c.check_passed === undefined
        ? undefined : c.check_passed === 1,
      outputJson: (c.output_json as string | null) ?? undefined,
    })),
  };
}

export function loadRun(db: Database.Database, runId: string): RunState | null {
  const run = db.prepare('SELECT * FROM rollout_runs WHERE id=?').get(runId) as
    Parameters<typeof hydrate>[0] | undefined;
  if (!run) return null;
  const cuts = db.prepare('SELECT * FROM rollout_cut_runs WHERE run_id=? ORDER BY ep, cut_id')
    .all(runId) as Record<string, unknown>[];
  return hydrate(run, cuts);
}

export function loadRunByRound(db: Database.Database, roundId: number): RunState | null {
  const row = db.prepare('SELECT id FROM rollout_runs WHERE round_id=?').get(roundId) as
    { id: string } | undefined;
  return row ? loadRun(db, row.id) : null;
}

/** Persist a whole RunState. Cheap enough at this size, and impossible to half-apply. */
export function saveRun(db: Database.Database, run: RunState, nowIso: string): void {
  db.transaction(() => {
    db.prepare(
      `UPDATE rollout_runs SET current_ep=?, state=?, error=?, updated_at=?,
         finished_at = CASE WHEN ? IN ('done','failed') THEN ? ELSE finished_at END
       WHERE id=?`,
    ).run(run.currentEp, run.state, run.error ?? null, nowIso, run.state, nowIso, run.runId);
    const upd = db.prepare(
      `UPDATE rollout_cut_runs
          SET state=?, attempts=?, remasters=?, check_passed=?, output_json=?
        WHERE run_id=? AND cut_id=?`,
    );
    for (const c of run.cuts) {
      upd.run(
        c.state, c.attempts, c.remasters,
        c.checkPassed === undefined ? null : c.checkPassed ? 1 : 0,
        c.outputJson ?? null, run.runId, c.cutId,
      );
    }
  })();
}

/** Atomic claim. Returns false if someone else got there first. */
export function claimCut(
  db: Database.Database, runId: string, cutId: string, nowIso: string,
): boolean {
  const res = db.prepare(
    `UPDATE rollout_cut_runs
        SET state='running', claimed_at=?, heartbeat_at=?, started_at=COALESCE(started_at, ?)
      WHERE run_id=? AND cut_id=? AND state='pending'`,
  ).run(nowIso, nowIso, nowIso, runId, cutId);
  return res.changes === 1;
}

export function heartbeat(
  db: Database.Database, runId: string, cutId: string, nowIso: string,
): void {
  db.prepare(`UPDATE rollout_cut_runs SET heartbeat_at=? WHERE run_id=? AND cut_id=? AND state='running'`)
    .run(nowIso, runId, cutId);
}

/**
 * Return cuts whose executor went away to `pending`, spending an attempt.
 * Without this the first host crash wedges a round forever.
 */
export function reapStaleCuts(
  db: Database.Database, nowIso: string, leaseSeconds = LEASE_SECONDS,
): number {
  const cutoff = new Date(new Date(nowIso).getTime() - leaseSeconds * 1000).toISOString();
  const res = db.prepare(
    `UPDATE rollout_cut_runs
        SET state='pending', attempts=attempts+1, claimed_at=NULL, heartbeat_at=NULL
      WHERE state='running' AND (heartbeat_at IS NULL OR heartbeat_at < ?)`,
  ).run(cutoff);
  return res.changes;
}

/**
 * One active run per league. A PARKED run counts as active — it still owns its
 * league — but a parked run in one league must never block another's.
 */
export function hasActiveRun(db: Database.Database, leagueId: number): boolean {
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM rollout_runs WHERE league_id=? AND state IN ('running','parked')`,
  ).get(leagueId) as { n: number };
  return row.n > 0;
}
```

- [ ] **Step 4: Add the `check_passed` column**

`saveRun` and `hydrate` reference `rollout_cut_runs.check_passed`, which Task 3 did not create. Add it to the table definition in `ui/src/lib/db/schema.ts`, after `remasters`:

```sql
    check_passed INTEGER,
```

Also append an in-place migration in `ui/src/lib/db/client.ts`, alongside the existing `PRAGMA table_info` blocks, so DBs created before this task gain the column:

```ts
	// Rollout: check_passed added after the initial rollout tables shipped.
	const cutRunCols = db.prepare("PRAGMA table_info(rollout_cut_runs)").all() as { name: string }[];
	if (cutRunCols.length > 0 && !cutRunCols.some(c => c.name === 'check_passed')) {
		db.exec('ALTER TABLE rollout_cut_runs ADD COLUMN check_passed INTEGER');
	}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/rollout/store.test.ts src/lib/rollout/schema.test.ts`
Expected: PASS (both files)

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/rollout/store.ts ui/src/lib/rollout/store.test.ts \
        ui/src/lib/db/schema.ts ui/src/lib/db/client.ts
git commit -m "feat(rollout): store — config, runs, atomic claims, lease reaping

Config degrades to the default DISABLED on malformed or invalid JSON. Claims
carry a lease so a killed host executor cannot wedge a round, and a parked run
owns its own league without blocking any other."
```

---

### Task 9: Holds — park, notify, resume

**Files:**
- Create: `ui/src/lib/rollout/holds.ts`
- Create: `ui/src/lib/rollout/holds.test.ts`

**Interfaces:**
- Consumes: `loadRun`, `saveRun` (Task 8); `advance` (Task 5); `generateApprovalToken` from `$lib/digest/approvals.js`; `notify` from `$lib/notifications/dispatch.js`.
- Produces:
  - `type HoldDeps = { notify: (payload: AlertPayload) => Promise<unknown>; now: () => string; appBase: string }`
  - `parkAtHold(db, run, rollout, deps): Promise<RunState>`
  - `liftHold(db, token, nowIso): { ok: true; runId: string } | { ok: false; reason: string }`

**Reuse, not reinvention** (spec §7): the token pattern is `approvals.ts` verbatim, and `notify()` already routes to ntfy and WhatsApp through the settings grid. This is the approval gate generalized from one hold to N.

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/rollout/holds.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';
import { createRun, loadRun, saveRun } from './store.js';
import { parkAtHold, liftHold } from './holds.js';
import type { Rollout } from './types.js';

const T0 = '2026-08-26T00:00:00Z';
const rollout: Rollout = {
  order: ['a', 'hold'],
  cuts: {
    a: { kind: 'script', runtime: 'host', label: 'A', command: ['a'] },
    hold: { kind: 'human', label: 'Rate ledes', reviewPath: '/digest/{roundId}/hil', alertType: 'digest_ready' },
  },
  skipAfter: { a: true },
  covers: [],
};

let db: Database.Database;
let deps: { notify: ReturnType<typeof vi.fn>; now: () => string; appBase: string };

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('sb', 'Second Best');
  db.prepare('INSERT INTO seasons (id, league_id, season_number) VALUES (1, 1, 1)').run();
  db.prepare('INSERT INTO rounds (id, season_id, name) VALUES (9, 1, ?)').run('More Cowbell!');
  deps = { notify: vi.fn().mockResolvedValue([]), now: () => T0, appBase: 'https://mlb37.example' };
});

function parked() {
  const id = createRun(db, 1, 9, rollout, T0);
  const run = loadRun(db, id)!;
  const cuts = run.cuts.map((c) => (c.cutId === 'a' ? { ...c, state: 'done' as const } : c));
  saveRun(db, { ...run, cuts, currentEp: 1, state: 'parked' }, T0);
  return loadRun(db, id)!;
}

describe('parkAtHold', () => {
  it('mints a resume token and stores the review url', async () => {
    const run = await parkAtHold(db, parked(), rollout, deps);
    const row = db.prepare('SELECT resume_token, review_url FROM rollout_runs WHERE id=?')
      .get(run.runId) as { resume_token: string; review_url: string };
    expect(row.resume_token).toMatch(/^[\w-]{20,}$/);
    expect(row.review_url).toBe('https://mlb37.example/digest/9/hil');
  });

  it('substitutes {roundId} in the review path', async () => {
    const run = await parkAtHold(db, parked(), rollout, deps);
    expect(loadRun(db, run.runId)!.state).toBe('parked');
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
      link: 'https://mlb37.example/digest/9/hil',
    }));
  });

  it('names the league and round in the notification', async () => {
    await parkAtHold(db, parked(), rollout, deps);
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
      alertType: 'digest_ready',
      title: 'Second Best — More Cowbell!',
      message: expect.stringContaining('Rate ledes'),
    }));
  });

  it('carries unresolved failures into the message on a forced hold', async () => {
    const run = { ...parked(), error: 'cut "verify" check failed and could not be repaired' };
    await parkAtHold(db, run, rollout, deps);
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('verify'),
    }));
  });

  it('does not notify twice for the same hold', async () => {
    const run = await parkAtHold(db, parked(), rollout, deps);
    await parkAtHold(db, loadRun(db, run.runId)!, rollout, deps);
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });
});

describe('liftHold', () => {
  it('marks the human cut done and resumes the run', async () => {
    const run = await parkAtHold(db, parked(), rollout, deps);
    const token = (db.prepare('SELECT resume_token FROM rollout_runs WHERE id=?')
      .get(run.runId) as { resume_token: string }).resume_token;

    const res = liftHold(db, token, T0);
    expect(res).toEqual({ ok: true, runId: run.runId });

    const after = loadRun(db, run.runId)!;
    expect(after.cuts.find((c) => c.cutId === 'hold')!.state).toBe('done');
    expect(after.state).toBe('running');
  });

  it('clears the token so it cannot be replayed', async () => {
    const run = await parkAtHold(db, parked(), rollout, deps);
    const token = (db.prepare('SELECT resume_token FROM rollout_runs WHERE id=?')
      .get(run.runId) as { resume_token: string }).resume_token;
    liftHold(db, token, T0);
    expect(liftHold(db, token, T0)).toEqual({ ok: false, reason: 'unknown or spent token' });
  });

  it('rejects an empty token', () => {
    expect(liftHold(db, '', T0)).toEqual({ ok: false, reason: 'unknown or spent token' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/rollout/holds.test.ts`
Expected: FAIL — `Failed to resolve import "./holds.js"`

- [ ] **Step 3: Write the implementation**

```ts
// ui/src/lib/rollout/holds.ts
/**
 * Holds: park a run for a human, notify, and lift on their action.
 *
 * This is the existing digest approval gate generalized from one hold to N.
 * The token pattern is approvals.ts verbatim and the notification goes through
 * the existing notify() dispatch, so a hold routes to ntfy and WhatsApp using
 * the settings grid already in place.
 */
import type Database from 'better-sqlite3';
import { generateApprovalToken } from '$lib/digest/approvals.js';
import type { AlertPayload } from '$lib/notifications/channels/types.js';
import { loadRun, saveRun } from './store.js';
import type { Rollout, RunState } from './types.js';

export type HoldDeps = {
  notify: (payload: AlertPayload) => Promise<unknown>;
  now: () => string;
  appBase: string;
};

function names(db: Database.Database, run: RunState): { league: string; round: string } {
  const l = db.prepare('SELECT name FROM leagues WHERE id=?').get(run.leagueId) as { name?: string } | undefined;
  const r = db.prepare('SELECT name FROM rounds WHERE id=?').get(run.roundId) as { name?: string } | undefined;
  return { league: l?.name ?? `League ${run.leagueId}`, round: r?.name ?? `Round ${run.roundId}` };
}

/** The human cut the run is parked on, if any. */
function holdCut(run: RunState, rollout: Rollout): string | null {
  const c = run.cuts.find((x) => x.ep === run.currentEp && x.runtime === null && x.state === 'pending');
  return c && rollout.cuts[c.cutId]?.kind === 'human' ? c.cutId : null;
}

/**
 * Mint a resume token, store the review url, and notify — once.
 *
 * Idempotent: a run that already has a resume_token is already announced, so a
 * second executor tick does not push a duplicate.
 */
export async function parkAtHold(
  db: Database.Database, run: RunState, rollout: Rollout, deps: HoldDeps,
): Promise<RunState> {
  const existing = db.prepare('SELECT resume_token FROM rollout_runs WHERE id=?')
    .get(run.runId) as { resume_token: string | null } | undefined;
  if (existing?.resume_token) return run;

  const cutId = holdCut(run, rollout);
  const def = cutId ? rollout.cuts[cutId] : undefined;
  const label = def && def.kind === 'human' ? def.label : 'Review required';
  const path = def && def.kind === 'human' ? def.reviewPath : `/digest/${run.roundId}`;
  const alertType = def && def.kind === 'human' ? def.alertType : 'digest_ready';

  const reviewUrl = `${deps.appBase}${path.replace('{roundId}', String(run.roundId))}`;
  const token = generateApprovalToken();
  const now = deps.now();

  saveRun(db, { ...run, state: 'parked' }, now);
  db.prepare('UPDATE rollout_runs SET resume_token=?, review_url=?, updated_at=? WHERE id=?')
    .run(token, reviewUrl, now, run.runId);

  const { league, round } = names(db, run);
  const message = run.error ? `${label} — unresolved: ${run.error}` : label;
  await deps.notify({
    alertType, title: `${league} — ${round}`, message, link: reviewUrl,
  } as AlertPayload);

  return { ...run, state: 'parked' };
}

/**
 * Lift a hold: mark the human cut done, resume the run, and SPEND the token so
 * a re-tapped notification cannot replay it.
 */
export function liftHold(
  db: Database.Database, token: string, nowIso: string,
): { ok: true; runId: string } | { ok: false; reason: string } {
  if (!token) return { ok: false, reason: 'unknown or spent token' };
  const row = db.prepare('SELECT id FROM rollout_runs WHERE resume_token=?').get(token) as
    { id: string } | undefined;
  if (!row) return { ok: false, reason: 'unknown or spent token' };

  const run = loadRun(db, row.id);
  if (!run) return { ok: false, reason: 'unknown or spent token' };

  const cuts = run.cuts.map((c) =>
    c.ep === run.currentEp && c.runtime === null && c.state === 'pending'
      ? { ...c, state: 'done' as const }
      : c);

  saveRun(db, { ...run, cuts, state: 'running', error: undefined }, nowIso);
  db.prepare('UPDATE rollout_runs SET resume_token=NULL, updated_at=? WHERE id=?').run(nowIso, row.id);
  return { ok: true, runId: row.id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/rollout/holds.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/rollout/holds.ts ui/src/lib/rollout/holds.test.ts
git commit -m "feat(rollout): holds — park, notify once, lift with a spent token

The approval gate generalized from one hold to N: approvals.ts token pattern
verbatim, notify() dispatch reused, and a forced hold carries its unresolved
failures into the push."
```

---

### Task 10: The app executor

**Files:**
- Create: `ui/src/lib/rollout/appExecutor.ts`
- Create: `ui/src/lib/rollout/appExecutor.test.ts`
- Modify: `ui/src/hooks.server.ts` (start it next to `startDigestRunner`)

**Interfaces:**
- Consumes: store (Task 8), engine (Tasks 5–6), holds (Task 9).
- Produces:
  - `type AppCutDeps = { capture; generate; send; archive: (roundId: number) => Promise<void> }`
  - `type AppExecutorDeps = AppCutDeps & { db; hold: HoldDeps; now: () => string }`
  - `promotePendingJobs(db, nowIso): number` — turn `pending` digest jobs into rollout runs for rollout-enabled leagues.
  - `tickApp(deps): Promise<'idle' | 'worked'>`
  - `startRolloutAppExecutor(): void`

**The promotion rule** (spec §7, corrected): the `api` container keeps enqueueing `digest_jobs` exactly as today. The app executor promotes a `pending` job into a rollout run **only** when its league has `enabled = 1`. Otherwise it leaves the row entirely alone for `runOneJob`. This is the degenerate-safety invariant in code.

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/rollout/appExecutor.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';
import { promotePendingJobs, tickApp } from './appExecutor.js';
import { putRolloutConfig, loadRunByRound } from './store.js';
import type { Rollout } from './types.js';

const T0 = '2026-08-26T00:00:00Z';
const rollout: Rollout = {
  order: ['capture', 'hold-approve', 'send'],
  cuts: {
    capture: { kind: 'script', runtime: 'app', label: 'Capture', command: ['capture'] },
    'hold-approve': { kind: 'human', label: 'Approve', reviewPath: '/digest/{roundId}', alertType: 'digest_ready' },
    send: { kind: 'script', runtime: 'app', label: 'Send', command: ['send'] },
  },
  skipAfter: { capture: true, 'hold-approve': true },
  covers: [],
};

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('sb', 'Second Best');
  db.prepare('INSERT INTO leagues (id, slug, name) VALUES (2, ?, ?)').run('bz', 'Boarz');
  db.prepare('INSERT INTO seasons (id, league_id, season_number) VALUES (1, 1, 1)').run();
  db.prepare('INSERT INTO seasons (id, league_id, season_number) VALUES (2, 2, 1)').run();
  db.prepare('INSERT INTO rounds (id, season_id, name) VALUES (9, 1, ?)').run('R9');
  db.prepare('INSERT INTO rounds (id, season_id, name) VALUES (10, 2, ?)').run('R10');
  const job = db.prepare(
    `INSERT INTO digest_jobs (round_id, league_id, status, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?)`);
  job.run(9, 1, T0, T0);
  job.run(10, 2, T0, T0);
});

describe('promotePendingJobs — degenerate safety', () => {
  it('promotes nothing when no league has a rollout enabled', () => {
    expect(promotePendingJobs(db, T0)).toBe(0);
    expect(loadRunByRound(db, 9)).toBeNull();
    const job = db.prepare('SELECT status FROM digest_jobs WHERE round_id=9').get() as { status: string };
    expect(job.status).toBe('pending'); // untouched, still runOneJob's
  });

  it('promotes only the rollout-enabled league', () => {
    putRolloutConfig(db, 1, rollout, true, T0);
    expect(promotePendingJobs(db, T0)).toBe(1);
    expect(loadRunByRound(db, 9)).not.toBeNull();
    expect(loadRunByRound(db, 10)).toBeNull();
  });

  it('leaves a config that exists but is disabled alone', () => {
    putRolloutConfig(db, 1, rollout, false, T0);
    expect(promotePendingJobs(db, T0)).toBe(0);
  });

  it('takes the promoted job out of runOneJob reach', () => {
    putRolloutConfig(db, 1, rollout, true, T0);
    promotePendingJobs(db, T0);
    const job = db.prepare('SELECT status FROM digest_jobs WHERE round_id=9').get() as { status: string };
    expect(job.status).toBe('rollout');
  });

  it('is idempotent — a second pass promotes nothing new', () => {
    putRolloutConfig(db, 1, rollout, true, T0);
    promotePendingJobs(db, T0);
    expect(promotePendingJobs(db, T0)).toBe(0);
  });
});

describe('tickApp', () => {
  function deps(over = {}) {
    return {
      db,
      capture: vi.fn().mockResolvedValue(undefined),
      generate: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
      archive: vi.fn().mockResolvedValue(undefined),
      hold: { notify: vi.fn().mockResolvedValue([]), now: () => T0, appBase: 'https://x' },
      now: () => T0,
      ...over,
    };
  }

  it('is idle when there is nothing to do', async () => {
    expect(await tickApp(deps())).toBe('idle');
  });

  it('runs an app cut and advances', async () => {
    putRolloutConfig(db, 1, rollout, true, T0);
    promotePendingJobs(db, T0);
    const d = deps();
    expect(await tickApp(d)).toBe('worked');
    expect(d.capture).toHaveBeenCalledWith(9);
    const run = loadRunByRound(db, 9)!;
    expect(run.cuts.find((c) => c.cutId === 'capture')!.state).toBe('done');
  });

  it('parks and notifies when it reaches a hold', async () => {
    putRolloutConfig(db, 1, rollout, true, T0);
    promotePendingJobs(db, T0);
    const d = deps();
    await tickApp(d);           // capture
    await tickApp(d);           // advance into the hold
    expect(loadRunByRound(db, 9)!.state).toBe('parked');
    expect(d.hold.notify).toHaveBeenCalled();
  });

  it('does not run cuts while parked', async () => {
    putRolloutConfig(db, 1, rollout, true, T0);
    promotePendingJobs(db, T0);
    const d = deps();
    await tickApp(d); await tickApp(d);
    await tickApp(d);
    expect(d.send).not.toHaveBeenCalled();
  });

  it('retries a throwing cut rather than failing the run', async () => {
    putRolloutConfig(db, 1, rollout, true, T0);
    promotePendingJobs(db, T0);
    const d = deps({ capture: vi.fn().mockRejectedValue(new Error('boom')) });
    await tickApp(d);
    const cut = loadRunByRound(db, 9)!.cuts.find((c) => c.cutId === 'capture')!;
    expect(cut.state).toBe('pending');
    expect(cut.attempts).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/rollout/appExecutor.test.ts`
Expected: FAIL — `Failed to resolve import "./appExecutor.js"`

- [ ] **Step 3: Write the implementation**

```ts
// ui/src/lib/rollout/appExecutor.ts
/**
 * The bot-ui half of the rollout. Runs `app` cuts — the ones that reuse the
 * live HTTP endpoints the digest runner already drives — and promotes pending
 * digest jobs into rollout runs for rollout-enabled leagues.
 *
 * DEGENERATE SAFETY: a league without an enabled rollout config is never
 * touched here. Its digest_jobs row stays `pending` and runOneJob handles it
 * exactly as before.
 */
import type Database from 'better-sqlite3';
import { getRolloutConfig, createRun, loadRun, saveRun, claimCut, reapStaleCuts, hasActiveRun } from './store.js';
import { advance, applyCutResult, claimable } from './engine.js';
import { parkAtHold, type HoldDeps } from './holds.js';
import type { Rollout, RunState } from './types.js';

/** Marker status parking a promoted job out of runOneJob's claim query. */
const PROMOTED = 'rollout';

export type AppCutDeps = {
  capture: (roundId: number) => Promise<void>;
  generate: (roundId: number) => Promise<void>;
  send: (roundId: number) => Promise<void>;
  archive: (roundId: number) => Promise<void>;
};

export type AppExecutorDeps = AppCutDeps & {
  db: Database.Database;
  hold: HoldDeps;
  now: () => string;
};

/**
 * Turn `pending` digest jobs into rollout runs, but only for leagues whose
 * rollout config is enabled. Returns how many were promoted.
 */
export function promotePendingJobs(db: Database.Database, nowIso: string): number {
  const rows = db.prepare(
    `SELECT round_id, league_id FROM digest_jobs WHERE status='pending' ORDER BY created_at`,
  ).all() as { round_id: number; league_id: number }[];

  let promoted = 0;
  for (const row of rows) {
    const cfg = getRolloutConfig(db, row.league_id);
    if (!cfg.enabled) continue;              // not ours — leave it for runOneJob
    if (hasActiveRun(db, row.league_id)) continue; // one active run per league
    createRun(db, row.league_id, row.round_id, cfg.rollout, nowIso);
    db.prepare('UPDATE digest_jobs SET status=?, updated_at=? WHERE round_id=?')
      .run(PROMOTED, nowIso, row.round_id);
    promoted++;
  }
  return promoted;
}

async function runAppCut(
  deps: AppExecutorDeps, rollout: Rollout, run: RunState, cutId: string,
): Promise<{ exitCode: number; error?: string }> {
  const def = rollout.cuts[cutId];
  if (def.kind !== 'script') return { exitCode: 1, error: `cut "${cutId}" is not a script cut` };
  const verb = def.command[0];
  const fn = { capture: deps.capture, generate: deps.generate, send: deps.send, archive: deps.archive }[verb];
  if (!fn) return { exitCode: 1, error: `unknown app command "${verb}"` };
  try {
    await fn(run.roundId);
    return { exitCode: 0 };
  } catch (e) {
    return { exitCode: 1, error: e instanceof Error ? e.message : String(e) };
  }
}

/** One pass: promote, reap, run at most one app cut, then advance/park. */
export async function tickApp(deps: AppExecutorDeps): Promise<'idle' | 'worked'> {
  const { db, now } = deps;
  const nowIso = now();

  promotePendingJobs(db, nowIso);
  reapStaleCuts(db, nowIso);

  const open = db.prepare(
    `SELECT id FROM rollout_runs WHERE state IN ('running','parked') ORDER BY started_at`,
  ).all() as { id: string }[];

  let worked = false;
  for (const { id } of open) {
    let run = loadRun(db, id);
    if (!run) continue;
    const rollout = JSON.parse(
      (db.prepare('SELECT definition_json FROM rollout_runs WHERE id=?').get(id) as { definition_json: string }).definition_json,
    ) as Rollout;

    if (run.state === 'parked') {
      await parkAtHold(db, run, rollout, deps.hold); // idempotent: notifies once
      continue;
    }

    const ready = claimable(run, rollout, 'app');
    for (const cutId of ready) {
      if (!claimCut(db, id, cutId, nowIso)) continue;
      const result = await runAppCut(deps, rollout, run, cutId);
      run = applyCutResult(loadRun(db, id)!, rollout, cutId, result);
      saveRun(db, run, nowIso);
      worked = true;
    }

    const advanced = advance(loadRun(db, id)!, rollout);
    saveRun(db, advanced, nowIso);
    if (advanced.state === 'parked') await parkAtHold(db, advanced, rollout, deps.hold);
  }
  return worked ? 'worked' : 'idle';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/rollout/appExecutor.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Wire the loop into startup**

Create the `startRolloutAppExecutor` export at the bottom of `appExecutor.ts`, mirroring `startDigestRunner`:

```ts
/**
 * Start the app-side rollout executor. Called once from hooks.server.ts,
 * next to startDigestRunner — the two coexist because a league is on exactly
 * one of the two paths.
 */
export function startRolloutAppExecutor(): void {
  const ms = Number(process.env.ROLLOUT_POLL_MS) || 60_000;
  console.log(`[rollout-app] starting (poll every ${ms}ms)`);
  const timer = setInterval(() => {
    void (async () => {
      const { getDb } = await import('$lib/db/client.js');
      const { notify } = await import('$lib/notifications/dispatch.js');
      const { captureRoundData } = await import('$lib/digest/capture.js');
      const base = process.env.BOT_UI_INTERNAL_URL ?? 'http://localhost:3002';
      const appBase = process.env.PUBLIC_APP_BASE_URL ?? 'https://mlb37.mattmariani.com';
      const post = async (roundId: number, path: string) => {
        const res = await fetch(`${base}/api/digest/${roundId}/${path}`, { method: 'POST' });
        if (!res.ok) throw new Error(`${path} ${res.status}`);
      };
      await tickApp({
        db: getDb(),
        capture: async (roundId) => { await captureRoundData(roundId); },
        generate: (roundId) => post(roundId, 'draft'),
        send: (roundId) => post(roundId, 'finalize'),
        archive: (roundId) => post(roundId, 'archive-refresh'),
        hold: {
          notify: (payload) => notify(getDb(), payload, { botControlUrl: process.env.BOT_CONTROL_URL ?? 'http://bot:3003' }),
          now: () => new Date().toISOString(),
          appBase,
        },
        now: () => new Date().toISOString(),
      });
    })().catch((e) => console.error('[rollout-app] tick threw', e));
  }, ms);
  timer.unref?.();
}
```

Then in `ui/src/hooks.server.ts`, add the import and call alongside the existing two:

```ts
import { startRolloutAppExecutor } from '$lib/rollout/appExecutor.js';
// ... next to startQueueWorker() and startDigestRunner():
startRolloutAppExecutor();
```

- [ ] **Step 6: Prove the whole suite is still green**

Run: `cd ui && npm test`
Expected: PASS. In particular `runner.test.ts` and `approvals.test.ts` must be untouched — no league has a rollout enabled, so nothing changed for them.

- [ ] **Step 7: Commit**

```bash
git add ui/src/lib/rollout/appExecutor.ts ui/src/lib/rollout/appExecutor.test.ts ui/src/hooks.server.ts
git commit -m "feat(rollout): app executor and job promotion

Promotes a pending digest job into a rollout run only when its league has an
enabled rollout config; every other league's row stays pending and untouched
for runOneJob. Degenerate safety proven by test."
```

---

### Task 11: The host executor

**Files:**
- Create: `scripts/rollout/__init__.py` (empty)
- Create: `scripts/rollout/host_executor.py`
- Create: `scripts/rollout/tests/__init__.py` (empty)
- Create: `scripts/rollout/tests/conftest.py`
- Create: `scripts/rollout/tests/test_host_executor.py`

**Interfaces:**
- Consumes: the three rollout tables (Task 3 + Task 8's `check_passed` column). It reads and writes them directly over SQLite, exactly as every other `scripts/digest-qa/*` tool does — no HTTP claim API.
- Produces:
  - `claimable_cuts(db, run_id, current_ep) -> list[dict]`
  - `claim(db, run_id, cut_id, now) -> bool`
  - `build_context(db, run_id, cut_id) -> dict`
  - `run_script_cut(cut, subs, cwd) -> dict` (`{exit_code, output_json, error}`)
  - `run_agent_cut(cut, context, subs) -> dict`
  - `tick(db, repo, now_fn) -> int` (number of cuts run)

**Why direct SQLite:** `verify_facts.py`, `participation.py`, and the punch-up scripts already open `data/league.db` on the host. Adding an HTTP claim API would be a second way to do the same thing; SQLite transactions give us the atomicity the claim needs.

**Open question resolved conservatively** (spec §12): agent cuts shell out to `claude -p`, matching `generate_ledes.py` and `generate_bridge.py`, which already prove that path in production. The Agent SDK stays a later swap behind `run_agent_cut`.

- [ ] **Step 1: Write the fixture**

```python
# scripts/rollout/tests/conftest.py
"""Fixture DB for the host executor.

Mirrors only the rollout tables plus the two lookup tables the executor reads.
Never opens data/league.db — that is production data.
"""
import os
import sqlite3
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SCHEMA = """
CREATE TABLE leagues (id INTEGER PRIMARY KEY, slug TEXT, name TEXT);
CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER);
CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER, name TEXT);
CREATE TABLE rollout_runs (
  id TEXT PRIMARY KEY, league_id INTEGER, round_id INTEGER, definition_json TEXT,
  state TEXT, current_ep INTEGER, resume_token TEXT, review_url TEXT, error TEXT,
  started_at TEXT, updated_at TEXT, finished_at TEXT);
CREATE TABLE rollout_cut_runs (
  run_id TEXT, cut_id TEXT, ep INTEGER, runtime TEXT, state TEXT,
  attempts INTEGER DEFAULT 0, remasters INTEGER DEFAULT 0, check_passed INTEGER,
  claimed_at TEXT, heartbeat_at TEXT, output_json TEXT, error TEXT,
  started_at TEXT, finished_at TEXT, PRIMARY KEY (run_id, cut_id));
"""

ROLLOUT = {
    "order": ["a", "b", "agent"],
    "cuts": {
        "a": {"kind": "script", "runtime": "host", "label": "A",
              "command": ["echo", "{roundId}"], "check": {"rule": "exit-zero"}},
        "b": {"kind": "script", "runtime": "host", "label": "B", "command": ["true"]},
        "agent": {"kind": "agent", "runtime": "host", "label": "Agent", "job": "punchup"},
    },
    "skipAfter": {"b": True},
    "covers": [],
}


@pytest.fixture
def db():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.execute("INSERT INTO leagues (id, slug, name) VALUES (1, 'sb', 'Second Best')")
    conn.execute("INSERT INTO seasons (id, league_id, season_number) VALUES (1, 1, 1)")
    conn.execute("INSERT INTO rounds (id, season_id, name) VALUES (9, 1, 'R9')")
    conn.commit()
    return conn


@pytest.fixture
def run(db):
    import json
    db.execute(
        "INSERT INTO rollout_runs (id, league_id, round_id, definition_json, state,"
        " current_ep, started_at, updated_at) VALUES ('r1', 1, 9, ?, 'running', 0, 't', 't')",
        (json.dumps(ROLLOUT),))
    for cut_id, ep in [("a", 0), ("b", 0), ("agent", 1)]:
        db.execute(
            "INSERT INTO rollout_cut_runs (run_id, cut_id, ep, runtime, state)"
            " VALUES ('r1', ?, ?, 'host', 'pending')", (cut_id, ep))
    db.commit()
    return "r1"
```

- [ ] **Step 2: Write the failing test**

```python
# scripts/rollout/tests/test_host_executor.py
import json

import host_executor as hx


def test_claimable_returns_pending_host_cuts_in_current_ep(db, run):
    ids = [c["cut_id"] for c in hx.claimable_cuts(db, run, 0)]
    assert ids == ["a", "b"]


def test_claimable_excludes_other_eps(db, run):
    assert [c["cut_id"] for c in hx.claimable_cuts(db, run, 1)] == ["agent"]


def test_claim_succeeds_once(db, run):
    assert hx.claim(db, run, "a", "t1") is True
    assert hx.claim(db, run, "a", "t1") is False


def test_claim_sets_running_and_lease(db, run):
    hx.claim(db, run, "a", "t1")
    row = db.execute(
        "SELECT state, claimed_at, heartbeat_at FROM rollout_cut_runs"
        " WHERE run_id=? AND cut_id='a'", (run,)).fetchone()
    assert row["state"] == "running"
    assert row["claimed_at"] == "t1"
    assert row["heartbeat_at"] == "t1"


def test_build_context_includes_only_earlier_eps(db, run):
    db.execute("UPDATE rollout_cut_runs SET state='done', output_json='{\"x\":1}'"
               " WHERE run_id=? AND cut_id='a'", (run,))
    db.execute("UPDATE rollout_cut_runs SET state='done', output_json='{\"y\":2}'"
               " WHERE run_id=? AND cut_id='b'", (run,))
    db.commit()
    ctx = hx.build_context(db, run, "agent")
    assert [u["cut_id"] for u in ctx["upstream"]] == ["a", "b"]


def test_build_context_excludes_same_ep_siblings(db, run):
    db.execute("UPDATE rollout_cut_runs SET state='done', output_json='{\"x\":1}'"
               " WHERE run_id=? AND cut_id='a'", (run,))
    db.commit()
    assert hx.build_context(db, run, "b")["upstream"] == []


def test_run_script_cut_substitutes_placeholders():
    cut = {"kind": "script", "command": ["echo", "{roundId}"]}
    res = hx.run_script_cut(cut, {"roundId": "9", "leagueSlug": "sb"}, cwd=".")
    assert res["exit_code"] == 0
    assert "9" in (res["output_json"] or res["stdout"])


def test_run_script_cut_reports_nonzero_exit():
    res = hx.run_script_cut({"kind": "script", "command": ["false"]}, {}, cwd=".")
    assert res["exit_code"] != 0


def test_run_script_cut_captures_json_stdout():
    payload = json.dumps({"checks": [{"severity": "warn"}]})
    cut = {"kind": "script", "command": ["python3", "-c", f"print({payload!r})"]}
    res = hx.run_script_cut(cut, {}, cwd=".")
    assert json.loads(res["output_json"])["checks"][0]["severity"] == "warn"


def test_run_script_cut_treats_a_missing_binary_as_transient(db):
    res = hx.run_script_cut({"kind": "script", "command": ["definitely-not-a-binary"]}, {}, cwd=".")
    assert res["error"]  # transient -> spends an attempt, not a remaster


def test_tick_runs_a_claimable_cut_and_records_output(db, run, monkeypatch):
    monkeypatch.setattr(hx, "run_script_cut",
                        lambda cut, subs, cwd: {"exit_code": 0, "output_json": '{"ok":1}', "error": None})
    assert hx.tick(db, repo=".", now_fn=lambda: "t1") == 2  # both EP0 cuts
    row = db.execute("SELECT state, output_json FROM rollout_cut_runs"
                     " WHERE run_id=? AND cut_id='a'", (run,)).fetchone()
    assert row["state"] == "done"
    assert row["output_json"] == '{"ok":1}'


def test_tick_ignores_a_parked_run(db, run, monkeypatch):
    db.execute("UPDATE rollout_runs SET state='parked' WHERE id=?", (run,))
    db.commit()
    monkeypatch.setattr(hx, "run_script_cut", lambda *a, **k: {"exit_code": 0, "output_json": None, "error": None})
    assert hx.tick(db, repo=".", now_fn=lambda: "t1") == 0


def test_tick_does_not_advance_the_ep(db, run, monkeypatch):
    """EP advance is the app executor's job; the host only completes cuts."""
    monkeypatch.setattr(hx, "run_script_cut", lambda *a, **k: {"exit_code": 0, "output_json": None, "error": None})
    hx.tick(db, repo=".", now_fn=lambda: "t1")
    assert db.execute("SELECT current_ep FROM rollout_runs WHERE id=?", (run,)).fetchone()["current_ep"] == 0
```

- [ ] **Step 3: Run test to verify it fails**

Run: `python3 -m pytest scripts/rollout/tests -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'host_executor'`

- [ ] **Step 4: Write the implementation**

```python
#!/usr/bin/env python3
"""Host-side rollout executor.

The containers have neither python3 nor the claude CLI, so every script and
agent cut runs here. This poller is the generic replacement for
hil_autorun.py's hardcoded "find rounds, run generate_ledes, notify".

It talks to data/league.db directly, exactly as every scripts/digest-qa tool
does. SQLite transactions give the claim its atomicity; no HTTP API needed.

Division of labour: the host executor ONLY completes cuts. Advancing the EP,
parking at holds, and firing notifications belong to the app executor, which
already has the notification dispatch wired.

Usage: python3 scripts/rollout/host_executor.py [--db data/league.db]
           [--once] [--interval 60]
"""
import argparse
import json
import os
import shlex
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))

CLAUDE_TIMEOUT = 900   # agent cuts are slow; 15 minutes before we call it hung
SCRIPT_TIMEOUT = 600


def load_env(path):
    """Minimal .env reader — the systemd unit has no shell to source it."""
    if not os.path.exists(path):
        return
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ----------------------------------------------------------------- claiming

def claimable_cuts(db, run_id, current_ep):
    """Pending host cuts in the run's current EP."""
    rows = db.execute(
        "SELECT cut_id, ep FROM rollout_cut_runs"
        "  WHERE run_id=? AND ep=? AND state='pending' AND runtime='host'"
        "  ORDER BY cut_id", (run_id, current_ep)).fetchall()
    return [dict(r) for r in rows]


def claim(db, run_id, cut_id, now):
    """Atomic claim. False means another executor got there first."""
    cur = db.execute(
        "UPDATE rollout_cut_runs"
        "   SET state='running', claimed_at=?, heartbeat_at=?,"
        "       started_at=COALESCE(started_at, ?)"
        " WHERE run_id=? AND cut_id=? AND state='pending'",
        (now, now, now, run_id, cut_id))
    db.commit()
    return cur.rowcount == 1


def heartbeat(db, run_id, cut_id, now):
    db.execute("UPDATE rollout_cut_runs SET heartbeat_at=?"
               " WHERE run_id=? AND cut_id=? AND state='running'", (now, run_id, cut_id))
    db.commit()


# ------------------------------------------------------------------ context

def build_context(db, run_id, cut_id):
    """The dossier slice: every cut in a STRICTLY earlier EP, never a sibling.

    Mirrors contextFor in ui/src/lib/rollout/context.ts. The two must agree —
    context visibility is declared by position, and a host cut and an app cut
    at the same position must see the same thing.
    """
    self_row = db.execute("SELECT ep FROM rollout_cut_runs WHERE run_id=? AND cut_id=?",
                          (run_id, cut_id)).fetchone()
    if self_row is None:
        raise KeyError(f'unknown cut "{cut_id}" in run {run_id}')
    rows = db.execute(
        "SELECT cut_id, ep, output_json FROM rollout_cut_runs"
        "  WHERE run_id=? AND ep < ? AND output_json IS NOT NULL"
        "  ORDER BY ep, cut_id", (run_id, self_row["ep"])).fetchall()
    return {
        "cut_id": cut_id,
        "ep": self_row["ep"],
        "upstream": [
            {"cut_id": r["cut_id"], "ep": r["ep"], "output_json": r["output_json"]}
            for r in rows
        ],
    }


# ------------------------------------------------------------------- cuts

def _substitute(argv, subs):
    out = []
    for arg in argv:
        for key, val in subs.items():
            arg = arg.replace("{" + key + "}", str(val))
        out.append(arg)
    return out


def run_script_cut(cut, subs, cwd):
    """Run a script cut. A missing binary or a timeout is TRANSIENT (`error`);
    a non-zero exit from a program that ran is a result, not an error."""
    argv = _substitute(cut["command"], subs)
    try:
        proc = subprocess.run(argv, cwd=cwd, capture_output=True, text=True,
                              timeout=SCRIPT_TIMEOUT)
    except FileNotFoundError as e:
        return {"exit_code": 127, "output_json": None, "stdout": "", "error": f"{argv[0]}: {e}"}
    except subprocess.TimeoutExpired:
        return {"exit_code": 124, "output_json": None, "stdout": "",
                "error": f"timed out after {SCRIPT_TIMEOUT}s: {shlex.join(argv)}"}

    stdout = proc.stdout or ""
    output_json = None
    try:
        json.loads(stdout)
        output_json = stdout
    except (ValueError, TypeError):
        # Not JSON — keep the tail as a plain record so the run page shows it.
        output_json = json.dumps({"stdout": stdout[-4000:], "stderr": (proc.stderr or "")[-2000:]})
    return {"exit_code": proc.returncode, "output_json": output_json,
            "stdout": stdout, "error": None}


def run_agent_cut(cut, context, subs):
    """Hand headless Claude a job with its dossier slice.

    `claude -p` rather than the Agent SDK: generate_ledes.py and
    generate_bridge.py already prove this path in production. Swapping in the
    SDK later is a change to this function only.
    """
    prompt = json.dumps({
        "job": cut["job"],
        "label": cut.get("label"),
        "round_id": subs.get("roundId"),
        "league_slug": subs.get("leagueSlug"),
        "context": context,
        "instructions": (
            "You are one cut in a digest rollout. Do only this job. "
            "Reply with strict JSON: {\"ok\": bool, \"summary\": str, \"details\": object}."
        ),
    }, indent=2)
    argv = ["claude", "-p"]
    if cut.get("model"):
        argv += ["--model", cut["model"]]
    try:
        proc = subprocess.run(argv, input=prompt, capture_output=True, text=True,
                              timeout=CLAUDE_TIMEOUT)
    except FileNotFoundError as e:
        return {"exit_code": 127, "output_json": None, "error": f"claude: {e}"}
    except subprocess.TimeoutExpired:
        return {"exit_code": 124, "output_json": None,
                "error": f"claude -p timed out after {CLAUDE_TIMEOUT}s"}
    if proc.returncode != 0:
        return {"exit_code": proc.returncode, "output_json": None,
                "error": (proc.stderr or "claude -p failed")[-2000:]}
    return {"exit_code": 0,
            "output_json": json.dumps({"raw": (proc.stdout or "")[-8000:]}),
            "error": None}


# -------------------------------------------------------------------- tick

def _finish(db, run_id, cut_id, res, now):
    """Write a finished cut. State transitions (retry / remaster / park) are the
    app executor's engine — the host records `done` or `failed` plus output and
    lets the engine decide on its next pass."""
    state = "done" if res["exit_code"] == 0 and not res.get("error") else "failed"
    db.execute(
        "UPDATE rollout_cut_runs SET state=?, output_json=?, error=?, finished_at=?"
        " WHERE run_id=? AND cut_id=?",
        (state, res.get("output_json"), res.get("error"), now, run_id, cut_id))
    db.commit()


def tick(db, repo, now_fn=now_iso):
    """One pass. Returns the number of cuts run."""
    runs = db.execute(
        "SELECT id, round_id, current_ep, definition_json FROM rollout_runs"
        "  WHERE state='running' ORDER BY started_at").fetchall()
    ran = 0
    for run in runs:
        rollout = json.loads(run["definition_json"])
        slug_row = db.execute(
            "SELECT l.slug FROM rollout_runs rr JOIN leagues l ON l.id=rr.league_id"
            " WHERE rr.id=?", (run["id"],)).fetchone()
        subs = {"roundId": run["round_id"], "leagueSlug": slug_row["slug"] if slug_row else ""}

        for row in claimable_cuts(db, run["id"], run["current_ep"]):
            cut_id = row["cut_id"]
            now = now_fn()
            if not claim(db, run["id"], cut_id, now):
                continue
            cut = rollout["cuts"][cut_id]
            if cut["kind"] == "agent":
                res = run_agent_cut(cut, build_context(db, run["id"], cut_id), subs)
            else:
                res = run_script_cut(cut, subs, cwd=repo)
            _finish(db, run["id"], cut_id, res, now_fn())
            ran += 1
    return ran


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.path.join(REPO, "data/league.db"))
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--interval", type=int, default=60)
    args = ap.parse_args()

    load_env(os.path.join(REPO, ".env"))
    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row

    if args.once:
        n = tick(db, REPO)
        print(f"host_executor: ran {n} cut(s)")
        return 0

    import time
    while True:
        try:
            n = tick(db, REPO)
            if n:
                print(f"host_executor: ran {n} cut(s)")
        except Exception as e:  # a bad run must not kill the poller
            print(f"host_executor: tick error: {e}", file=sys.stderr)
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main() or 0)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /home/loydmilligan/Projects/music-league-bot && python3 -m pytest scripts/rollout/tests -q`
Expected: PASS (13 tests)

- [ ] **Step 6: Confirm the existing Python suite is untouched**

Run: `python3 -m pytest scripts/digest-qa/tests -q`
Expected: PASS (58 tests, as before)

- [ ] **Step 7: Commit**

```bash
git add scripts/rollout/
git commit -m "feat(rollout): host executor for script and agent cuts

Direct SQLite like every other digest-qa tool. The host only completes cuts;
EP advance, parking, and notification stay with the app executor. Agent cuts
shell to claude -p, matching generate_ledes and generate_bridge."
```

---

**Phase 3 checkpoint.** Stop and report. At this point a rollout can actually run end to end for a league that is switched on, and **no league is switched on**. Verify before continuing: `cd ui && npm test` green, `python3 -m pytest scripts -q` green, and `sqlite3 data/league.db "SELECT COUNT(*) FROM rollout_configs"` returns 0.

## Phase 4 — Surfaces

### Task 12: API routes

**Files:**
- Create: `ui/src/routes/api/rollout/config/+server.ts`
- Create: `ui/src/routes/api/rollout/config/server.test.ts`
- Create: `ui/src/routes/api/rollout/runs/+server.ts`
- Create: `ui/src/routes/api/rollout/resume/+server.ts`

**Interfaces:**
- Consumes: `getRolloutConfig`, `putRolloutConfig`, `loadRun`, `loadRunByRound` (Task 8); `liftHold` (Task 9); `isValidRollout` (Task 2).
- Produces the HTTP contract the UI in Tasks 13–14 consumes:
  - `GET /api/rollout/config?leagueId=N` → `{ rollout, enabled }` — never 404, never null.
  - `PUT /api/rollout/config?leagueId=N` body `{ rollout, enabled }` → `{ rollout, enabled }`; 400 on structurally invalid input.
  - `GET /api/rollout/runs?leagueId=N` → `{ runs: RunSummary[] }`; `?runId=X` → `{ run: RunState }`.
  - `POST /api/rollout/resume` body `{ token }` → `{ ok }`.

Follow the existing `pipeline-config` endpoint's contract exactly: GET always returns a valid object, falling back to the default rather than erroring.

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/routes/api/rollout/config/server.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';
import { DEFAULT_ROLLOUT } from '$lib/rollout/defaults.js';

let db: Database.Database;
vi.mock('$lib/db/client.js', () => ({ getDb: () => db }));

const { GET, PUT } = await import('./+server.js');
const url = (qs: string) => new URL(`http://x/api/rollout/config${qs}`);

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('sb', 'Second Best');
});

describe('GET', () => {
  it('returns the default rollout, disabled, when nothing is stored', async () => {
    const body = await (await GET({ url: url('?leagueId=1') } as never)).json();
    expect(body.enabled).toBe(false);
    expect(body.rollout.order).toEqual(DEFAULT_ROLLOUT.order);
  });

  it('400s without a leagueId', async () => {
    await expect(GET({ url: url('') } as never)).rejects.toMatchObject({ status: 400 });
  });
});

describe('PUT', () => {
  const req = (body: unknown) => ({ json: async () => body }) as Request;

  it('stores and echoes a valid rollout', async () => {
    const res = await PUT({ url: url('?leagueId=1'), request: req({ rollout: DEFAULT_ROLLOUT, enabled: true }) } as never);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    const back = await (await GET({ url: url('?leagueId=1') } as never)).json();
    expect(back.enabled).toBe(true);
  });

  it('400s on a structurally invalid rollout', async () => {
    await expect(
      PUT({ url: url('?leagueId=1'), request: req({ rollout: { order: [] }, enabled: true }) } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('defaults enabled to false when omitted', async () => {
    await PUT({ url: url('?leagueId=1'), request: req({ rollout: DEFAULT_ROLLOUT }) } as never);
    const back = await (await GET({ url: url('?leagueId=1') } as never)).json();
    expect(back.enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/routes/api/rollout/config/server.test.ts`
Expected: FAIL — cannot resolve `./+server.js`

- [ ] **Step 3: Write the config route**

```ts
// ui/src/routes/api/rollout/config/+server.ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getRolloutConfig, putRolloutConfig } from '$lib/rollout/store.js';
import { isValidRollout } from '$lib/rollout/validate.js';

function leagueId(url: URL): number {
  const raw = url.searchParams.get('leagueId');
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n <= 0) throw error(400, 'leagueId is required');
  return n;
}

// GET /api/rollout/config?leagueId=N → { rollout, enabled }
// Never 404s and never returns null: an unset or malformed config degrades to
// the default, DISABLED — same contract as /api/settings/pipeline-config.
export const GET: RequestHandler = ({ url }) => json(getRolloutConfig(getDb(), leagueId(url)));

// PUT /api/rollout/config?leagueId=N  body { rollout, enabled? }
export const PUT: RequestHandler = async ({ url, request }) => {
  const id = leagueId(url);
  const body = (await request.json()) as { rollout?: unknown; enabled?: unknown };
  if (!isValidRollout(body.rollout)) throw error(400, 'invalid rollout definition');
  const enabled = body.enabled === true;
  putRolloutConfig(getDb(), id, body.rollout, enabled, new Date().toISOString());
  return json(getRolloutConfig(getDb(), id));
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/routes/api/rollout/config/server.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the runs and resume routes**

```ts
// ui/src/routes/api/rollout/runs/+server.ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { loadRun } from '$lib/rollout/store.js';

export type RunSummary = {
  runId: string; roundId: number; roundName: string;
  state: string; currentEp: number; startedAt: string; updatedAt: string; error: string | null;
};

// GET /api/rollout/runs?runId=X   → { run }   (full RunState, for the detail view)
// GET /api/rollout/runs?leagueId=N → { runs } (summaries, newest first)
export const GET: RequestHandler = ({ url }) => {
  const db = getDb();
  const runId = url.searchParams.get('runId');
  if (runId) {
    const run = loadRun(db, runId);
    if (!run) throw error(404, 'unknown run');
    return json({ run });
  }
  const leagueId = Number(url.searchParams.get('leagueId'));
  if (!Number.isInteger(leagueId) || leagueId <= 0) throw error(400, 'leagueId or runId is required');
  const runs = db.prepare(
    `SELECT rr.id AS runId, rr.round_id AS roundId, r.name AS roundName, rr.state,
            rr.current_ep AS currentEp, rr.started_at AS startedAt,
            rr.updated_at AS updatedAt, rr.error
       FROM rollout_runs rr JOIN rounds r ON r.id = rr.round_id
      WHERE rr.league_id = ? ORDER BY rr.started_at DESC LIMIT 50`,
  ).all(leagueId) as RunSummary[];
  return json({ runs });
};
```

```ts
// ui/src/routes/api/rollout/resume/+server.ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { liftHold } from '$lib/rollout/holds.js';

// POST /api/rollout/resume  body { token } → { ok, runId }
// The token is single-use: liftHold clears it, so a re-tapped ntfy notification
// cannot replay a hold that has already been lifted.
export const POST: RequestHandler = async ({ request }) => {
  const { token } = (await request.json()) as { token?: string };
  const res = liftHold(getDb(), token ?? '', new Date().toISOString());
  if (!res.ok) throw error(404, res.reason);
  return json(res);
};
```

- [ ] **Step 6: Typecheck and run the suite**

Run: `cd ui && npm run check && npm test`
Expected: no new type errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add ui/src/routes/api/rollout/
git commit -m "feat(rollout): config, runs, and resume endpoints

GET config follows the pipeline-config contract: never 404, never null, always
a valid object falling back to the default disabled. Resume tokens are
single-use so a re-tapped notification cannot replay a lifted hold."
```

---

### Task 13: The Rollouts tab — Definition editor

**Files:**
- Create: `ui/src/lib/rollout/RolloutTab.svelte`
- Modify: `ui/src/lib/models/ModelsScreen.svelte` (add the third tab)

**Interfaces:**
- Consumes: `GET/PUT /api/rollout/config` (Task 12); `resolveRollout` (Task 4) for the preview.
- Produces: no exports — a component mounted by `ModelsScreen`.

**What this changes structurally** (spec §9): `/settings/models` gains a third tab, so Pipelines stops being the top of the hierarchy and becomes the layer a Rollout composes. Match the existing pipeline editor's markup and CSS class conventions (`mlm-*`) rather than inventing a new visual language.

- [ ] **Step 1: Build the component**

```svelte
<!-- ui/src/lib/rollout/RolloutTab.svelte -->
<script lang="ts">
  /**
   * The Rollouts tab: per-league "what happens when a round ends".
   *
   * Deliberately mirrors the pipeline editor (reorder / skip toggle / cover
   * with a model) so the two levels feel like one system. The rollout addition
   * is the REMASTER checkbox on a cover: fires only when the cut's check fails.
   */
  import { resolveRollout } from './solve.js';
  import type { Rollout, RolloutCover } from './types.js';

  let { leagues }: { leagues: { id: number; name: string }[] } = $props();

  let leagueId = $state(leagues[0]?.id ?? 0);
  let rollout = $state<Rollout | null>(null);
  let enabled = $state(false);
  let mode = $state<'edit' | 'preview'>('edit');
  let saving = $state(false);
  let saved = $state(false);

  const eps = $derived(rollout ? resolveRollout(rollout) : []);
  const holdCount = $derived(
    rollout ? rollout.order.filter((id) => rollout!.cuts[id]?.kind === 'human').length : 0,
  );

  async function load() {
    const r = await fetch(`/api/rollout/config?leagueId=${leagueId}`);
    if (!r.ok) return;
    const d = await r.json();
    rollout = d.rollout; enabled = d.enabled;
  }
  $effect(() => { if (leagueId) void load(); });

  async function save() {
    if (!rollout) return;
    saving = true; saved = false;
    try {
      const r = await fetch(`/api/rollout/config?leagueId=${leagueId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rollout, enabled }),
      });
      if (r.ok) { const d = await r.json(); rollout = d.rollout; enabled = d.enabled; saved = true; setTimeout(() => (saved = false), 2000); }
    } finally { saving = false; }
  }

  function move(idx: number, dir: -1 | 1) {
    if (!rollout) return;
    const order = [...rollout.order];
    const j = idx + dir;
    if (j < 0 || j >= order.length) return;
    [order[idx], order[j]] = [order[j], order[idx]];
    rollout = { ...rollout, order };
  }

  function toggleSkip(id: string) {
    if (!rollout) return;
    const skipAfter = { ...(rollout.skipAfter as Record<string, true>) };
    if (skipAfter[id]) delete skipAfter[id]; else skipAfter[id] = true;
    rollout = { ...rollout, skipAfter };
  }

  function toggleDisabled(id: string) {
    if (!rollout) return;
    const off = new Set(rollout.disabled ?? []);
    if (off.has(id)) off.delete(id); else off.add(id);
    rollout = { ...rollout, disabled: [...off] };
  }

  const coverOf = (id: string): RolloutCover | undefined => rollout?.covers.find((c) => c.of === id);

  function toggleCover(id: string) {
    if (!rollout) return;
    rollout = coverOf(id)
      ? { ...rollout, covers: rollout.covers.filter((c) => c.of !== id) }
      : { ...rollout, covers: [...rollout.covers, { of: id }] };
  }

  function toggleRemaster(id: string) {
    if (!rollout) return;
    rollout = {
      ...rollout,
      covers: rollout.covers.map((c) =>
        c.of === id ? (c.remaster ? { of: c.of, model: c.model } : { ...c, remaster: true as const, budget: c.budget ?? 1 }) : c),
    };
  }
</script>

<div class="mlm-card">
  <header style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
    <label>League
      <select bind:value={leagueId}>
        {#each leagues as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
      </select>
    </label>
    <label title="While off, this league keeps the existing digest_jobs path.">
      <input type="checkbox" bind:checked={enabled} /> Rollout enabled
    </label>
    <span style="color:var(--fg-quiet);">{eps.length} EPs · {holdCount} holds</span>
    <button class="mash-btn" onclick={() => (mode = 'edit')} disabled={mode === 'edit'}>Edit</button>
    <button class="mash-btn" onclick={() => (mode = 'preview')} disabled={mode === 'preview'}>Preview</button>
    <button class="mash-btn mash-btn--primary" onclick={save} disabled={saving}>
      {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
    </button>
  </header>

  {#if !rollout}
    <p style="color:var(--fg-quiet);">Loading…</p>
  {:else if mode === 'edit'}
    <ol class="mlm-cutlist">
      {#each rollout.order as id, idx (id)}
        {@const cut = rollout.cuts[id]}
        {@const off = (rollout.disabled ?? []).includes(id)}
        {@const cover = coverOf(id)}
        <li class:mlm-cut--off={off}>
          <span class="mlm-cut-kind">{cut.kind}</span>
          <strong>{cut.label}</strong>
          <code>{id}</code>
          {#if cut.kind !== 'human'}<span class="mlm-cut-rt">{cut.runtime}</span>{/if}
          {#if 'check' in cut && cut.check}<span title="This cut has a check">✓</span>{/if}

          <button class="mash-btn" onclick={() => move(idx, -1)} aria-label="Move up">↑</button>
          <button class="mash-btn" onclick={() => move(idx, 1)} aria-label="Move down">↓</button>
          <label><input type="checkbox" checked={!off} onchange={() => toggleDisabled(id)} /> on</label>
          <label><input type="checkbox" checked={!!rollout.skipAfter[id]} onchange={() => toggleSkip(id)} /> skip after</label>
          <label><input type="checkbox" checked={!!cover} onchange={() => toggleCover(id)} /> cover</label>
          {#if cover}
            <label title="Fires only when this cut's check fails — this is how repair is expressed.">
              <input type="checkbox" checked={!!cover.remaster} onchange={() => toggleRemaster(id)} /> remaster
            </label>
          {/if}
        </li>
      {/each}
    </ol>
  {:else}
    {#each eps as ep, i (i)}
      <div class="mlm-ep">
        <h4>EP{i}</h4>
        <ul>{#each ep.cuts as id (id)}<li>{rollout.cuts[id].label}</li>{/each}</ul>
        {#each ep.covers as c (c.of)}
          <p class="mlm-cover">{c.remaster ? 'remaster' : 'cover'} of {rollout.cuts[c.of]?.label ?? c.of}</p>
        {/each}
      </div>
    {/each}
  {/if}
</div>
```

- [ ] **Step 2: Add the third tab to `ModelsScreen.svelte`**

Import the component near the existing imports:

```ts
  import RolloutTab from '../rollout/RolloutTab.svelte';
```

Widen the tab state (line ~116) from two values to three:

```ts
  let activeTab = $state<'models' | 'pipeline' | 'rollouts'>('models');
```

Add the tab button next to the existing two, and the panel:

```svelte
  <button class="mash-btn" onclick={() => (activeTab = 'rollouts')} disabled={activeTab === 'rollouts'}>Rollouts</button>
  ...
  {#if activeTab === 'rollouts'}
    <RolloutTab leagues={leagues} />
  {/if}
```

`leagues` must be available to `ModelsScreen`. If it is not already a prop, load it in `ui/src/routes/settings/+page.server.ts` with
`db.prepare('SELECT id, name FROM leagues ORDER BY name').all()` and pass it down.

- [ ] **Step 3: Verify with a production build, not `npm run dev`**

The digest page hydration crashes under `npm run dev` (`node:crypto` via `llm.ts`), so dev-server verification is unreliable here:

```bash
cd ui && npm run build && npm run preview
```

Open `/settings/models`, select the Rollouts tab, confirm: the league picker lists leagues, the cut list renders in order, reorder/skip/cover/remaster toggles mutate the preview, Save round-trips, and **"Rollout enabled" is unchecked for every league**.

- [ ] **Step 4: Run the suite and typecheck**

Run: `cd ui && npm run check && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/rollout/RolloutTab.svelte ui/src/lib/models/ModelsScreen.svelte ui/src/routes/settings/+page.server.ts
git commit -m "feat(rollout): Rollouts tab with the definition editor

Third tab on /settings/models: Pipelines stops being the top of the hierarchy
and becomes the layer a Rollout composes. Cover gains the remaster checkbox —
fires only when the cut's check fails."
```

---

### Task 14: The Runs view and the digest-page strip

**Files:**
- Create: `ui/src/lib/rollout/RunsView.svelte`
- Create: `ui/src/lib/rollout/runView.ts`
- Create: `ui/src/lib/rollout/runView.test.ts`
- Modify: `ui/src/lib/rollout/RolloutTab.svelte` (Definition / Runs sub-tabs)
- Modify: `ui/src/routes/digest/[roundId]/+page.server.ts` and `+page.svelte` (run-state strip)

**Interfaces:**
- Consumes: `GET /api/rollout/runs`, `POST /api/rollout/resume` (Task 12); `RunState`, `Rollout` (Task 2).
- Produces: `summarizeRun(run: RunState, rollout: Rollout): RunSummaryView` — the presentation logic, extracted so it can be tested without a browser.

**Why extract `runView.ts`:** this is the surface that replaces reading four terminal outputs, so the interesting part is the labelling — which checks failed, whether a remaster fixed them. That reasoning is testable as a pure function; only the markup needs a browser.

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/rollout/runView.test.ts
import { describe, it, expect } from 'vitest';
import { summarizeRun } from './runView.js';
import type { Rollout, RunState, CutRunState } from './types.js';

const rollout: Rollout = {
  order: ['verify', 'punchup', 'hold'],
  cuts: {
    verify: { kind: 'script', runtime: 'host', label: 'Verify facts', command: ['v'], check: { rule: 'no-fail-checks' } },
    punchup: { kind: 'agent', runtime: 'host', label: 'Punch-up', job: 'punchup' },
    hold: { kind: 'human', label: 'Approve', reviewPath: '/d', alertType: 'digest_ready' },
  },
  skipAfter: { verify: true, punchup: true },
  covers: [{ of: 'verify', remaster: true, budget: 1 }],
};

const c = (over: Partial<CutRunState> & { cutId: string; ep: number }): CutRunState => ({
  runtime: 'host', state: 'pending', attempts: 0, remasters: 0, ...over,
});

const run = (over: Partial<RunState> = {}, cuts: CutRunState[] = []): RunState => ({
  runId: 'r1', leagueId: 1, roundId: 9, currentEp: 0, state: 'running', cuts, ...over,
});

describe('summarizeRun', () => {
  it('labels a cut that passed its check', () => {
    const v = summarizeRun(run({}, [c({ cutId: 'verify', ep: 0, state: 'done', checkPassed: true })]), rollout);
    expect(v.cuts[0].status).toBe('passed');
  });

  it('labels a cut repaired by a remaster', () => {
    const v = summarizeRun(run({}, [c({ cutId: 'verify', ep: 0, state: 'done', checkPassed: true, remasters: 1 })]), rollout);
    expect(v.cuts[0].status).toBe('repaired');
    expect(v.cuts[0].note).toContain('remaster');
  });

  it('labels a cut whose check failed unrepairably', () => {
    const v = summarizeRun(run({}, [c({ cutId: 'verify', ep: 0, state: 'failed', checkPassed: false, remasters: 1 })]), rollout);
    expect(v.cuts[0].status).toBe('failed-check');
  });

  it('distinguishes a transient failure from a failed check', () => {
    const v = summarizeRun(run({}, [c({ cutId: 'verify', ep: 0, state: 'failed', attempts: 3 })]), rollout);
    expect(v.cuts[0].status).toBe('failed-transient');
  });

  it('reports the run as resumable only when parked', () => {
    expect(summarizeRun(run({ state: 'parked' }), rollout).resumable).toBe(true);
    expect(summarizeRun(run({ state: 'running' }), rollout).resumable).toBe(false);
    expect(summarizeRun(run({ state: 'done' }), rollout).resumable).toBe(false);
  });

  it('names the hold a parked run is waiting on', () => {
    const v = summarizeRun(
      run({ state: 'parked', currentEp: 2 }, [c({ cutId: 'hold', ep: 2, runtime: null })]),
      rollout);
    expect(v.waitingOn).toBe('Approve');
  });

  it('surfaces the run error on a forced hold', () => {
    const v = summarizeRun(run({ state: 'parked', error: 'cut "verify" check failed' }), rollout);
    expect(v.error).toContain('verify');
  });

  it('counts progress as terminal cuts over total', () => {
    const v = summarizeRun(run({}, [
      c({ cutId: 'verify', ep: 0, state: 'done' }),
      c({ cutId: 'punchup', ep: 1, state: 'pending' }),
    ]), rollout);
    expect(v.progress).toEqual({ done: 1, total: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/rollout/runView.test.ts`
Expected: FAIL — `Failed to resolve import "./runView.js"`

- [ ] **Step 3: Write the implementation**

```ts
// ui/src/lib/rollout/runView.ts
/**
 * Presentation logic for a rollout run, extracted from the component so the
 * interesting part — what a cut's state actually MEANS — is testable without
 * a browser.
 *
 * The distinction that matters on this screen is the same one the engine
 * refuses to conflate: a transient failure (the command did not complete) is
 * not a failed check (the command completed and the output was wrong).
 */
import type { Rollout, RunState } from './types.js';

export type CutStatus =
  | 'pending' | 'running' | 'passed' | 'repaired'
  | 'failed-check' | 'failed-transient' | 'skipped';

export type CutView = {
  cutId: string; label: string; ep: number; kind: string;
  status: CutStatus; note?: string; outputJson?: string;
};

export type RunSummaryView = {
  runId: string; state: RunState['state'];
  progress: { done: number; total: number };
  resumable: boolean;
  waitingOn?: string;
  error?: string;
  cuts: CutView[];
};

const TERMINAL = new Set(['done', 'failed', 'skipped']);

export function summarizeRun(run: RunState, rollout: Rollout): RunSummaryView {
  const cuts: CutView[] = run.cuts.map((c) => {
    const def = rollout.cuts[c.cutId];
    let status: CutStatus;
    let note: string | undefined;

    if (c.state === 'pending') status = 'pending';
    else if (c.state === 'running') status = 'running';
    else if (c.state === 'skipped') status = 'skipped';
    else if (c.state === 'failed') {
      // A failed check has checkPassed === false; a transient failure never
      // got far enough to evaluate one.
      status = c.checkPassed === false ? 'failed-check' : 'failed-transient';
      note = status === 'failed-transient' ? `${c.attempts} attempts` : 'could not be repaired';
    } else if (c.remasters > 0) {
      status = 'repaired';
      note = `fixed after ${c.remasters} remaster${c.remasters === 1 ? '' : 's'}`;
    } else {
      status = 'passed';
    }

    return {
      cutId: c.cutId, ep: c.ep,
      label: def?.label ?? c.cutId,
      kind: def?.kind ?? 'script',
      status, note, outputJson: c.outputJson,
    };
  });

  const waiting = run.cuts.find(
    (c) => c.ep === run.currentEp && c.runtime === null && c.state === 'pending');

  return {
    runId: run.runId,
    state: run.state,
    progress: { done: run.cuts.filter((c) => TERMINAL.has(c.state)).length, total: run.cuts.length },
    resumable: run.state === 'parked',
    waitingOn: waiting ? rollout.cuts[waiting.cutId]?.label : undefined,
    error: run.error,
    cuts,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/rollout/runView.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Build the Runs view component**

```svelte
<!-- ui/src/lib/rollout/RunsView.svelte -->
<script lang="ts">
  import { summarizeRun, type RunSummaryView } from './runView.js';
  import type { Rollout, RunState } from './types.js';

  let { leagueId }: { leagueId: number } = $props();

  let runs = $state<{ runId: string; roundId: number; roundName: string; state: string }[]>([]);
  let selected = $state<RunSummaryView | null>(null);
  let resumeToken = $state('');

  async function loadRuns() {
    const r = await fetch(`/api/rollout/runs?leagueId=${leagueId}`);
    if (r.ok) runs = (await r.json()).runs;
  }
  $effect(() => { if (leagueId) void loadRuns(); });

  async function open(runId: string) {
    const r = await fetch(`/api/rollout/runs?runId=${runId}`);
    if (!r.ok) return;
    const { run } = (await r.json()) as { run: RunState };
    const cfg = await (await fetch(`/api/rollout/config?leagueId=${leagueId}`)).json() as { rollout: Rollout };
    selected = summarizeRun(run, cfg.rollout);
  }

  async function resume() {
    const r = await fetch('/api/rollout/resume', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: resumeToken }),
    });
    if (r.ok) { resumeToken = ''; await loadRuns(); }
  }
</script>

<div class="mlm-card">
  <ul class="mlm-runlist">
    {#each runs as r (r.runId)}
      <li><button class="mash-btn" onclick={() => open(r.runId)}>{r.roundName} — {r.state}</button></li>
    {:else}
      <li style="color:var(--fg-quiet);">No runs yet.</li>
    {/each}
  </ul>

  {#if selected}
    <h4>Run {selected.runId.slice(0, 8)} — {selected.state}
      ({selected.progress.done}/{selected.progress.total})</h4>
    {#if selected.waitingOn}<p>Waiting on: <strong>{selected.waitingOn}</strong></p>{/if}
    {#if selected.error}<p style="color:var(--amber);">{selected.error}</p>{/if}
    <ol>
      {#each selected.cuts as c (c.cutId)}
        <li>
          <span>EP{c.ep}</span> <strong>{c.label}</strong>
          <span class="mlm-status mlm-status--{c.status}">{c.status}</span>
          {#if c.note}<em>{c.note}</em>{/if}
          {#if c.outputJson}<details><summary>output</summary><pre>{c.outputJson}</pre></details>{/if}
        </li>
      {/each}
    </ol>
    {#if selected.resumable}
      <label>Resume token <input bind:value={resumeToken} /></label>
      <button class="mash-btn mash-btn--primary" onclick={resume} disabled={!resumeToken}>Resume</button>
    {/if}
  {/if}
</div>
```

- [ ] **Step 6: Add Definition / Runs sub-tabs to `RolloutTab.svelte`**

Add `import RunsView from './RunsView.svelte';`, a `let section = $state<'definition' | 'runs'>('definition');`, two buttons in the header, and wrap the existing editor body in `{#if section === 'definition'} … {:else}<RunsView {leagueId} />{/if}`.

- [ ] **Step 7: Add the run-state strip to the digest page**

In `ui/src/routes/digest/[roundId]/+page.server.ts`, add to the returned data:

```ts
  const rolloutRun = db.prepare(
    `SELECT id, state, current_ep FROM rollout_runs WHERE round_id = ?`,
  ).get(roundId) as { id: string; state: string; current_ep: number } | undefined ?? null;
```

and render it in `+page.svelte` above the sections, guarded so it is invisible for rounds with no run:

```svelte
{#if data.rolloutRun}
  <p class="dg-rollout-strip">
    Rollout {data.rolloutRun.state} · EP{data.rolloutRun.current_ep}
    <a href="/settings/models#rollouts">view run</a>
  </p>
{/if}
```

- [ ] **Step 8: Verify with a production build**

```bash
cd ui && npm run build && npm run preview
```

Confirm: Runs sub-tab renders an empty state without errors, and the digest page is **visually unchanged** for a round with no rollout run.

- [ ] **Step 9: Run the suite and typecheck**

Run: `cd ui && npm run check && npm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add ui/src/lib/rollout/RunsView.svelte ui/src/lib/rollout/runView.ts \
        ui/src/lib/rollout/runView.test.ts ui/src/lib/rollout/RolloutTab.svelte \
        ui/src/routes/digest/
git commit -m "feat(rollout): runs view and digest-page run strip

Presentation logic extracted to runView.ts so the meaningful part — repaired
vs failed-check vs failed-transient — is tested without a browser."
```

---

### Task 15: Host executor service and the cutover runbook

**Files:**
- Create: `~/.config/systemd/user/mlb-rollout-host.service`
- Create: `~/.config/systemd/user/mlb-rollout-host.timer`
- Create: `docs/how-to/rollouts.md`

**Interfaces:**
- Consumes: `scripts/rollout/host_executor.py` (Task 11).
- Produces: a running host executor and a written cutover procedure.

**Do not retire `mlb-hil-ledes.timer` in this task.** Spec §11: it is retired only once a league has completed a rollout run end to end. Until then both exist, and because no league has a rollout enabled, only the old one does anything.

- [ ] **Step 1: Write the unit files**

```ini
# ~/.config/systemd/user/mlb-rollout-host.service
[Unit]
Description=music-league-bot rollout host executor (script + agent cuts)

[Service]
Type=oneshot
WorkingDirectory=/home/loydmilligan/Projects/music-league-bot
ExecStart=/usr/bin/python3 scripts/rollout/host_executor.py --once
```

```ini
# ~/.config/systemd/user/mlb-rollout-host.timer
[Unit]
Description=Poll for host rollout cuts

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
AccuracySec=30s

[Install]
WantedBy=timers.target
```

- [ ] **Step 2: Prove it is a no-op before enabling**

```bash
cd /home/loydmilligan/Projects/music-league-bot
python3 scripts/rollout/host_executor.py --once
```
Expected: `host_executor: ran 0 cut(s)` — no league has a rollout enabled, so there are no runs.

- [ ] **Step 3: Install and enable**

```bash
systemctl --user daemon-reload
systemctl --user enable --now mlb-rollout-host.timer
systemctl --user list-timers mlb-rollout-host.timer
```
Expected: the timer is listed with a NEXT time. Confirm `mlb-hil-ledes.timer` is **still** listed and enabled.

- [ ] **Step 4: Write the runbook**

Create `docs/how-to/rollouts.md` covering, in this order: what a rollout is and its vocabulary (one paragraph, pointing at the spec); how to enable one for a league (Rollouts tab → pick league → check "Rollout enabled" → Save); how to watch a run (Runs sub-tab; `journalctl --user -u mlb-rollout-host -n 50`); how to resume a parked run (ntfy tap, or paste the token in the Runs view); how to roll back (uncheck "Rollout enabled" — in-flight runs finish, new rounds fall back to `digest_jobs`); and the fact that `check_passed`, `attempts`, and `remasters` mean three different things.

- [ ] **Step 5: Commit**

```bash
git add docs/how-to/rollouts.md
git commit -m "docs(rollout): host executor service and cutover runbook

The systemd units live outside the repo; the runbook records them, how to
enable a league, how to resume a parked run, and how to roll back."
```

- [ ] **Step 6: First live rollout — a checklist, not a code change**

Do **not** perform this step in the same session as the build. Per spec §11:

1. Boarz R149 (closes 2026-08-27T06:30Z) runs **manually** on existing tooling.
2. After R149 ships, pick one league and enable its rollout.
3. Watch the first run cut by cut in the Runs view; do not leave it unattended.
4. Only after one league completes a rollout end to end: `systemctl --user disable --now mlb-hil-ledes.timer` and delete `hil_autorun.py`.

---

## Self-Review

**Spec coverage.** §2 vocabulary → Tasks 2, 4, 6 (remaster), 13 (the checkbox). §3 context rule → Task 7, mirrored in Task 11's `build_context`. §4.1 generalizing `digest_jobs` → Task 10 promotion. §4.2 two executors → Tasks 10, 11. §4.3 agent-not-step-runner → Task 11 `run_agent_cut`. §5 data model → Tasks 3, 8. §6 solver + shared core → Tasks 1, 4. §7 trigger/claiming/leases/budgets/failure/holds/concurrency → Tasks 8, 9, 10, 11. §8 default rollout → Task 2, asserted in Task 4. §9 screen → Tasks 13, 14. §10 testing → every task; the degenerate guarantee is Tasks 3 and 10. §11 delivery → Task 15.

**Open questions from spec §12, resolved here:** agent invocation settled as `claude -p` (Task 11), with the SDK a later swap behind one function. **Two remain genuinely open and are flagged as such rather than guessed:** the `cover-art` cut's command in `DEFAULT_ROLLOUT` assumes `scripts/cover-gen/cli.py <roundId>`, which has **not** been verified — Task 2's implementer must read `scripts/cover-gen/cli.py` and correct the command, or mark the cut disabled by default. Likewise `dupe_review_page.py` still carries hardcoded `FINDINGS`; the `dupe-findings` agent cut writes JSON that the script cannot yet read, so `dupe-page` will produce a stale page until a follow-up teaches it to read findings from a file. Both are noted in the runbook rather than silently shipped.

**Type consistency checked:** `RunState`/`CutRunState` field names are identical across Tasks 2, 5, 6, 8, 14; `CutResult` (Task 6) matches what `runAppCut` (Task 10) and `_finish` (Task 11) produce; `contextFor` (Task 7) and `build_context` (Task 11) return the same shape in two languages, which Task 11's test asserts independently.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-26-rollout-entity.md`.
