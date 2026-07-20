# SP1 — Source-Aware Seasons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "which upstream league instance is this season" a first-class DB fact (`seasons.source` + `seasons.source_competition_id`), backfill every existing season, and refactor the three ML resolver scripts to read it — retiring the duplicated hardcoded pin maps.

**Architecture:** Additive schema change via the codebase's established dual pattern (`schema.ts` `CREATE TABLE` for fresh DBs + guarded `ALTER` in `client.ts` for the live prod DB). Season creation stays a single chokepoint (`upsertSeason`). A one-time backfill authors the mapping for existing seasons. A shared `scripts/lib/mlSource.mjs` resolver reads the column; the three scripts prefer it and fall back to their existing pins/name-matching so nothing regresses.

**Tech Stack:** SQLite (better-sqlite3), TypeScript (SvelteKit UI lib), Node `.mjs` scripts, Vitest (TS tests), `node --test` (script tests).

## Global Constraints

- **`data/league.db` is the LIVE production DB** (containers mount `data/` → `/app/data`). Any task that writes to it (Task 3) MUST back it up first and dry-run before `--apply`. Verify the bot stays healthy after schema changes.
- **Additive only.** No column renames (`ml_round_id`, `ml_competitor_id` stay). No behavior change to season *semantics*.
- **`source` default is `'music_league'`.** Do not add other source values in SP1.
- **`source_competition_id` is authored at onboarding + backfill, never at import time** (the importer does not know the upstream id).
- **Every ALTER is existence-guarded** (SCHEMA runs first; on the live DB `CREATE TABLE IF NOT EXISTS` is a no-op so the guarded ALTER is what adds the columns; on a fresh DB SCHEMA adds them and the guarded ALTER must be a no-op — a naked ALTER crashes every fresh-DB boot and all tests).
- **Retain fallbacks** (pin maps / name-matching) in the three scripts throughout SP1.
- TS test command: `cd ui && npx vitest run <file>`. Script test command: `node --test <file>` (run from repo root so `better-sqlite3` resolves).

---

### Task 1: Add `seasons.source` + `seasons.source_competition_id` (schema + migration)

**Files:**
- Modify: `ui/src/lib/db/schema.ts:22-23` (add two columns to `CREATE TABLE IF NOT EXISTS seasons`)
- Modify: `ui/src/lib/db/client.ts` (add guarded `ALTER` after the `leagues` columns loop, ~line 30)
- Test: `ui/src/lib/db/seasonSource.test.ts` (create)

**Interfaces:**
- Produces: `seasons.source TEXT NOT NULL DEFAULT 'music_league'`, `seasons.source_competition_id TEXT` — present on both fresh and migrated DBs.

- [ ] **Step 1: Write the failing test** — create `ui/src/lib/db/seasonSource.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, unlinkSync } from 'node:fs';
import { openLeagueDb } from './client.js';

describe('seasons source columns', () => {
  it('fresh DB has source (default music_league) + source_competition_id', () => {
    const db = openLeagueDb(':memory:');
    const cols = (db.prepare('PRAGMA table_info(seasons)').all() as { name: string }[]).map(c => c.name);
    expect(cols).toContain('source');
    expect(cols).toContain('source_competition_id');
    db.prepare("INSERT INTO leagues (slug,name) VALUES ('x','X')").run();
    const lid = (db.prepare("SELECT id FROM leagues WHERE slug='x'").get() as { id: number }).id;
    db.prepare("INSERT INTO seasons (league_id,season_number,status) VALUES (?,1,'active')").run(lid);
    const s = db.prepare('SELECT source, source_competition_id FROM seasons').get() as any;
    expect(s.source).toBe('music_league');
    expect(s.source_competition_id).toBeNull();
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_seasons_source_comp'").get();
    expect(idx).toBeTruthy();
  });

  it('migrates an existing DB that lacks the columns', () => {
    const p = '/tmp/test-seasons-migrate.db';
    if (existsSync(p)) unlinkSync(p);
    const old = new Database(p);
    old.exec(`
      CREATE TABLE leagues (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT);
      CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER,
        status TEXT NOT NULL DEFAULT 'active', status_source TEXT NOT NULL DEFAULT 'derived');
      INSERT INTO leagues (slug,name) VALUES ('x','X');
      INSERT INTO seasons (league_id,season_number,status) VALUES (1,1,'active');`);
    old.close();
    const db = openLeagueDb(p); // SCHEMA (IF NOT EXISTS = no-op on seasons) + guarded ALTER
    const cols = (db.prepare('PRAGMA table_info(seasons)').all() as { name: string }[]).map(c => c.name);
    expect(cols).toContain('source');
    expect(cols).toContain('source_competition_id');
    const s = db.prepare('SELECT source FROM seasons WHERE id=1').get() as any;
    expect(s.source).toBe('music_league'); // NOT NULL DEFAULT backfills the existing row
    db.close();
    unlinkSync(p);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/db/seasonSource.test.ts`
