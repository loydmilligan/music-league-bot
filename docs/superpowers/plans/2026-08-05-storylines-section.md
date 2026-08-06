# "Storylines" (Cast) Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-league "Storylines" digest section — a curated cast of recurring characters (SSSC: PoetryInNoise's cats/"big butts", timmyg's Friday new-release deep-dives + weed, bagimation & missmara relitigating songs they didn't pick) — where the system deterministically gathers real evidence quotes (from the round's chat window + the players' vote comments) and a thin LLM pass writes each active storyline up. Off by default per-league.

**Architecture:** Storylines is a genuine LLM `SECTION_KINDS` member (`'storylines'`) so it inherits the regen modal, cost ledger, and model routing (research §1.3/§2). Its *inputs* are deterministic: a per-league seed config (`{player, motif, patterns, sources}`) drives an evidence-gatherer that searches the round's chat window (`chatWindowFor`/`loadChatWindow`, voting-deadline-bounded) and the players' vote comments for motif matches, producing a bounded, labeled evidence bundle. That bundle (not the raw round dump) is injected into the prompt for the `storylines` kind. A seed with no evidence this round is dropped; a league with no seeds / opt-in off never generates the section.

**Tech Stack:** TypeScript, SvelteKit, better-sqlite3, OpenRouter (existing digest LLM plumbing), vitest.

**Reference:** `docs/superpowers/specs/2026-08-05-digest-section-pipeline-research.md` (§1.3 the 12 SECTION_KINDS edit sites, §2 generation flow, §5 opt-in, §7 evidence windows) and `docs/superpowers/specs/2026-08-05-guesser-and-discord-chat-design.md` §4 (seed table).

## Global Constraints

- New section kind string `'storylines'` — the research §1.3 enumerates ALL ~12 edit sites; hit every one (SECTION_KINDS, SECTION_DESCRIPTIONS, SECTION_DESCRIPTIONS_RECAP, SECTION_SCHEMA, digest_sections.kind CHECK + client.ts rebuild migration, +page.svelte SECTION_LABELS + VISUAL_COMPONENTS, sectionState.ts SECTION_LABELS, modelFor.ts bucket, pipeline.ts routing).
- **digest_sections.kind CHECK widening** uses the table-rebuild pattern (research §1.2) — MUST preserve the `digest_regenerations.section_id` FK-child rows (compare the `ml_submissions__new` precedent, not just player_identities).
- **Evidence is deterministic**; only the write-up is LLM. The LLM must only phrase what the evidence shows (no invented threads) — enforce in the prompt.
- **Off by default per-league** (`storylines_section_leagues` setting, same shape as chat/guesser) AND gated at generation time (pre-filter `genParams.sections` in the API route so a disabled league never pays for it — research §5.3).
- **Evidence window**: `chatWindowFor(round.voting_deadline, prevRound.voting_deadline)` + `loadChatWindow` (placeholder-filtered, tz-correct); vote comments via the round's votes join. Resolve chat senders → players via `buildChatRoster` for attribution.
- Content shape `content_json` for `storylines`: `{ title: string, cast: [{ name: string, headline: string, evidence: string[] }] }` — render via a dedicated component modeled on `ChatMoments.svelte`.
- Seeds config lives in code (`ui/src/lib/digest/storylineSeeds.ts`), keyed by league slug, seeded with the 3 SSSC entries. Adding a regular later = a config edit.
- DB `data/league.db`; verify against a COPY. Prod mlb37; deploy per playbook. GitNexus `impact` before editing existing symbols, `detect_changes` before commits. `master`.

---

### Task 1: `digest_sections.kind` CHECK widening migration

**Files:** Modify `ui/src/lib/db/schema.ts` (add `'storylines'` to the `digest_sections.kind` CHECK); Modify `ui/src/lib/db/client.ts` (table-rebuild migration preserving `digest_sections` rows AND `digest_regenerations` FK-children); Test `ui/src/lib/db/digestSectionsStorylines.test.ts`.

