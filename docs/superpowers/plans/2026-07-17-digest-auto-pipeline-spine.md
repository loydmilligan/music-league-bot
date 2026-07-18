# Digest Auto-Pipeline (Spine → Auto-Send) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a round's voting ends, automatically capture its data, generate the digest draft, and — for leagues in `auto` mode — finalize it so the already-built bot poller posts it to the group. No human touch for auto-mode leagues; HiL/ntfy is a separate follow-on plan.

**Architecture:** A `digest_jobs` queue in `league.db`. The `api` process (email poller) enqueues a job when `emailIngest` records a `voting_ended` event. A new runner in `bot-ui` (a `setInterval` loop like the existing `queueWorker`) claims jobs and runs capture → generate → (auto mode) finalize. Finalizing makes the round eligible for the **existing, tested** bot poller, which sends it — so this plan adds **no new send code**.

**Tech Stack:** TypeScript, better-sqlite3, SvelteKit (bot-ui), Vitest. Two separate TS projects: root (`src/`, `tests/`, root `vitest.config.ts`) and `ui/` (`ui/src/`, `ui/vite.config.ts`). They share `data/league.db` on disk but cannot import each other's code.

## Global Constraints

- Both `src/` and `ui/src` resolve the DB as `${process.env.DATA_DIR ?? 'data'}/league.db` — copy this verbatim; never hardcode a path.
- `src/` and `ui/` are separate TS projects with **no shared imports**. Logic needed on both sides is duplicated with identical DDL and a cross-reference comment.
- TDD: every task writes the failing test first, watches it fail, then implements. Real code only — no placeholders.
- Fail-closed: a league sends only when `digest_mode='auto'` AND it has a `DIGEST_SEND_TARGETS` entry AND `DIGEST_SEND_MODE=live`. Absent any of these → the job halts at `rendered` and nothing sends.
- The runner tick never throws (it is timer-called; this project has no unhandled-rejection backstop). Wrap each job in try/catch → `failed`.
- Root tests run with `npx vitest run` from repo root; ui tests with `npx vitest run` from `ui/`.

---

### Task 1: `digest_jobs` table

**Files:**
- Modify: `ui/src/lib/db/schema.ts` (add table to the `SCHEMA` string)
- Create: `ui/src/lib/digest/jobsSchema.ts` (a callable `ensureDigestJobsSchema` for the `src/` side to mirror)
- Test: `ui/src/lib/digest/jobs.test.ts`

**Interfaces:**
- Produces: table `digest_jobs(round_id INTEGER PRIMARY KEY, league_id INTEGER NOT NULL, status TEXT NOT NULL, gen_params TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`. `status` ∈ `pending|capturing|generating|rendered|finalizing|done|failed`.
- Produces: `DIGEST_JOBS_DDL` (string) exported from `jobsSchema.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// ui/src/lib/digest/jobs.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

describe('digest_jobs schema', () => {
  it('exists after the league schema is applied', () => {
    const row = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='digest_jobs'`,
    ).get();
    expect(row).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/digest/jobs.test.ts`
Expected: FAIL — `digest_jobs` not found.

- [ ] **Step 3: Add the DDL**

Create `ui/src/lib/digest/jobsSchema.ts`:

```typescript
// Canonical digest_jobs DDL. Mirrored verbatim by the src/ trigger writer
// (src/email/digestJobs.ts) because src/ and ui/ cannot share imports.
export const DIGEST_JOBS_DDL = `
  CREATE TABLE IF NOT EXISTS digest_jobs (
    round_id   INTEGER PRIMARY KEY REFERENCES rounds(id),
    league_id  INTEGER NOT NULL REFERENCES leagues(id),
    status     TEXT NOT NULL,
    gen_params TEXT,
    error      TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;
```

