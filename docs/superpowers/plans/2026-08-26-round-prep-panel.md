# Round Prep Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the material a digest will be built from visible before it is built, give the editor a durable per-round note that reaches generation server-side, and add an on-demand early lede sheet.

**Architecture:** A second block on the digest page's existing `stage === 'prepare'`, fed by one server-side gatherer (`prepMaterial.ts`) that returns typed rows. Notes live in a new `round_notes` table and are injected into prompts inside `buildUserPrompt`, not through the UI, so they survive unattended generation. Early ledes use `callOpenRouter` in-container rather than the host's `claude -p`.

**Tech Stack:** TypeScript + SvelteKit 2 + Svelte 5 runes, better-sqlite3, vitest (`ui/`); Python 3 + pytest (`scripts/`).

**Spec:** `docs/superpowers/specs/2026-08-26-round-prep-panel-design.md`

## Global Constraints

- **Do not touch the existing prep checks.** `runPrepChecks`, `POST /api/digest/:roundId/prepare`, and the `dg-prepare` checks list stay exactly as they are. The new block sits *below* them.
- **Do not modify the per-section `context` textarea** in `GenerateModal`. Notes and `context` are two different jobs (spec §4); the modal only gains read-only chips.
- **The editorial envelope is mandatory.** Every note reaching a prompt is wrapped per spec §4. Losing it makes this feature manufacture the fabricated-quote failures `verify_facts` exists to catch. Task 5 asserts it against the built prompt string.
- **`digest_early_ledes` and `digest_ledes` are separate tables.** Early generation must never write `digest_ledes` — that would collide with `generate_ledes.py`'s `--force` guard and could clobber real ratings.
- **Never open `data/league.db` in a test.** TS tests use `new Database(':memory:')`; Python tests use `scripts/digest-qa/tests/conftest.py`.
- **Verify UI with a production build, not `npm run dev`.** The digest page hydration crashes under the dev server (`node:crypto` via `llm.ts`): `cd ui && npm run build && npm run preview`.
- `ui/src/routes/digest/[roundId]/+page.svelte` is already ~2000 lines. New UI goes in its own component under `$lib/digest/`, mounted from the page — do not inline it.
- Run tests with `cd ui && npm test` and `python3 -m pytest scripts/digest-qa/tests -q`.
- Commit after every task. Do not push — `master` is 29+ commits ahead of `origin/master`.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `ui/src/lib/digest/prepMaterial.ts` | Server-side gatherer: one `MaterialRow[]` describing what pre-gen material exists. Pure over a DB handle. |
| `ui/src/lib/digest/PrepPanel.svelte` | The panel: rows, expand-to-preview, notes affordance. |
| `ui/src/lib/digest/roundNotes.ts` | `round_notes` CRUD + `notesForPrompt` grouping. |
| `ui/src/lib/digest/noteEnvelope.ts` | The prompt envelope. One function, one responsibility, so it cannot drift. |
| `ui/src/routes/api/digest/[roundId]/notes/+server.ts` | GET/POST/PATCH/DELETE notes. |
| `ui/src/routes/api/digest/[roundId]/early-ledes/+server.ts` | POST generate, PATCH ratings. |
| `ui/src/lib/digest/earlyLedes.ts` | Early lede prompt + `callOpenRouter` call + storage. |

**Modified:** `ui/src/lib/db/schema.ts` (2 tables), `ui/src/routes/digest/[roundId]/+page.server.ts` (load material), `+page.svelte` (mount panel), `ui/src/lib/digest/llm.ts` (note injection in `buildUserPrompt`), `ui/src/lib/digest/GenerateModal.svelte` (read-only chips), `scripts/digest-qa/generate_ledes.py` (consume early sheet).

---

## Phase 1 — The panel and the bridge

*Ships alone and is worth shipping alone: it renders `digest_bridges` for the first time and would have caught the R148 gap.*

### Task 1: The material gatherer, with the bridge row

**Files:**
- Create: `ui/src/lib/digest/prepMaterial.ts`
- Create: `ui/src/lib/digest/prepMaterial.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `type MaterialStatus = 'present' | 'absent' | 'not-enabled'`
  - `type MaterialRow = { id: string; name: string; status: MaterialStatus; src: string; count?: number; preview?: unknown }`
  - `previousRoundId(db, roundId): number | null`
  - `gatherPrepMaterial(db, roundId): MaterialRow[]`

**The three-state status matters** (spec §3): `not-enabled` (league isn't opted in) must be distinct from `absent` (opted in, nothing there). Conflating them is the R148 failure, where Boarz shipped without a Regulars section and nobody noticed until punch-up.

**Previous-round resolution** mirrors `generate_ledes.py`: same season, greatest `voting_deadline` strictly before this round's.

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/digest/prepMaterial.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';
import { previousRoundId, gatherPrepMaterial } from './prepMaterial.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('bz', 'Boarz II Men');
  // Real schema: seasons.status, rounds.ml_round_id and rounds.created_at are NOT NULL.
  db.prepare("INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')").run();
  const r = db.prepare(
    "INSERT INTO rounds (id, season_id, ml_round_id, name, voting_deadline, created_at) VALUES (?, 1, ?, ?, ?, '2026-08-01T00:00:00Z')",
  );
  r.run(148, 'ml-148', 'Smells Like Teen Cousin Fuckers', '2026-08-20T06:30:00Z');
  r.run(149, 'ml-149', 'Surrender Monkeys', '2026-08-27T06:30:00Z');
});

describe('previousRoundId', () => {
  it('finds the prior round in the same season by deadline', () => {
    expect(previousRoundId(db, 149)).toBe(148);
  });

  it('returns null for the first round of a season', () => {
    expect(previousRoundId(db, 148)).toBeNull();
  });

  it('ignores rounds in other seasons', () => {
    db.prepare('INSERT INTO seasons (id, league_id, season_number) VALUES (2, 1, 2)').run();
    db.prepare('INSERT INTO rounds (id, season_id, name, voting_deadline) VALUES (200, 2, ?, ?)')
      .run('Other', '2026-08-25T06:30:00Z');
    expect(previousRoundId(db, 149)).toBe(148);
  });
});

describe('gatherPrepMaterial — bridge row', () => {
  const bridgeRow = (roundId: number) =>
    gatherPrepMaterial(db, roundId).find((r) => r.id === 'bridge')!;

  it('reports absent when the previous round has no bridge — the R148 case', () => {
    const row = bridgeRow(149);
    expect(row.status).toBe('absent');
    expect(row.preview).toBeUndefined();
    expect(row.src).toContain('148');
  });

  it('reports present with a preview when the previous round has a bridge', () => {
    // Real digest_bridges also has NOT NULL league_id + draft_id.
    db.prepare('INSERT INTO digest_bridges (round_id, league_id, draft_id, content_json, generated_at) VALUES (?, 1, ?, ?, ?)')
      .run(148, 'draft-148', JSON.stringify({
        round: { id: 148 },
        headline_stories: [{ title: 'The Combo Option' }],
        running_bits: ['carrotbox'],
        callbacks_planted: ['mandolin'],
        notable_quotes: [{ text: 'a quote' }],
      }), '2026-08-26T21:55:24Z');
    const row = bridgeRow(149);
    expect(row.status).toBe('present');
    expect(row.src).toContain('2026-08-26');
    expect((row.preview as { headline_stories: unknown[] }).headline_stories).toHaveLength(1);
  });

  it('reports absent, not present-with-nothing, for the first round of a season', () => {
    const row = bridgeRow(148);
    expect(row.status).toBe('absent');
    expect(row.src).toContain('no previous round');
  });

  it('survives a malformed bridge payload rather than throwing', () => {
    db.prepare('INSERT INTO digest_bridges (round_id, league_id, draft_id, content_json, generated_at) VALUES (?, 1, ?, ?, ?)')
      .run(148, 'draft-148', '{ not json', '2026-08-26T21:55:24Z');
    expect(() => bridgeRow(149)).not.toThrow();
    expect(bridgeRow(149).status).toBe('absent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/digest/prepMaterial.test.ts`
Expected: FAIL — `Failed to resolve import "./prepMaterial.js"`

- [ ] **Step 3: Confirm `digest_bridges` is in `SCHEMA`**

The table was created by `generate_bridge.py`, not by `schema.ts`, so the in-memory test DB may not have it. Check:

```bash
grep -n "digest_bridges" ui/src/lib/db/schema.ts
```

Already done (commit 8f9b2c3): `schema.ts` mirrors the live table, which also carries
NOT NULL `league_id` and `draft_id` columns. Do **not** edit `schema.ts` or the live table.

- [ ] **Step 4: Write the implementation**