Expected: FAIL — `expect(cols).toContain('source')` fails (column absent).

- [ ] **Step 3: Add the columns to `schema.ts`** — change lines 22-23 from:

```
    status_source TEXT NOT NULL CHECK(status_source IN ('derived','manual')) DEFAULT 'derived',
    UNIQUE(league_id, season_number)
```

to:

```
    status_source TEXT NOT NULL CHECK(status_source IN ('derived','manual')) DEFAULT 'derived',
    -- SP1 source-aware seasons: which upstream service + that service's competition id
    -- this season maps to. Default 'music_league'; source_competition_id set at
    -- onboarding/backfill (the importer does not know the upstream id).
    source TEXT NOT NULL DEFAULT 'music_league',
    source_competition_id TEXT,
    UNIQUE(league_id, season_number)
```

- [ ] **Step 4: Add the guarded migration to `client.ts`** — insert immediately after the `leagues` columns loop (after line 30, `if (!leaguesCols.some...)` block):

```ts
	// SP1 source-aware seasons: which upstream service + competition id a season maps to.
	const seasonsCols = db.prepare('PRAGMA table_info(seasons)').all() as { name: string }[];
	if (!seasonsCols.some(c => c.name === 'source')) {
		db.exec("ALTER TABLE seasons ADD COLUMN source TEXT NOT NULL DEFAULT 'music_league'");
	}
	if (!seasonsCols.some(c => c.name === 'source_competition_id')) {
		db.exec('ALTER TABLE seasons ADD COLUMN source_competition_id TEXT');
	}
	// Integrity: at most one season per (source, competition id). Partial so many
	// NULL (un-backfilled) rows don't collide. MUST come AFTER the ALTERs above —
	// on the live DB `db.exec(SCHEMA)` ran first as a no-op (table already exists),
	// so the columns only exist once these ALTERs run. Keep this out of schema.ts.
	db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_seasons_source_comp
		ON seasons(source, source_competition_id) WHERE source_competition_id IS NOT NULL`);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/db/seasonSource.test.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/db/schema.ts ui/src/lib/db/client.ts ui/src/lib/db/seasonSource.test.ts
git commit -m "feat(seasons): add source + source_competition_id columns (SP1)"
```

---

### Task 2: `upsertSeason` persists `sourceCompetitionId`; thread through `Season` type + mappers

**Files:**
- Modify: `ui/src/lib/types.ts:2` (`Season` interface — add optional fields)
- Modify: `ui/src/lib/db/leagues.ts:30-33` (`getSeasonsForLeague` mapper), `:44-47` (`getActiveSeasonsWithLeague` mapper), `:50-59` (`upsertSeason`)
- Test: `ui/src/lib/db/leagues.test.ts` (add cases)

**Interfaces:**
- Consumes: the columns from Task 1.
- Produces: `upsertSeason(db, leagueId, seasonNumber, status, sourceCompetitionId?: string | null): number` — a nullish `sourceCompetitionId` never wipes an existing value (COALESCE). `Season` gains `source?: string` and `sourceCompetitionId?: string | null`.

- [ ] **Step 1: Write the failing test** — append to `ui/src/lib/db/leagues.test.ts`:

```ts
import { getSeasonsForLeague, upsertSeason } from './leagues.js';

