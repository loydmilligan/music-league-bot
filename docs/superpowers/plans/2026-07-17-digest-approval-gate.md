# Digest Approval Gate (Phase 2 — HiL via ntfy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the digest runner's stubbed `hil` hold into a working ntfy approval gate — a rendered digest pushes to the phone, and Approve (finalize + immediate send) / Deny (drop) / Review (open editor) drive it to a WhatsApp post.

**Architecture:** The pure `runOneJob` orchestrator (`ui/src/lib/digest/runner.ts`) gains three collaborators — a structural-review check, an `awaitApproval` and an `awaitReview` — wired in `runnerLoop.ts` to real DB writes + an ntfy `publish()`. Public token-authed `approve`/`deny` endpoints on bot-ui finalize and POST the bot's control `/trigger` (newly reachable across the compose network) for an immediate send through the existing resolver → `sendGuard` → `sendLog` chain. No new send code.

**Tech Stack:** TypeScript, SvelteKit (adapter-node) for bot-ui, `better-sqlite3`, Vitest, Node `fetch`, `node:crypto`. Two separate TS projects with NO shared imports: `ui/` (bot-ui) and `src/` (bot + api).

## Global Constraints

- **No shared imports across `src/` and `ui/`.** They are separate TS projects. The `digest_jobs` DDL is duplicated in `ui/src/lib/db/schema.ts` and `src/email/digestJobs.ts`; keep them in sync but never `import` across the boundary.
- **ui additive-column migrations live in `ui/src/lib/db/client.ts`** (`PRAGMA table_info` + `ALTER TABLE ADD COLUMN`), NOT in `schema.ts`. `schema.ts` holds the canonical `CREATE TABLE` for fresh DBs.
- **Never hardcode secrets.** `NTFY_URL`, `NTFY_TOPIC`, `NTFY_TOKEN` come from `process.env` (already set in the top-level `.env`, loaded by every compose service via `env_file: .env`).
- **The bot control server is send-capable.** It stays unpublished (no host `ports:` in `docker-compose.yml`); the only change is binding host `0.0.0.0` so sibling compose containers can reach it. `/send` keeps its dry-run default; `sendGuard` stays fail-closed.
- **TDD, DRY, YAGNI, frequent commits.** Runner logic is tested with fakes (see `ui/src/lib/digest/runner.test.ts`); lib DB helpers are tested against an in-memory `better-sqlite3`.
- Run ui tests with `npm test --prefix ui -- run <path>`; root tests with `npm test -- run <path>`.

---

### Task 1: Add approval columns to `digest_jobs`

**Files:**
- Modify: `ui/src/lib/db/schema.ts` (the `digest_jobs` CREATE TABLE, ~line 224)
- Modify: `ui/src/lib/db/client.ts` (additive-migration block)
- Modify: `src/email/digestJobs.ts` (mirror DDL comment + columns)
- Test: `ui/src/lib/db/digestJobsColumns.test.ts` (new)

**Interfaces:**
- Produces: `digest_jobs` gains columns `approval_token TEXT`, `decision TEXT`, `decided_at TEXT`, `review_url TEXT`, `attempts INTEGER NOT NULL DEFAULT 0`. Every later task reads/writes these.

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/db/digestJobsColumns.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from './schema.js';

describe('digest_jobs approval columns', () => {
  it('fresh schema has the approval + attempts columns', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA);
    const cols = (db.prepare("PRAGMA table_info(digest_jobs)").all() as { name: string }[]).map((c) => c.name);
    for (const c of ['approval_token', 'decision', 'decided_at', 'review_url', 'attempts']) {
      expect(cols).toContain(c);
    }
  });
});
```

Note: confirm `schema.ts` exports the DDL string as `SCHEMA`. If it is exported under a different name, import that name instead (grep `export` in `ui/src/lib/db/schema.ts`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix ui -- run src/lib/db/digestJobsColumns.test.ts`
Expected: FAIL — columns `approval_token`, etc. not found.

- [ ] **Step 3: Add columns to the canonical CREATE TABLE**

In `ui/src/lib/db/schema.ts`, change the `digest_jobs` table to:

```sql
  CREATE TABLE IF NOT EXISTS digest_jobs (
    round_id       INTEGER PRIMARY KEY REFERENCES rounds(id),
    league_id      INTEGER NOT NULL REFERENCES leagues(id),
    status         TEXT NOT NULL,
    gen_params     TEXT,
    error          TEXT,
    approval_token TEXT,
    decision       TEXT,
    decided_at     TEXT,
    review_url     TEXT,
    attempts       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
```

- [ ] **Step 4: Add the additive migration**

In `ui/src/lib/db/client.ts`, next to the other `PRAGMA table_info` migration blocks, add:

```ts
	const digestJobsCols = db.prepare("PRAGMA table_info(digest_jobs)").all() as { name: string }[];
	for (const [col, ddl] of [
		['approval_token', 'TEXT'],
		['decision', 'TEXT'],
		['decided_at', 'TEXT'],
		['review_url', 'TEXT'],
		['attempts', "INTEGER NOT NULL DEFAULT 0"],
	] as const) {
		if (!digestJobsCols.some((c) => c.name === col)) {
			db.exec(`ALTER TABLE digest_jobs ADD COLUMN ${col} ${ddl}`);
		}
	}
```

- [ ] **Step 5: Keep the `src/` DDL copy in sync**

In `src/email/digestJobs.ts`, update `DIGEST_JOBS_DDL` to include the same columns (the enqueue statement is unchanged — it only sets the base columns):

```ts
const DIGEST_JOBS_DDL = `
  CREATE TABLE IF NOT EXISTS digest_jobs (
    round_id       INTEGER PRIMARY KEY,
    league_id      INTEGER NOT NULL,
    status         TEXT NOT NULL,
    gen_params     TEXT,
    error          TEXT,
    approval_token TEXT,
    decision       TEXT,
    decided_at     TEXT,
    review_url     TEXT,
    attempts       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
`;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test --prefix ui -- run src/lib/db/digestJobsColumns.test.ts`
Expected: PASS.
Run: `npm test --prefix ui -- run src/lib/digest/jobs.test.ts` (existing enqueue/claim tests still green against the wider table)
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add ui/src/lib/db/schema.ts ui/src/lib/db/client.ts src/email/digestJobs.ts ui/src/lib/db/digestJobsColumns.test.ts
git commit -m "feat(digest): add approval + attempts columns to digest_jobs"
```

---

### Task 2: Structural-review helper

**Files:**
- Create: `ui/src/lib/digest/structuralReview.ts`
- Test: `ui/src/lib/digest/structuralReview.test.ts`

**Interfaces:**
- Consumes: `getNextRound(db, roundId)` from `$lib/db/nextRound.js` (returns `NextRoundPreview | null`).
- Produces: `structuralReviewReason(db: Database.Database, roundId: number, nowIso: string): string | null` — returns a human-readable reason when the round should force human review (season-final / no submissions / no votes / no description), else `null`. Mirrors the structural holds in `resolveScheduledDigest` (`schedule.ts`), excluding the draft/finalized gates.

- [ ] **Step 1: Write the failing tests**

Create `ui/src/lib/digest/structuralReview.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { structuralReviewReason } from './structuralReview.js';

// Minimal schema slice this helper touches.
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE leagues (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER);
    CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER, description TEXT);
    CREATE TABLE ml_submissions (round_id INTEGER);
    CREATE TABLE votes (round_id INTEGER);
  `);
  db.prepare('INSERT INTO leagues (id, name) VALUES (1, ?)').run('Test League');
  db.prepare('INSERT INTO seasons (id, league_id, season_number) VALUES (1, 1, 1)').run();
  return db;
}

// A clean, sendable round needs: a successor round, >=1 submission, >=1 vote, a description.
function seedRound(db: Database.Database, id: number, description: string | null, subs: number, votes: number) {
  db.prepare('INSERT INTO rounds (id, season_id, description) VALUES (?, 1, ?)').run(id, description);
  for (let i = 0; i < subs; i++) db.prepare('INSERT INTO ml_submissions (round_id) VALUES (?)').run(id);
  for (let i = 0; i < votes; i++) db.prepare('INSERT INTO votes (round_id) VALUES (?)').run(id);
}

const NOW = '2026-07-17T00:00:00Z';

describe('structuralReviewReason', () => {
  let db: Database.Database;
  beforeEach(() => { db = makeDb(); });

  it('returns null for a clean, sendable round (has a successor)', () => {
    seedRound(db, 10, 'Songs about rain', 3, 5);
    seedRound(db, 11, 'Next theme', 3, 5); // successor → round 10 is not season-final
    expect(structuralReviewReason(db, 10, NOW)).toBeNull();
  });

  it('flags a season-final round (no successor)', () => {
    seedRound(db, 10, 'Finale', 3, 5); // no round 11 → season-final
    expect(structuralReviewReason(db, 10, NOW)).toMatch(/season-final/i);
  });

  it('flags a round with no submissions', () => {
    seedRound(db, 10, 'Theme', 0, 0);
    seedRound(db, 11, 'Next', 3, 5);
    expect(structuralReviewReason(db, 10, NOW)).toMatch(/submission/i);
  });

  it('flags a round with submissions but no votes', () => {
    seedRound(db, 10, 'Theme', 3, 0);
    seedRound(db, 11, 'Next', 3, 5);
    expect(structuralReviewReason(db, 10, NOW)).toMatch(/vote/i);
  });

  it('flags a round with no theme description', () => {
    seedRound(db, 10, '   ', 3, 5);
    seedRound(db, 11, 'Next', 3, 5);
    expect(structuralReviewReason(db, 10, NOW)).toMatch(/description|theme/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix ui -- run src/lib/digest/structuralReview.test.ts`