```ts
// ui/src/lib/digest/prepMaterial.ts
/**
 * What pre-generation material exists for a round.
 *
 * Answers a different question from runPrepChecks: that one asks "is the DATA
 * imported?", this asks "what MATERIAL do we hold to build from?" They render
 * as two blocks on the prepare stage and are deliberately not merged.
 */
import type Database from 'better-sqlite3';

/**
 * `not-enabled` (the league is not opted in) is deliberately distinct from
 * `absent` (opted in, nothing there). Collapsing them is how R148 shipped
 * without a Regulars section without anyone noticing.
 */
export type MaterialStatus = 'present' | 'absent' | 'not-enabled';

export type MaterialRow = {
  id: string;
  name: string;
  status: MaterialStatus;
  /** Where it comes from / why it is missing. Rendered like PrepareCheck.src. */
  src: string;
  count?: number;
  preview?: unknown;
};

/**
 * The prior round in the same season, by voting deadline.
 * Mirrors generate_ledes.py's lookup so the app and the lede generator never
 * disagree about which bridge belongs to which round.
 */
export function previousRoundId(db: Database.Database, roundId: number): number | null {
  const self = db.prepare('SELECT season_id, voting_deadline FROM rounds WHERE id = ?')
    .get(roundId) as { season_id: number; voting_deadline: string | null } | undefined;
  if (!self?.voting_deadline) return null;
  const prev = db.prepare(
    `SELECT id FROM rounds
      WHERE season_id = ? AND voting_deadline IS NOT NULL AND voting_deadline < ?
      ORDER BY voting_deadline DESC LIMIT 1`,
  ).get(self.season_id, self.voting_deadline) as { id: number } | undefined;
  return prev?.id ?? null;
}

function bridgeRow(db: Database.Database, roundId: number): MaterialRow {
  const base = { id: 'bridge', name: "Previous round's bridge" };
  const prevId = previousRoundId(db, roundId);
  if (prevId === null) {
    return { ...base, status: 'absent', src: 'no previous round in this season' };
  }
  let row: { content_json: string; generated_at: string } | undefined;
  try {
    row = db.prepare('SELECT content_json, generated_at FROM digest_bridges WHERE round_id = ?')
      .get(prevId) as typeof row;
  } catch {
    row = undefined; // table may not exist on an old DB
  }
  if (!row) {
    return { ...base, status: 'absent', src: `digest_bridges · round ${prevId} · never generated` };
  }
  try {
    return {
      ...base,
      status: 'present',
      src: `round ${prevId} · ${row.generated_at}`,
      preview: JSON.parse(row.content_json),
    };
  } catch {
    // A malformed payload is worse than a missing one; report it as absent so
    // it is regenerated rather than silently previewed as empty.
    return { ...base, status: 'absent', src: `round ${prevId} · malformed payload` };
  }
}

export function gatherPrepMaterial(db: Database.Database, roundId: number): MaterialRow[] {
  return [bridgeRow(db, roundId)];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/digest/prepMaterial.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/digest/prepMaterial.ts ui/src/lib/digest/prepMaterial.test.ts
git commit -m "feat(prep): material gatherer with the previous-round bridge row

Three-state status: not-enabled is distinct from absent, because collapsing
them is how R148 shipped without a Regulars section unnoticed. Previous-round
resolution mirrors generate_ledes.py so the app and the generator never
disagree about which bridge belongs to which round."
```

---

### Task 2: The panel component

**Files:**
- Create: `ui/src/lib/digest/PrepPanel.svelte`
- Modify: `ui/src/routes/digest/[roundId]/+page.server.ts` (add `material` to the prepare-stage return)
- Modify: `ui/src/routes/digest/[roundId]/+page.svelte` (mount below the checks block)

**Interfaces:**
- Consumes: `MaterialRow[]` (Task 1).
- Produces: a component taking `{ material, roundId }`. No exports.

- [ ] **Step 1: Add `material` to the page load**

In `ui/src/routes/digest/[roundId]/+page.server.ts`, import the gatherer and widen the prepare branch of the `DigestPageData` union (line ~172):

```ts
import { gatherPrepMaterial, type MaterialRow } from '$lib/digest/prepMaterial.js';
```

```ts
  | (DigestPageBase & { stage: 'prepare'; checks: PrepareCheck[]; material: MaterialRow[] })
```

and at the prepare return (line ~435):

```ts
  const material = gatherPrepMaterial(getDb(), roundId);
  return { roundId, roundsIndex, currentRound, relContext, share, archiveUrl, stage: 'prepare', checks, material } satisfies DigestPageData;
```

- [ ] **Step 2: Build the component**

```svelte
<!-- ui/src/lib/digest/PrepPanel.svelte -->
<script lang="ts">
  /**
   * Pre-generation material for a round: what exists to build the digest from.
   *
   * Sits below the prep-checks list on the prepare stage and answers a
   * different question — checks ask "is the data imported?", this asks "what
   * material do we hold?". Same visual language on purpose.
   */
  import type { MaterialRow } from './prepMaterial.js';

  let { material }: { material: MaterialRow[]; roundId: number } = $props();

  let open = $state<Record<string, boolean>>({});
  const toggle = (id: string) => { open = { ...open, [id]: !open[id] }; };

  function glyph(status: MaterialRow['status']): string {
    return status === 'present' ? '✓' : status === 'not-enabled' ? '–' : '!';
  }
  function colour(status: MaterialRow['status']): string {
    return status === 'present' ? 'var(--moss)'
      : status === 'not-enabled' ? 'var(--fg-quiet)' : 'var(--amber)';
  }
  const presentCount = $derived(material.filter((m) => m.status === 'present').length);
</script>

<div class="dg-prep-material">
  <header class="dg-prep-material-hd">
    <span class="dg-prep-material-label">
      Pre-generation material · {presentCount}/{material.length}
    </span>
  </header>

  <div class="dg-prep-material-list">
    {#each material as row (row.id)}
      <div class="dg-prep-material-row">
        <span class="dg-prep-material-glyph" style="color: {colour(row.status)};">
          {glyph(row.status)}
        </span>
        <span class="dg-prep-material-name">
          {row.name}{row.count !== undefined ? ` · ${row.count}` : ''}
          {#if row.status === 'not-enabled'}<em> (not enabled for this league)</em>{/if}
        </span>
        <span class="dg-prep-material-src">{row.src}</span>
        {#if row.preview !== undefined}
          <button type="button" class="mash-btn mash-btn--ghost mash-btn--sm"
                  onclick={() => toggle(row.id)}>
            {open[row.id] ? 'hide' : 'preview'}
          </button>
        {/if}
      </div>
      {#if open[row.id] && row.preview !== undefined}
        <pre class="dg-prep-material-preview">{JSON.stringify(row.preview, null, 2)}</pre>
      {/if}
    {/each}
  </div>
</div>

<style>
  .dg-prep-material { display: flex; flex-direction: column; gap: 6px; }
  .dg-prep-material-hd { display: flex; justify-content: space-between; align-items: baseline; }
  .dg-prep-material-label { font: 600 11px/1 var(--font-mono); color: var(--fg-quiet); text-transform: uppercase; letter-spacing: 0.04em; }
  .dg-prep-material-list { display: flex; flex-direction: column; gap: 6px; }
  .dg-prep-material-row {
    display: grid; grid-template-columns: 22px 1fr auto auto; gap: 12px; align-items: baseline;
    padding: 8px 10px; background: var(--ink-0); border: 1px solid var(--line); border-radius: var(--r-2);
  }
  .dg-prep-material-glyph { text-align: center; font: 700 14px/1 var(--font-mono); }
  .dg-prep-material-name { font: 500 13px/1.4 var(--font-body); color: var(--fg); }
  .dg-prep-material-name em { color: var(--fg-quiet); font-style: normal; }
  .dg-prep-material-src { font: 500 11px/1 var(--font-mono); color: var(--fg-quiet); }
  .dg-prep-material-preview {
    margin: 0 0 4px; padding: 10px 12px; background: var(--ink-0);
    border: 1px solid var(--line); border-radius: var(--r-2);
    font: 500 11px/1.5 var(--font-mono); color: var(--fg-quiet);
    max-height: 320px; overflow: auto; white-space: pre-wrap;
  }
</style>
```

- [ ] **Step 3: Mount it on the prepare stage**

In `+page.svelte`, import it with the other `$lib/digest` imports:

```ts
  import PrepPanel from '$lib/digest/PrepPanel.svelte';
```

and place it inside the `{#if data.stage === 'prepare'}` section, **after** the checks `<div>` and **before** the missing-popularity panel:

```svelte
    <PrepPanel material={data.material} roundId={data.roundId} />
```

- [ ] **Step 4: Verify with a production build**

```bash
cd ui && npm run build && npm run preview
```