In `ui/src/lib/db/schema.ts`, add `CREATE TABLE IF NOT EXISTS digest_jobs (...)` (identical columns to `DIGEST_JOBS_DDL`) to the `SCHEMA` template, next to `digest_sends`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/digest/jobs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/db/schema.ts ui/src/lib/digest/jobsSchema.ts ui/src/lib/digest/jobs.test.ts
git commit -m "feat(digest): add digest_jobs table for the auto-pipeline spine"
```

---

### Task 2: Job queue CRUD

**Files:**
- Create: `ui/src/lib/digest/jobs.ts`
- Test: `ui/src/lib/digest/jobs.test.ts` (extend)

**Interfaces:**
- Produces: `enqueueJob(db, roundId, leagueId, nowIso): boolean` — INSERT OR IGNORE; false if already queued.
- Produces: `claimNextJob(db, nowIso): {roundId, leagueId, gen_params} | null` — atomically moves the oldest `pending` job to `capturing`.
- Produces: `transitionJob(db, roundId, status, nowIso): void`.
- Produces: `failJob(db, roundId, error, nowIso): void` — sets `failed` + error.
- Produces: `getJob(db, roundId): {status, error} | undefined`.

- [ ] **Step 1: Write the failing tests**

```typescript
// append to ui/src/lib/digest/jobs.test.ts
import { enqueueJob, claimNextJob, transitionJob, failJob, getJob } from './jobs.js';

const NOW = '2026-07-17T09:00:00Z';
function seed(db: Database.Database) {
  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1,'l','L')`).run();
  db.prepare(`INSERT INTO seasons (id, league_id, season_number, status) VALUES (1,1,1,'active')`).run();
  db.prepare(`INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (7,1,'r7','R7','${NOW}')`).run();
}

describe('job queue', () => {
  it('enqueues a job once and refuses a duplicate', () => {
    seed(db);
    expect(enqueueJob(db, 7, 1, NOW)).toBe(true);
    expect(enqueueJob(db, 7, 1, NOW)).toBe(false);
  });
  it('claims the pending job and moves it to capturing', () => {
    seed(db); enqueueJob(db, 7, 1, NOW);
    const claimed = claimNextJob(db, NOW);
    expect(claimed).toMatchObject({ roundId: 7, leagueId: 1 });
    expect(getJob(db, 7)?.status).toBe('capturing');
  });
  it('a second claim finds nothing once the only job is claimed', () => {
    seed(db); enqueueJob(db, 7, 1, NOW); claimNextJob(db, NOW);
    expect(claimNextJob(db, NOW)).toBeNull();
  });
  it('transitions and fails', () => {
    seed(db); enqueueJob(db, 7, 1, NOW); claimNextJob(db, NOW);
    transitionJob(db, 7, 'generating', NOW);
    expect(getJob(db, 7)?.status).toBe('generating');
    failJob(db, 7, 'boom', NOW);
    expect(getJob(db, 7)).toMatchObject({ status: 'failed', error: 'boom' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/digest/jobs.test.ts`
Expected: FAIL — `enqueueJob` not exported.

- [ ] **Step 3: Implement `jobs.ts`**

```typescript
// ui/src/lib/digest/jobs.ts
import type Database from 'better-sqlite3';

export function enqueueJob(db: Database.Database, roundId: number, leagueId: number, nowIso: string): boolean {
  const res = db.prepare(
    `INSERT OR IGNORE INTO digest_jobs (round_id, league_id, status, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?)`,
  ).run(roundId, leagueId, nowIso, nowIso);
  return res.changes === 1;
}

export function claimNextJob(db: Database.Database, nowIso: string):
  { roundId: number; leagueId: number; gen_params: string | null } | null {
  const claim = db.transaction(() => {
    const row = db.prepare(
      `SELECT round_id, league_id, gen_params FROM digest_jobs
        WHERE status='pending' ORDER BY created_at LIMIT 1`,
    ).get() as { round_id: number; league_id: number; gen_params: string | null } | undefined;
    if (!row) return null;
    db.prepare(`UPDATE digest_jobs SET status='capturing', updated_at=? WHERE round_id=?`)
      .run(nowIso, row.round_id);
    return { roundId: row.round_id, leagueId: row.league_id, gen_params: row.gen_params };
  });
  return claim();
}

export function transitionJob(db: Database.Database, roundId: number, status: string, nowIso: string): void {
  db.prepare(`UPDATE digest_jobs SET status=?, updated_at=? WHERE round_id=?`).run(status, nowIso, roundId);
}

export function failJob(db: Database.Database, roundId: number, error: string, nowIso: string): void {
  db.prepare(`UPDATE digest_jobs SET status='failed', error=?, updated_at=? WHERE round_id=?`)
    .run(error, nowIso, roundId);
}

export function getJob(db: Database.Database, roundId: number): { status: string; error: string | null } | undefined {
  return db.prepare(`SELECT status, error FROM digest_jobs WHERE round_id=?`).get(roundId) as
    { status: string; error: string | null } | undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/digest/jobs.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/digest/jobs.ts ui/src/lib/digest/jobs.test.ts
git commit -m "feat(digest): job queue CRUD (enqueue/claim/transition/fail)"
```