it('upsertSeason stores and preserves source_competition_id', () => {
  const db = mk(); seedLeagues(db);
  const lid = getAllLeagues(db).find(l => l.slug === 'second-best')!.id;
  upsertSeason(db, lid, 2, 'active', 'abc123');
  let s = getSeasonsForLeague(db, lid).find(x => x.seasonNumber === 2)!;
  expect(s.source).toBe('music_league');
  expect(s.sourceCompetitionId).toBe('abc123');
  // Re-upsert without an id must NOT wipe the existing mapping.
  upsertSeason(db, lid, 2, 'complete');
  s = getSeasonsForLeague(db, lid).find(x => x.seasonNumber === 2)!;
  expect(s.sourceCompetitionId).toBe('abc123');
  expect(s.status).toBe('complete');
});
```

(`mk`, `seedLeagues`, `getAllLeagues` are already imported at the top of this test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/db/leagues.test.ts`
Expected: FAIL — `upsertSeason` has no 5th param / `s.sourceCompetitionId` is undefined.

- [ ] **Step 3: Extend the `Season` type** — `ui/src/lib/types.ts:2`, change:

```ts
export interface Season { id: number; leagueId: number; seasonNumber: number; status: 'active' | 'complete'; }
```

to:

```ts
export interface Season { id: number; leagueId: number; seasonNumber: number; status: 'active' | 'complete'; source?: string; sourceCompetitionId?: string | null; }
```

- [ ] **Step 4: Update `upsertSeason` and both mappers** in `ui/src/lib/db/leagues.ts`.

`upsertSeason` (lines 50-59) becomes:

```ts
export function upsertSeason(
  db: Database.Database,
  leagueId: number,
  seasonNumber: number,
  status: 'active' | 'complete',
  sourceCompetitionId?: string | null,
): number {
  // Preserve status for manually-overridden seasons (status_source='manual').
  // COALESCE(excluded, existing) means a nullish sourceCompetitionId never wipes
  // a previously-authored mapping — only sets it when the caller supplies one.
  return (db.prepare(`INSERT INTO seasons (league_id,season_number,status,status_source,source_competition_id)
    VALUES (?,?,?,'derived',?)
    ON CONFLICT(league_id,season_number) DO UPDATE SET
      status = CASE WHEN seasons.status_source = 'manual' THEN seasons.status ELSE excluded.status END,
      source_competition_id = COALESCE(excluded.source_competition_id, seasons.source_competition_id)
    RETURNING id`)
    .get(leagueId, seasonNumber, status, sourceCompetitionId ?? null) as { id: number }).id;
}
```

`getSeasonsForLeague` mapper (line 32) becomes:

```ts
    .map(r => ({ id: r.id, leagueId: r.league_id, seasonNumber: r.season_number, status: r.status,
      source: r.source, sourceCompetitionId: r.source_competition_id }));
```

`getActiveSeasonsWithLeague` mapper (lines 44-47) — add the two fields to the mapped object:

```ts
    .map(r => ({
      id: r.id, leagueId: r.league_id, seasonNumber: r.season_number, status: r.status,
      source: r.source, sourceCompetitionId: r.source_competition_id,
      league: { id: r.league_id, slug: r.league_slug, name: r.league_name, excludeFromCombined: !!r.exclude_from_combined, notes: null },
    }));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/db/leagues.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full lib/db suite (no regressions)**

Run: `cd ui && npx vitest run src/lib/db`
Expected: PASS (existing `upsertSeason` callers still compile — the 5th param is optional).

- [ ] **Step 7: Commit**

```bash
git add ui/src/lib/types.ts ui/src/lib/db/leagues.ts ui/src/lib/db/leagues.test.ts
git commit -m "feat(seasons): upsertSeason persists source_competition_id; thread through Season (SP1)"
```

---

### Task 3: Backfill existing seasons + run against prod

**Files:**
- Create: `scripts/backfill-season-sources.mjs`

**Interfaces:**
- Consumes: the columns from Task 1.
- Produces: every existing season's `source_competition_id` populated (idempotent: sets only where currently NULL).

Note: this is a data task (live-prod), not TDD. Its "test" is a dry-run + a post-apply SQL verification. The full source→season map below is verified from `cli-web-musicleague leagues list --all`.

- [ ] **Step 1: Write the backfill script** — `scripts/backfill-season-sources.mjs`:

```js
#!/usr/bin/env node
/**
 * One-time backfill of seasons.source_competition_id from verified ML league ids.
 * Idempotent: only sets rows where source_competition_id IS NULL. Dry-run by
 * default; --apply writes (backs up the DB first).
 */
import Database from 'better-sqlite3';
import { copyFileSync } from 'node:fs';