Open a round with no draft. Confirm: the checks list is unchanged above; the new block lists "Previous round's bridge"; a round whose predecessor has a bridge shows ✓ with a working preview; one whose predecessor has none shows `!` and **no preview button**.

- [ ] **Step 5: Typecheck and run the suite**

Run: `cd ui && npm run check && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/digest/PrepPanel.svelte ui/src/routes/digest/
git commit -m "feat(prep): render pre-generation material on the prepare stage

digest_bridges is rendered by a surface for the first time. A missing bridge
now shows as missing before it bites, instead of surfacing as bridge=no in a
lede run at 06:30 on the morning the round closes."
```

---

### Task 3: The remaining material rows

**Files:**
- Modify: `ui/src/lib/digest/prepMaterial.ts`
- Modify: `ui/src/lib/digest/prepMaterial.test.ts`

**Interfaces:**
- Consumes: `chatWindowFor`, `loadChatWindow` from `./chatSection.js`; `chatSectionEnabledFor` from `./chatSection.js`; `guesserSectionEnabledFor` from `./guesserSection.js`; `gatherStorylineEvidence` from `./storylineEvidence.js`; `getGuesserData` from `$lib/db/guesserInsights.js`.
- Produces: `gatherPrepMaterial` now returns six rows: `bridge`, `early-ledes`, `chat`, `storylines`, `guesser`, `participation`.

**Reuse, do not reimplement.** Every one of these has an existing resolver that the digest page already calls. Rebuilding any of them would create a second answer to the same question.

- [ ] **Step 1: Write the failing tests**

```ts
// append to ui/src/lib/digest/prepMaterial.test.ts
describe('gatherPrepMaterial — the other rows', () => {
  const rows = (roundId: number) => {
    const m = gatherPrepMaterial(db, roundId);
    return Object.fromEntries(m.map((r) => [r.id, r]));
  };

  it('returns all six rows in a stable order', () => {
    expect(gatherPrepMaterial(db, 149).map((r) => r.id))
      .toEqual(['bridge', 'early-ledes', 'chat', 'storylines', 'guesser', 'participation']);
  });

  it('reports the early lede sheet absent until one is drafted', () => {
    expect(rows(149)['early-ledes'].status).toBe('absent');
  });

  it('marks storylines not-enabled for a league that is not opted in', () => {
    expect(rows(149).storylines.status).toBe('not-enabled');
  });

  it('marks the guesser not-enabled for a league that is not opted in', () => {
    expect(rows(149).guesser.status).toBe('not-enabled');
  });

  it('distinguishes not-enabled from absent for storylines', () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('storylines_section_leagues', ?)").run('["bz"]');
    const row = rows(149).storylines;
    expect(row.status).not.toBe('not-enabled'); // opted in, so absent or present
  });

  it('reports participation absent when no vectors exist for the round', () => {
    expect(rows(149).participation.status).toBe('absent');
  });

  it('reports participation present with a count when vectors exist', () => {
    db.prepare('INSERT INTO competitors (id, name) VALUES (1, ?)').run('Kozh');
    db.prepare(`INSERT INTO player_participation (league_id, round_id, competitor_id, computed_at)
                VALUES (1, 149, 1, ?)`).run('2026-08-26T00:00:00Z');
    const row = rows(149).participation;
    expect(row.status).toBe('present');
    expect(row.count).toBe(1);
  });

  it('never throws when a downstream table is missing entirely', () => {
    const bare = new Database(':memory:');
    bare.exec('CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER, name TEXT, voting_deadline TEXT)');
    bare.prepare('INSERT INTO rounds (id, season_id, name, voting_deadline) VALUES (1, 1, ?, ?)')
      .run('R', '2026-01-01T00:00:00Z');
    expect(() => gatherPrepMaterial(bare, 1)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ui && npx vitest run src/lib/digest/prepMaterial.test.ts`
Expected: FAIL — the order assertion fails first (only `bridge` is returned).

- [ ] **Step 3: Read the existing resolvers before writing anything**

```bash
sed -n '1,60p' ui/src/lib/digest/guesserSection.ts
grep -n "export function chatSectionEnabledFor" -A 15 ui/src/lib/digest/chatSection.ts
grep -n "export function gatherStorylineEvidence" -A 20 ui/src/lib/digest/storylineEvidence.ts
```

Use whatever signatures those actually have. If one needs data the prepare stage does not have, return `absent` with an explanatory `src` rather than inventing a second resolver.

- [ ] **Step 4: Implement the five rows**

Each follows the same shape as `bridgeRow`: a `try/catch` around the lookup, an explicit `not-enabled` branch where an opt-in exists, and a `src` string that explains *why* something is missing rather than only that it is. Every row must be individually wrapped so one missing table cannot take down the panel:

```ts
function safeRow(id: string, name: string, build: () => MaterialRow): MaterialRow {
  try {
    return build();
  } catch (e) {
    return { id, name, status: 'absent', src: `unavailable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export function gatherPrepMaterial(db: Database.Database, roundId: number): MaterialRow[] {
  return [
    safeRow('bridge', "Previous round's bridge", () => bridgeRow(db, roundId)),
    safeRow('early-ledes', 'Early lede sheet', () => earlyLedesRow(db, roundId)),
    safeRow('chat', 'Chat window', () => chatRow(db, roundId)),
    safeRow('storylines', 'The Regulars evidence', () => storylinesRow(db, roundId)),
    safeRow('guesser', 'The Guesser', () => guesserRow(db, roundId)),
    safeRow('participation', 'Participation', () => participationRow(db, roundId)),
  ];
}
```

`earlyLedesRow` reads `digest_early_ledes`, which Task 8 creates — until then its `try` throws "no such table" and `safeRow` reports it absent, which is correct and needs no placeholder.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ui && npx vitest run src/lib/digest/prepMaterial.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify with a production build**

```bash
cd ui && npm run build && npm run preview
```
Confirm all six rows render, and that Boarz shows "The Regulars evidence — not enabled for this league" in quiet grey rather than an amber `!`.

- [ ] **Step 7: Commit**

```bash
git add ui/src/lib/digest/prepMaterial.ts ui/src/lib/digest/prepMaterial.test.ts
git commit -m "feat(prep): chat, Regulars, Guesser, and participation rows