Expected: FAIL — `structuralReviewReason` not defined.

- [ ] **Step 3: Implement the helper**

Create `ui/src/lib/digest/structuralReview.ts`:

```ts
import type Database from 'better-sqlite3';
import { getNextRound } from '$lib/db/nextRound.js';

/**
 * Why a completed round must go to a human before it can be sent — mirrors the
 * structural holds in `resolveScheduledDigest` (schedule.ts), MINUS the draft /
 * finalized gates (those are the approval mechanism, not review triggers).
 * Returns the reason string, or null if the round is structurally sendable.
 */
export function structuralReviewReason(
  db: Database.Database,
  roundId: number,
  _nowIso: string,
): string | null {
  const round = db.prepare('SELECT id, description FROM rounds WHERE id = ?').get(roundId) as
    | { id: number; description: string | null }
    | undefined;
  if (!round) return 'round not found';

  // Season-final: no later round → the next-round teaser renders empty and the
  // round wants a hand-worked recap. Tied to getNextRound exactly like the resolver.
  if (getNextRound(db, roundId) === null) {
    return 'season-final round — needs a hand-worked recap, and the next-round teaser would be empty';
  }

  const subs = (db.prepare('SELECT COUNT(*) AS n FROM ml_submissions WHERE round_id = ?').get(roundId) as { n: number }).n;
  if (subs === 0) return 'round has no submissions';

  const votes = (db.prepare('SELECT COUNT(*) AS n FROM votes WHERE round_id = ?').get(roundId) as { n: number }).n;
  if (votes === 0) return 'voting closed but no votes were recorded';

  if (!round.description?.trim()) return 'round has no theme description';

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix ui -- run src/lib/digest/structuralReview.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/digest/structuralReview.ts ui/src/lib/digest/structuralReview.test.ts
git commit -m "feat(digest): structuralReviewReason — resolver-parity review gate"
```

---

### Task 3: Approvals lib — token lifecycle + approve/deny orchestration

**Files:**
- Create: `ui/src/lib/digest/approvals.ts`
- Test: `ui/src/lib/digest/approvals.test.ts`

**Interfaces:**
- Consumes: the `digest_jobs` approval columns from Task 1.
- Produces:
  - `generateApprovalToken(): string` — 32-char-ish URL-safe random token.
  - `setAwaitingApproval(db, roundId, token, reviewUrl, nowIso): void` — status `awaiting_approval` + token + review_url.
  - `setAwaitingReview(db, roundId, token, reviewUrl, nowIso): void` — status `awaiting_review` + token + review_url.
  - `resolveJobByToken(db, token): { roundId: number; status: string } | undefined`.
  - `interface ApproveDeps { finalize(roundId): Promise<void>; triggerSend(): Promise<void>; now(): string }`
  - `approveJob(db, token, deps: ApproveDeps): Promise<ApiResult>` where `ApiResult = { ok: boolean; roundId?: number; reason?: string }`.
  - `denyJob(db, token, now: () => string): Promise<ApiResult>`.

- [ ] **Step 1: Write the failing tests**

Create `ui/src/lib/digest/approvals.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  generateApprovalToken, setAwaitingApproval, setAwaitingReview,
  resolveJobByToken, approveJob, denyJob,
} from './approvals.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE digest_jobs (
      round_id INTEGER PRIMARY KEY, league_id INTEGER NOT NULL, status TEXT NOT NULL,
      gen_params TEXT, error TEXT, approval_token TEXT, decision TEXT, decided_at TEXT,
      review_url TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  db.prepare(`INSERT INTO digest_jobs (round_id, league_id, status, created_at, updated_at)
              VALUES (7, 1, 'rendered', '2026-07-17T00:00:00Z', '2026-07-17T00:00:00Z')`).run();
  return db;
}
const NOW = '2026-07-17T09:00:00Z';
const status = (db: Database.Database, id = 7) =>
  (db.prepare('SELECT status FROM digest_jobs WHERE round_id=?').get(id) as { status: string }).status;

describe('token lifecycle', () => {
  it('generates distinct, non-empty tokens', () => {
    const a = generateApprovalToken(); const b = generateApprovalToken();
    expect(a.length).toBeGreaterThan(16); expect(a).not.toBe(b);
  });
  it('setAwaitingApproval stores token + review_url + status', () => {
    const db = makeDb();
    setAwaitingApproval(db, 7, 'tok123', 'https://d/x', NOW);
    expect(status(db)).toBe('awaiting_approval');
    expect(resolveJobByToken(db, 'tok123')).toEqual({ roundId: 7, status: 'awaiting_approval' });
  });
  it('setAwaitingReview stores token + status awaiting_review', () => {
    const db = makeDb();
    setAwaitingReview(db, 7, 'tok456', 'https://d/x', NOW);
    expect(status(db)).toBe('awaiting_review');
    expect(resolveJobByToken(db, 'tok456')).toEqual({ roundId: 7, status: 'awaiting_review' });
  });
  it('resolveJobByToken returns undefined for an unknown token', () => {
    expect(resolveJobByToken(makeDb(), 'nope')).toBeUndefined();
  });
});

describe('approveJob', () => {
  it('finalizes, triggers send, marks approved+done, consumes the token', async () => {
    const db = makeDb();
    setAwaitingApproval(db, 7, 'tok', 'https://d/x', NOW);
    const finalize = vi.fn().mockResolvedValue(undefined);
    const triggerSend = vi.fn().mockResolvedValue(undefined);
    const res = await approveJob(db, 'tok', { finalize, triggerSend, now: () => NOW });
    expect(res).toEqual({ ok: true, roundId: 7 });
    expect(finalize).toHaveBeenCalledWith(7);
    expect(triggerSend).toHaveBeenCalledTimes(1);
    expect(status(db)).toBe('done');
    const row = db.prepare('SELECT decision, approval_token FROM digest_jobs WHERE round_id=7').get() as { decision: string; approval_token: string | null };
    expect(row.decision).toBe('approved');
    expect(row.approval_token).toBeNull(); // single-use
  });
  it('rejects an unknown token without finalizing', async () => {
    const db = makeDb();
    const finalize = vi.fn();
    const res = await approveJob(db, 'bad', { finalize, triggerSend: vi.fn(), now: () => NOW });
    expect(res.ok).toBe(false);
    expect(finalize).not.toHaveBeenCalled();
  });
  it('rejects a token whose job is not awaiting_approval (e.g. awaiting_review)', async () => {
    const db = makeDb();
    setAwaitingReview(db, 7, 'tok', 'https://d/x', NOW);
    const res = await approveJob(db, 'tok', { finalize: vi.fn(), triggerSend: vi.fn(), now: () => NOW });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/awaiting approval/i);
  });
  it('a second approve with the same (now-consumed) token is rejected', async () => {
    const db = makeDb();
    setAwaitingApproval(db, 7, 'tok', 'https://d/x', NOW);
    await approveJob(db, 'tok', { finalize: vi.fn().mockResolvedValue(undefined), triggerSend: vi.fn().mockResolvedValue(undefined), now: () => NOW });
    const res = await approveJob(db, 'tok', { finalize: vi.fn(), triggerSend: vi.fn(), now: () => NOW });
    expect(res.ok).toBe(false);
  });
});

describe('denyJob', () => {
  it('marks denied, consumes token, leaves status denied', async () => {
    const db = makeDb();
    setAwaitingApproval(db, 7, 'tok', 'https://d/x', NOW);
    const res = await denyJob(db, 'tok', () => NOW);
    expect(res).toEqual({ ok: true, roundId: 7 });
    expect(status(db)).toBe('denied');
    const row = db.prepare('SELECT decision, approval_token FROM digest_jobs WHERE round_id=7').get() as { decision: string; approval_token: string | null };
    expect(row.decision).toBe('denied');
    expect(row.approval_token).toBeNull();
  });
  it('denies a token in awaiting_review too', async () => {
    const db = makeDb();
    setAwaitingReview(db, 7, 'tok', 'https://d/x', NOW);
    expect((await denyJob(db, 'tok', () => NOW)).ok).toBe(true);
    expect(status(db)).toBe('denied');
  });
  it('rejects an unknown token', async () => {
    expect((await denyJob(makeDb(), 'bad', () => NOW)).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix ui -- run src/lib/digest/approvals.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the approvals lib**

Create `ui/src/lib/digest/approvals.ts`:

```ts
import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';