const DB_PATH = process.env.LEAGUE_DB ?? 'data/league.db';
const APPLY = process.argv.includes('--apply');

// (slug, season_number) -> verified live ML league id.
const MAP = [
  { slug: 'fam-jam',       season: 1, mlId: '9a133b6d27ce4ae5b9ce76745dc52ec0' },
  { slug: 'fam-jam',       season: 2, mlId: '65cb1570373a4541b21046787c2334a8' },
  { slug: 'fam-jam',       season: 3, mlId: 'e2a5ee4ad1ef4a5ca951d7b51c9b936e' },
  { slug: 'fam-jam',       season: 4, mlId: 'd3d3b2046a2c4c639976ca2621a8afa3' },
  { slug: 'hip-jammers',   season: 1, mlId: '0c5528f18f074d3296748583735ed7c7' },
  { slug: 'hip-jammers',   season: 2, mlId: 'b790807818f840ddadd37e37d9b71b98' },
  { slug: 'hip-jammers',   season: 3, mlId: 'b514fe6352994d6fadd602dee3cbaeb7' },
  { slug: 'second-best',   season: 1, mlId: '948e0131250c4ce1b449ab6b453261f6' },
  { slug: 'second-best',   season: 2, mlId: '78b2e6400520468e8d726e8793127fb0' },
  { slug: 'nostalgia-pit', season: 1, mlId: 'b2a0fb602548495ca4bf39f67c7d97d2' },
  { slug: 'boarz-ii-men',  season: 1, mlId: '71598b6952064ca4afe4baf437495604' },
];

const db = new Database(DB_PATH);
if (APPLY) {
  const bak = `${DB_PATH}.backup-backfill-source-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  copyFileSync(DB_PATH, bak);
  console.log('Backed up DB → ' + bak);
} else {
  console.log('DRY-RUN. Use --apply to write.\n');
}

// Self-sufficient: on --apply, ensure the columns exist even if the app hasn't
// restarted with Task 1's boot migration yet. Additive + idempotent; the running
// app (old code) ignores the new columns. Dry-run writes nothing — it tolerates
// the column being absent (treats every mapped season as unset).
let hasCols = db.prepare('PRAGMA table_info(seasons)').all().some((c) => c.name === 'source_competition_id');
if (APPLY && !hasCols) {
  const cols = db.prepare('PRAGMA table_info(seasons)').all().map((c) => c.name);
  if (!cols.includes('source')) db.exec("ALTER TABLE seasons ADD COLUMN source TEXT NOT NULL DEFAULT 'music_league'");
  db.exec('ALTER TABLE seasons ADD COLUMN source_competition_id TEXT');
  hasCols = true;
}

const upd = db.prepare(`UPDATE seasons SET source_competition_id = @mlId
  WHERE source_competition_id IS NULL
    AND season_number = @season
    AND league_id = (SELECT id FROM leagues WHERE slug = @slug)`);

let changed = 0, missing = 0;
for (const m of MAP) {
  const row = db.prepare(`SELECT s.id ${hasCols ? ', s.source_competition_id AS sid' : ''}
    FROM seasons s JOIN leagues l ON l.id = s.league_id
    WHERE l.slug = ? AND s.season_number = ?`).get(m.slug, m.season);
  if (!row) { console.log(`  ? ${m.slug} s${m.season}: no season row (skip)`); missing++; continue; }
  const sid = hasCols ? row.sid : null;
  if (sid) { console.log(`  = ${m.slug} s${m.season}: already ${sid.slice(0,8)} (skip)`); continue; }
  console.log(`  ${APPLY ? '+' : '~'} ${m.slug} s${m.season} → ${m.mlId.slice(0,8)}`);
  if (APPLY) changed += upd.run(m).changes;
}
console.log(`\n${APPLY ? `Applied: ${changed} updated` : 'Dry-run complete'}${missing ? `, ${missing} missing` : ''}.`);
```

- [ ] **Step 2: Dry-run**

Run: `node scripts/backfill-season-sources.mjs`
Expected: lists each active season as `~ ... → <id>`; no writes.

- [ ] **Step 3: Apply**

Run: `node scripts/backfill-season-sources.mjs --apply`
Expected: "Backed up DB → ..." then `Applied: N updated`.

- [ ] **Step 4: Verify**

Run: `sqlite3 data/league.db "SELECT l.slug, s.season_number, substr(s.source_competition_id,1,8) sid, s.source FROM seasons s JOIN leagues l ON l.id=s.league_id ORDER BY l.slug, s.season_number;"`
Expected: every row has a non-null `sid` and `source='music_league'`.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-season-sources.mjs
git commit -m "feat(seasons): one-time backfill of source_competition_id for all seasons (SP1)"
```

---

### Task 4: Shared resolver `scripts/lib/mlSource.mjs`

**Files:**
- Create: `scripts/lib/mlSource.mjs`
- Test: `scripts/lib/mlSource.test.mjs`

**Interfaces:**
- Produces:
  - `resolveSourceCompetition(db, slug, seasonNumber) => { source, sourceCompetitionId } | null`
  - `resolveActiveSourceCompetition(db, slug) => { source, sourceCompetitionId, seasonNumber } | null` (highest `season_number` whose `status='active'` with a non-null id; for the auth-trigger fast-path).

- [ ] **Step 1: Write the failing test** — `scripts/lib/mlSource.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { resolveSourceCompetition, resolveActiveSourceCompetition } from './mlSource.mjs';

function seed() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE leagues (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT);
    CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER,
      status TEXT, source TEXT DEFAULT 'music_league', source_competition_id TEXT);
    INSERT INTO leagues (slug,name) VALUES ('second-best','Second Best');
    INSERT INTO seasons (league_id,season_number,status,source_competition_id)
      VALUES (1,1,'complete','oldid'),(1,2,'active','newid');`);
  return db;
}

test('resolveSourceCompetition returns the season mapping', () => {
  const db = seed();
  assert.deepEqual(resolveSourceCompetition(db, 'second-best', 2),
    { source: 'music_league', sourceCompetitionId: 'newid' });
  assert.equal(resolveSourceCompetition(db, 'second-best', 9), null);
});

test('resolveActiveSourceCompetition picks the highest active season', () => {
  const db = seed();
  assert.deepEqual(resolveActiveSourceCompetition(db, 'second-best'),
    { source: 'music_league', sourceCompetitionId: 'newid', seasonNumber: 2 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lib/mlSource.test.mjs`