Each row reuses the resolver the digest page already calls rather than
answering the same question a second way, and each is individually wrapped so
one missing table cannot take down the panel."
```

---

**Phase 1 checkpoint.** Stop and report. The panel ships here and is independently useful: six rows, previews, and the bridge visible for the first time. Nothing about generation has changed yet.

## Phase 2 — Notes

### Task 4: The notes table, store, and envelope

**Files:**
- Modify: `ui/src/lib/db/schema.ts` (one table)
- Create: `ui/src/lib/digest/noteEnvelope.ts`
- Create: `ui/src/lib/digest/roundNotes.ts`
- Create: `ui/src/lib/digest/roundNotes.test.ts`

**Interfaces:**
- Consumes: `SECTION_KINDS`, `SectionKind` from `./llm.js`.
- Produces:
  - `type NoteTarget = 'general' | SectionKind | 'ledes'`
  - `type RoundNote = { id: string; roundId: number; target: NoteTarget; body: string; createdAt: string; updatedAt: string }`
  - `listNotes(db, roundId): RoundNote[]`
  - `addNote(db, roundId, target, body, nowIso): RoundNote`
  - `updateNote(db, id, patch, nowIso): RoundNote | null`
  - `deleteNote(db, id): boolean`
  - `notesForPrompt(db, roundId): { general: RoundNote[]; bySection: Partial<Record<SectionKind, RoundNote[]>>; ledes: RoundNote[] }`
  - `wrapNotes(notes: RoundNote[]): string` (from `noteEnvelope.ts`)

**`noteEnvelope.ts` is its own file with one function on purpose.** The envelope is the safety property of this whole feature; giving it a home stops it being quietly reworded inside a larger refactor.

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/digest/roundNotes.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';
import { listNotes, addNote, updateNote, deleteNote, notesForPrompt } from './roundNotes.js';
import { wrapNotes } from './noteEnvelope.js';

const T0 = '2026-08-26T00:00:00Z';
let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('bz', 'Boarz');
  // Real schema: seasons.status and rounds.ml_round_id/created_at are NOT NULL.
  db.prepare(
    `INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (149, 1, 'r149', ?, '2026-08-26T00:00:00Z')`,
  ).run('Surrender Monkeys');
});

describe('CRUD', () => {
  it('adds and lists a note', () => {
    addNote(db, 149, 'general', 'Kozh has been needling Jensen about the mandolin', T0);
    const all = listNotes(db, 149);
    expect(all).toHaveLength(1);
    expect(all[0].target).toBe('general');
    expect(all[0].body).toContain('mandolin');
  });

  it('lists oldest-first — the order they were observed in', () => {
    addNote(db, 149, 'general', 'first', '2026-08-24T00:00:00Z');
    addNote(db, 149, 'general', 'second', '2026-08-25T00:00:00Z');
    expect(listNotes(db, 149).map((n) => n.body)).toEqual(['first', 'second']);
  });

  it('scopes notes to their round', () => {
    db.prepare(
      `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (150, 1, 'r150', ?, '2026-08-26T00:00:00Z')`,
    ).run('Next');
    addNote(db, 149, 'general', 'for 149', T0);
    expect(listNotes(db, 150)).toEqual([]);
  });

  it('updates a note body and target', () => {
    const n = addNote(db, 149, 'general', 'body', T0);
    const up = updateNote(db, n.id, { target: 'chat', body: 'edited' }, '2026-08-27T00:00:00Z');
    expect(up!.target).toBe('chat');
    expect(up!.body).toBe('edited');
    expect(up!.updatedAt).toBe('2026-08-27T00:00:00Z');
  });

  it('returns null updating an unknown note', () => {
    expect(updateNote(db, 'nope', { body: 'x' }, T0)).toBeNull();
  });

  it('deletes a note', () => {
    const n = addNote(db, 149, 'general', 'body', T0);
    expect(deleteNote(db, n.id)).toBe(true);
    expect(listNotes(db, 149)).toEqual([]);
  });

  it('rejects an unknown target', () => {
    expect(() => addNote(db, 149, 'nonsense' as never, 'x', T0)).toThrow();
  });
});

describe('notesForPrompt', () => {
  it('splits notes by target', () => {
    addNote(db, 149, 'general', 'g', T0);
    addNote(db, 149, 'chat', 'c', T0);
    addNote(db, 149, 'ledes', 'l', T0);
    const n = notesForPrompt(db, 149);
    expect(n.general.map((x) => x.body)).toEqual(['g']);
    expect(n.bySection.chat!.map((x) => x.body)).toEqual(['c']);
    expect(n.ledes.map((x) => x.body)).toEqual(['l']);
  });

  it('does not put a general note into bySection', () => {
    addNote(db, 149, 'general', 'g', T0);
    expect(notesForPrompt(db, 149).bySection).toEqual({});
  });

  it('returns empty structures for a round with no notes', () => {
    const n = notesForPrompt(db, 149);
    expect(n.general).toEqual([]);
    expect(n.ledes).toEqual([]);
    expect(n.bySection).toEqual({});
  });
});

describe('wrapNotes — the editorial envelope', () => {
  const note = (body: string) => ({ id: 'x', roundId: 149, target: 'general' as const, body, createdAt: T0, updatedAt: T0 });

  it('returns an empty string for no notes, so no stray heading is emitted', () => {
    expect(wrapNotes([])).toBe('');
  });

  it('states the note is not a quotable source', () => {
    const out = wrapNotes([note('the mandolin thing')]);
    expect(out).toMatch(/not a quotable source/i);
  });

  it('forbids attribution and chat framing', () => {
    const out = wrapNotes([note('x')]);
    expect(out).toMatch(/do not attribute/i);
    expect(out).toMatch(/said in the chat/i);
  });

  it('includes every note body verbatim', () => {
    const out = wrapNotes([note('first thing'), note('second thing')]);
    expect(out).toContain('first thing');
    expect(out).toContain('second thing');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/digest/roundNotes.test.ts`
Expected: FAIL — `Failed to resolve import "./roundNotes.js"`

- [ ] **Step 3: Add the table to `SCHEMA`**

Append to the `SCHEMA` template literal in `ui/src/lib/db/schema.ts`:

```sql
  CREATE TABLE IF NOT EXISTS round_notes (
    id         TEXT PRIMARY KEY,
    round_id   INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    target     TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS round_notes_round ON round_notes(round_id);
```

`target` is validated in code rather than by a CHECK constraint, so adding a section kind later does not need a table rebuild.

- [ ] **Step 4: Write the envelope**

```ts
// ui/src/lib/digest/noteEnvelope.ts
/**
 * The editorial envelope for editor notes in a prompt.
 *
 * This exists as its own file because it is the safety property of the notes
 * feature. A note is the editor's words going verbatim into a prompt, and a
 * model will otherwise treat them as source material — which means a note can
 * come back phrased as though it were said in the chat, and verify_facts then
 * flags it as a fabricated quote. Without this wrapper the feature
 * manufactures exactly the failure the QA gates exist to catch.
 *
 * Its wording is asserted by test. Change it deliberately, not incidentally.
 */
import type { RoundNote } from './roundNotes.js';

export function wrapNotes(notes: RoundNote[]): string {
  if (notes.length === 0) return '';
  const lines = notes.map((n) => `- ${n.body.trim()}`).join('\n');
  return [
    '',
    '# Editor notes',
    'Editorial direction from the human editor. Treat it as true, but it is',
    'NOT a quotable source: do not attribute it to anyone, and do not present it as',
    'something said in the chat or in a comment.',
    lines,
  ].join('\n');
}
```

- [ ] **Step 5: Write the store**

```ts
// ui/src/lib/digest/roundNotes.ts
/**
 * Durable per-round editor notes.
 *
 * Distinct from GenerateModal's per-section `context`, which is one-off
 * steering typed at the instant of generation. A note is something observed
 * days earlier. Conflating them would lose one of the two jobs.
 *
 * Notes are per-round and do not carry forward — cross-round continuity is the
 * bridge's job and it already does it.
 */
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { SECTION_KINDS, type SectionKind } from './llm.js';

export type NoteTarget = 'general' | SectionKind | 'ledes';

export type RoundNote = {
  id: string; roundId: number; target: NoteTarget; body: string;
  createdAt: string; updatedAt: string;
};

const TARGETS = new Set<string>(['general', 'ledes', ...SECTION_KINDS]);

export function isNoteTarget(v: unknown): v is NoteTarget {
  return typeof v === 'string' && TARGETS.has(v);
}

type Row = { id: string; round_id: number; target: string; body: string; created_at: string; updated_at: string };
const hydrate = (r: Row): RoundNote => ({
  id: r.id, roundId: r.round_id, target: r.target as NoteTarget,
  body: r.body, createdAt: r.created_at, updatedAt: r.updated_at,
});

/** Oldest-first: the order the editor observed them in. */
export function listNotes(db: Database.Database, roundId: number): RoundNote[] {
  return (db.prepare(
    'SELECT * FROM round_notes WHERE round_id = ? ORDER BY created_at, id',
  ).all(roundId) as Row[]).map(hydrate);
}

export function addNote(
  db: Database.Database, roundId: number, target: NoteTarget, body: string, nowIso: string,
): RoundNote {
  if (!isNoteTarget(target)) throw new Error(`unknown note target "${target}"`);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO round_notes (id, round_id, target, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, roundId, target, body, nowIso, nowIso);
  return { id, roundId, target, body, createdAt: nowIso, updatedAt: nowIso };
}

export function updateNote(
  db: Database.Database, id: string,
  patch: { target?: NoteTarget; body?: string }, nowIso: string,
): RoundNote | null {
  const row = db.prepare('SELECT * FROM round_notes WHERE id = ?').get(id) as Row | undefined;
  if (!row) return null;
  if (patch.target !== undefined && !isNoteTarget(patch.target)) {
    throw new Error(`unknown note target "${patch.target}"`);
  }
  const target = patch.target ?? (row.target as NoteTarget);
  const body = patch.body ?? row.body;
  db.prepare('UPDATE round_notes SET target = ?, body = ?, updated_at = ? WHERE id = ?')
    .run(target, body, nowIso, id);
  return { id, roundId: row.round_id, target, body, createdAt: row.created_at, updatedAt: nowIso };
}

export function deleteNote(db: Database.Database, id: string): boolean {
  return db.prepare('DELETE FROM round_notes WHERE id = ?').run(id).changes === 1;
}

export type PromptNotes = {
  general: RoundNote[];
  bySection: Partial<Record<SectionKind, RoundNote[]>>;
  ledes: RoundNote[];
};

/**
 * Group a round's notes by where they are allowed to go.
 *
 * `general` is NOT duplicated into bySection — callers append both, so
 * duplicating here would put the same note in a section prompt twice.
 */
export function notesForPrompt(db: Database.Database, roundId: number): PromptNotes {
  const out: PromptNotes = { general: [], bySection: {}, ledes: [] };
  for (const n of listNotes(db, roundId)) {
    if (n.target === 'general') out.general.push(n);
    else if (n.target === 'ledes') out.ledes.push(n);
    else (out.bySection[n.target] ??= []).push(n);
  }
  return out;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/digest/roundNotes.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 7: Commit**

```bash
git add ui/src/lib/db/schema.ts ui/src/lib/digest/noteEnvelope.ts \
        ui/src/lib/digest/roundNotes.ts ui/src/lib/digest/roundNotes.test.ts