export interface ApiResult {
  ok: boolean;
  roundId?: number;
  reason?: string;
}

export interface ApproveDeps {
  finalize: (roundId: number) => Promise<void>;
  triggerSend: () => Promise<void>;
  now: () => string;
}

export function generateApprovalToken(): string {
  return randomBytes(24).toString('base64url');
}

export function setAwaitingApproval(
  db: Database.Database, roundId: number, token: string, reviewUrl: string, nowIso: string,
): void {
  db.prepare(
    `UPDATE digest_jobs SET status='awaiting_approval', approval_token=?, review_url=?, updated_at=? WHERE round_id=?`,
  ).run(token, reviewUrl, nowIso, roundId);
}

export function setAwaitingReview(
  db: Database.Database, roundId: number, token: string, reviewUrl: string, nowIso: string,
): void {
  db.prepare(
    `UPDATE digest_jobs SET status='awaiting_review', approval_token=?, review_url=?, updated_at=? WHERE round_id=?`,
  ).run(token, reviewUrl, nowIso, roundId);
}

export function resolveJobByToken(
  db: Database.Database, token: string,
): { roundId: number; status: string } | undefined {
  if (!token) return undefined;
  const row = db.prepare('SELECT round_id, status FROM digest_jobs WHERE approval_token=?').get(token) as
    | { round_id: number; status: string }
    | undefined;
  return row ? { roundId: row.round_id, status: row.status } : undefined;
}

