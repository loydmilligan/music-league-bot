# Guessing Workspace Shell + Gut Phase (Project C2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the guessing workspace on the round page as a tab, and make the **gut phase** and **rehearsal controls** actually usable — the first slice of this feature Matt can drive end-to-end on Boarz R148/R149.

**Architecture:** Project A shipped the storage and rules; C1 shipped the evidence horizon. C2 adds one composition module, four thin API routes, and the Svelte shell. **This codebase has no Svelte component test setup** (no testing-library, no jsdom; `vite.config.ts` includes only `src/**/*.{test,spec}.ts`). The established pattern — see `ui/src/lib/components/panelState.ts` and its test — is to put logic in plain `.ts` modules with vitest tests and keep `.svelte` files thin. This plan follows that: Tasks 1–3 are fully TDD'd; Tasks 4–5 are markup, verified by `svelte-check` plus explicit manual steps.

**Tech Stack:** TypeScript, SvelteKit (Svelte 5 runes — `$state`, `$props`, `$derived`), better-sqlite3, zod, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-31-submitter-guessing-design.md` — §3b (project map), §4 (placement), §7.1 (gut), §14 (rehearsal).

## Global Constraints

- **Anonymity (spec §5):** every new module under `ui/src/lib/guessing/` is subject to the guard in `scoring.test.ts` and must never read `ml_submissions.competitor_id`. Only `scoring.ts`, `sync.ts` and `fixtures.ts` are allowlisted. Reading `competitors.name` for the roster is fine — that is a list of players, not a mapping from song to submitter. Run `cd ui && npx vitest run src/lib/guessing/scoring.test.ts` after any change here.
- **Do not alter live tables.** `client.ts` runs `db.exec(SCHEMA)` with `CREATE TABLE IF NOT EXISTS` only. Adding a column to `leagues` or any existing table is out of bounds — that is why Task 1 uses a `settings` row.
- **Scoring is derived, never stored.**
- **Gut immutability (spec §7.1):** once `gut_locked_at` is set, gut picks cannot change. `setGutPick` already throws; the UI must surface that, never work around it.
- **Vote transplant is NOT in this plan.** §7.6 and removing the two `VotingLab` embeds are deferred to a follow-up (C2b). Leaving `VotingLab` where it is during C2 is a deliberate transitional state — nothing breaks.
- **Tests:** `cd ui && npx vitest run <path>`. Never from the repo root; that config excludes `ui/**` and reports "No test files found", which is not a pass. Suite is currently **77 tests across 9 files** in `src/lib/guessing/`.
- **Svelte verification:** `cd ui && npm run check` (svelte-check). Tasks 4–5 cannot be unit-tested; their steps give explicit manual verification instead. Do not fake a unit test for markup.
- **A test protecting an ordering or side-effect property needs fixture data where the right and wrong answers differ.** Two tests earlier in this project passed under both correct and broken implementations because their fixtures made the answers coincide. If you write such a test, check it discriminates.
- **Concurrency:** an unrelated session commits to master throughout. Stage explicit paths, never `git add -A`. Retry once on `.git/index.lock`.

---

### Task 1: Which competitor is Matt, per league

**Files:**
- Create: `ui/src/lib/guessing/meCompetitor.ts`
- Test: `ui/src/lib/guessing/meCompetitor.test.ts`

**Interfaces:**
- Consumes: `seedRound` from `./fixtures.js`
- Produces:
  - `getMeCompetitorId(db, leagueSlug): number | null`
  - `setMeCompetitorId(db, leagueSlug, competitorId): void`
  - `resolveMeForRound(db, roundId): number | null`

**Why this exists.** Project A's `eligiblePlayers`, `scoreRound` and `verifyRoundSync` all take `mePlayerId` as a parameter — the spine deliberately deferred the question of where it comes from. Nothing in the app answers it today: `voting_lab_ballot.is_mine` is per-song and manual, and `settings.chat_self_names` holds `["Matt Mariani"]`, which does not match the Boarz competitor name `Mashew`. It must be **per league**, because Matt is a different `competitors` row in each one (competitor 3 in Boarz). It is stored as a `settings` row rather than a `leagues` column because `client.ts` only ever runs `CREATE TABLE IF NOT EXISTS` and must never alter a live table.

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/guessing/meCompetitor.test.ts
import { describe, it, expect } from 'vitest';
import { seedRound } from './fixtures.js';
import { getMeCompetitorId, setMeCompetitorId, resolveMeForRound } from './meCompetitor.js';

describe('me-competitor resolution', () => {
  it('returns null when the league has no setting yet', () => {
    const { db } = seedRound();
    expect(getMeCompetitorId(db, 'boarz-ii-men')).toBeNull();
  });

  it('round-trips a competitor id for a league', () => {
    const { db } = seedRound();
    setMeCompetitorId(db, 'boarz-ii-men', 3);
    expect(getMeCompetitorId(db, 'boarz-ii-men')).toBe(3);
  });

  it('keeps leagues independent — the same person is a different id per league', () => {
    const { db } = seedRound();
    setMeCompetitorId(db, 'boarz-ii-men', 3);
    setMeCompetitorId(db, 'second-best', 17);
    expect(getMeCompetitorId(db, 'boarz-ii-men')).toBe(3);
    expect(getMeCompetitorId(db, 'second-best')).toBe(17);
  });

  it('overwrites rather than duplicating on a second set', () => {
    const { db } = seedRound();
    setMeCompetitorId(db, 'boarz-ii-men', 3);
    setMeCompetitorId(db, 'boarz-ii-men', 4);
    expect(getMeCompetitorId(db, 'boarz-ii-men')).toBe(4);
    const n = db.prepare("SELECT COUNT(*) AS c FROM settings WHERE key LIKE 'guess_me_competitor:%'")
      .get() as { c: number };
    expect(n.c).toBe(1);
  });

  it('resolves from a round id via its league', () => {
    const { db } = seedRound(); // seeds league slug 'boarz-ii-men', round 1
    setMeCompetitorId(db, 'boarz-ii-men', 3);
    expect(resolveMeForRound(db, 1)).toBe(3);
  });

  it('returns null for a round whose league has no setting', () => {
    const { db } = seedRound();
    expect(resolveMeForRound(db, 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/guessing/meCompetitor.test.ts`
Expected: FAIL — cannot resolve `./meCompetitor.js`

- [ ] **Step 3: Implement meCompetitor.ts**

```ts
// ui/src/lib/guessing/meCompetitor.ts
import type Database from 'better-sqlite3';

/**
 * Which `competitors` row is Matt, per league.
 *
 * Project A takes `mePlayerId` as a parameter everywhere and deliberately left
 * this unanswered. Nothing else in the app knows: `voting_lab_ballot.is_mine` is
 * per-song and manual, and `settings.chat_self_names` holds a chat display name
 * that does not match the competitor name.
 *
 * Per league, because Matt is a different competitors row in each. Stored in
 * `settings` rather than as a `leagues` column because client.ts only ever runs
 * CREATE TABLE IF NOT EXISTS and must never alter a live table.
 */