git commit -m "feat(notes): round_notes table, store, and the editorial envelope

The envelope lives in its own one-function file because it is the safety
property of the feature: without it, a note comes back as a quote and
verify_facts flags it as fabricated. Its wording is asserted by test."
```

---

### Task 5: Inject notes into prompts

**Files:**
- Modify: `ui/src/lib/digest/llm.ts` (`buildUserPrompt`, `generateDraft`, `regenerateOneSection`)
- Create: `ui/src/lib/digest/llm.notes.test.ts`

**Interfaces:**
- Consumes: `notesForPrompt`, `PromptNotes` (Task 4); `wrapNotes` (Task 4).
- Produces: `buildUserPrompt(data, steer?, genParams?, season?, sections?, notes?)` — one new **optional trailing** parameter, so no existing call site breaks.

**All four call sites are inside `llm.ts`** (lines 923, 968, 1038), inside `generateDraft(data, genParams, season, db?)` and `regenerateOneSection(...)`. Both already have an optional `db` in scope, so notes are gathered there. When `db` is absent (the legacy/test path) no notes are injected — correct and safe.

**Placement in the prompt:** the `general` block goes near the top, after the round chronology, where cross-cutting framing already lives. Section-targeted notes append to that section's line, next to the existing `[extra context: …]`.

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/digest/llm.notes.test.ts
import { describe, it, expect } from 'vitest';
import { buildUserPrompt } from './llm.js';
import type { PromptNotes, RoundNote } from './roundNotes.js';

const T0 = '2026-08-26T00:00:00Z';
const note = (body: string, target: RoundNote['target']): RoundNote =>
  ({ id: body, roundId: 149, target, body, createdAt: T0, updatedAt: T0 });

// Minimal RoundData. Copy the fixture shape from llm.test.ts — it already
// builds a valid one; import or duplicate it rather than inventing fields.
import { makeRoundData } from './llm.test.js';

const empty: PromptNotes = { general: [], bySection: {}, ledes: [] };

describe('note injection', () => {
  it('puts a general note in the prompt', () => {
    const p = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['podium'],
      { ...empty, general: [note('the mandolin thing', 'general')] });
    expect(p).toContain('the mandolin thing');
  });

  it('wraps every note in the editorial envelope', () => {
    const p = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['podium'],
      { ...empty, general: [note('x', 'general')] });
    expect(p).toMatch(/not a quotable source/i);
    expect(p).toMatch(/do not attribute/i);
  });

  it('puts a chat-targeted note on the chat section only', () => {
    const notes: PromptNotes = { ...empty, bySection: { chat: [note('chat thing', 'chat')] } };
    const p = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['chat', 'podium'], notes);
    const chatLine = p.split('\n').find((l) => l.startsWith('- chat:'))!;
    const podiumLine = p.split('\n').find((l) => l.startsWith('- podium:'))!;
    expect(chatLine).toContain('chat thing');
    expect(podiumLine).not.toContain('chat thing');
  });

  it('never puts a ledes note in a section prompt', () => {
    const p = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['podium'],
      { ...empty, ledes: [note('lede steer', 'ledes')] });
    expect(p).not.toContain('lede steer');
  });

  it('emits no envelope and no heading when there are no notes', () => {
    const p = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['podium'], empty);
    expect(p).not.toContain('# Editor notes');
  });

  it('is unchanged when the notes argument is omitted entirely', () => {
    const withArg = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['podium'], empty);
    const without = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['podium']);
    expect(without).toBe(withArg);
  });

  it('keeps the existing per-section context alongside a note', () => {
    const genParams = { sections: [{ id: 'podium', enabled: true, style: [], variant: 'textual', context: 'lean dry' }] } as never;
    const p = buildUserPrompt(makeRoundData(), undefined, genParams, undefined, ['podium'],
      { ...empty, bySection: { podium: [note('podium thing', 'podium')] } });
    expect(p).toContain('lean dry');
    expect(p).toContain('podium thing');
  });
});
```

If `llm.test.ts` does not export a reusable fixture builder, extract its existing inline `RoundData` fixture into an exported `makeRoundData()` in that file and import it here rather than duplicating a large object.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/digest/llm.notes.test.ts`
Expected: FAIL — `buildUserPrompt` takes 5 arguments; notes are ignored.

- [ ] **Step 3: Extend `buildUserPrompt`**

Add the import and the trailing parameter:

```ts
import { wrapNotes } from './noteEnvelope.js';
import type { PromptNotes } from './roundNotes.js';
```

```ts
export function buildUserPrompt(
  data: RoundData,
  steer?: { chips: string[]; instructions: string; kind?: SectionKind; currentContent?: unknown },
  genParams?: GenParams,
  season?: SeasonData,
  sections?: SectionKind[],
  notes?: PromptNotes,
): string {
```

After the round-chronology block near the top, add the general block:

```ts
  // Editor notes (general): cross-cutting framing, so it sits with the other
  // whole-digest context rather than on any one section.
  if (notes?.general?.length) parts.push(wrapNotes(notes.general));
```

And in the section loop (around line 828), after the existing `context` line:

```ts
      const sectionNotes = notes?.bySection?.[k];
      if (sectionNotes?.length) {
        line += ` [editor notes — true but NOT quotable, do not attribute: ${sectionNotes.map((n) => n.body.trim()).join(' | ')}]`;
      }
```

The inline form carries its own short envelope because it is appended to a one-line section description rather than emitted as a block. The `general` block uses the full `wrapNotes` text.

- [ ] **Step 4: Gather notes at the call sites**

In `generateDraft(data, genParams, season, db?)`, before building messages:

```ts
  // Notes are read server-side rather than passed in from the UI: under an
  // unattended rollout nobody opens GenerateModal, so a UI-only path would
  // silently stop working the day automation lands.
  const notes = db ? notesForPrompt(db, data.round.id) : undefined;
```

Pass `notes` as the sixth argument at lines 923 and 968. Do the same in `regenerateOneSection` for line 1038. Confirm the round-id property name on `RoundData` before using `data.round.id` — read the type rather than assuming.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ui && npx vitest run src/lib/digest/llm.notes.test.ts src/lib/digest/llm.test.ts src/lib/digest/llm.storylines.test.ts`
Expected: PASS. The existing `llm` tests must be untouched — with no notes, the prompt is byte-identical.

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/digest/llm.ts ui/src/lib/digest/llm.notes.test.ts
git commit -m "feat(notes): inject editor notes into generation prompts

Server-side in generateDraft, not through GenerateModal: under an unattended
rollout nobody opens the modal. General notes go to every section and the
lede prompt; targeted notes go only where aimed; a ledes note never reaches a
section. With no notes the prompt is byte-identical to before."
```

---

### Task 6: Notes UI — panel affordance and modal chips

**Files:**
- Create: `ui/src/routes/api/digest/[roundId]/notes/+server.ts`
- Create: `ui/src/routes/api/digest/[roundId]/notes/server.test.ts`
- Modify: `ui/src/lib/digest/PrepPanel.svelte` (note list + add form per row)
- Modify: `ui/src/lib/digest/GenerateModal.svelte` (read-only chips)
- Modify: `ui/src/routes/digest/[roundId]/+page.server.ts` (load notes)

**Interfaces:**
- Consumes: the Task 4 store.
- Produces: `GET /api/digest/:roundId/notes` → `{ notes }`; `POST` `{ target, body }` → `{ note }`; `PATCH` `{ id, target?, body? }` → `{ note }`; `DELETE` `{ id }` → `{ ok }`.

**Default target per row** (spec §4): bridge → `general`, early-ledes → `ledes`, chat → `chat`, storylines → `storylines`, guesser → `general`, participation → `general`.

- [ ] **Step 1: Write the failing route test**

```ts
// ui/src/routes/api/digest/[roundId]/notes/server.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';

let db: Database.Database;
vi.mock('$lib/db/client.js', () => ({ getDb: () => db }));

const { GET, POST, PATCH, DELETE } = await import('./+server.js');
const params = { roundId: '149' };
const req = (body: unknown) => ({ json: async () => body }) as Request;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('bz', 'Boarz');
  db.prepare('INSERT INTO seasons (id, league_id, season_number) VALUES (1, 1, 1)').run();
  db.prepare('INSERT INTO rounds (id, season_id, name) VALUES (149, 1, ?)').run('R149');
});

it('returns an empty list for a round with no notes', async () => {
  expect((await (await GET({ params } as never)).json()).notes).toEqual([]);
});