Expected: FAIL — module `./mlSource.mjs` not found.

- [ ] **Step 3: Write the resolver** — `scripts/lib/mlSource.mjs`:

```js
/**
 * DB-backed resolution of a season's upstream (source) competition id.
 * Single source of truth for the .mjs ML scripts, replacing hardcoded pin maps.
 */
export function resolveSourceCompetition(db, slug, seasonNumber) {
  const row = db.prepare(`SELECT s.source AS source, s.source_competition_id AS sid
    FROM seasons s JOIN leagues l ON l.id = s.league_id
    WHERE l.slug = ? AND s.season_number = ?`).get(slug, seasonNumber);
  if (!row || !row.sid) return null;
  return { source: row.source ?? 'music_league', sourceCompetitionId: row.sid };
}

export function resolveActiveSourceCompetition(db, slug) {
  const row = db.prepare(`SELECT s.season_number AS n, s.source AS source, s.source_competition_id AS sid
    FROM seasons s JOIN leagues l ON l.id = s.league_id
    WHERE l.slug = ? AND s.status = 'active' AND s.source_competition_id IS NOT NULL
    ORDER BY s.season_number DESC LIMIT 1`).get(slug);
  if (!row) return null;
  return { source: row.source ?? 'music_league', sourceCompetitionId: row.sid, seasonNumber: row.n };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/lib/mlSource.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/mlSource.mjs scripts/lib/mlSource.test.mjs
git commit -m "feat(scripts): shared DB-backed season→source resolver (SP1)"
```

---

### Task 5: `ml-rebuild.mjs` resolves from DB (pins as fallback)