**Interfaces produced:** after `openLeagueDb`, inserting a `digest_sections` row with `kind='storylines'` succeeds; existing rows + their `digest_regenerations` children preserved.

- [ ] **Step 1: Write the failing test** — open a temp DB, seed a draft + a `digest_sections` row (e.g. kind 'podium') + a `digest_regenerations` row referencing it; assert (a) inserting `kind='storylines'` throws BEFORE migration is impossible to test directly (migration runs in openLeagueDb), so instead: create the OLD-CHECK table manually with a row + regen child, reopen via `openLeagueDb`, assert the row + regen child survive AND `kind='storylines'` now inserts without throwing.

```ts
// abridged — implementer writes full fixture
it('widens digest_sections.kind to storylines, preserving rows + regen children', () => {
  // manual pre-migration digest_sections with old CHECK + a digest_regenerations child;
  // reopen via openLeagueDb; assert child row still present and 'storylines' insert ok.
});
```

- [ ] **Step 2: Run → FAIL.** `cd ui && npx vitest run src/lib/db/digestSectionsStorylines.test.ts`

- [ ] **Step 3: Implement.** In schema.ts add `'storylines'` to the CHECK list. In client.ts add a guarded rebuild (detect via `sqlite_master.sql` not containing `'storylines'`): create `digest_sections_new` with the widened CHECK and IDENTICAL other columns/defaults, `INSERT ... SELECT` all columns, then — because `digest_regenerations.section_id REFERENCES digest_sections(id) ON DELETE CASCADE` — disable FKs for the swap (`PRAGMA foreign_keys=OFF` within the migration txn, or drop child FK first) to avoid cascade-deleting children during `DROP TABLE digest_sections`; recreate/rename; re-enable FKs. Follow the `ml_submissions__new` precedent (client.ts:47-92) which handles a rebuild with dependent structures. Verify `digest_regenerations` rows still resolve.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** `feat(db): allow 'storylines' digest section kind (rebuild preserves regen children)`.

---

### Task 2: Storyline seeds config + evidence gatherer

**Files:** Create `ui/src/lib/digest/storylineSeeds.ts` (per-league seed config + the SSSC seeds); Create `ui/src/lib/digest/storylineEvidence.ts` (`gatherStorylineEvidence`); Tests for both.

**Interfaces produced:**
```ts
export interface StorylineSeed { player: string; motif: string; patterns: RegExp[]; sources: Array<'chat'|'vote_comments'> }
export const STORYLINE_SEEDS: Record<string, StorylineSeed[]>;   // keyed by league slug
export interface StorylineEvidence { player: string; motif: string; quotes: { text: string; ts: string; source: 'chat'|'vote_comments' }[] }
export function gatherStorylineEvidence(db, roundId): StorylineEvidence[];   // drops seeds with no quotes
```

- [ ] **Step 1: Seeds test + config.** Seed SSSC:
```ts
export const STORYLINE_SEEDS: Record<string, StorylineSeed[]> = {
  sssc: [
    { player: 'PoetryinNoise', motif: 'cats & big butts', patterns: [/\bcats?\b/i, /\bbig butts?\b/i, /\bbutts?\b/i], sources: ['vote_comments','chat'] },
    { player: 'Timmywhatup', motif: 'rap deep-dives & weed', patterns: [/\brap(ity)?\b/i, /\bnew (music|releases?)\b/i, /\bfriday\b/i, /\bweed\b/i], sources: ['chat'] },
    { player: 'bagimation', motif: "songs they didn't pick", patterns: [/\bdidn.?t (pick|choose|submit)\b/i, /\bshould have (picked|submitted)\b/i, /\balmost (picked|went with)\b/i], sources: ['chat'] },
    { player: 'missmara', motif: "songs they didn't pick", patterns: [/\bdidn.?t (pick|choose|submit)\b/i, /\bshould have (picked|submitted)\b/i, /\balmost (picked|went with)\b/i], sources: ['chat'] },
  ],
};
```
Test: `STORYLINE_SEEDS.sssc` has entries with valid RegExp patterns.