export async function approveJob(db: Database.Database, token: string, deps: ApproveDeps): Promise<ApiResult> {
  const job = resolveJobByToken(db, token);
  if (!job) return { ok: false, reason: 'invalid or already-used token' };
  if (job.status !== 'awaiting_approval') {
    return { ok: false, reason: `round ${job.roundId} is not awaiting approval (status=${job.status})` };
  }
  // Consume the token and mark the decision BEFORE the side effects, so a
  // double-tap can never fire finalize/send twice (single-use is atomic here).
  db.prepare(
    `UPDATE digest_jobs SET approval_token=NULL, decision='approved', decided_at=?, status='finalizing', updated_at=? WHERE round_id=?`,
  ).run(deps.now(), deps.now(), job.roundId);
  try {
    await deps.finalize(job.roundId);
    await deps.triggerSend();
  } catch (err) {
    db.prepare(`UPDATE digest_jobs SET status='failed', error=?, updated_at=? WHERE round_id=?`)
      .run(err instanceof Error ? err.message : String(err), deps.now(), job.roundId);
    return { ok: false, roundId: job.roundId, reason: `approve failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  db.prepare(`UPDATE digest_jobs SET status='done', updated_at=? WHERE round_id=?`).run(deps.now(), job.roundId);
  return { ok: true, roundId: job.roundId };
}

export async function denyJob(db: Database.Database, token: string, now: () => string): Promise<ApiResult> {
  const job = resolveJobByToken(db, token);
  if (!job) return { ok: false, reason: 'invalid or already-used token' };
  if (job.status !== 'awaiting_approval' && job.status !== 'awaiting_review') {
    return { ok: false, reason: `round ${job.roundId} is not awaiting a decision (status=${job.status})` };
  }
  db.prepare(
    `UPDATE digest_jobs SET approval_token=NULL, decision='denied', decided_at=?, status='denied', updated_at=? WHERE round_id=?`,
  ).run(now(), now(), job.roundId);
  return { ok: true, roundId: job.roundId };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix ui -- run src/lib/digest/approvals.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/digest/approvals.ts ui/src/lib/digest/approvals.test.ts
git commit -m "feat(digest): approvals lib — single-use token + approve/deny orchestration"
```

---

### Task 4: Runner branch — review gate + approval hold

**Files:**
- Modify: `ui/src/lib/digest/runner.ts`
- Test: `ui/src/lib/digest/runner.test.ts` (extend)

**Interfaces:**
- Consumes: `structuralReviewReason` (Task 2), `awaitApproval`/`awaitReview` collaborators (wired in Task 7).
- Produces: `RunnerDeps` gains `structuralReview: (roundId: number) => string | null`, `awaitApproval: (roundId: number, leagueId: number, reviewUrl: string) => void | Promise<void>`, `awaitReview: (roundId: number, leagueId: number, reviewUrl: string, reason: string) => void | Promise<void>`. `runOneJob` uses the render URL as the review URL and branches: `off` → silent hold; structural reason → `awaitReview`; `hil` clean → `awaitApproval`; `auto` clean → finalize+send.

- [ ] **Step 1: Write the failing tests**

In `ui/src/lib/digest/runner.test.ts`, update the shared `deps()` factory to add the three new deps, then add the branch matrix. Edit the factory:

```ts
function deps(over: Partial<RunnerDeps> = {}): RunnerDeps {
  return {
    claim: vi.fn().mockReturnValue({ roundId: 7, leagueId: 1, gen_params: null }),
    transition: vi.fn(), fail: vi.fn(),
    capture: vi.fn().mockResolvedValue({ ok: true, imported: {} }),
    generate: vi.fn().mockResolvedValue(undefined),
    render: vi.fn().mockResolvedValue({ url: 'https://d/x' }),
    leagueConfig: vi.fn().mockReturnValue({ mode: 'auto', genParams: {} }),
    finalize: vi.fn().mockResolvedValue(undefined),
    structuralReview: vi.fn().mockReturnValue(null),
    awaitApproval: vi.fn(), awaitReview: vi.fn(),
    log: vi.fn(), now: () => '2026-07-17T09:00:00Z',
    ...over,
  };
}
```

Replace the existing `'hil/off-mode holds at rendered and never finalizes'` test with this matrix:

```ts
it('auto + clean: finalizes and returns ok', async () => {
  const d = deps();
  expect(await runOneJob(d)).toBe('ok');
  expect(d.finalize).toHaveBeenCalledWith(7);
  expect(d.awaitApproval).not.toHaveBeenCalled();
  expect(d.awaitReview).not.toHaveBeenCalled();
});

it('hil + clean: awaits approval, never finalizes', async () => {
  const d = deps({ leagueConfig: vi.fn().mockReturnValue({ mode: 'hil', genParams: {} }) });
  expect(await runOneJob(d)).toBe('held');
  expect(d.awaitApproval).toHaveBeenCalledWith(7, 1, 'https://d/x');
  expect(d.finalize).not.toHaveBeenCalled();
});

it('auto + structural review: escalates to review, never finalizes (item-11 fix)', async () => {
  const d = deps({ structuralReview: vi.fn().mockReturnValue('season-final round') });
  expect(await runOneJob(d)).toBe('held');
  expect(d.awaitReview).toHaveBeenCalledWith(7, 1, 'https://d/x', 'season-final round');
  expect(d.finalize).not.toHaveBeenCalled();
  expect(d.awaitApproval).not.toHaveBeenCalled();
});

it('hil + structural review: awaits review, not approval', async () => {
  const d = deps({
    leagueConfig: vi.fn().mockReturnValue({ mode: 'hil', genParams: {} }),
    structuralReview: vi.fn().mockReturnValue('round has no votes'),
  });
  expect(await runOneJob(d)).toBe('held');
  expect(d.awaitReview).toHaveBeenCalledWith(7, 1, 'https://d/x', 'round has no votes');
  expect(d.awaitApproval).not.toHaveBeenCalled();
});

it('off mode: holds silently — no approval, no review, no finalize', async () => {
  const d = deps({ leagueConfig: vi.fn().mockReturnValue({ mode: 'off', genParams: {} }) });
  expect(await runOneJob(d)).toBe('held');
  expect(d.awaitApproval).not.toHaveBeenCalled();
  expect(d.awaitReview).not.toHaveBeenCalled();
  expect(d.finalize).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix ui -- run src/lib/digest/runner.test.ts`
Expected: FAIL — `awaitApproval`/`awaitReview`/`structuralReview` not on the deps type; branch not implemented.

- [ ] **Step 3: Rewrite the runner branch**

In `ui/src/lib/digest/runner.ts`, first extend `RunnerDeps` with the three new members (add them next to `finalize`):

```ts
  structuralReview: (roundId: number) => string | null;
  awaitApproval: (roundId: number, leagueId: number, reviewUrl: string) => void | Promise<void>;
  awaitReview: (roundId: number, leagueId: number, reviewUrl: string, reason: string) => void | Promise<void>;
```

Then replace the **entire body of the `try` block** (from `const cap = await deps.capture(roundId);` through `return 'ok';`) with this — note `cfg` is declared exactly once, before `generate`, and reused by the branch:

```ts
    const cap = await deps.capture(roundId);
    if (!cap.ok) { deps.fail(roundId, `capture ${cap.stage}: ${cap.reason}`, deps.now()); return 'failed'; }

    const cfg = deps.leagueConfig(leagueId);

    deps.transition(roundId, 'generating', deps.now());
    await deps.generate(roundId, cfg.genParams);

    deps.transition(roundId, 'rendered', deps.now());
    const { url } = await deps.render(roundId);

    if (cfg.mode === 'off') {
      deps.log(`[digest-runner] round ${roundId}: held (mode=off) — no notification`);
      return 'held';
    }

    const reviewReason = deps.structuralReview(roundId);
    if (reviewReason) {
      await deps.awaitReview(roundId, leagueId, url, reviewReason);
      deps.log(`[digest-runner] round ${roundId}: awaiting_review — ${reviewReason}`);
      return 'held';
    }

    if (cfg.mode !== 'auto') {
      await deps.awaitApproval(roundId, leagueId, url);
      deps.log(`[digest-runner] round ${roundId}: awaiting_approval (mode=${cfg.mode})`);
      return 'held';
    }

    deps.transition(roundId, 'finalizing', deps.now());
    await deps.finalize(roundId);
    deps.transition(roundId, 'done', deps.now());
    deps.log(`[digest-runner] round ${roundId}: auto-finalized; existing poller will send`);
    return 'ok';
```

Verify the final order is: capture → `cfg = leagueConfig` (once) → transition generating → generate(cfg.genParams) → transition rendered → render → branch. There must be exactly one `const cfg` declaration.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix ui -- run src/lib/digest/runner.test.ts`
Expected: PASS (the full matrix + the unchanged capture-failure / thrown-error tests).

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/digest/runner.ts ui/src/lib/digest/runner.test.ts
git commit -m "feat(digest): runner review-gate + approval-hold branch"
```

---

### Task 5: ntfy module — publish + notification builders

**Files:**
- Create: `ui/src/lib/digest/ntfy.ts`
- Test: `ui/src/lib/digest/ntfy.test.ts`

**Interfaces:**
- Produces:
  - `interface NtfyConfig { url: string; topic: string; token?: string }`
  - `ntfyConfigFromEnv(env: Record<string, string | undefined>): NtfyConfig | null` — null when `NTFY_URL`/`NTFY_TOPIC` missing.
  - `interface NtfyAction { action: 'http' | 'view'; label: string; url: string; method?: string; headers?: Record<string, string>; body?: string; clear?: boolean }`
  - `interface Notification { title: string; message: string; click?: string; actions?: NtfyAction[]; priority?: number; tags?: string[] }`
  - `buildApprovalNotification(o: { league: string; round: string; reviewUrl: string; approveUrl: string; denyUrl: string; editUrl: string; token: string; bearer?: string }): Notification`
  - `buildReviewNotification(o: { league: string; round: string; reviewUrl: string; editUrl: string; denyUrl: string; token: string; reason: string; bearer?: string }): Notification`
  - `buildFailureNotification(o: { stage: string; reason: string; roundId?: number }): Notification`
  - `publish(cfg: NtfyConfig, n: Notification, fetchFn?: typeof fetch): Promise<boolean>` — never throws; returns false on failure.

- [ ] **Step 1: Write the failing tests**

Create `ui/src/lib/digest/ntfy.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  ntfyConfigFromEnv, buildApprovalNotification, buildReviewNotification,
  buildFailureNotification, publish,
} from './ntfy.js';

describe('ntfyConfigFromEnv', () => {
  it('returns null when url/topic missing', () => {
    expect(ntfyConfigFromEnv({})).toBeNull();
    expect(ntfyConfigFromEnv({ NTFY_URL: 'https://n' })).toBeNull();
  });
  it('reads url/topic/token from env', () => {
    expect(ntfyConfigFromEnv({ NTFY_URL: 'https://n', NTFY_TOPIC: 't', NTFY_TOKEN: 'k' }))
      .toEqual({ url: 'https://n', topic: 't', token: 'k' });
  });
});

describe('buildApprovalNotification', () => {
  const n = buildApprovalNotification({
    league: 'Fam Jam', round: 'Round 12', reviewUrl: 'https://d/x',
    approveUrl: 'https://mlb37/api/digest/approve', denyUrl: 'https://mlb37/api/digest/deny',
    editUrl: 'https://mlb37/digest/12', token: 'tok', bearer: 'BR',
  });
  it('titles with league + round and clicks through to the review link', () => {
    expect(n.title).toContain('Fam Jam'); expect(n.title).toContain('Round 12');
    expect(n.click).toBe('https://d/x');
  });
  it('has exactly Approve / Edit / Deny actions', () => {
    expect(n.actions?.map((a) => a.label)).toEqual(['Approve', 'Edit', 'Deny']);
  });
  it('Approve+Deny are token-authed http POSTs carrying the bearer', () => {
    const approve = n.actions!.find((a) => a.label === 'Approve')!;
    expect(approve.action).toBe('http'); expect(approve.method).toBe('POST');
    expect(approve.url).toContain('/approve');
    expect(approve.headers?.Authorization).toBe('Bearer BR');
    expect(approve.body).toContain('tok');
  });
  it('Edit is a view action to the editor', () => {
    const edit = n.actions!.find((a) => a.label === 'Edit')!;
    expect(edit.action).toBe('view'); expect(edit.url).toBe('https://mlb37/digest/12');
  });
});

describe('buildReviewNotification', () => {
  const n = buildReviewNotification({
    league: 'Fam Jam', round: 'Round 12', reviewUrl: 'https://d/x',
    editUrl: 'https://mlb37/digest/12', denyUrl: 'https://mlb37/api/digest/deny',
    token: 'tok', reason: 'season-final round', bearer: 'BR',
  });
  it('mentions the reason and has NO Approve action', () => {
    expect(n.message).toMatch(/season-final/i);
    expect(n.actions?.map((a) => a.label)).toEqual(['Review', 'Deny']);
    expect(n.actions?.some((a) => a.label === 'Approve')).toBe(false);
  });
});

describe('buildFailureNotification', () => {
  it('carries stage + reason', () => {
    const n = buildFailureNotification({ stage: 'capture', reason: 'ML auth expired', roundId: 7 });
    expect(n.title).toMatch(/digest/i);
    expect(n.message).toContain('capture'); expect(n.message).toContain('ML auth expired');
  });
});

describe('publish', () => {
  it('POSTs to base url with topic + bearer and returns true on 2xx', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    const ok = await publish({ url: 'https://n', topic: 't', token: 'k' },
      { title: 'T', message: 'M' }, fetchFn as unknown as typeof fetch);
    expect(ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://n/t');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect(JSON.parse(init.body as string)).toMatchObject({ topic: 't', title: 'T', message: 'M' });
  });
  it('returns false (never throws) when fetch rejects', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network'));
    await expect(publish({ url: 'https://n', topic: 't' }, { title: 'T', message: 'M' }, fetchFn as unknown as typeof fetch))
      .resolves.toBe(false);
  });
  it('returns false on a non-2xx response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    await expect(publish({ url: 'https://n', topic: 't' }, { title: 'T', message: 'M' }, fetchFn as unknown as typeof fetch))
      .resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix ui -- run src/lib/digest/ntfy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the ntfy module**

Create `ui/src/lib/digest/ntfy.ts`:

```ts
export interface NtfyConfig {
  url: string;
  topic: string;
  token?: string;
}

export interface NtfyAction {
  action: 'http' | 'view';
  label: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  clear?: boolean;
}

export interface Notification {
  title: string;
  message: string;
  click?: string;
  actions?: NtfyAction[];
  priority?: number;
  tags?: string[];
}

export function ntfyConfigFromEnv(env: Record<string, string | undefined>): NtfyConfig | null {
  if (!env.NTFY_URL || !env.NTFY_TOPIC) return null;
  return { url: env.NTFY_URL, topic: env.NTFY_TOPIC, token: env.NTFY_TOKEN };
}

function authedPost(url: string, token: string, bearer?: string): NtfyAction {
  return {
    action: 'http', label: '', url, method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify({ token }),
    clear: true,
  };
}

export function buildApprovalNotification(o: {
  league: string; round: string; reviewUrl: string;
  approveUrl: string; denyUrl: string; editUrl: string; token: string; bearer?: string;
}): Notification {
  return {
    title: `${o.league} — ${o.round}`,
    message: 'Digest ready. Approve to post, Edit to open the editor, or Deny to drop it.',
    click: o.reviewUrl,
    priority: 4,
    tags: ['musical_note'],
    actions: [
      { ...authedPost(o.approveUrl, o.token, o.bearer), label: 'Approve' },
      { action: 'view', label: 'Edit', url: o.editUrl, clear: false },
      { ...authedPost(o.denyUrl, o.token, o.bearer), label: 'Deny' },
    ],
  };
}

export function buildReviewNotification(o: {
  league: string; round: string; reviewUrl: string;
  editUrl: string; denyUrl: string; token: string; reason: string; bearer?: string;
}): Notification {
  return {
    title: `${o.league} — ${o.round} (needs review)`,
    message: `Needs a human before it can post: ${o.reason}. Open the editor to review.`,
    click: o.reviewUrl,
    priority: 4,
    tags: ['warning'],
    actions: [
      { action: 'view', label: 'Review', url: o.editUrl, clear: false },
      { ...authedPost(o.denyUrl, o.token, o.bearer), label: 'Deny' },
    ],
  };
}

export function buildFailureNotification(o: { stage: string; reason: string; roundId?: number }): Notification {
  return {
    title: '⚠ digest pipeline',
    message: `${o.stage} failed${o.roundId ? ` (round ${o.roundId})` : ''}: ${o.reason}`,
    priority: 5,
    tags: ['rotating_light'],
  };
}

export async function publish(cfg: NtfyConfig, n: Notification, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(`${cfg.url}/${cfg.topic}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
      },
      body: JSON.stringify({
        topic: cfg.topic, title: n.title, message: n.message,
        click: n.click, actions: n.actions, priority: n.priority, tags: n.tags,
      }),
    });
    if (!res.ok) {
      console.error(`[ntfy] publish → ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[ntfy] publish failed:', e instanceof Error ? e.message : String(e));
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix ui -- run src/lib/digest/ntfy.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/digest/ntfy.ts ui/src/lib/digest/ntfy.test.ts
git commit -m "feat(digest): ntfy module — publish + approval/review/failure builders"
```

---

### Task 6: Force fresh regeneration on the draft endpoint

**Files:**
- Modify: `ui/src/routes/api/digest/[roundId]/draft/+server.ts`
- Test: `ui/src/lib/digest/draftForce.test.ts` (new — tests the pure force-decision helper)

**Interfaces:**
- Produces: the `/draft` endpoint honors a `force: true` body flag — it skips the cached-draft short-circuit and deletes prior drafts before regenerating, even when no `GenParams` are supplied. Extract the decision into a tiny pure helper `shouldRegenerate(genParams, force)` so it is unit-tested without SvelteKit.

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/digest/draftForce.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldRegenerate } from './draftForce.js';

describe('shouldRegenerate', () => {
  it('reuses cache when no params and not forced', () => {
    expect(shouldRegenerate(null, false)).toBe(false);
  });
  it('regenerates when forced even without params', () => {
    expect(shouldRegenerate(null, true)).toBe(true);
  });
  it('regenerates when params are present', () => {
    expect(shouldRegenerate({ sections: [{ id: 'podium', enabled: true }] } as never, false)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix ui -- run src/lib/digest/draftForce.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `ui/src/lib/digest/draftForce.ts`:

```ts
import type { GenParams } from '$lib/digest/llm.js';

/** True when a fresh generation is required (params supplied, or force requested). */
export function shouldRegenerate(genParams: GenParams | null, force: boolean): boolean {
  return force || genParams !== null;
}
```

- [ ] **Step 4: Wire it into the endpoint**

In `ui/src/routes/api/digest/[roundId]/draft/+server.ts`:

1. Import the helper and read the body once (currently `parseGenParams(await readBody(request))` consumes the body):

```ts
import { shouldRegenerate } from '$lib/digest/draftForce.js';
```

2. Replace `const genParams = parseGenParams(await readBody(request));` with:

```ts
  const body = await readBody(request);
  const force = !!(body && typeof body === 'object' && (body as { force?: unknown }).force === true);
  const genParams = parseGenParams(body);
  const regenerate = shouldRegenerate(genParams, force);
```

3. Change the cache short-circuit guard from `if (cached && !genParams) {` to:

```ts
  if (cached && !regenerate) {
```

4. Change the prior-draft delete guard from `if (genParams) {` to:

```ts
  if (regenerate) {
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --prefix ui -- run src/lib/digest/draftForce.test.ts`
Expected: PASS.
Run: `npm test --prefix ui -- run src/lib/digest/pipeline.test.ts src/lib/digest/llm.test.ts`
Expected: PASS (no regression in generation paths).

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/digest/draftForce.ts ui/src/lib/digest/draftForce.test.ts "ui/src/routes/api/digest/[roundId]/draft/+server.ts"
git commit -m "feat(digest): /draft honors force flag to always regenerate"
```

---

### Task 7: Wire the runner loop — collaborators, force-regen, failure alerts

**Files:**
- Modify: `ui/src/lib/digest/runnerLoop.ts`
- Test: `ui/src/lib/digest/runnerLoop.test.ts` (extend the existing assembly test)

**Interfaces:**
- Consumes: `structuralReviewReason` (Task 2), `generateApprovalToken`/`setAwaitingApproval`/`setAwaitingReview` (Task 3), `ntfyConfigFromEnv`/`publish`/`buildApprovalNotification`/`buildReviewNotification`/`buildFailureNotification` (Task 5), the `force` flag (Task 6).
- Produces: `buildRunnerDeps()` returns a `RunnerDeps` whose `generate` sends `force: true`, whose `structuralReview`/`awaitApproval`/`awaitReview` are wired to real DB + ntfy, and whose `fail` also publishes a failure alert (additive; the owner-DM path is untouched).

- [ ] **Step 1: Extend the assembly test**

In `ui/src/lib/digest/runnerLoop.test.ts`, assert the new deps exist and are functions (the existing test already checks the shape). Add:

```ts
it('buildRunnerDeps wires the review-gate + approval collaborators', () => {
  const d = buildRunnerDeps();
  expect(typeof d.structuralReview).toBe('function');
  expect(typeof d.awaitApproval).toBe('function');
  expect(typeof d.awaitReview).toBe('function');
});
```

(If `runnerLoop.test.ts` does not yet exist or imports differ, mirror the existing import of `buildRunnerDeps` from `./runnerLoop.js`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix ui -- run src/lib/digest/runnerLoop.test.ts`
Expected: FAIL — deps not present.

- [ ] **Step 3: Wire the collaborators**

In `ui/src/lib/digest/runnerLoop.ts`, add imports:

```ts
import { structuralReviewReason } from './structuralReview.js';
import { generateApprovalToken, setAwaitingApproval, setAwaitingReview } from './approvals.js';
import { ntfyConfigFromEnv, publish, buildApprovalNotification, buildReviewNotification, buildFailureNotification } from './ntfy.js';
```

Add a helper above `buildRunnerDeps` to look up display names and the public app base:

```ts
const appBase = process.env.PUBLIC_APP_URL ?? 'https://mlb37.mattmariani.com';

function names(roundId: number, leagueId: number): { league: string; round: string } {
  const db = getDb();
  const league = (db.prepare('SELECT name FROM leagues WHERE id=?').get(leagueId) as { name?: string } | undefined)?.name ?? `League ${leagueId}`;
  const round = (db.prepare('SELECT name FROM rounds WHERE id=?').get(roundId) as { name?: string } | undefined)?.name ?? `Round ${roundId}`;
  return { league, round };
}
```

Note: confirm `rounds` has a `name` column (grep `rounds` in `schema.ts`); the manual render endpoint uses `round.name`, so it exists. If a round's name can be null, the `?? 'Round N'` fallback covers it.

In `buildRunnerDeps()`, change `generate` to force regeneration:

```ts
    generate: async (roundId, genParams) => {
      const res = await fetch(`${baseUrl}/api/digest/${roundId}/draft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...((genParams as object) ?? {}), force: true }),
      });
      if (!res.ok) throw new Error(`draft ${res.status}`);
    },
```

Add the three new deps to the returned object:

```ts
    structuralReview: (roundId) => structuralReviewReason(getDb(), roundId, new Date().toISOString()),
    awaitApproval: async (roundId, leagueId, reviewUrl) => {
      const token = generateApprovalToken();
      setAwaitingApproval(getDb(), roundId, token, reviewUrl, new Date().toISOString());
      const cfg = ntfyConfigFromEnv(process.env);
      if (!cfg) return;
      const { league, round } = names(roundId, leagueId);
      await publish(cfg, buildApprovalNotification({
        league, round, reviewUrl,
        approveUrl: `${appBase}/api/digest/approve`,
        denyUrl: `${appBase}/api/digest/deny`,
        editUrl: `${appBase}/digest/${roundId}`,
        token, bearer: cfg.token,
      }));
    },
    awaitReview: async (roundId, leagueId, reviewUrl, reason) => {
      const token = generateApprovalToken();
      setAwaitingReview(getDb(), roundId, token, reviewUrl, new Date().toISOString());
      const cfg = ntfyConfigFromEnv(process.env);
      if (!cfg) return;
      const { league, round } = names(roundId, leagueId);
      await publish(cfg, buildReviewNotification({
        league, round, reviewUrl,
        editUrl: `${appBase}/digest/${roundId}`,
        denyUrl: `${appBase}/api/digest/deny`,
        token, reason, bearer: cfg.token,
      }));
    },
```

Change `fail` to additionally publish a failure alert (keep the existing `failJob` call):

```ts
    fail: (roundId, error, now) => {
      failJob(getDb(), roundId, error, now);
      const cfg = ntfyConfigFromEnv(process.env);
      if (cfg) void publish(cfg, buildFailureNotification({ stage: 'runner', reason: error, roundId }));
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix ui -- run src/lib/digest/runnerLoop.test.ts`
Expected: PASS.
Run: `npm run check --prefix ui` (typecheck the wiring)
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/digest/runnerLoop.ts ui/src/lib/digest/runnerLoop.test.ts
git commit -m "feat(digest): wire runner loop — ntfy approval/review + force-regen + failure alerts"
```

---

### Task 8: Approve / Deny endpoints (bot-ui, two-layer auth)

**Files:**
- Create: `ui/src/routes/api/digest/approve/+server.ts`
- Create: `ui/src/routes/api/digest/deny/+server.ts`
- Create: `ui/src/lib/digest/callbackAuth.ts` (shared Bearer check)
- Test: `ui/src/lib/digest/callbackAuth.test.ts`

**Interfaces:**
- Consumes: `approveJob`/`denyJob` (Task 3), `NTFY_TOKEN`/`BOT_CONTROL_URL`/`BOT_UI_INTERNAL_URL` env.
- Produces: `bearerOk(authHeader: string | null, expected: string | undefined): boolean` — constant-ish shared-secret check; two public POST endpoints.

- [ ] **Step 1: Write the failing test for the Bearer check**

Create `ui/src/lib/digest/callbackAuth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bearerOk } from './callbackAuth.js';

describe('bearerOk', () => {
  it('accepts a matching bearer', () => {
    expect(bearerOk('Bearer abc', 'abc')).toBe(true);
  });
  it('rejects a mismatched bearer', () => {
    expect(bearerOk('Bearer wrong', 'abc')).toBe(false);
  });
  it('rejects a missing header', () => {
    expect(bearerOk(null, 'abc')).toBe(false);
  });
  it('rejects when no expected secret is configured (fail closed)', () => {
    expect(bearerOk('Bearer abc', undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix ui -- run src/lib/digest/callbackAuth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the Bearer check**

Create `ui/src/lib/digest/callbackAuth.ts`:

```ts
/**
 * Coarse shared-secret gate for the public approve/deny callbacks: the ntfy
 * action carries `Authorization: Bearer ${NTFY_TOKEN}`. Fail closed when no
 * expected secret is configured. The per-job single-use token (checked
 * separately) is the primary, job-scoped auth.
 */
export function bearerOk(authHeader: string | null, expected: string | undefined): boolean {
  if (!expected) return false;
  return authHeader === `Bearer ${expected}`;
}
```

- [ ] **Step 4: Create the approve endpoint**

Create `ui/src/routes/api/digest/approve/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { approveJob } from '$lib/digest/approvals.js';
import { bearerOk } from '$lib/digest/callbackAuth.js';

const uiBase = process.env.BOT_UI_INTERNAL_URL ?? 'http://localhost:3002';
const botControlUrl = process.env.BOT_CONTROL_URL ?? 'http://bot:3003';

export const POST: RequestHandler = async ({ request }) => {
  if (!bearerOk(request.headers.get('authorization'), process.env.NTFY_TOKEN)) {
    return json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === 'string' ? body.token : '';

  const result = await approveJob(getDb(), token, {
    finalize: async (roundId) => {
      const res = await fetch(`${uiBase}/api/digest/${roundId}/finalize`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'pdf' }),
      });
      if (!res.ok) throw new Error(`finalize ${res.status}`);
    },
    triggerSend: async () => {
      const res = await fetch(`${botControlUrl}/trigger`, { method: 'POST' });
      if (!res.ok) throw new Error(`trigger ${res.status}`);
    },
    now: () => new Date().toISOString(),
  });
  return json(result, { status: result.ok ? 200 : 400 });
};
```

- [ ] **Step 5: Create the deny endpoint**

Create `ui/src/routes/api/digest/deny/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { denyJob } from '$lib/digest/approvals.js';
import { bearerOk } from '$lib/digest/callbackAuth.js';

export const POST: RequestHandler = async ({ request }) => {
  if (!bearerOk(request.headers.get('authorization'), process.env.NTFY_TOKEN)) {
    return json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === 'string' ? body.token : '';
  const result = await denyJob(getDb(), token, () => new Date().toISOString());
  return json(result, { status: result.ok ? 200 : 400 });
};
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test --prefix ui -- run src/lib/digest/callbackAuth.test.ts`
Expected: PASS.
Run: `npm run check --prefix ui`
Expected: 0 errors (the endpoints typecheck against `approveJob`/`denyJob`).

- [ ] **Step 7: Commit**

```bash
git add ui/src/lib/digest/callbackAuth.ts ui/src/lib/digest/callbackAuth.test.ts ui/src/routes/api/digest/approve/+server.ts ui/src/routes/api/digest/deny/+server.ts
git commit -m "feat(digest): public approve/deny endpoints with two-layer auth"
```

---

### Task 9: Expose the bot control server to the compose network

**Files:**
- Modify: `src/control/server.ts` (bind host)
- Modify: `.env` (add `BOT_CONTROL_URL`)
- Test: `src/control/router.test.ts` (already exists — confirm still green; no new unit test — a bind-host change has no meaningful unit assertion and is verified in the Task 12 live smoke)

**Interfaces:**
- Produces: the bot control server binds `0.0.0.0` (still no published host port), reachable at `http://bot:3003` from sibling containers. bot-ui reads `BOT_CONTROL_URL`.

- [ ] **Step 1: Change the bind host**

In `src/control/server.ts`, replace:

```ts
const CONTROL_HOST = '127.0.0.1';
```

with:

```ts
// Bind on the compose network so bot-ui (a sibling container) can POST /trigger
// for immediate sends. NOT published to the host — see docker-compose.yml (`bot`
// has no `ports:`), so only sibling containers can reach it. /send stays dry-run
// by default and sendGuard stays fail-closed.
const CONTROL_HOST = process.env.BOT_CONTROL_HOST ?? '0.0.0.0';
```

Update the startup log line and the file's top comment to reflect "reachable by sibling compose containers" instead of "container-local only".

- [ ] **Step 2: Add the env var**

Add to `.env` (top-level):

```
BOT_CONTROL_URL=http://bot:3003
```

- [ ] **Step 3: Confirm the router tests still pass**

Run: `npm test -- run src/control/router.test.ts`
Expected: PASS (routing logic unchanged).
Run: `npm test -- run src/control/server.test.ts` (if present)
Expected: PASS.

- [ ] **Step 4: Typecheck the bot project**

Run: `npm run build` (or the project's `tsc --noEmit` equivalent — check `package.json` scripts)
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/control/server.ts .env
git commit -m "feat(control): bind bot control server to compose network for cross-container /trigger"
```

Note: `.env` may be gitignored. If `git add .env` is a no-op, record `BOT_CONTROL_URL=http://bot:3003` in the deploy notes / `.env.example` instead and commit that.

---

### Task 10: Retry / requeue for failed jobs

**Files:**
- Modify: `ui/src/lib/digest/jobs.ts` (add `failOrRetry`, `requeueJob`)
- Modify: `ui/src/lib/digest/runnerLoop.ts` (use `failOrRetry`; alert only on final fail)
- Create: `ui/src/routes/api/digest/[roundId]/requeue/+server.ts`
- Test: `ui/src/lib/digest/jobs.test.ts` (extend)

**Interfaces:**
- Produces:
  - `failOrRetry(db, roundId, error, nowIso, maxAttempts?): 'retry' | 'failed'` — increments `attempts`; sets `status='pending'` (retriable) while `attempts < maxAttempts` (default 3), else `status='failed'`.
  - `requeueJob(db, roundId, nowIso): void` — resets a `failed` row to `pending`, `attempts=0`, `error=NULL`.

- [ ] **Step 1: Write the failing tests**

In `ui/src/lib/digest/jobs.test.ts`, add (reuse whatever in-memory `digest_jobs` setup the file already has; if it seeds a narrower table, widen it to include `attempts INTEGER NOT NULL DEFAULT 0`):

```ts
import { failOrRetry, requeueJob } from './jobs.js';

describe('failOrRetry', () => {
  it('retries (status pending, attempts incremented) below the cap', () => {
    const db = seedJob(); // helper that inserts a job at round_id=7, status 'capturing', attempts 0
    expect(failOrRetry(db, 7, 'boom', 'NOW', 3)).toBe('retry');
    const row = db.prepare('SELECT status, attempts FROM digest_jobs WHERE round_id=7').get() as { status: string; attempts: number };
    expect(row.status).toBe('pending'); expect(row.attempts).toBe(1);
  });
  it('fails terminally at the cap', () => {
    const db = seedJob();
    failOrRetry(db, 7, 'boom', 'NOW', 2); // attempts→1, retry
    expect(failOrRetry(db, 7, 'boom', 'NOW', 2)).toBe('failed'); // attempts→2, cap
    const row = db.prepare('SELECT status, attempts FROM digest_jobs WHERE round_id=7').get() as { status: string; attempts: number };
    expect(row.status).toBe('failed'); expect(row.attempts).toBe(2);
  });
});

describe('requeueJob', () => {
  it('resets a failed job to pending with attempts 0', () => {
    const db = seedJob();
    db.prepare("UPDATE digest_jobs SET status='failed', attempts=3, error='x' WHERE round_id=7").run();
    requeueJob(db, 7, 'NOW');
    const row = db.prepare('SELECT status, attempts, error FROM digest_jobs WHERE round_id=7').get() as { status: string; attempts: number; error: string | null };
    expect(row).toMatchObject({ status: 'pending', attempts: 0, error: null });
  });
});
```

Add a `seedJob()` helper in the test file if one does not exist:

```ts
function seedJob(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE digest_jobs (
    round_id INTEGER PRIMARY KEY, league_id INTEGER NOT NULL, status TEXT NOT NULL,
    gen_params TEXT, error TEXT, approval_token TEXT, decision TEXT, decided_at TEXT,
    review_url TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );`);
  db.prepare(`INSERT INTO digest_jobs (round_id, league_id, status, attempts, created_at, updated_at)
              VALUES (7, 1, 'capturing', 0, 'NOW', 'NOW')`).run();
  return db;
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix ui -- run src/lib/digest/jobs.test.ts`
Expected: FAIL — `failOrRetry`/`requeueJob` not defined.

- [ ] **Step 3: Implement the functions**

In `ui/src/lib/digest/jobs.ts`, add:

```ts
export function failOrRetry(
  db: Database.Database, roundId: number, error: string, nowIso: string, maxAttempts = 3,
): 'retry' | 'failed' {
  const row = db.prepare('SELECT attempts FROM digest_jobs WHERE round_id=?').get(roundId) as { attempts: number } | undefined;
  const attempts = (row?.attempts ?? 0) + 1;
  if (attempts < maxAttempts) {
    db.prepare(`UPDATE digest_jobs SET status='pending', attempts=?, error=?, updated_at=? WHERE round_id=?`)
      .run(attempts, error, nowIso, roundId);
    return 'retry';
  }
  db.prepare(`UPDATE digest_jobs SET status='failed', attempts=?, error=?, updated_at=? WHERE round_id=?`)
    .run(attempts, error, nowIso, roundId);
  return 'failed';
}

export function requeueJob(db: Database.Database, roundId: number, nowIso: string): void {
  db.prepare(`UPDATE digest_jobs SET status='pending', attempts=0, error=NULL, updated_at=? WHERE round_id=?`)
    .run(nowIso, roundId);
}
```

- [ ] **Step 4: Use `failOrRetry` in the runner loop**

In `ui/src/lib/digest/runnerLoop.ts`, replace the `fail` dep (from Task 7) with retry-aware behavior — alert only when the job is terminally failed:

```ts
    fail: (roundId, error, now) => {
      const outcome = failOrRetry(getDb(), roundId, error, now);
      if (outcome === 'failed') {
        const cfg = ntfyConfigFromEnv(process.env);
        if (cfg) void publish(cfg, buildFailureNotification({ stage: 'runner', reason: error, roundId }));
      }
    },
```

Add `failOrRetry` to the existing `jobs.js` import in `runnerLoop.ts`.

- [ ] **Step 5: Add the requeue endpoint**

Create `ui/src/routes/api/digest/[roundId]/requeue/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { requeueJob } from '$lib/digest/jobs.js';

export const POST: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');
  requeueJob(getDb(), roundId, new Date().toISOString());
  return json({ ok: true, roundId });
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test --prefix ui -- run src/lib/digest/jobs.test.ts`
Expected: PASS.
Run: `npm run check --prefix ui`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add ui/src/lib/digest/jobs.ts ui/src/lib/digest/jobs.test.ts ui/src/lib/digest/runnerLoop.ts "ui/src/routes/api/digest/[roundId]/requeue/+server.ts"
git commit -m "feat(digest): retry/backoff + requeue for failed jobs; alert only on terminal fail"
```

---

### Task 11: One-job-in-flight guard

**Files:**
- Modify: `ui/src/lib/digest/jobs.ts` (add `hasActiveJob`)
- Modify: `ui/src/lib/digest/runnerLoop.ts` (guard the `claim` dep)
- Test: `ui/src/lib/digest/jobs.test.ts` (extend)

**Interfaces:**
- Produces: `hasActiveJob(db): boolean` — true when any job is in `capturing | generating | finalizing` (the ML-CLI / LLM active-work statuses). Deliberately EXCLUDES `awaiting_approval`/`awaiting_review` (long-lived human waits must not block new rounds). The runner's `claim` returns null while a job is active, serializing ML exports.

- [ ] **Step 1: Write the failing tests**

In `ui/src/lib/digest/jobs.test.ts`, add:

```ts
import { hasActiveJob } from './jobs.js';

describe('hasActiveJob', () => {
  function db2(status: string): Database.Database {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE digest_jobs (round_id INTEGER PRIMARY KEY, league_id INTEGER NOT NULL, status TEXT NOT NULL,
      gen_params TEXT, error TEXT, approval_token TEXT, decision TEXT, decided_at TEXT, review_url TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
    db.prepare(`INSERT INTO digest_jobs (round_id, league_id, status, created_at, updated_at) VALUES (7,1,?, 'N','N')`).run(status);
    return db;
  }
  it('true while a job is capturing/generating/finalizing', () => {
    expect(hasActiveJob(db2('capturing'))).toBe(true);
    expect(hasActiveJob(db2('generating'))).toBe(true);
    expect(hasActiveJob(db2('finalizing'))).toBe(true);
  });
  it('false for pending/done/failed and (critically) awaiting_* human waits', () => {
    expect(hasActiveJob(db2('pending'))).toBe(false);
    expect(hasActiveJob(db2('done'))).toBe(false);
    expect(hasActiveJob(db2('failed'))).toBe(false);
    expect(hasActiveJob(db2('awaiting_approval'))).toBe(false);
    expect(hasActiveJob(db2('awaiting_review'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix ui -- run src/lib/digest/jobs.test.ts`
Expected: FAIL — `hasActiveJob` not defined.

- [ ] **Step 3: Implement the guard**

In `ui/src/lib/digest/jobs.ts`, add:

```ts
export function hasActiveJob(db: Database.Database): boolean {
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM digest_jobs WHERE status IN ('capturing','generating','finalizing')`,
  ).get() as { n: number };
  return row.n > 0;
}
```

- [ ] **Step 4: Guard the claim in the runner loop**

In `ui/src/lib/digest/runnerLoop.ts`, add `hasActiveJob` to the `jobs.js` import and change the `claim` dep:

```ts
    claim: () => (hasActiveJob(getDb()) ? null : claimNextJob(getDb(), new Date().toISOString())),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --prefix ui -- run src/lib/digest/jobs.test.ts`
Expected: PASS.
Run: `npm run check --prefix ui`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/digest/jobs.ts ui/src/lib/digest/jobs.test.ts ui/src/lib/digest/runnerLoop.ts
git commit -m "feat(digest): one-job-in-flight guard serializes ML exports (excludes human waits)"
```

---

### Task 12: Live staged smoke (CONTROLLER + USER — not a subagent)

**Files:** none (operational verification). Rebuilds containers and posts to the staging group.

**Preconditions:**
- All prior tasks merged; full suites green: `npm test --prefix ui -- run` and `npm test -- run`.
- `.env` carries `NTFY_URL`/`NTFY_TOPIC`/`NTFY_TOKEN`/`BOT_CONTROL_URL`/`PUBLIC_APP_URL`.
- Staging group id `120363426590199032@g.us` (Matt + bot) configured as the send target for the test league; `DIGEST_SEND_MODE=live` only for the staged run.
- **Copy-first / revert discipline:** operate on a DB copy or a disposable test round; revert any state change after.

- [ ] **Step 1: Rebuild the three services from master**

Matt runs:

```bash
docker compose build --no-cache bot bot-ui && docker compose up -d bot bot-ui api
```

Verify each image actually landed (stale-image gotcha): check `docker compose images` timestamps / `git rev-parse HEAD` inside the container.

- [ ] **Step 2: Confirm cross-container reachability**

From bot-ui, confirm it can reach the bot control server:

```bash
docker compose exec bot-ui node -e "fetch('http://bot:3003/trigger',{method:'POST'}).then(r=>console.log('trigger',r.status)).catch(e=>console.log('ERR',e.message))"
```

Expected: `trigger 200` (a poll tick with nothing to send is fine). If `ECONNREFUSED`, the bind change (Task 9) did not deploy — recheck.

- [ ] **Step 3: Drive a hil job to awaiting_approval**

Set the test league to `hil` mode. Enqueue/park a job for a disposable completed test round (or replay a `voting_ended` marker), let the runner capture→generate→render. Confirm:

```bash
docker compose exec bot-ui node -e "const D=require('better-sqlite3')('/app/data/league.db'); console.log(D.prepare('SELECT round_id,status,approval_token IS NOT NULL AS hasTok,review_url FROM digest_jobs ORDER BY updated_at DESC LIMIT 3').all())"
```

Expected: the row at `awaiting_approval` with a token and a `review_url`. Expected: an ntfy push arrives on Matt's phone with **Approve / Edit / Deny**.

- [ ] **Step 4: Approve → immediate post to staging**

Tap **Approve** on the phone (or simulate the exact callback):

```bash
TOKEN=<the approval_token>; curl -sS -X POST https://mlb37.mattmariani.com/api/digest/approve \
  -H "Authorization: Bearer $NTFY_TOKEN" -H 'content-type: application/json' -d "{\"token\":\"$TOKEN\"}"
```

Expected: `{"ok":true,"roundId":...}`; the digest posts to the staging group within seconds; the job row → `done`; `digest_sends` has the exactly-once ledger row. Re-POST the same token → `{"ok":false}` (single-use).

- [ ] **Step 5: Deny path**

Park a second disposable round to `awaiting_approval`, tap **Deny** (or curl the deny endpoint). Expected: `ok:true`, job → `denied`, draft NOT finalized, nothing posts.

- [ ] **Step 6: Needs-review path**

Park a season-final (or no-votes) disposable round. Expected: an ntfy push with **Review / Deny only — no Approve**; job at `awaiting_review`; nothing auto-posts.

- [ ] **Step 7: Failure-alert path**

Force a capture failure (e.g. temporarily point `ML_AUTH_TRIGGER_URL` at a dead port on the test round). Expected: after the retry cap, a `⚠ digest pipeline` ntfy alert AND the existing owner-DM both fire; job at `failed`; `POST /api/digest/<round>/requeue` resets it to `pending`.

- [ ] **Step 8: Revert**

Restore the DB copy / delete disposable rows, set the test league mode back, set `DIGEST_SEND_MODE` back to its prior value, and confirm no residual `awaiting_*` rows for real leagues.

- [ ] **Step 9: Record the smoke result**

Append the outcome (pass/fail per path, commit SHA, any deviations) to `.superpowers/sdd/progress.md`.

---

## Notes for the executor

- **Do not** change the send path (`sendGuard`, `poller.ts`, `manualSend.ts`, `sendLog.ts`, `send-claim`/`send-confirm` endpoints). Approve terminates in the existing chain via `/trigger`.
- **`off` mode never notifies** — it holds silently at `rendered` (Task 4). Only `auto`/`hil` reach a notification.
- **`awaiting_*` are long-lived** and are intentionally excluded from both the in-flight guard (Task 11) and any retry — a human decision has no timeout in the MVP; a parked job exits via approve/deny/requeue.
- **Secrets:** `NTFY_TOKEN` is read from `process.env` in `runnerLoop.ts` and the endpoints — never inline it, never log it.