it('creates a note', async () => {
  const res = await POST({ params, request: req({ target: 'chat', body: 'a thing' }) } as never);
  expect((await res.json()).note.target).toBe('chat');
  expect((await (await GET({ params } as never)).json()).notes).toHaveLength(1);
});

it('400s on an unknown target', async () => {
  await expect(POST({ params, request: req({ target: 'nope', body: 'x' }) } as never))
    .rejects.toMatchObject({ status: 400 });
});

it('400s on an empty body', async () => {
  await expect(POST({ params, request: req({ target: 'general', body: '   ' }) } as never))
    .rejects.toMatchObject({ status: 400 });
});

it('patches and deletes', async () => {
  const { note } = await (await POST({ params, request: req({ target: 'general', body: 'x' }) } as never)).json();
  const patched = await (await PATCH({ params, request: req({ id: note.id, body: 'y' }) } as never)).json();
  expect(patched.note.body).toBe('y');
  await DELETE({ params, request: req({ id: note.id }) } as never);
  expect((await (await GET({ params } as never)).json()).notes).toEqual([]);
});

it('404s patching an unknown note', async () => {
  await expect(PATCH({ params, request: req({ id: 'nope', body: 'y' }) } as never))
    .rejects.toMatchObject({ status: 404 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run "src/routes/api/digest/[roundId]/notes/server.test.ts"`
Expected: FAIL — cannot resolve `./+server.js`

- [ ] **Step 3: Write the route**

```ts
// ui/src/routes/api/digest/[roundId]/notes/+server.ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { listNotes, addNote, updateNote, deleteNote, isNoteTarget } from '$lib/digest/roundNotes.js';

const roundOf = (params: { roundId: string }): number => {
  const n = Number(params.roundId);
  if (!Number.isInteger(n) || n <= 0) throw error(400, 'invalid roundId');
  return n;
};

export const GET: RequestHandler = ({ params }) =>
  json({ notes: listNotes(getDb(), roundOf(params as { roundId: string })) });

export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = roundOf(params as { roundId: string });
  const { target, body } = (await request.json()) as { target?: unknown; body?: unknown };
  if (!isNoteTarget(target)) throw error(400, `unknown note target "${String(target)}"`);
  if (typeof body !== 'string' || !body.trim()) throw error(400, 'body is required');
  return json({ note: addNote(getDb(), roundId, target, body.trim(), new Date().toISOString()) });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  roundOf(params as { roundId: string });
  const { id, target, body } = (await request.json()) as { id?: string; target?: unknown; body?: unknown };
  if (!id) throw error(400, 'id is required');
  if (target !== undefined && !isNoteTarget(target)) throw error(400, 'unknown note target');
  if (body !== undefined && (typeof body !== 'string' || !body.trim())) throw error(400, 'body cannot be empty');
  const note = updateNote(getDb(), id,
    { target: target as never, body: typeof body === 'string' ? body.trim() : undefined },
    new Date().toISOString());
  if (!note) throw error(404, 'unknown note');
  return json({ note });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  roundOf(params as { roundId: string });
  const { id } = (await request.json()) as { id?: string };
  if (!id) throw error(400, 'id is required');
  if (!deleteNote(getDb(), id)) throw error(404, 'unknown note');
  return json({ ok: true });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run "src/routes/api/digest/[roundId]/notes/server.test.ts"`
Expected: PASS (6 tests)

- [ ] **Step 5: Add the notes affordance to `PrepPanel.svelte`**

Give each row a default target and a small notes block: existing notes for that target listed with edit/delete, plus a textarea and "Add note". Render note bodies as **plain text** — `boldRuns()` applies only to a section's `body`, so markdown in a note would print literally and imply a formatting that does not exist (spec §8).

```ts
  const DEFAULT_TARGET: Record<string, string> = {
    bridge: 'general', 'early-ledes': 'ledes', chat: 'chat',
    storylines: 'storylines', guesser: 'general', participation: 'general',
  };
```

Each note also gets a target `<select>` (options: `general`, the seven section kinds, `ledes`) so it can be retargeted after jotting.

- [ ] **Step 6: Add read-only chips to `GenerateModal.svelte`**

Fetch `GET /api/digest/:roundId/notes` when the modal opens and render, per section, a non-interactive chip: `{n} note{s} will be included` for that section's targeted notes plus the general ones. **Do not** write notes into the existing `context` textarea — they travel server-side, and copying them in would double them in the prompt.

- [ ] **Step 7: Verify with a production build**

```bash
cd ui && npm run build && npm run preview
```

Add a note on the bridge row, confirm it defaults to `general`; retarget one to `chat`; open Generate and confirm the chip counts match; generate and confirm the note's phrasing shows up in the output *without* being attributed to anyone.

- [ ] **Step 8: Typecheck and run the suite**

Run: `cd ui && npm run check && npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add ui/src/routes/api/digest/ ui/src/lib/digest/PrepPanel.svelte \
        ui/src/lib/digest/GenerateModal.svelte ui/src/routes/digest/
git commit -m "feat(notes): panel affordance and read-only modal chips

Each panel row defaults a note's target and any note can be retargeted. The
modal shows what will be included but never copies notes into the context
textarea — they travel server-side, and copying would double them."
```

---

**Phase 2 checkpoint.** Stop and report. A note written mid-round now reaches generation with nothing remembered at generation time, and reaches it whether or not a human is present.

## Phase 3 — The early lede sheet

### Task 7: Early lede generation

**Files:**
- Modify: `ui/src/lib/db/schema.ts` (one table)
- Create: `ui/src/lib/digest/earlyLedes.ts`
- Create: `ui/src/lib/digest/earlyLedes.test.ts`

**Interfaces:**
- Consumes: `callOpenRouter` from `./llm.js`; `modelFor` from `./modelFor.js`; `notesForPrompt`, `wrapNotes` (Task 4); `previousRoundId` (Task 1).
- Produces:
  - `type EarlyLede = { id: string; title: string; angle: string; evidence: string[] }`
  - `buildEarlyLedePrompt(input: EarlyLedeInput): string`
  - `generateEarlyLedes(db, roundId, deps): Promise<{ ledes: EarlyLede[] }>`
  - `getEarlyLedes(db, roundId): { ledes: EarlyLede[]; ratings: unknown; generatedAt: string } | null`
  - `saveEarlyLedeRatings(db, roundId, ratings, nowIso): boolean`

**Why OpenRouter, not `claude -p`** (spec §5): bot-ui has no `claude` CLI, and `callOpenRouter` already makes metered LLM calls in-container for every digest section. Using it means a synchronous button with no queue and no host round-trip. The two lede paths run on different engines, which is fine — the early sheet is explicitly the provisional one.

**`deps` is injected** so the test never makes a network call:

```ts
type EarlyLedeDeps = { call: typeof callOpenRouter; now: () => string; model?: string };
```

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/digest/earlyLedes.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';
import { buildEarlyLedePrompt, generateEarlyLedes, getEarlyLedes, saveEarlyLedeRatings } from './earlyLedes.js';
import { addNote } from './roundNotes.js';

const T0 = '2026-08-26T00:00:00Z';
let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('bz', 'Boarz');
  // seasons.status and rounds.ml_round_id/created_at are NOT NULL in SCHEMA.
  db.prepare("INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')").run();
  const r = db.prepare('INSERT INTO rounds (id, season_id, ml_round_id, name, voting_deadline, created_at) VALUES (?, 1, ?, ?, ?, ?)');
  r.run(148, 'ml-148', 'Prev', '2026-08-20T06:30:00Z', T0);
  r.run(149, 'ml-149', 'Surrender Monkeys', '2026-08-27T06:30:00Z', T0);
});

const deps = (ledes: unknown = [{ id: 'a', title: 'T', angle: 'A', evidence: ['e'] }]) => ({
  call: vi.fn().mockResolvedValue({ content: JSON.stringify({ ledes }) }),
  now: () => T0,
});

describe('buildEarlyLedePrompt', () => {
  it('states plainly that votes and results do not exist yet', () => {
    const p = buildEarlyLedePrompt({ roundName: 'R', leagueName: 'L', songs: [], subComments: [], chat: [], bridge: null, notes: '' });
    expect(p).toMatch(/no votes/i);
    expect(p).toMatch(/results/i);
  });

  it('includes the previous round bridge when present', () => {
    const p = buildEarlyLedePrompt({ roundName: 'R', leagueName: 'L', songs: [], subComments: [], chat: [], bridge: '{"running_bits":["carrotbox"]}', notes: '' });
    expect(p).toContain('carrotbox');
  });

  it('includes notes with their envelope', () => {
    const p = buildEarlyLedePrompt({ roundName: 'R', leagueName: 'L', songs: [], subComments: [], chat: [], bridge: null, notes: '# Editor notes\nnot a quotable source\n- the mandolin thing' });
    expect(p).toContain('the mandolin thing');
    expect(p).toMatch(/not a quotable source/i);
  });
});

describe('generateEarlyLedes', () => {
  it('stores the result in digest_early_ledes', async () => {
    await generateEarlyLedes(db, 149, deps());
    const got = getEarlyLedes(db, 149)!;
    expect(got.ledes).toHaveLength(1);
    expect(got.generatedAt).toBe(T0);
  });

  it('NEVER writes digest_ledes', async () => {
    await generateEarlyLedes(db, 149, deps());
    const n = db.prepare('SELECT COUNT(*) AS n FROM digest_ledes').get() as { n: number };
    expect(n.n).toBe(0);
  });

  it('regenerating replaces the row rather than erroring', async () => {
    await generateEarlyLedes(db, 149, deps());
    await generateEarlyLedes(db, 149, deps([{ id: 'b', title: 'T2', angle: 'A2', evidence: [] }]));
    expect(getEarlyLedes(db, 149)!.ledes[0].title).toBe('T2');
  });

  it('preserves ratings across a regeneration', async () => {
    await generateEarlyLedes(db, 149, deps());
    saveEarlyLedeRatings(db, 149, { ratings: { a: 'love' } }, T0);
    await generateEarlyLedes(db, 149, deps());
    expect(getEarlyLedes(db, 149)!.ratings).toEqual({ ratings: { a: 'love' } });
  });

  it('feeds ledes- and general-targeted notes into the prompt', async () => {
    addNote(db, 149, 'ledes', 'lede steer', T0);
    addNote(db, 149, 'general', 'general colour', T0);
    addNote(db, 149, 'chat', 'chat only', T0);
    const d = deps();
    await generateEarlyLedes(db, 149, d);
    const prompt = JSON.stringify(d.call.mock.calls[0][0]);
    expect(prompt).toContain('lede steer');
    expect(prompt).toContain('general colour');
    expect(prompt).not.toContain('chat only');
  });

  it('throws a useful error on unparseable model output', async () => {
    const d = { call: vi.fn().mockResolvedValue({ content: 'not json' }), now: () => T0 };
    await expect(generateEarlyLedes(db, 149, d)).rejects.toThrow(/parse/i);
  });

  it('returns null from getEarlyLedes when none exist', () => {
    expect(getEarlyLedes(db, 149)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/digest/earlyLedes.test.ts`
Expected: FAIL — `Failed to resolve import "./earlyLedes.js"`

- [ ] **Step 3: Add the table to `SCHEMA`** *(already done by the schema task, commit 8f9b2c3 — `digest_early_ledes` and `digest_ledes` are both in schema.ts; skip)*

```sql
  CREATE TABLE IF NOT EXISTS digest_early_ledes (
    round_id     INTEGER PRIMARY KEY REFERENCES rounds(id) ON DELETE CASCADE,
    content_json TEXT NOT NULL,
    ratings_json TEXT,
    generated_at TEXT NOT NULL
  );
```

Separate from `digest_ledes` on purpose: no collision with `generate_ledes.py`'s "already has a row, use `--force`" guard, and the real run can never clobber mid-round ratings.

The test also needs `digest_ledes` present in `SCHEMA` to assert it stays empty. It is created by `generate_ledes.py`, so check with `grep -n "digest_ledes" ui/src/lib/db/schema.ts` and, if absent, add it mirroring `sqlite3 data/league.db ".schema digest_ledes"` exactly.

- [ ] **Step 4: Write the implementation**

Key requirements, each covered by a test above:

- `generateEarlyLedes` reads the round, its songs and submission comments, the chat so far, `previousRoundId`'s bridge, and `notesForPrompt(db, roundId)` — using **only** `general` and `ledes` notes, wrapped with `wrapNotes`.
- The prompt says explicitly that votes, results, and the closing chat do not exist yet.
- The call is `deps.call(messages, { model: deps.model ?? modelFor('digest', db), jsonMode: true, meta: { db, ... } })`.
- Parse failures throw an error whose message contains "parse".
- Storage is an `INSERT … ON CONFLICT(round_id) DO UPDATE` that writes `content_json` and `generated_at` **but leaves `ratings_json` untouched**, which is what preserves ratings across a regeneration.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/digest/earlyLedes.test.ts`
Expected: PASS (10 tests — the count above, not 11)

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/db/schema.ts ui/src/lib/digest/earlyLedes.ts ui/src/lib/digest/earlyLedes.test.ts
git commit -m "feat(early-ledes): in-container generation via callOpenRouter

bot-ui has no claude CLI, but callOpenRouter already makes metered calls here,
so the button is synchronous with no queue and no host round-trip. Separate
table from digest_ledes; regeneration preserves ratings."
```

---

### Task 8: The early lede endpoint and panel row

**Files:**
- Create: `ui/src/routes/api/digest/[roundId]/early-ledes/+server.ts`
- Modify: `ui/src/lib/digest/prepMaterial.ts` (`earlyLedesRow` now reads a real table)
- Modify: `ui/src/lib/digest/PrepPanel.svelte` (Draft button, angle list, ratings)

**Interfaces:**
- Consumes: Task 7.
- Produces: `POST /api/digest/:roundId/early-ledes` → `{ ledes }`; `PATCH` `{ ratings }` → `{ ok }`; `GET` → `{ sheet | null }`.

- [ ] **Step 1: Write the route**

```ts
// ui/src/routes/api/digest/[roundId]/early-ledes/+server.ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { callOpenRouter } from '$lib/digest/llm.js';
import { generateEarlyLedes, getEarlyLedes, saveEarlyLedeRatings } from '$lib/digest/earlyLedes.js';

const roundOf = (params: { roundId: string }): number => {
  const n = Number(params.roundId);
  if (!Number.isInteger(n) || n <= 0) throw error(400, 'invalid roundId');
  return n;
};

export const GET: RequestHandler = ({ params }) =>
  json({ sheet: getEarlyLedes(getDb(), roundOf(params as { roundId: string })) });

// On demand only — never scheduled. Each call costs one LLM call, and the
// sheet is only worth having when there is time to look at it.
export const POST: RequestHandler = async ({ params }) => {
  const roundId = roundOf(params as { roundId: string });
  const out = await generateEarlyLedes(getDb(), roundId, {
    call: callOpenRouter, now: () => new Date().toISOString(),
  });
  return json(out);
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const roundId = roundOf(params as { roundId: string });
  const { ratings } = (await request.json()) as { ratings?: unknown };
  if (ratings === undefined) throw error(400, 'ratings is required');
  if (!saveEarlyLedeRatings(getDb(), roundId, ratings, new Date().toISOString())) {
    throw error(404, 'no early lede sheet for this round');
  }
  return json({ ok: true });
};
```

- [ ] **Step 2: Make `earlyLedesRow` read the table**

Replace the placeholder from Task 3 so it returns `present` with the angles as its preview and a count, or `absent` when there is no row. Because it is wrapped in `safeRow`, an old DB without the table still degrades to `absent` rather than throwing.

- [ ] **Step 3: Add the row UI**

In `PrepPanel.svelte`, the `early-ledes` row gains a "Draft early ledes" button (label becomes "Redraft" once a sheet exists) posting to the endpoint, a spinner while in flight, and — when a sheet exists — the angles with love/keep/kill controls that PATCH ratings. Render a short standing caveat next to the heading: *drafted without votes or results — steering only*.

- [ ] **Step 4: Verify with a production build**

```bash
cd ui && npm run build && npm run preview
```

Draft a sheet on an open round; confirm angles render, ratings persist across a reload, a redraft replaces the angles but keeps ratings, and `sqlite3 data/league.db "SELECT COUNT(*) FROM digest_ledes"` is **unchanged**.

- [ ] **Step 5: Typecheck and run the suite**

Run: `cd ui && npm run check && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/src/routes/api/digest/ ui/src/lib/digest/prepMaterial.ts ui/src/lib/digest/PrepPanel.svelte
git commit -m "feat(early-ledes): endpoint and prep-panel row

On demand only, with a standing caveat in the UI that the sheet was drafted
without votes or results."
```

---

### Task 9: Feed the early sheet into the real lede run

**Files:**
- Modify: `scripts/digest-qa/generate_ledes.py`
- Create: `scripts/digest-qa/tests/test_generate_ledes_early.py`

**Interfaces:**
- Consumes: `digest_early_ledes` (Task 7); `round_notes` (Task 4).
- Produces: `gather()` returns `early` and `notes`; `build_prompt` emits both with their caveats.

**The caveat goes in the prompt, not just the UI** (spec §5). The risk being managed is the model over-weighting a provisional artifact, and UI copy does not manage that.

- [ ] **Step 1: Write the failing test**

```python
# scripts/digest-qa/tests/test_generate_ledes_early.py
import json

import generate_ledes as gl


def test_build_prompt_says_no_early_sheet_when_absent():
    m = {"round_id": 149, "round_name": "R", "league_name": "L", "round_desc": "",
         "rulecard": "", "songs": [], "non_voters": [], "vote_comments": [],
         "sub_comments": [], "chat": [], "bridge": None, "early": None, "notes": [],
         "window": ("a", "b"), "slug": "bz", "song_by_uri": {}}
    p = gl.build_prompt(m)
    assert "no early lede sheet" in p.lower()


def test_build_prompt_includes_early_sheet_with_its_caveat():
    m = {"round_id": 149, "round_name": "R", "league_name": "L", "round_desc": "",
         "rulecard": "", "songs": [], "non_voters": [], "vote_comments": [],
         "sub_comments": [], "chat": [], "bridge": None,
         "early": json.dumps({"ledes": [{"title": "The Mandolin Question"}],
                              "ratings": {"a": "love"}}),
         "notes": [], "window": ("a", "b"), "slug": "bz", "song_by_uri": {}}
    p = gl.build_prompt(m)
    assert "The Mandolin Question" in p
    assert "without votes" in p.lower()
    assert "supersede" in p.lower()


def test_build_prompt_wraps_notes_in_the_editorial_envelope():
    m = {"round_id": 149, "round_name": "R", "league_name": "L", "round_desc": "",
         "rulecard": "", "songs": [], "non_voters": [], "vote_comments": [],
         "sub_comments": [], "chat": [], "bridge": None, "early": None,
         "notes": [{"body": "the mandolin thing"}],
         "window": ("a", "b"), "slug": "bz", "song_by_uri": {}}
    p = gl.build_prompt(m)
    assert "the mandolin thing" in p
    assert "not a quotable source" in p.lower()
    assert "do not attribute" in p.lower()


def test_gather_tolerates_missing_tables(tmp_path):
    """An old DB without digest_early_ledes or round_notes must still work."""
    import sqlite3
    path = tmp_path / "x.db"
    conn = sqlite3.connect(path)
    # gather() also reads ml_submissions/players/votes/settings unconditionally,
    # so the "old DB" must have them; only the two new prep-panel tables are absent.
    conn.executescript(
        "CREATE TABLE leagues (id INTEGER PRIMARY KEY, slug TEXT, name TEXT);"
        "CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER);"
        "CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER, name TEXT,"
        "  description TEXT, voting_deadline TEXT);"
        "CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT);"
        "CREATE TABLE ml_submissions (id INTEGER PRIMARY KEY, round_id INTEGER,"
        "  player_id INTEGER, spotify_uri TEXT, title TEXT, artists TEXT, comment TEXT);"
        "CREATE TABLE votes (id INTEGER PRIMARY KEY, round_id INTEGER,"
        "  player_id INTEGER, spotify_uri TEXT, points INTEGER, comment TEXT);"
        "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);"
        "INSERT INTO leagues VALUES (1,'bz','Boarz');"
        "INSERT INTO seasons VALUES (1,1);"
        "INSERT INTO rounds VALUES (149,1,'R','', '2026-08-27T06:30:00Z');"
        "INSERT INTO settings VALUES ('chat_league_group_map','{}');")
    conn.commit()
    m = gl.gather(conn, 149)
    assert m["early"] is None
    assert m["notes"] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest scripts/digest-qa/tests/test_generate_ledes_early.py -q`
Expected: FAIL — `KeyError: 'early'` from `build_prompt`.

- [ ] **Step 3: Extend `gather()`**

Alongside the existing bridge lookup (around line 127), add two lookups guarded the same way — `try/except sqlite3.OperationalError` so an old DB without the tables still works:

```python
    # 6. early lede sheet (mid-round, provisional — see build_prompt's caveat)
    early = None
    try:
        row = db.execute(
            "SELECT content_json, ratings_json FROM digest_early_ledes WHERE round_id=?",
            (round_id,)).fetchone()
        if row:
            early = json.dumps({"ledes": json.loads(row[0]).get("ledes", []),
                                "ratings": json.loads(row[1]) if row[1] else None})
    except (sqlite3.OperationalError, ValueError):
        early = None

    # 7. editor notes targeted at the ledes, plus the general ones
    notes = []
    try:
        notes = [dict(body=r[0]) for r in db.execute(
            "SELECT body FROM round_notes WHERE round_id=? AND target IN ('ledes','general')"
            " ORDER BY created_at, id", (round_id,)).fetchall()]
    except sqlite3.OperationalError:
        notes = []
```

Add `early=early, notes=notes` to the returned dict.

- [ ] **Step 4: Extend `build_prompt()`**

Next to the existing bridge line (around line 192):

```python
    if m["early"]:
        p.append(
            "\n# Early lede sheet (provisional)\n"
            "These angles were drafted mid-round, WITHOUT votes, results, or the closing\n"
            "chat. They show what looked live early and which ones the editor liked.\n"
            "Treat them as steering, NOT as candidates to reproduce. The real evidence\n"
            "below supersedes them wherever they disagree.\n"
            + m["early"])
    else:
        p.append("\nno early lede sheet for this round")

    if m["notes"]:
        p.append(
            "\n# Editor notes\n"
            "Editorial direction from the human editor. Treat it as true, but it is NOT a\n"
            "quotable source: do not attribute it to anyone, and do not present it as\n"
            "something said in the chat or in a comment.\n"
            + "\n".join(f"- {n['body'].strip()}" for n in m["notes"]))
```

The envelope wording deliberately matches `noteEnvelope.ts` — two languages, one contract.

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m pytest scripts/digest-qa/tests -q`
Expected: PASS — the four new tests plus all 58 existing ones.

- [ ] **Step 6: Confirm the end-to-end log line still reports bridge state**

`generate_ledes.py` prints `bridge={'yes' if m['bridge'] else 'no'}`. Extend it to also report the early sheet and note count, so a run's inputs are visible in `journalctl`:

```python
          f"bridge={'yes' if m['bridge'] else 'no'}; "
          f"early={'yes' if m['early'] else 'no'}; notes={len(m['notes'])}; "
```

- [ ] **Step 7: Commit**

```bash
git add scripts/digest-qa/generate_ledes.py scripts/digest-qa/tests/test_generate_ledes_early.py
git commit -m "feat(ledes): consume the early sheet and editor notes

Both carry their caveats IN THE PROMPT, not only in the UI — the risk being
managed is the model over-weighting a provisional artifact, and UI copy does
not manage that. Envelope wording matches noteEnvelope.ts."
```

---

## Self-Review

**Spec coverage.** §2 (what exists) → respected by the Global Constraints, which forbid touching the checks or the `context` textarea. §3 panel and its six rows → Tasks 1–3; the three-state status is asserted in Tasks 1 and 3. §4 notes: storage → Task 4; per-row default targets → Task 6; server-side injection → Task 5; envelope → Tasks 4, 5, 9. §5 early ledes: engine choice → Task 7; separate storage → Task 7; on-demand trigger → Task 8; consumption with caveat → Task 9. §6 testing → every listed assertion has a task. §7 delivery order → phases match exactly.

**Placeholder scan.** Task 3 Step 4 and Task 8 Step 2/3 describe requirements rather than showing complete code. That is deliberate and flagged: Task 3's five rows depend on the real signatures of `chatWindowFor`, `chatSectionEnabledFor`, `guesserSectionEnabledFor`, and `gatherStorylineEvidence`, which the implementer is instructed to read first (Step 3) — writing code against guessed signatures would be worse than an honest instruction. Task 7 Step 4 lists its requirements as bullets, each backed by a specific failing test from Step 1, so the tests define the contract precisely.

**Type consistency.** `MaterialRow`/`MaterialStatus` identical across Tasks 1, 2, 3, 8. `RoundNote`/`NoteTarget`/`PromptNotes` identical across Tasks 4, 5, 6, 7. `wrapNotes(RoundNote[])` is the only envelope producer in TS; Task 9 reproduces its wording in Python and asserts it independently, which is the intended duplication (no shared imports across `src/`, `ui/`, `scripts/`).

**Two ordering dependencies worth naming.** Task 3's `earlyLedesRow` reads a table Task 7 creates — handled by `safeRow`, so Phase 1 ships correct without Phase 3. And Task 5's test imports a `makeRoundData()` fixture that may need extracting from `llm.test.ts` first; the task says so rather than assuming it exists.

**Open questions from spec §8.** Bridge preview rendering is resolved as raw pretty-printed JSON in Task 2 — honest, cheap, and easy to improve once the shape is seen in situ. Note ordering is resolved as oldest-first, asserted in Task 4. Plain-text note rendering is called out in Task 6 Step 5.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-26-round-prep-panel.md`.