---

### Task 3: Trigger — enqueue on `voting_ended`

**Files:**
- Create: `src/email/digestJobs.ts` (src-side enqueue; mirrors the DDL)
- Modify: `src/email/emailIngest.ts` (call it on the `voting_ended` event)
- Test: `tests/digestJobsTrigger.test.ts`

**Interfaces:**
- Consumes (conceptually): the `digest_jobs` table from Task 1.
- Produces: `enqueueDigestJob(db, roundId, leagueId, nowIso): void` in `src/email/digestJobs.ts` — ensures the table then INSERT OR IGNORE.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/digestJobsTrigger.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { enqueueDigestJob } from '../src/email/digestJobs.js';

function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE leagues (id INTEGER PRIMARY KEY, slug TEXT, name TEXT);
          CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER, status TEXT);
          CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER, ml_round_id TEXT, name TEXT, created_at TEXT);`);
  d.prepare(`INSERT INTO leagues VALUES (1,'l','L')`).run();
  return d;
}

describe('enqueueDigestJob', () => {
  it('creates the table if missing and enqueues once', () => {
    const d = db();
    enqueueDigestJob(d, 7, 1, '2026-07-17T09:00:00Z');
    const row = d.prepare(`SELECT status FROM digest_jobs WHERE round_id=7`).get() as { status: string };
    expect(row.status).toBe('pending');
  });
  it('is idempotent — a re-ingested email does not duplicate', () => {
    const d = db();
    enqueueDigestJob(d, 7, 1, '2026-07-17T09:00:00Z');
    enqueueDigestJob(d, 7, 1, '2026-07-17T10:00:00Z');
    const n = (d.prepare(`SELECT COUNT(*) AS n FROM digest_jobs WHERE round_id=7`).get() as { n: number }).n;
    expect(n).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/digestJobsTrigger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/email/digestJobs.ts`**

