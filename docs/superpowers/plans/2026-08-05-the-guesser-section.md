# "The Guesser" Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic digest section, "The Guesser", that scores a league's designated submitter-guesser (SSSC = Boonie Dogsweat) from his ML vote comments — weekly record, season leaderboards (eludes-him, always-nails, littermates), and the drunk-by-play-position decay — rendered on the R163 digest.

**Architecture:** Fully deterministic, no LLM. Follows the existing `stats`/`getRoundInsights` pattern (research doc §3): a pure compute function whose heavy payload is recomputed live each page load and travels via the `visualData` prop; a synthetic section spliced into `renderSections` (NOT a `digest_sections` row, so no `SECTION_KINDS`/CHECK changes); three dedicated `digest_drafts` columns for the tiny editable caption; per-league opt-in like the chat section; a dedicated Svelte visual component.

**Tech Stack:** TypeScript (`ui/src/lib`), SvelteKit, better-sqlite3, vitest.

**Reference:** `docs/superpowers/specs/2026-08-05-digest-section-pipeline-research.md` (integration points, file:line) and `docs/superpowers/specs/2026-08-05-guesser-and-discord-chat-design.md` (design + Appendix A roster/aliases).

## Global Constraints

- **Deterministic only** — no LLM/network in any Guesser code path. A vote comment with no roster-name match = "no guess" (excluded from accuracy), never guessed-wrong.
- **Play order = `ORDER BY spotify_uri`** (verified). Position 1..N within a round.
- **The "guesser" is auto-detected**: the league competitor with the most non-empty vote comments (SSSC: Boonie Dogsweat, 217). No hardcoded name.
- **Actual submitter** resolves via `ml_submissions` (prefer `m.player_id` join to `players`, else `competitors`), per research §6.2.
- **Guess resolution** matches names in comment text against the roster (competitor names + `player_identities` discord/music-league identifiers for the league) + an explicit per-league alias map seeded from the design doc Appendix A.
- **Off by default per-league** (`guesser_section_leagues` setting, same shape as `chat_section_leagues`).
- DB is `data/league.db`; scripts/verification run against a COPY. Prod is mlb37; deploy per `docs/dev-loop-playbook.md`. Run GitNexus `impact` before editing existing symbols and `detect_changes` before commits (CLAUDE.md). Commit on `master`.

---

### Task 1: `digest_drafts` guesser columns + per-league opt-in

**Files:**
- Modify: `ui/src/lib/db/schema.ts` (add 3 columns to the `digest_drafts` CREATE)
- Modify: `ui/src/lib/db/client.ts` (guarded `ALTER TABLE` migrations, next to the `stats_*` ones ~line 124-131)
- Create: `ui/src/lib/digest/guesserSection.ts` (opt-in helpers, mirroring `chatSection.ts:256-310`)
- Test: `ui/src/lib/digest/guesserSection.test.ts`

**Interfaces produced:**
- Columns `guesser_position INTEGER NOT NULL DEFAULT 0`, `guesser_state TEXT NOT NULL DEFAULT 'default'`, `guesser_content_json TEXT NOT NULL DEFAULT '{}'` on `digest_drafts`.
- `guesserSectionEnabledFor(db, leagueSlug): boolean`, `setGuesserSectionEnabled(db, leagueSlug, enabled): void`, `GUESSER_SECTION_DEFAULTS: Record<string,boolean>` (all false), `GUESSER_SETTINGS_KEY = 'guesser_section_leagues'`.

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/digest/guesserSection.test.ts
import { describe, it, expect } from 'vitest';
import { openLeagueDb } from '../db/client.js';
import { guesserSectionEnabledFor, setGuesserSectionEnabled } from './guesserSection.js';
import { randomUUID } from 'node:crypto';