const KEY = (leagueSlug: string): string => `guess_me_competitor:${leagueSlug}`;

export function getMeCompetitorId(db: Database.Database, leagueSlug: string): number | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY(leagueSlug)) as
    | { value: string }
    | undefined;
  if (!row) return null;
  const n = Number(row.value);
  return Number.isInteger(n) ? n : null;
}

export function setMeCompetitorId(
  db: Database.Database,
  leagueSlug: string,
  competitorId: number,
): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(KEY(leagueSlug), String(competitorId));
}

/** Convenience for the API routes, which know a round rather than a league. */
export function resolveMeForRound(db: Database.Database, roundId: number): number | null {
  const row = db.prepare(
    `SELECT l.slug AS slug
       FROM rounds r
       JOIN seasons s ON s.id = r.season_id
       JOIN leagues l ON l.id = s.league_id
      WHERE r.id = ?`,
  ).get(roundId) as { slug: string } | undefined;
  return row ? getMeCompetitorId(db, row.slug) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/guessing/meCompetitor.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Verify the anonymity guard**

Run: `cd ui && npx vitest run src/lib/guessing/scoring.test.ts`
Expected: PASS — `meCompetitor.ts` must not be flagged.

- [ ] **Step 6: Commit**

```bash
cd /home/loydmilligan/Projects/music-league-bot
git add ui/src/lib/guessing/meCompetitor.ts ui/src/lib/guessing/meCompetitor.test.ts
git commit -m "feat(guessing): per-league me-competitor setting"
```

---

### Task 2: The workspace payload

**Files:**
- Create: `ui/src/lib/guessing/workspaceData.ts`
- Test: `ui/src/lib/guessing/workspaceData.test.ts`

**Interfaces:**
- Consumes: `getRoundState` from `./state.js`; `eligibleSongs`, `eligiblePlayers`, `validateGutSlate` from `./assignment.js`; `visibleSubmissions` from `./horizon.js`; `resolveMeForRound` from `./meCompetitor.js`
- Produces: `buildWorkspaceData(db, roundId): WorkspaceData | null` (null when me-competitor is unset)

```ts
export interface WorkspaceSong {
  spotifyUri: string;
  title: string;
  artists: string;
  comment: string | null;
  gutPickPlayerId: number | null;
}
export interface WorkspacePlayer { id: number; name: string }
export interface WorkspaceData {
  roundId: number;
  phase: GuessPhase;
  mode: RehearsalMode;
  asOf: string | null;
  gutLockedAt: string | null;
  songs: WorkspaceSong[];
  roster: WorkspacePlayer[];
  validation: Validation;
}
```

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/guessing/workspaceData.test.ts
import { describe, it, expect } from 'vitest';
import { seedRound } from './fixtures.js';
import { setMeCompetitorId } from './meCompetitor.js';
import { setGutPick, lockGut } from './state.js';
import { buildWorkspaceData } from './workspaceData.js';

function setup(opts = {}) {
  const s = seedRound({ songCount: 4, playerCount: 4, mineIndex: 0, ...opts });
  setMeCompetitorId(s.db, 'boarz-ii-men', 1);
  return s;
}

describe('workspace payload', () => {
  it('returns null when the me-competitor is unset', () => {
    const { db } = seedRound();
    expect(buildWorkspaceData(db, 1)).toBeNull();
  });

  it('excludes my own song and me from the working set', () => {
    const { db, songs, players } = setup();
    const w = buildWorkspaceData(db, 1)!;
    expect(w.songs.map((s) => s.spotifyUri)).toEqual([songs[1], songs[2], songs[3]]);
    expect(w.roster.map((p) => p.id)).toEqual([players[1], players[2], players[3]]);
  });

  it('carries song text and roster names for display', () => {
    const { db } = setup();
    const w = buildWorkspaceData(db, 1)!;
    expect(w.songs[0].title).toBe('Song 1');
    expect(w.roster[0].name).toBe('P2');
  });

  it('reflects gut picks and validation as they are made', () => {
    const { db, songs, players } = setup();
    const before = buildWorkspaceData(db, 1)!;
    expect(before.validation.ok).toBe(false);
    expect(before.songs.every((s) => s.gutPickPlayerId === null)).toBe(true);

    setGutPick(db, 1, songs[1], players[1]);
    setGutPick(db, 1, songs[2], players[2]);
    setGutPick(db, 1, songs[3], players[3]);

    const after = buildWorkspaceData(db, 1)!;
    expect(after.validation.ok).toBe(true);
    expect(after.songs.find((s) => s.spotifyUri === songs[1])!.gutPickPlayerId).toBe(players[1]);
  });

  it('surfaces the lock so the UI can disable editing', () => {
    const { db } = setup();
    expect(buildWorkspaceData(db, 1)!.gutLockedAt).toBeNull();
    lockGut(db, 1, '2026-02-01T00:00:00Z');
    const w = buildWorkspaceData(db, 1)!;
    expect(w.gutLockedAt).toBe('2026-02-01T00:00:00Z');
    expect(w.phase).toBe('fetch');
  });

  it('hides a comment that was not visible to voters', () => {
    const { db, songs } = setup();
    db.prepare('UPDATE ml_submissions SET comment = ? WHERE spotify_uri = ?').run('shown', songs[1]);
    db.prepare('UPDATE ml_submissions SET comment = ?, visible_to_voters = 0 WHERE spotify_uri = ?')
      .run('hidden', songs[2]);
    const w = buildWorkspaceData(db, 1)!;
    expect(w.songs.find((s) => s.spotifyUri === songs[1])!.comment).toBe('shown');
    expect(w.songs.find((s) => s.spotifyUri === songs[2])!.comment).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/guessing/workspaceData.test.ts`
Expected: FAIL — cannot resolve `./workspaceData.js`

- [ ] **Step 3: Implement workspaceData.ts**

```ts
// ui/src/lib/guessing/workspaceData.ts
import type Database from 'better-sqlite3';
import { getRoundState, type GuessPhase, type RehearsalMode } from './state.js';
import { eligibleSongs, eligiblePlayers, validateGutSlate, type Validation } from './assignment.js';
import { visibleSubmissions } from './horizon.js';
import { resolveMeForRound } from './meCompetitor.js';

export interface WorkspaceSong {
  spotifyUri: string;
  title: string;
  artists: string;
  comment: string | null;
  gutPickPlayerId: number | null;
}
export interface WorkspacePlayer { id: number; name: string }
export interface WorkspaceData {
  roundId: number;
  phase: GuessPhase;
  mode: RehearsalMode;
  asOf: string | null;
  gutLockedAt: string | null;
  songs: WorkspaceSong[];
  roster: WorkspacePlayer[];
  validation: Validation;
}

/**
 * Everything the workspace tab renders for one round.
 *
 * Returns null when the league has no me-competitor set — the caller shows a
 * setup prompt rather than a broken grid, because without it the roster cannot
 * exclude Matt and every downstream rule is wrong.
 *
 * NOT on the §5 anonymity allowlist: reads competitors.name for the roster, and
 * song text via visibleSubmissions, but never ml_submissions.competitor_id.
 */
export function buildWorkspaceData(db: Database.Database, roundId: number): WorkspaceData | null {
  const me = resolveMeForRound(db, roundId);
  if (me === null) return null;

  const state = getRoundState(db, roundId);
  const uris = new Set(eligibleSongs(db, roundId));

  const picks = new Map(
    (
      db.prepare(
        `SELECT spotify_uri AS uri, gut_pick_player_id AS pid
           FROM guess_picks WHERE round_id = ?`,
      ).all(roundId) as { uri: string; pid: number | null }[]
    ).map((r) => [r.uri, r.pid]),
  );

  const songs: WorkspaceSong[] = visibleSubmissions(db, roundId)
    .filter((s) => uris.has(s.spotifyUri))
    .map((s) => ({ ...s, gutPickPlayerId: picks.get(s.spotifyUri) ?? null }));

  const ids = eligiblePlayers(db, roundId, me);
  const roster: WorkspacePlayer[] =
    ids.length === 0
      ? []
      : (db
          .prepare(
            `SELECT id, name FROM competitors WHERE id IN (${ids.map(() => '?').join(',')})
              ORDER BY id`,
          )
          .all(...ids) as WorkspacePlayer[]);

  return {
    roundId,
    phase: state.phase,
    mode: state.mode,
    asOf: state.asOf,
    gutLockedAt: state.gutLockedAt,
    songs,
    roster,
    validation: validateGutSlate(db, roundId, me),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/guessing/workspaceData.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Verify the guard and commit**

Run: `cd ui && npx vitest run src/lib/guessing/`
Expected: PASS — report the new total (was 77 across 9 files).

```bash
cd /home/loydmilligan/Projects/music-league-bot
git add ui/src/lib/guessing/workspaceData.ts ui/src/lib/guessing/workspaceData.test.ts
git commit -m "feat(guessing): workspace payload for the round tab"
```

---

### Task 3: API routes

**Files:**
- Create: `ui/src/routes/api/guess/[roundId]/+server.ts`
- Create: `ui/src/routes/api/guess/[roundId]/gut/+server.ts`
- Create: `ui/src/routes/api/guess/[roundId]/rehearsal/+server.ts`

**Interfaces:**
- Consumes: `buildWorkspaceData`, `setGutPick`, `lockGut`, `startRehearsal`, `archiveRehearsal`, `resolveMeForRound`
- Produces: `GET /api/guess/:roundId`, `PATCH /api/guess/:roundId/gut`, `POST /api/guess/:roundId/gut` (lock), `POST /api/guess/:roundId/rehearsal`, `DELETE /api/guess/:roundId/rehearsal` (archive)

Follow the conventions in `ui/src/routes/api/voting-lab/[roundId]/+server.ts` and `.../ballot/+server.ts` exactly: `RequestHandler` from `./$types.js`, `json`/`error` from `@sveltejs/kit`, `getDb()` from `$lib/db/client.js`, a zod schema for bodies, and a round-exists check before doing work.

These are thin wrappers; their logic is already tested in Tasks 1–2 and Project A. There is no route-level test harness in this repo — do not invent one.

- [ ] **Step 1: Workspace GET**

```ts
// ui/src/routes/api/guess/[roundId]/+server.ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { buildWorkspaceData } from '$lib/guessing/workspaceData.js';

export const GET: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');

  const db = getDb();
  const exists = db.prepare(`SELECT 1 FROM rounds WHERE id = ?`).get(roundId);
  if (!exists) throw error(404, 'round not found');

  const data = buildWorkspaceData(db, roundId);
  // null => the league has no me-competitor set yet; the UI shows a setup prompt.
  return json({ configured: data !== null, data });
};
```

- [ ] **Step 2: Gut pick + lock**

```ts
// ui/src/routes/api/guess/[roundId]/gut/+server.ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/db/client.js';
import { setGutPick, lockGut } from '$lib/guessing/state.js';

const PickSchema = z.object({
  spotifyUri: z.string().min(1),
  playerId: z.number().int().positive(),
});

function roundOr404(roundId: number) {
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');
  const db = getDb();
  if (!db.prepare(`SELECT 1 FROM rounds WHERE id = ?`).get(roundId)) throw error(404, 'round not found');
  return db;
}

export const PATCH: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  const db = roundOr404(roundId);

  const parsed = PickSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw error(400, parsed.error.message);

  try {
    setGutPick(db, roundId, parsed.data.spotifyUri, parsed.data.playerId);
  } catch (e) {
    // spec §7.1: gut picks are immutable once locked. Surface it, never work around it.
    throw error(409, e instanceof Error ? e.message : 'gut slate is locked');
  }
  return json({ ok: true });
};

export const POST: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  const db = roundOr404(roundId);
  lockGut(db, roundId, new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
  return json({ ok: true });
};
```

- [ ] **Step 3: Rehearsal start / archive**

```ts
// ui/src/routes/api/guess/[roundId]/rehearsal/+server.ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/db/client.js';
import { startRehearsal, archiveRehearsal } from '$lib/guessing/rehearsal.js';

const StartSchema = z.object({ asOf: z.string().min(1) });

export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');
  const db = getDb();
  const row = db.prepare(`SELECT voting_deadline AS d FROM rounds WHERE id = ?`).get(roundId) as
    | { d: string | null }
    | undefined;
  if (!row) throw error(404, 'round not found');

  const body = await request.json().catch(() => ({}));
  const parsed = StartSchema.safeParse(body);
  // Default the horizon to the round's own voting deadline — the moment the real
  // guess was due (spec §14.3).
  const asOf = parsed.success ? parsed.data.asOf : row.d;
  if (!asOf) throw error(400, 'round has no voting deadline; pass asOf explicitly');

  startRehearsal(db, roundId, asOf);
  return json({ ok: true, asOf });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');
  const db = getDb();
  if (!db.prepare(`SELECT 1 FROM rounds WHERE id = ?`).get(roundId)) throw error(404, 'round not found');
  return json({ ok: true, archive: archiveRehearsal(db, roundId) });
};
```

- [ ] **Step 4: Verify it type-checks**

Run: `cd ui && npm run check`
Expected: no new errors attributable to these three files. Pre-existing errors elsewhere are not yours — report the count before and after if any are ambiguous.

- [ ] **Step 5: Commit**

```bash
cd /home/loydmilligan/Projects/music-league-bot
git add ui/src/routes/api/guess
git commit -m "feat(guessing): workspace, gut and rehearsal API routes"
```

---

### Task 4: The tab

**Files:**
- Modify: `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte`
- Create: `ui/src/lib/components/GuessWorkspace.svelte`

**Interfaces:**
- Consumes: `GET /api/guess/:roundId`
- Produces: a `guess` tab rendering `<GuessWorkspace roundId={data.round.id} />`

- [ ] **Step 1: Widen the tab union and add the entry**

At `+page.svelte:142`, the tab state is:
```ts
  let tab = $state<'ml' | 'chat' | 'history' | 'research' | 'h2h'>('ml');
```
Change to include `'guess'`. At the `tabs` array (line 325), widen the same union in its type annotation and append:

```ts
    { key: 'guess',  label: 'Guess',          count: data.mlSubmissions.length },
```

Spec §4: the tab is **disabled until the round's playlist exists.** `data.mlSubmissions.length === 0` is that signal — the `voting_started` event already drives `ingestPlaylist`, so this is a read of existing state, not new detection. Render the button `disabled` with `opacity-50 cursor-not-allowed` when the count is 0, and do not let `tab` be set to `'guess'` in that case.

- [ ] **Step 2: Add the panel**

After the `{#if tab === 'h2h'}` block, add:

```svelte
{#if tab === 'guess'}
  <GuessWorkspace roundId={data.round.id} />
{/if}
```

and import it at the top with the other component imports:
```ts
  import GuessWorkspace from '$lib/components/GuessWorkspace.svelte';
```

- [ ] **Step 3: Create the shell component**

```svelte
<!-- ui/src/lib/components/GuessWorkspace.svelte -->
<script lang="ts">
  import type { WorkspaceData } from '$lib/guessing/workspaceData.js';

  let { roundId }: { roundId: number } = $props();

  let data = $state<WorkspaceData | null>(null);
  let configured = $state(true);
  let loadError = $state<string | null>(null);

  export async function load() {
    loadError = null;
    const res = await fetch(`/api/guess/${roundId}`);
    if (!res.ok) { loadError = `Failed to load workspace (${res.status})`; return; }
    const body = (await res.json()) as { configured: boolean; data: WorkspaceData | null };
    configured = body.configured;
    data = body.data;
  }

  $effect(() => { void roundId; void load(); });
</script>

{#if loadError}
  <p class="font-mono text-sm text-red-400">{loadError}</p>
{:else if !configured}
  <p class="font-mono text-sm text-fg-muted">
    No guesser set for this league yet — set which competitor is you before using the workspace.
  </p>
{:else if data}
  <div class="mb-4 flex items-center gap-3 font-mono text-xs uppercase tracking-wider text-fg-faint">
    <span>phase: {data.phase}</span>
    {#if data.mode === 'rehearsal'}
      <span class="text-accent">rehearsal · as of {data.asOf}</span>
    {/if}
  </div>
  <p class="font-mono text-sm text-fg-muted">{data.songs.length} songs · {data.roster.length} players</p>
{:else}
  <p class="font-mono text-sm text-fg-muted">Loading…</p>
{/if}
```

- [ ] **Step 4: Verify**

Run: `cd ui && npm run check` — no new errors from these two files.

Manual, against a **copy** of `data/league.db` (never the live file):
1. Start the app, open a Boarz round page.
2. The **Guess** tab is present, and clicking it shows either the setup prompt or the phase line.
3. On a round with no submissions the tab is visibly disabled and not clickable.

- [ ] **Step 5: Commit**

```bash
cd /home/loydmilligan/Projects/music-league-bot
git add ui/src/lib/components/GuessWorkspace.svelte "ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte"
git commit -m "feat(guessing): workspace tab on the round page"
```

---

### Task 5: Gut phase and rehearsal controls

**Files:**
- Modify: `ui/src/lib/components/GuessWorkspace.svelte`

**Interfaces:**
- Consumes: `PATCH/POST /api/guess/:roundId/gut`, `POST/DELETE /api/guess/:roundId/rehearsal`

- [ ] **Step 1: Add the gut slate**

Replace the placeholder `<p>{data.songs.length} songs …</p>` with a per-song row: the song's title and artists, its comment when present, and a `<select>` of `data.roster` bound to `song.gutPickPlayerId`. On change, `PATCH /api/guess/:roundId/gut` with `{ spotifyUri, playerId }`, then `await load()`.

Disable every select when `data.gutLockedAt !== null` — spec §7.1, gut picks are immutable once locked. If the PATCH returns **409**, surface the server's message rather than silently reverting; that status means the slate locked underneath you.

Show `data.validation`: the count of `missingSongs` and any `duplicatePlayerIds` (mapped through `data.roster` to names). Render a **Lock gut slate** button, enabled only when `data.validation.ok` is true, that calls `POST /api/guess/:roundId/gut` then `await load()`.

- [ ] **Step 2: Add rehearsal controls**

When `data.mode === 'live'`, show a **Start rehearsal** button that `POST`s to `/api/guess/:roundId/rehearsal` with an empty body (the server defaults `asOf` to the round's voting deadline), then reloads.

When `data.mode === 'rehearsal'`, show the as-of stamp and an **Archive rehearsal** button that `DELETE`s the same route and reloads. Put a confirmation step in front of it — archiving deletes every guess row for the round (spec §14.7) and is not undoable from the UI.

- [ ] **Step 3: Verify**

Run: `cd ui && npm run check` — no new errors.

Manual, against a **copy** of `data/league.db` — this is the slice that must actually work:
1. Open Boarz R148's Guess tab. It has 10 songs and no gut picks.
2. Press **Start rehearsal**. The header shows `rehearsal · as of 2026-08-20T06:30:00Z`.
3. Assign a player to every song. Validation goes from "3 missing" to clear as you fill it; assigning the same player twice reports a duplicate.
4. **Lock gut slate** enables only once validation is clean. Press it — phase becomes `fetch` and every select is disabled.
5. Try to change a pick. The UI refuses and shows the lock message rather than appearing to succeed.
6. **Archive rehearsal**, confirm. The round returns to `live` with no picks.

Record the actual observed result of each step in your report — this is the only verification these two tasks get.

- [ ] **Step 4: Commit**

```bash
cd /home/loydmilligan/Projects/music-league-bot
git add ui/src/lib/components/GuessWorkspace.svelte
git commit -m "feat(guessing): gut slate and rehearsal controls"
```

---

## Self-review notes

**Spec coverage.** §4 placement → Task 4 (tab, disabled until playlist exists). §7.1 gut → Tasks 2 and 5. §14 rehearsal controls → Tasks 3 and 5. §3b names C2 as the workspace; the grid (§7.4), comment (§7.5) and output (§7.7) are C3/C4.

**Deliberately deferred.** §7.6 vote and removing the two `VotingLab` embeds are NOT here — that is a self-contained follow-up (C2b) touching the home page as well, and bundling it would make this plan unreviewable. `VotingLab` stays where it is meanwhile; nothing breaks.

**A decision this plan makes that the spec did not.** Task 1 introduces a per-league `settings` row for "which competitor is Matt". Nothing in the app answered that question, and Project A took it as a parameter throughout. Alternatives rejected: a `leagues` column (would require altering a live table, which `client.ts` never does) and deriving it from `voting_lab_ballot.is_mine` (circular — during a live round that would mean reading submitter identity, which §5 forbids).

**Known soft spot.** Tasks 4 and 5 are markup and have no automated coverage beyond `svelte-check`; their verification is the manual scripts above. That is the established shape of this codebase, not a shortcut — there is no component test harness, and inventing one is out of scope for this plan.