```typescript
// src/email/digestJobs.ts
import type Database from 'better-sqlite3';

// DDL mirrored verbatim from ui/src/lib/digest/jobsSchema.ts (no shared imports
// across the src/ and ui/ projects). Keep the two in sync.
const DIGEST_JOBS_DDL = `
  CREATE TABLE IF NOT EXISTS digest_jobs (
    round_id   INTEGER PRIMARY KEY,
    league_id  INTEGER NOT NULL,
    status     TEXT NOT NULL,
    gen_params TEXT,
    error      TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

export function enqueueDigestJob(db: Database.Database, roundId: number, leagueId: number, nowIso: string): void {
  db.exec(DIGEST_JOBS_DDL);
  db.prepare(
    `INSERT OR IGNORE INTO digest_jobs (round_id, league_id, status, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?)`,
  ).run(roundId, leagueId, nowIso, nowIso);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/digestJobsTrigger.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `emailIngest.ts`**

In `src/email/emailIngest.ts`, locate the `voting_ended` branch (the `UPDATE rounds SET ${map.col} = ?` at ~line 213, where `map.event === 'voting_ended'`). After the round row is resolved and its `league_id` is known, add:

```typescript
import { enqueueDigestJob } from './digestJobs.js';
// ... inside the voting_ended handling, after resolving roundId + leagueId:
if (eventType === 'voting_ended') {
  const leagueRow = db.prepare(
    `SELECT s.league_id AS leagueId FROM rounds r JOIN seasons s ON s.id=r.season_id WHERE r.id=?`,
  ).get(roundId) as { leagueId: number } | undefined;
  if (leagueRow) enqueueDigestJob(db, roundId, leagueRow.leagueId, p.sentAt);
}
```

- [ ] **Step 6: Add an integration test for the wiring**

```typescript
// append to tests/digestJobsTrigger.test.ts — exercises ingestParsedEmail end to end.
// Build a minimal parsed votes_are_in email for an existing round and assert a job appears.
// (Use the existing emailIngest test fixtures in tests/emailIngest.test.ts as the pattern.)
```

Run: `npx vitest run tests/digestJobsTrigger.test.ts tests/emailIngest.test.ts`
Expected: PASS; no regression in `emailIngest.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/email/digestJobs.ts src/email/emailIngest.ts tests/digestJobsTrigger.test.ts
git commit -m "feat(digest): enqueue a digest job when emailIngest records voting_ended"
```

---

### Task 4: Per-league mode + gen-params config

**Files:**
- Modify: `ui/src/lib/db/schema.ts` (add columns via the existing safe-add pattern)
- Create: `ui/src/lib/digest/leagueDigestConfig.ts`
- Test: `ui/src/lib/digest/leagueDigestConfig.test.ts`

**Interfaces:**
- Produces: `getLeagueDigestConfig(db, leagueId): { mode: 'auto'|'hil'|'off'; genParams: GenParams }` — reads `leagues.digest_mode` (default `'off'`) and `leagues.digest_gen_params` (JSON; falls back to `DEFAULT_GEN_PARAMS`).
- Produces: `DEFAULT_GEN_PARAMS: GenParams` (import `GenParams` type from `$lib/digest/llm.js`).

- [ ] **Step 1: Write the failing test**

```typescript
// ui/src/lib/digest/leagueDigestConfig.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { getLeagueDigestConfig } from './leagueDigestConfig.js';

let db: Database.Database;
beforeEach(() => {
  db = openLeagueDb(':memory:');
  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1,'l','L')`).run();
});