- [ ] **Step 2: Evidence gatherer test (self-contained fixture)** — seed a league 'sssc', players, a chat window with messages (some matching PoetryinNoise's cat patterns, attributed via player_identities/roster), vote comments matching, and non-matching noise. Assert `gatherStorylineEvidence` returns only seeds with ≥1 quote, quotes are the matching lines, and a no-match seed is dropped.

- [ ] **Step 3: Implement `gatherStorylineEvidence`**: resolve round→league slug; look up `STORYLINE_SEEDS[slug]` (empty → return []); compute the chat window via `chatWindowFor(round.voting_deadline, prevRound.voting_deadline)` + `loadChatWindow`; build the roster via `buildChatRoster` to attribute chat `sender`→player; for each seed: (a) if `sources` includes 'chat', scan window messages whose resolved player display-name matches `seed.player` (normalized) for any `pattern`; (b) if includes 'vote_comments', scan that player's vote comments in the round for patterns; collect `{text, ts, source}` (cap e.g. 5 quotes/seed, most recent first); drop seeds with zero quotes.

- [ ] **Step 4: Run → PASS** (incl. the drop-empty-seed and attribution cases).

- [ ] **Step 5: Commit** `feat(digest): storyline seeds + deterministic evidence gatherer`.

---

### Task 3: Wire `storylines` into the LLM section system

**Files:** Modify `ui/src/lib/digest/llm.ts` (SECTION_KINDS, SECTION_DESCRIPTIONS, SECTION_DESCRIPTIONS_RECAP, SECTION_SCHEMA, activeKindsForDraft evidence gate, and inject the evidence into the user prompt for the storylines kind — mirror how `chatHistory` is injected ~llm.ts:770); Modify `ui/src/lib/digest/pipeline.ts` (route the kind); Modify `ui/src/lib/digest/modelFor.ts` (bucket); Test `ui/src/lib/digest/llm.storylines.test.ts` (activeKindsForDraft includes 'storylines' only when evidence present).

**Interfaces produced:** `SECTION_KINDS` includes `'storylines'`; `SECTION_SCHEMA.storylines = '"storylines": { "title": string, "cast": [{"name": string, "headline": string, "evidence": [string] }] }'`; `RoundData` carries `storylineEvidence?: StorylineEvidence[]`; `activeKindsForDraft` includes `storylines` iff evidence present.

- [ ] **Step 1: Write the failing test** — `activeKindsForDraft` with `data.storylineEvidence = [one seed]` includes `'storylines'`; with `[]`/undefined excludes it; disabled via genParams excludes it.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Add `'storylines'` to `SECTION_KINDS` + all Record maps (descriptions/recap/schema). In `gatherRoundData`, call `gatherStorylineEvidence(db, roundId)` → `data.storylineEvidence`. In `activeKindsForDraft`, add `if (k === 'storylines') return (data.storylineEvidence?.length ?? 0) > 0;`. In `buildUserPrompt`, when the storylines kind is active, append a bounded `# Storylines evidence (write ONLY from these quotes — do not invent threads)` block listing each seed's player/motif/quotes. Add pipeline/model-bucket entries. Keep recap description a stub (season recap can skip storylines).
- [ ] **Step 4: Run → PASS**; `cd ui && npm run check` no new errors.
- [ ] **Step 5: Commit** `feat(digest): storylines LLM kind fed by deterministic evidence`.

---

### Task 4: Per-league opt-in + generation-time gating

**Files:** Create `ui/src/lib/digest/storylinesSection.ts` (opt-in trio, `storylines_section_leagues`, defaults `{}`); Modify `ui/src/routes/api/digest/[roundId]/draft/+server.ts` (pre-filter: if the league's opt-in is off, inject `{ id:'storylines', enabled:false }` into genParams.sections before `generateDraft`, so a disabled league never generates/pays — research §5.3); Test.

- [ ] **Step 1:** opt-in test (defaults off, round-trips) — mirror guesserSection.test.ts. - [ ] **Step 2:** implement the trio + the API pre-filter (resolve league slug from round; `storylinesSectionEnabledFor(db, slug)`; if false, ensure genParams disables 'storylines'). - [ ] **Step 3:** `npm run check`. - [ ] **Step 4: Commit** `feat(digest): storylines per-league opt-in + gen-time gating`.

---

### Task 5: Render — `StorylinesCast.svelte`

**Files:** Create `ui/src/lib/digest/StorylinesCast.svelte` (VisualComponentProps; reads `content` = `{ title, cast: [{name, headline, evidence[]}] }`, dual web/export mode like `ChatMoments.svelte`); Modify `ui/src/routes/digest/[roundId]/+page.svelte` (register `VISUAL_COMPONENTS.storylines`, `SECTION_LABELS.storylines` eyebrow, e.g. "The Regulars"); Modify `ui/src/lib/digest/sectionState.ts` (SECTION_LABELS entry).

Because `storylines` IS a real `SECTION_KINDS`/`digest_sections` kind (unlike guesser), it flows through the normal `{:else}` `<DigestSection>` path via `kindOrFallback` — but `kindOrFallback` only recognizes kinds in `SECTION_KINDS` (now including storylines), so it renders correctly with its registered label/component WITHOUT a synthetic branch. Confirm `kindOrFallback` returns `'storylines'` (not `'flow'`) once it's in SECTION_KINDS.

- [ ] **Step 1:** Build `StorylinesCast.svelte` (header from `content.title`; per cast member: name + headline + evidence quotes as a small list), empty-safe. - [ ] **Step 2:** register component + labels. - [ ] **Step 3:** `npm run check` no new errors. - [ ] **Step 4: Commit** `feat(digest): render Storylines cast section`.

---

### Task 6: Deploy, enable SSSC, generate + verify on R163

**Files:** none (ops).

- [ ] **Step 1:** `detect_changes`; deploy; bundle-assert (`storylines` in server build).
- [ ] **Step 2:** enable for SSSC on the live DB (`setStorylinesSectionEnabled(db,'sssc',true)`).
- [ ] **Step 3:** Because storylines is an LLM `digest_sections` kind (not synthetic/live), R163's existing draft won't have it — do a **full regen** (`curl -X POST /api/digest/163/draft -d '{"force":true}'`) so `activeKindsForDraft` picks it up (evidence permitting). Confirm a `digest_sections` row `kind='storylines'` exists and the section renders on `http://localhost:3002/digest/163` with real cast members and real quotes.
- [ ] **Step 4:** Verify the evidence is real (spot-check a couple of the quoted lines against the DB). If a seed produced no evidence for R163's window, that's expected (it's dropped) — note which seeds fired. Record outcome in the ledger.

---

## Self-Review
- Spec coverage: seeds config (T2), deterministic evidence gathering from chat + vote comments (T2), thin LLM write-up "only from evidence" (T3), off-by-default per-league + gen-time gating (T4), render (T5), CHECK migration preserving regen children (T1), R163 (T6). ✅
- The 12 SECTION_KINDS edit sites (research §1.3) are covered across T1 (schema+CHECK), T3 (llm.ts x4 + pipeline + modelFor), T5 (+page.svelte labels/components + sectionState). Implementer MUST re-check the research §1.3 list to ensure none is missed — a missed Record key is a compile error, a missed pipeline/label is a silent mis-render.
- Types: `StorylineSeed`/`StorylineEvidence` (T2) → consumed in T3 (`RoundData.storylineEvidence`) and rendered from `content_json` (T5). `storylinesSectionEnabledFor` (T4).
- Risk: the LLM step is the only non-deterministic part; the prompt must forbid invented threads (T3) and the evidence is bounded. Cost is one extra section only when a league opts in AND evidence exists.