describe('guesser opt-in', () => {
  it('defaults off and round-trips the setting', () => {
    const db = openLeagueDb(`/tmp/g-${randomUUID()}.db`);
    expect(guesserSectionEnabledFor(db, 'sssc')).toBe(false);
    setGuesserSectionEnabled(db, 'sssc', true);
    expect(guesserSectionEnabledFor(db, 'sssc')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/digest/guesserSection.test.ts` → FAIL (module missing).

- [ ] **Step 3: Add columns + migrations + opt-in module**

In `schema.ts`, inside the `digest_drafts` CREATE (near `stats_content_json`), add:
```sql
    guesser_position INTEGER NOT NULL DEFAULT 0,
    guesser_state TEXT NOT NULL DEFAULT 'default',
    guesser_content_json TEXT NOT NULL DEFAULT '{}',
```
In `client.ts`, next to the `stats_*` guards, add (verify column name each time, matching the existing `draftCols.some(...)` idiom):
```ts
if (draftCols.length && !draftCols.some(c => c.name === 'guesser_position')) db.exec("ALTER TABLE digest_drafts ADD COLUMN guesser_position INTEGER NOT NULL DEFAULT 0");
if (draftCols.length && !draftCols.some(c => c.name === 'guesser_state')) db.exec("ALTER TABLE digest_drafts ADD COLUMN guesser_state TEXT NOT NULL DEFAULT 'default'");
if (draftCols.length && !draftCols.some(c => c.name === 'guesser_content_json')) db.exec("ALTER TABLE digest_drafts ADD COLUMN guesser_content_json TEXT NOT NULL DEFAULT '{}'");
```
Create `guesserSection.ts` copying `chatSection.ts`'s opt-in trio verbatim with `GUESSER_SETTINGS_KEY = 'guesser_section_leagues'`, `GUESSER_SECTION_DEFAULTS = {}` (so every league defaults false via the `?? false`), and `guesserSectionEnabledFor` / `setGuesserSectionEnabled`.

- [ ] **Step 4: Run test → PASS.** `cd ui && npx vitest run src/lib/digest/guesserSection.test.ts`

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/db/schema.ts ui/src/lib/db/client.ts ui/src/lib/digest/guesserSection.ts ui/src/lib/digest/guesserSection.test.ts
git commit -m "feat(digest): guesser_* draft columns + per-league opt-in"
```

---

### Task 2: Deterministic guess resolver

Pure function: given a comment string and a resolver roster, return the guessed `playerId` (or null). Normalizes (lowercase, strip punctuation/emoji, collapse spaces) and finds a roster candidate whose normalized name/alias appears as a token-run in the comment. Longest match wins; ambiguous (2+ distinct players) → null.

**Files:**
- Create: `ui/src/lib/digest/guessResolver.ts`
- Test: `ui/src/lib/digest/guessResolver.test.ts`

**Interfaces produced:**
- `interface GuessCandidate { playerId: number; label: string }` (label = a name/alias to match)
- `buildGuessMatcher(candidates: GuessCandidate[]): (comment: string) => number | null`

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/digest/guessResolver.test.ts
import { describe, it, expect } from 'vitest';
import { buildGuessMatcher } from './guessResolver.js';

const cands = [
  { playerId: 1, label: 'PoetryinNoise' }, { playerId: 1, label: 'Poetry in Noise' },
  { playerId: 2, label: 'bagimation' },
  { playerId: 3, label: 'nowlistenallison' }, { playerId: 3, label: 'zewskers' },
  { playerId: 4, label: 'Lexa Prole' },
];

describe('buildGuessMatcher', () => {
  const m = buildGuessMatcher(cands);
  it('matches a spaced/altered nickname', () => {
    expect(m("I'm gonna guess this one is Poetry in Noise.")).toBe(1);
  });
  it('matches an alias', () => {
    expect(m('Zewskers with the whimsical pick!')).toBe(3); // zewskers -> nowlistenallison
  });
  it('matches a bare name mid-sentence', () => {
    expect(m('This sounds like a Bagimation pull.')).toBe(2);
  });
  it('returns null when no roster name appears', () => {
    expect(m('This song really wasn’t about anything.')).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd ui && npx vitest run src/lib/digest/guessResolver.test.ts`

- [ ] **Step 3: Implement**

```ts
// ui/src/lib/digest/guessResolver.ts
export interface GuessCandidate { playerId: number; label: string }

/** Lowercase, drop emoji/punctuation to spaces, collapse whitespace. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buildGuessMatcher(candidates: GuessCandidate[]): (comment: string) => number | null {
  // Precompute normalized labels, longest first so "poetry in noise" wins over "noise".
  const norms = candidates
    .map((c) => ({ playerId: c.playerId, n: norm(c.label) }))
    .filter((c) => c.n.length >= 3)
    .sort((a, b) => b.n.length - a.n.length);
  return (comment: string): number | null => {
    const hay = ` ${norm(comment)} `;
    const hits = new Set<number>();
    let firstLabelPlayer: number | null = null;
    for (const { playerId, n } of norms) {
      // Word-boundary-ish match: the normalized label surrounded by spaces.
      if (hay.includes(` ${n} `)) {
        if (firstLabelPlayer === null) firstLabelPlayer = playerId;
        hits.add(playerId);
      }
    }
    if (hits.size === 0) return null;
    if (hits.size === 1) return [...hits][0];
    // Ambiguous: multiple distinct players named. Prefer the longest-label match
    // (norms is longest-first, so firstLabelPlayer is the longest); if that longest
    // is unique to one player, take it, else null.
    return firstLabelPlayer;
  };
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/digest/guessResolver.ts ui/src/lib/digest/guessResolver.test.ts
git commit -m "feat(digest): deterministic vote-comment guess resolver"
```

---

### Task 3: `getGuesserData` compute

The core. Detect the guesser, build the candidate roster (+ SSSC alias map), score every (round, song) the guesser commented on, and aggregate weekly + season records.

**Files:**
- Create: `ui/src/lib/db/guesserInsights.ts`
- Test: `ui/src/lib/db/guesserInsights.test.ts` (self-contained fixture via `openLeagueDb`)

**Interfaces produced:**
```ts
export interface GuesserGuess { spotifyUri: string; title: string; playPosition: number; playCount: number;
  actualPlayerId: number | null; actualName: string; guessedPlayerId: number | null; guessedName: string | null; correct: boolean; }
export interface GuesserLeaderRow { playerId: number; name: string; attempts: number; correct: number; rate: number }
export interface GuesserLittermates { aName: string; bName: string; swaps: number }
export interface GuesserData {
  guesserName: string | null;                 // null => no guesser / section unavailable
  weekly: { attempts: number; correct: number; rate: number; guesses: GuesserGuess[] };
  drunkByThird: { first: number; middle: number; last: number };   // accuracy by play-position third
  eludesHim: GuesserLeaderRow[];               // submitters he's worst at, min attempts
  alwaysNails: GuesserLeaderRow[];             // submitters he's ~always right on, min attempts
  littermates: GuesserLittermates | null;      // the pair he most swaps
}
export function getGuesserData(db: Database.Database, roundId: number): GuesserData;
```

- [ ] **Step 1: Write the failing test** (fixture: 1 league, 1 season, 2 rounds, a guesser + 3 others; seed submissions with known spotify_uris giving a known play order, and guesser votes whose comments name submitters — some right, some wrong, one swap pair).

```ts
// ui/src/lib/db/guesserInsights.test.ts — abridged fixture; implementer fills exact rows
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openLeagueDb } from './client.js';
import { getGuesserData } from './guesserInsights.js';
import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { unlinkSync } from 'node:fs'; import { randomUUID } from 'node:crypto';

const DB = join(tmpdir(), `gi-${randomUUID()}.db`);
let round2Id: number;
beforeAll(() => {
  const db = openLeagueDb(DB);
  // league 'x'; players P1(guesser 'Gus'),P2 'Ann',P3 'Bob',P4 'Cid'; competitors linked;
  // season 1; round1, round2. Submissions in round2 with spotify_uris that sort to: Ann, Bob, Cid.
  // Gus's votes in round2: on Ann's song comment "this is Ann" (correct), on Bob's "must be Cid" (wrong -> swap Bob/Cid),
  //   on Cid's "sounds like Bob" (wrong -> swap). Round1: enough attempts so Ann qualifies for alwaysNails, Bob for eludesHim.
  // (Implementer: insert via raw SQL to give deterministic expectations below.)
  // ... set round2Id ...
});
afterAll(() => { try { unlinkSync(DB); } catch {} });

describe('getGuesserData', () => {
  it('computes weekly record, play order, and leaderboards', () => {
    const g = getGuesserData(openLeagueDb(DB), round2Id);
    expect(g.guesserName).toBe('Gus');
    expect(g.weekly.attempts).toBeGreaterThan(0);
    expect(g.weekly.guesses[0].playPosition).toBe(1);         // spotify_uri order
    expect(g.littermates?.swaps).toBeGreaterThanOrEqual(1);    // Bob<->Cid
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `getGuesserData`.** Structure (pure SQL + JS; no LLM):

```ts
// ui/src/lib/db/guesserInsights.ts (sketch — implementer completes each query)
import type Database from 'better-sqlite3';
import { buildGuessMatcher, type GuessCandidate } from '../digest/guessResolver.js';

// SSSC-specific guess aliases from the design doc Appendix A (guessed text -> canonical roster label).
// Applied in addition to competitor names + player_identities identifiers.
const LEAGUE_ALIASES: Record<string, Array<{ match: string; asName: string }>> = {
  sssc: [
    { match: 'Generous Giragge', asName: 'jirafa' }, { match: 'Cherrycola', asName: 'Cherry' },
    // (Zewskers/Sparkle Pants/etc. already covered by discord identifiers seeded in player_identities.)
  ],
};

export function getGuesserData(db: Database.Database, roundId: number): GuesserData {
  // 1. Resolve round -> season, league (id+slug).
  // 2. Detect guesser: competitor with most non-empty vote comments in the league.
  //    SELECT voter_id, COUNT(*) c FROM votes v JOIN rounds r ... WHERE league AND TRIM(comment)<>'' GROUP BY voter_id ORDER BY c DESC LIMIT 1
  //    Resolve to playerId+name. If none -> return { guesserName: null, ... empties }.
  // 3. Build candidate roster for the league:
  //    competitors(name), player_identities(identifier where identity_type in discord/music-league for this league),
  //    plus LEAGUE_ALIASES[slug]. Each -> GuessCandidate{playerId, label}. Need competitor->player map.
  // 4. matcher = buildGuessMatcher(candidates).
  // 5. Weekly (this round): actual submitters via  ml_submissions ORDER BY spotify_uri (playPosition 1..N).
  //    For each song, the guesser's vote comment on that spotify_uri; guessedPlayerId = matcher(comment).
  //    correct = guessedPlayerId===actualPlayerId. Skip songs the guesser submitted himself.
  //    attempts = comments with a non-null guess; correct = matches; rate.
  // 6. drunkByThird: split weekly guesses by playPosition into thirds; accuracy each.
  // 7. Season aggregate (all rounds in this season up to & incl. roundId): per actual-submitter attempts/correct.
  //    eludesHim = lowest rate with attempts>=MIN(=3); alwaysNails = highest rate with attempts>=MIN.
  // 8. littermates: over all wrong guesses season-wide, count unordered pairs {actual, guessed}; top pair by swaps.
  // Return GuesserData.
}
```

Implementer: write each query explicitly, add small pure helpers (`third(pos,n)`, `rate(c,a)`), and ensure determinism (stable ORDER BY, tie-breaks by name).

- [ ] **Step 4: Run → PASS** (and add a case asserting a self-submission is skipped and a no-match comment doesn't count as wrong).

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/db/guesserInsights.ts ui/src/lib/db/guesserInsights.test.ts
git commit -m "feat(digest): getGuesserData deterministic records"
```

---

### Task 4: Page-server wiring (opt-in gated)

**Files:** Modify `ui/src/routes/digest/[roundId]/+page.server.ts` (compute `guesserData` next to `insights`, gated by `guesserSectionEnabledFor`); Modify the page data type (`DigestPageData`) to carry `guesserData: GuesserData | null` and the draft's `guesser_position`.

**Interfaces produced:** `data.guesserData: GuesserData | null` on the digest page load.

- [ ] **Step 1** (impact first on the `load` function). Add, inside the `if (draft)` block (mirror the `insights` construction ~line 311 and the chat opt-in gating ~line 246-257):
```ts
let guesserData: GuesserData | null = null;
try {
  const slug = (db.prepare('SELECT slug FROM leagues WHERE id = ?').get(round.league_id) as { slug?: string } | undefined)?.slug;
  if (slug && guesserSectionEnabledFor(db, slug)) guesserData = getGuesserData(db, roundId);
} catch { /* never fail the page over the guesser */ }
```
Add `guesserData` (and `guesserPosition: draft.guesser_position ?? 0`) to the returned object and to `DigestPageData`.

- [ ] **Step 2: `npm run check`** — no NEW errors (baseline ~10 pre-existing).
- [ ] **Step 3: Commit** `feat(digest): load guesser data (opt-in) on the digest page`.

---

### Task 5: Render — `GuesserLeaderboard.svelte` + synthetic section

**Files:** Create `ui/src/lib/digest/GuesserLeaderboard.svelte` (VisualComponentProps; reads `visualData` = GuesserData); Modify `ui/src/routes/digest/[roundId]/+page.svelte` (register `VISUAL_COMPONENTS.guesser`, `showGuesser` `$derived`, splice synthetic `{ id:'guesser', kind:'guesser', position: data.guesserPosition ?? 0, content: data.draft.guesser_content_json?…, variant:'visual' }` into `renderSections`, add `{:else if section.kind === 'guesser'}` branch BEFORE the generic `{:else}` so `kindOrFallback` doesn't coerce it to `flow` — per research §3 rec 7 / §4.4).

- [ ] **Step 1:** Build `GuesserLeaderboard.svelte` modeled on `ChatMoments.svelte` (dual web/export mode via `?export=1`): a header ("The Guesser — <name>'s ledger"), the weekly record (X/Y, rate), the drunk-by-third bars, and three small tables (eludes-him, always-nails, littermates). Read everything from `visualData` (GuesserData); use `content.title/body` only for an optional caption override.
- [ ] **Step 2:** Wire the page: `showGuesser = $derived(!!data.guesserData && data.guesserData.guesserName && data.guesserData.weekly.attempts > 0)`; add to `VISUAL_COMPONENTS`; splice into `renderSections`; add the `{:else if section.kind === 'guesser'}` render branch passing `visualComponent={VISUAL_COMPONENTS.guesser}` and `visualData={data.guesserData}`.
- [ ] **Step 3:** `npm run check` clean of new errors; visually confirm later in Task 8.
- [ ] **Step 4: Commit** `feat(digest): render The Guesser section`.

---

### Task 6: PATCH endpoint for the guesser caption

**Files:** Modify `ui/src/routes/api/digest/[roundId]/sections/[id]/+server.ts` — add a `sectionId === 'guesser'` branch mirroring the `'stats'` branch (write `guesser_content_json`/`guesser_state`/`guesser_position` on the `digest_drafts` row).

- [ ] **Step 1:** Copy the `'stats'` special-case block, swap column names to `guesser_*`. - [ ] **Step 2:** `npm run check`. - [ ] **Step 3: Commit** `feat(digest): persist guesser caption via sections PATCH`.

---

### Task 7: ModelsScreen deterministic row

**Files:** Modify `ui/src/lib/models/ModelsScreen.svelte` — add a static "The Guesser - deterministic / no model - computed from vote comments" row next to the existing "Round intelligence - deterministic" row (~line 1114).

- [ ] **Step 1:** Add the row. - [ ] **Step 2:** `npm run check`. - [ ] **Step 3: Commit** `feat(digest): note The Guesser as deterministic in ModelsScreen`.

---

### Task 8: Deploy, enable for SSSC, verify on R163

**Files:** none (ops).

- [ ] **Step 1:** `detect_changes`; deploy `docker compose build bot-ui && up -d --force-recreate bot-ui`; bundle-assert a new marker (e.g. grep server build for `guesser`).
- [ ] **Step 2:** Enable for SSSC on the live DB: `setGuesserSectionEnabled(db,'sssc',true)` (tsx one-liner via `getDb()`).
- [ ] **Step 3:** Full-regenerate R163 so the synthetic section shows (per memory: a new section won't appear on an existing draft without a full regen — but note the Guesser is synthetic/live-computed, so it may appear on load WITHOUT regen; verify. If not visible, `curl -X POST /api/digest/163/draft -d '{"force":true}'`). Load `http://localhost:3002/digest/163` and confirm The Guesser renders with a real record for Boonie Dogsweat (weekly attempts>0, leaderboards populated, littermates present).
- [ ] **Step 4:** Sanity-check the numbers against a manual query (spot-check 2-3 of his R163 comments vs actual submitters). Record final counts in the ledger.

---

## Self-Review
- Spec coverage: weekly record (T3/T5), eludes-him (T3), always-nails (T3), littermates (T3), drunk-by-play-position (T3 drunkByThird + play order), deterministic (Global Constraints/T2-T3), off-by-default per-league (T1), render (T5), R163 (T8). ✅
- No SECTION_KINDS/CHECK changes (Pattern A). ✅
- Types consistent: `GuesserData`/`GuesserGuess`/`GuesserLeaderRow`/`GuesserLittermates` defined in T3, consumed in T4/T5. `buildGuessMatcher`/`GuessCandidate` T2→T3.
- Known deferral: the alias map lives in code (`LEAGUE_ALIASES` in guesserInsights.ts) seeded from Appendix A — most aliases already covered by seeded `player_identities`; only the 2 non-identifier ones are added. The KarBen duplicate-competitor issue (Plan 1 ledger) may split his attempts across two competitor ids — resolve during T3 by keying actual-submitter on `player_id` (not competitor id), which merges them.