describe('getLeagueDigestConfig', () => {
  it('defaults to off with default gen params', () => {
    const c = getLeagueDigestConfig(db, 1);
    expect(c.mode).toBe('off');
    expect(c.genParams).toBeTruthy();
  });
  it('reads a configured mode', () => {
    db.prepare(`UPDATE leagues SET digest_mode='auto' WHERE id=1`).run();
    expect(getLeagueDigestConfig(db, 1).mode).toBe('auto');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/digest/leagueDigestConfig.test.ts`
Expected: FAIL — `no such column: digest_mode` (and module missing).

- [ ] **Step 3: Add columns + implement the reader**

In `ui/src/lib/db/schema.ts`, follow the existing additive-column pattern (the code already safe-adds `action_status`/`action_detail` to `rounds`; do the same for `leagues`). Add, in the schema-migration section:

```typescript
for (const col of ['digest_mode', 'digest_gen_params']) {
  const has = db.prepare(`SELECT 1 FROM pragma_table_info('leagues') WHERE name=?`).get(col);
  if (!has) db.exec(`ALTER TABLE leagues ADD COLUMN ${col} TEXT`);
}
```

Create `ui/src/lib/digest/leagueDigestConfig.ts`:

```typescript
import type Database from 'better-sqlite3';
import type { GenParams } from '$lib/digest/llm.js';

// Seeded from the Generate modal's current defaults. Deferred block 2.1.1 will
// replace this flat default with a learned per-league house-style profile.
export const DEFAULT_GEN_PARAMS: GenParams = {
  sections: [], // empty → llm.js uses its built-in default section set
};

export function getLeagueDigestConfig(
  db: Database.Database, leagueId: number,
): { mode: 'auto' | 'hil' | 'off'; genParams: GenParams } {
  const row = db.prepare(
    `SELECT digest_mode AS mode, digest_gen_params AS gp FROM leagues WHERE id=?`,
  ).get(leagueId) as { mode: string | null; gp: string | null } | undefined;
  const mode = (row?.mode === 'auto' || row?.mode === 'hil') ? row.mode : 'off';
  let genParams = DEFAULT_GEN_PARAMS;
  if (row?.gp) { try { genParams = JSON.parse(row.gp) as GenParams; } catch { /* default */ } }
  return { mode, genParams };
}
```

Note: confirm the exact `GenParams` shape in `ui/src/lib/digest/llm.js` and make `DEFAULT_GEN_PARAMS` satisfy it (the empty/default form that produces the standard section set).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/digest/leagueDigestConfig.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/db/schema.ts ui/src/lib/digest/leagueDigestConfig.ts ui/src/lib/digest/leagueDigestConfig.test.ts
git commit -m "feat(digest): per-league digest mode + default gen params config"
```

---

### Task 5: Extract `captureRoundData` as a headless lib function

**Files:**
- Create: `ui/src/lib/digest/capture.ts`
- Modify: `ui/src/routes/api/digest/[roundId]/import-export-zip/+server.ts` (delegate to the lib fn)
- Test: `ui/src/lib/digest/capture.test.ts`

**Interfaces:**
- Consumes: `probeMlAuth` (`$lib/mlAuth.js`), `importZipData`/`importLiveRoundsData` (`$lib/import/importer.js`), `parseZip` (`$lib/import/zipParser.js`).
- Produces: `captureRoundData(db, roundId, deps?): Promise<{ ok: true; imported } | { ok: false; stage; reason }>` — the probe→trigger→import flow lifted out of the endpoint. `deps` injects `probe`, `triggerExport`, `importZip` for tests.

- [ ] **Step 1: Write the failing test (auth gate + happy path with fakes)**

```typescript
// ui/src/lib/digest/capture.test.ts
import { describe, it, expect, vi } from 'vitest';
import { captureRoundData } from './capture.js';

const okDeps = {
  probe: vi.fn().mockResolvedValue({ valid: true }),
  triggerExport: vi.fn().mockResolvedValue(Buffer.from('zip')),
  importZip: vi.fn().mockReturnValue({ submissions: 3, votes: 9, voteComments: 4 }),
  roundContext: vi.fn().mockReturnValue({ slug: 'l', seasonNumber: 1 }),
};

describe('captureRoundData', () => {
  it('fails at the auth stage when ML auth is invalid — nothing else runs', async () => {
    const r = await captureRoundData({} as never, 7, { ...okDeps, probe: vi.fn().mockResolvedValue({ valid: false }) });
    expect(r).toMatchObject({ ok: false, stage: 'auth' });
    expect(okDeps.triggerExport).not.toHaveBeenCalled();
  });
  it('imports on the happy path', async () => {
    const r = await captureRoundData({} as never, 7, okDeps);
    expect(r).toMatchObject({ ok: true, imported: { submissions: 3, votes: 9, voteComments: 4 } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/digest/capture.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `capture.ts`**

Lift the orchestration from `import-export-zip/+server.ts` (the `probeMlAuth()` → `fetch(TRIGGER_URL/export-zip)` → `parseZip` → `importZipData` flow) into `captureRoundData`, parameterized by injectable `deps` that default to the real implementations. Keep the same stage vocabulary (`auth|cli|download|import`). Return `{ok:true, imported}` or `{ok:false, stage, reason}`.

- [ ] **Step 4: Delegate the endpoint to the lib fn**

Rewrite the `import-export-zip` POST handler to call `captureRoundData(getDb(), roundId)` and translate the result into the existing JSON response shape (`runPrepChecks` still appended on success). This keeps the endpoint's external contract identical.

- [ ] **Step 5: Run tests**

Run: `cd ui && npx vitest run src/lib/digest/capture.test.ts && cd ui && npm run check 2>&1 | tail -1`
Expected: PASS; svelte-check 0 errors.

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/digest/capture.ts ui/src/routes/api/digest/'[roundId]'/import-export-zip/+server.ts ui/src/lib/digest/capture.test.ts
git commit -m "refactor(digest): extract captureRoundData headless lib fn from the endpoint"
```

---

### Task 6: Extend send-eligibility to recognize `voting_ended_at`

**Files:**
- Modify: `ui/src/lib/digest/schedule.ts` (`latestCompletedRound` completion predicate)
- Test: `ui/src/lib/digest/schedule.test.ts` (extend)

**Rationale:** The trigger fires on the `voting_ended` email, which sets `rounds.voting_ended_at`. The existing resolver only treats a round as complete when `voting_deadline <= now`. A freshly-ended round may have `voting_ended_at` set but a null/future `voting_deadline`, so the poller would not send it. Broaden "complete" to `voting_deadline <= now OR voting_ended_at IS NOT NULL`.

- [ ] **Step 1: Write the failing test**

```typescript
// append to ui/src/lib/digest/schedule.test.ts
it('treats a round with voting_ended_at set as complete even if voting_deadline is null', () => {
  // seed a league + a round with voting_deadline NULL but voting_ended_at set, a successor round,
  // subs+votes+finalized draft; expect resolveScheduledDigest → action 'send'.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/digest/schedule.test.ts`
Expected: FAIL — round not selected (resolves to `none`).

- [ ] **Step 3: Broaden the predicate**

In `latestCompletedRound`, change the WHERE clause from `r.voting_deadline <= ?` to `(r.voting_deadline IS NOT NULL AND r.voting_deadline <= ?) OR r.voting_ended_at IS NOT NULL`, and keep the ordering. Ensure `voting_ended_at` is selected where needed.

- [ ] **Step 4: Run tests**

Run: `cd ui && npx vitest run src/lib/digest/schedule.test.ts`
Expected: PASS; existing schedule tests still green.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/digest/schedule.ts ui/src/lib/digest/schedule.test.ts
git commit -m "feat(digest): recognize voting_ended_at as round-complete for send-eligibility"
```

---

### Task 7: The runner — one job end to end

**Files:**
- Create: `ui/src/lib/digest/runner.ts`
- Test: `ui/src/lib/digest/runner.test.ts`

**Interfaces:**
- Consumes: `claimNextJob`, `transitionJob`, `failJob` (Task 2); `captureRoundData` (Task 5); `getLeagueDigestConfig` (Task 4); `generateDraft`+`gatherRoundData`+`writeDraft` (`$lib/digest/llm.js`); `renderDigestHtml` (`$lib/digest/export.js`); a `finalize(roundId)` action.
- Produces: `runOneJob(deps): Promise<'idle' | 'ok' | 'failed' | 'held'>` — claims and drives one job; returns `idle` if none. All collaborators injected via `deps` for tests.

**Job flow inside `runOneJob`:** claim → `captureRoundData` → `generate` → `render` → read league mode → `auto` ⇒ `finalize` + status `done`; `hil`/`off` ⇒ status `rendered` (**held**, nothing sends — the ntfy gate is a later plan). Any throw ⇒ `failJob`. Auth failure from capture ⇒ `failJob('ml-auth: ...')`.

- [ ] **Step 1: Write the failing tests (fakes for every collaborator)**

```typescript
// ui/src/lib/digest/runner.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runOneJob, type RunnerDeps } from './runner.js';

function deps(over: Partial<RunnerDeps> = {}): RunnerDeps {
  return {
    claim: vi.fn().mockReturnValue({ roundId: 7, leagueId: 1, gen_params: null }),
    transition: vi.fn(), fail: vi.fn(),
    capture: vi.fn().mockResolvedValue({ ok: true, imported: {} }),
    generate: vi.fn().mockResolvedValue(undefined),
    render: vi.fn().mockResolvedValue({ url: 'https://d/x' }),
    leagueConfig: vi.fn().mockReturnValue({ mode: 'auto', genParams: {} }),
    finalize: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(), now: () => '2026-07-17T09:00:00Z',
    ...over,
  };
}

describe('runOneJob', () => {
  it('returns idle when there is no job', async () => {
    expect(await runOneJob(deps({ claim: vi.fn().mockReturnValue(null) }))).toBe('idle');
  });
  it('auto-mode: captures, generates, renders, finalizes, done', async () => {
    const d = deps();
    expect(await runOneJob(d)).toBe('ok');
    expect(d.capture).toHaveBeenCalledWith(7);
    expect(d.finalize).toHaveBeenCalledWith(7);
    expect(d.transition).toHaveBeenLastCalledWith(7, 'done', expect.any(String));
  });
  it('hil/off-mode holds at rendered and never finalizes', async () => {
    const d = deps({ leagueConfig: vi.fn().mockReturnValue({ mode: 'hil', genParams: {} }) });
    expect(await runOneJob(d)).toBe('held');
    expect(d.finalize).not.toHaveBeenCalled();
    expect(d.transition).toHaveBeenLastCalledWith(7, 'rendered', expect.any(String));
  });
  it('capture auth-failure fails the job and stops', async () => {
    const d = deps({ capture: vi.fn().mockResolvedValue({ ok: false, stage: 'auth', reason: 'expired' }) });
    expect(await runOneJob(d)).toBe('failed');
    expect(d.fail).toHaveBeenCalledWith(7, expect.stringContaining('auth'), expect.any(String));
    expect(d.generate).not.toHaveBeenCalled();
  });
  it('a thrown error becomes a failed job, not an exception', async () => {
    const d = deps({ generate: vi.fn().mockRejectedValue(new Error('llm down')) });
    await expect(runOneJob(d)).resolves.toBe('failed');
    expect(d.fail).toHaveBeenCalledWith(7, expect.stringContaining('llm down'), expect.any(String));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/digest/runner.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `runner.ts`**

```typescript
// ui/src/lib/digest/runner.ts
export interface RunnerDeps {
  claim: () => { roundId: number; leagueId: number; gen_params: string | null } | null;
  transition: (roundId: number, status: string, now: string) => void;
  fail: (roundId: number, error: string, now: string) => void;
  capture: (roundId: number) => Promise<{ ok: boolean; stage?: string; reason?: string }>;
  generate: (roundId: number, genParams: unknown) => Promise<void>;
  render: (roundId: number) => Promise<{ url: string }>;
  leagueConfig: (leagueId: number) => { mode: 'auto' | 'hil' | 'off'; genParams: unknown };
  finalize: (roundId: number) => Promise<void>;
  log: (msg: string) => void;
  now: () => string;
}

export async function runOneJob(deps: RunnerDeps): Promise<'idle' | 'ok' | 'failed' | 'held'> {
  const job = deps.claim();
  if (!job) return 'idle';
  const { roundId, leagueId } = job;
  try {
    const cap = await deps.capture(roundId);
    if (!cap.ok) { deps.fail(roundId, `capture ${cap.stage}: ${cap.reason}`, deps.now()); return 'failed'; }

    deps.transition(roundId, 'generating', deps.now());
    const cfg = deps.leagueConfig(leagueId);
    await deps.generate(roundId, cfg.genParams);

    deps.transition(roundId, 'rendered', deps.now());
    await deps.render(roundId);

    if (cfg.mode !== 'auto') {
      deps.log(`[digest-runner] round ${roundId}: held (mode=${cfg.mode}) — awaiting approval gate`);
      return 'held';
    }
    deps.transition(roundId, 'finalizing', deps.now());
    await deps.finalize(roundId);
    deps.transition(roundId, 'done', deps.now());
    deps.log(`[digest-runner] round ${roundId}: auto-finalized; existing poller will send`);
    return 'ok';
  } catch (err) {
    deps.fail(roundId, err instanceof Error ? err.message : String(err), deps.now());
    return 'failed';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/digest/runner.test.ts`
Expected: PASS (all five).

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/digest/runner.ts ui/src/lib/digest/runner.test.ts
git commit -m "feat(digest): runner state machine — capture/generate/render/auto-finalize with fakes"
```

---

### Task 8: Wire the runner into bot-ui startup

**Files:**
- Create: `ui/src/lib/digest/runnerLoop.ts` (real-dep wiring + `setInterval`)
- Modify: `ui/src/hooks.server.ts` (start it, mirroring the `queueWorker` start)
- Test: `ui/src/lib/digest/runnerLoop.test.ts` (thin — verifies dep assembly picks real fns)

**Interfaces:**
- Consumes: everything from Tasks 2/4/5/7, plus real `generateDraft`/`writeDraft`, `renderDigestHtml`, and the finalize action (call the existing finalize logic — reuse the `finalize` endpoint's underlying steps or the lib path used by `POST /finalize`).
- Produces: `startDigestRunner(): void` — one-immediate-guarded interval like `queueWorker` (do NOT fire on startup if it could act; a claim is safe, but keep parity with existing pattern), `DIGEST_RUNNER_POLL_MS` default 60_000.

- [ ] **Step 1: Write the failing test**

```typescript
// ui/src/lib/digest/runnerLoop.test.ts
import { describe, it, expect } from 'vitest';
import { buildRunnerDeps } from './runnerLoop.js';

describe('buildRunnerDeps', () => {
  it('assembles a deps object with every collaborator present', () => {
    const d = buildRunnerDeps();
    for (const k of ['claim','transition','fail','capture','generate','render','leagueConfig','finalize','log','now']) {
      expect(typeof (d as Record<string, unknown>)[k]).toBe('function');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/digest/runnerLoop.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `runnerLoop.ts`**

Assemble `buildRunnerDeps()` binding the real functions (`getDb`, `claimNextJob`, `transitionJob`, `failJob`, `captureRoundData`, `getLeagueDigestConfig`, a `generate` wrapper calling `gatherRoundData`+`generateDraft`+`writeDraft`, `renderDigestHtml`, a `finalize` wrapper calling the existing finalize path). Add `startDigestRunner()`: `const deps = buildRunnerDeps(); setInterval(() => { void runOneJob(deps).catch(e => console.error('[digest-runner] tick threw', e)); }, ms); timer.unref?.()`.

- [ ] **Step 4: Start it in `hooks.server.ts`**

Add `startDigestRunner()` next to the existing `queueWorker` startup call in `ui/src/hooks.server.ts`.

- [ ] **Step 5: Run tests + typecheck**

Run: `cd ui && npx vitest run src/lib/digest/runnerLoop.test.ts && npm run check 2>&1 | tail -1`
Expected: PASS; svelte-check 0 errors.

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/digest/runnerLoop.ts ui/src/hooks.server.ts ui/src/lib/digest/runnerLoop.test.ts
git commit -m "feat(digest): start the auto-pipeline runner in bot-ui"
```

---

### Task 9: Live smoke against the staging group (no new code)

**Goal:** Prove the full chain on real infra without touching a real-people league, exactly how the send was validated.

- [ ] **Step 1:** In `.env`, set fam-jam to auto mode against the staging group: `DIGEST_SEND_MODE=live`, `DIGEST_SEND_TARGETS={"fam-jam":"120363426590199032@g.us"}`, and set `leagues.digest_mode='auto'` for fam-jam via SQL.
- [ ] **Step 2:** Rebuild + restart `bot` and `bot-ui`; confirm `[digest-runner]` and the poller both log startup.
- [ ] **Step 3:** Enqueue a job by SQL (`enqueueDigestJob` equivalent) for a completed fam-jam round on a **copy first**, then live; watch the runner logs go capture → generate → rendered → finalizing → done.
- [ ] **Step 4:** Confirm the existing bot poller then posts it to the staging group (you + bot).
- [ ] **Step 5:** Revert the `.env` and the `digest_mode`, delete the test `digest_jobs`/`digest_sends` rows (same cleanup discipline as the earlier live test).

---

## Self-Review

**Spec coverage:** spine (`1.1.1`) → Tasks 1–3; capture (`1.3.2`) → Task 5; generate (`1.4.1`/`2.3.1`) → Tasks 4,7,8; mode gate (`4.3.1`) → Tasks 4,7; send (`6.1.1`) → reused (auto-finalize + existing poller), with Task 6 closing the `voting_ended_at` eligibility seam; runner spine (new block) → Tasks 7,8. ntfy gate (`4.3.1` hil path) and infra are **out of this plan** (Plan 2), matching the spec's step 5–6 split. Covered.

**Placeholder scan:** Task 3 Step 6 and Task 6 Step 1 describe a test to write against existing fixtures rather than inlining full code — acceptable because they reuse the documented `tests/emailIngest.test.ts` / `schedule.test.ts` seed patterns; the implementer copies those. Task 4/5/8 note "confirm the exact shape in llm.js / reuse the finalize path" — these are real verification steps, not deferrals, because the exact `GenParams` shape and finalize internals must be read from source at implementation time.

**Type consistency:** `RunnerDeps` collaborators in Task 7 match the producers in Tasks 2/4/5. `enqueueDigestJob` (src) and `enqueueJob` (ui) are intentionally distinct (separate projects, same table). DDL is identical across `jobsSchema.ts`, `schema.ts`, and `digestJobs.ts`.

## Execution Handoff

(see below)