**Files:**
- Modify: `scripts/ml-rebuild.mjs` (import resolver; resolve each target's league id from DB first, `mlLeagueId` pin as fallback)

**Interfaces:**
- Consumes: `resolveSourceCompetition` (Task 4); the `db` handle already opened at `scripts/ml-rebuild.mjs:56`.

- [ ] **Step 1: Add the import** near the top of `scripts/ml-rebuild.mjs` (after the existing imports):

```js
import { resolveSourceCompetition } from './lib/mlSource.mjs';
```

- [ ] **Step 2: Prefer the DB mapping in the target loop** — in `main()`, replace the pin lookup:

```js
		const mlL = mlLeagues.find((l) => l.id === target.mlLeagueId);
```

with:

```js
		// DB is source of truth; the TARGETS pin is a fallback for un-backfilled rows.
		const sid = resolveSourceCompetition(db, target.slug, target.season)?.sourceCompetitionId ?? target.mlLeagueId;
		const mlL = mlLeagues.find((l) => l.id === sid);
```

Leave the existing `if (!target.mlLeagueId) throw ...` guard and the `if (!mlL) ... skipping` branch unchanged (the pin stays required as the documented fallback).

- [ ] **Step 3: Verify unchanged behavior via dry-run**

Run: `node scripts/ml-rebuild.mjs`
Expected: identical to today — `fam-jam s4` (12 update), `second-best s2` (9 update), `boarz-ii-men s1` (9 update), all `0 insert, 0 delete`; no `UNSAFE-DELETE`.

- [ ] **Step 4: Commit**

```bash
git add scripts/ml-rebuild.mjs
git commit -m "refactor(ml-rebuild): resolve league id from seasons.source_competition_id, pin as fallback (SP1)"
```

---

### Task 6: `ml-reconcile.mjs` resolves from DB (pin/name as fallback)

**Files:**
- Modify: `scripts/ml-reconcile.mjs` (import resolver; resolve the reconciled season's league id from DB first, `SLUG_TO_ML_ID` / name needle as fallback)

**Interfaces:**
- Consumes: `resolveSourceCompetition` (Task 4); the `db` handle at `scripts/ml-reconcile.mjs:41`. `ml-reconcile` reconciles a league's **max** `season_number` (`reconcileLeague` picks `seasons[seasons.length-1]`).

- [ ] **Step 1: Add the import** after the existing imports in `scripts/ml-reconcile.mjs`:

```js
import { resolveSourceCompetition } from './lib/mlSource.mjs';
```

- [ ] **Step 2: Prefer the DB mapping when choosing the ML league** — in the `for (const dbL of dbLeagues)` loop in `main()`, replace the pin/name resolution:

```js
		const mlL = pinnedId
			? mlLeagues.find((l) => l.id === pinnedId)
			: mlLeagues.find((l) => l.name.toLowerCase().includes(needle));
```

with:

```js
		// DB is source of truth for the max season; pin/name are fallbacks.
		const maxSeason = db.prepare(
			'SELECT MAX(season_number) AS n FROM seasons WHERE league_id = (SELECT id FROM leagues WHERE slug = ?)'
		).get(dbL.slug)?.n;
		const dbSid = maxSeason != null
			? resolveSourceCompetition(db, dbL.slug, maxSeason)?.sourceCompetitionId
			: null;
		const mlL = dbSid
			? mlLeagues.find((l) => l.id === dbSid)
			: pinnedId
			? mlLeagues.find((l) => l.id === pinnedId)
			: mlLeagues.find((l) => l.name.toLowerCase().includes(needle));
```

(Keep the surrounding `pinnedId`/`needle`/`if (!mlL) ... skipping` code as-is.)

- [ ] **Step 3: Verify via dry-run (read-only; no `--apply`)**

Run: `node scripts/ml-reconcile.mjs`
Expected: for each active league it reports the SAME ML league it resolved before (fam-jam→"Fam Jam IV", second-best→"Second Second Best", boarz-ii-men→"Boarz II Men", hip-jammers→its S3 league or a skip if complete/absent from the current list), and per-round diffs are all `✓ in sync`. No crashes.

- [ ] **Step 4: Commit**

```bash
git add scripts/ml-reconcile.mjs
git commit -m "refactor(ml-reconcile): resolve max-season league id from DB, pin/name as fallback (SP1)"
```

---

### Task 7: `ml-auth-trigger.mjs` DB fast-path (additive; name-match unchanged)

**Files:**
- Modify: `scripts/ml-auth-trigger.mjs` (in `resolveLeagueId`, try the DB's active-season mapping first; keep the entire existing name-matching path as the fallback)

**Interfaces:**
- Consumes: `resolveActiveSourceCompetition` (Task 4). `resolveLeagueId({ leagueName, slug })` already receives `slug`. It must open `data/league.db` read-only (the script is currently DB-free).

- [ ] **Step 1: Add imports** at the top of `scripts/ml-auth-trigger.mjs`:

```js
import Database from 'better-sqlite3';
import { resolveActiveSourceCompetition } from './lib/mlSource.mjs';
```

- [ ] **Step 2: Add the DB fast-path** at the very start of `resolveLeagueId` (before the `runCli(['--json','leagues','list'], ...)` call at line 286):

```js
	// SP1 fast-path: if the DB maps this slug's active season to an upstream id,
	// use it directly and skip name-matching entirely. Read-only; failure is
	// non-fatal — fall through to the existing CLI name-match below.
	try {
		const db = new Database(process.env.LEAGUE_DB ?? 'data/league.db', { readonly: true });
		const hit = slug ? resolveActiveSourceCompetition(db, slug) : null;
		db.close();
		if (hit?.sourceCompetitionId) {
			return { leagueId: hit.sourceCompetitionId };
		}
	} catch {
		// ignore — fall through to name-matching
	}
```

Note: confirm the success shape the two callers (`scripts/ml-auth-trigger.mjs:167,238`) expect from `resolveLeagueId` and match it. If they read `resolved.leagueId`, the return above is correct; if they read a different field, mirror that field name instead. (Do not change the callers.)

- [ ] **Step 3: Verify the success shape** — inspect the two call sites:

Run: `sed -n '165,175p;236,246p' scripts/ml-auth-trigger.mjs`
Expected: confirm they read `resolved.leagueId` (or adjust Step 2's returned property to match what they read).

- [ ] **Step 4: Smoke-test resolution for a backfilled slug**

Run (from repo root):
```bash
node -e "import('./scripts/lib/mlSource.mjs').then(async m => { const D=(await import('better-sqlite3')).default; const db=new D('data/league.db',{readonly:true}); console.log(m.resolveActiveSourceCompetition(db,'second-best')); })"
```
Expected: `{ source: 'music_league', sourceCompetitionId: '78b2e640...', seasonNumber: 2 }`.

- [ ] **Step 5: Commit**

```bash
git add scripts/ml-auth-trigger.mjs
git commit -m "feat(ml-auth-trigger): DB active-season fast-path before name-match (SP1)"
```

---

### Task 8: Full-suite gate + final live dry-runs

**Files:** none (verification only).

- [ ] **Step 1: Run the full UI test suite**

Run: `cd ui && npx vitest run`
Expected: PASS (no regressions from the schema/type/upsertSeason changes).

- [ ] **Step 2: Run the script resolver test**

Run: `node --test scripts/lib/mlSource.test.mjs`
Expected: PASS.

- [ ] **Step 3: Final live dry-runs (read-only)**

Run: `node scripts/ml-rebuild.mjs` and `node scripts/ml-reconcile.mjs`
Expected: both resolve every active season from the DB, report in-sync / zero-insert-zero-delete, no `UNSAFE-DELETE`, no crashes.

- [ ] **Step 4: Confirm the running bot is healthy** (schema change is live via the mounted DB)

Run: `docker ps --format '{{.Names}} {{.Status}}' | grep music-league-bot`
Expected: `bot-ui`, `api`, `bot` all `Up`. (If the app restarted to pick up new code, confirm no boot crash: `docker logs --tail 30 music-league-bot-bot-ui-1`.)

---

## Notes for the executor

- **Order matters:** Tasks 1→2 (schema before writers), Task 3 (backfill) before Tasks 5–7 rely on populated rows for their DB path — though all three retain fallbacks so a partial backfill can't break them.
- **This is the only DB-writing task:** Task 3. Tasks 5–7 are code-only; their verification steps are read-only dry-runs.
- **Do NOT** rename `ml_*` columns or introduce any second `source` value — that is Phase 2, out of scope.
- If `cd ui && npx vitest run` reports a config error, the suite is run from `ui/` (its `package.json` `test` script is `vitest run`); do not add a root-level vitest config.
- **Deployment timing:** all SP1 changes are backward-compatible. The columns reach the live DB immediately via Task 3's self-sufficient backfill (`--apply`), so the standalone scripts (Tasks 5–7) work at once. The app (`upsertSeason`/`Season`/boot migration/unique index) picks up the new code on its **next natural container rebuild** — no forced mid-sequence redeploy is required, and the running old-code app safely ignores the additive columns until then.
