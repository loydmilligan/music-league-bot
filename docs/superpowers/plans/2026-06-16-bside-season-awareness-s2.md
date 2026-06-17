# b-side Season Awareness — S2 (The Living Season) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the **Season-Update "season pulse"** on the public b-side — an LLM narration of the S1 `SeasonSignals`, regenerated on every b-side publish/update, with the loosened funny/fact-based voice + an operator snark dial.

**Architecture:** A new `seasonUpdateTask` (PredictionTask) narrates the deterministic `computeSeasonSignalsForLeague()` output (built in S1) into a `{title, body}` block. It's wired into BOTH read-model paths (first-publish `buildReadModel` + `buildUpdatedReadModel`) so it regenerates each update. The public `bside/` SPA renders it right after the KPI ribbon. An operator `snark_level` (new column on `dashboard_sites`) tunes the voice. Two carry-over signals from S1 (spot-trading, punching-bag guard) are added to `seasonSignals.ts`; chat-barbs stay deferred.

**Tech Stack:** TypeScript, SvelteKit (operator app `ui/`), standalone Vite+Svelte SPA (`bside/`), better-sqlite3, vitest, zod. Builds on S1 (`sprint-36`). Spec: `docs/superpowers/specs/2026-06-16-bside-season-awareness-design.md`.

---

## Cross-lane contracts (define ONCE — both lanes code to these)

**A. `seasonUpdate` read-model field** (the backend→frontend contract):
```ts
// null when the season is too thin to narrate (round 1 / no signals)
seasonUpdate: { title: string; body: string } | null
```
- zod (ui): `z.object({ title: z.string(), body: z.string() }).nullable()`
- bside TS interface mirrors `{ title: string; body: string } | null`.

**B. Snark dial:** integer `snark_level` 0–2 (0=gentle, 1=medium default, 2=spicy), stored on `dashboard_sites.snark_level` (default 1). Operator sets it via `PATCH /api/content/:leagueId/snark` body `{ level: 0|1|2 }`. Generation reads it and passes it into `seasonUpdateTask`.

---

## File Structure

**Lane A — backend (`ui/`):**
- Create `ui/src/lib/dashboard/generators/seasonUpdate.ts` — `seasonUpdateTask` + input/output schemas + `buildSeasonUpdateMessages`.
- Create `ui/src/lib/dashboard/generators/seasonUpdate.test.ts`.
- Modify `ui/src/lib/dashboard/seasonSignals.ts` (+ test) — add `spotTrading` rivalry + `punchingBagGuard`.
- Modify `ui/src/lib/dashboard/buildReadModel.ts` — `seasonUpdate` in `ReadModelSchema` + populate (first publish).
- Modify `ui/src/routes/api/content/[leagueId]/update/+server.ts` — populate `seasonUpdate` in `buildUpdatedReadModel`.
- Modify `ui/src/lib/db/schema.ts` + `ui/src/lib/db/client.ts` — `snark_level` column + migration.
- Create `ui/src/routes/api/content/[leagueId]/snark/+server.ts` — PATCH snark level.

**Lane B — frontend (`bside/` SPA + operator control):**
- Modify `bside/src/lib/types.ts` — add `seasonUpdate` to the `ReadModel` interface.
- Modify `bside/src/routes/HomeScreen.svelte` — render the Season-Update section after the KPI ribbon.
- Modify `ui/src/lib/content/UpdateModal.svelte` (+ the publish/content screen) — snark-dial control calling the snark API.

Lanes are file-disjoint (Lane A = `ui/src/lib/dashboard` + `db` + `api`; Lane B = `bside/*` + `ui/src/lib/content` UI). Shared only by the two contracts above.

---

## Lane A — backend

### Task A1: `snark_level` column + snark API
**Files:** `db/schema.ts`, `db/client.ts`, `routes/api/content/[leagueId]/snark/+server.ts` (+ a small test)

- [ ] **Step 1:** In `schema.ts` `dashboard_sites` CREATE TABLE, add `snark_level INTEGER NOT NULL DEFAULT 1`.
- [ ] **Step 2:** In `client.ts`, additive migration (mirror the `phase`/`archive_context` pattern):
```ts
const dsCols = db.prepare("PRAGMA table_info(dashboard_sites)").all() as { name: string }[];
if (dsCols.length && !dsCols.some(c => c.name === 'snark_level')) {
  db.exec("ALTER TABLE dashboard_sites ADD COLUMN snark_level INTEGER NOT NULL DEFAULT 1");
}
```
- [ ] **Step 3:** Add a reader in `db` (e.g. in `dashboard` db helpers or inline): `getSnarkLevel(db, leagueId): number` → `SELECT snark_level FROM dashboard_sites WHERE league_id=?` (default 1 if no row).
- [ ] **Step 4:** Create `PATCH /api/content/[leagueId]/snark/+server.ts` — validate `level ∈ {0,1,2}`, `UPDATE dashboard_sites SET snark_level=? WHERE league_id=?`; 400 on bad level. Write a route test (in-memory db) asserting persistence + validation.
- [ ] **Step 5:** `npx vitest run` the new snark test green; commit path-scoped.

### Task A2: carry-over signals (spot-trading + punching-bag guard)
**Files:** `dashboard/seasonSignals.ts` (+ `seasonSignals.test.ts`)

- [ ] **Step 1:** Add a `'spot-trading'` branch to `computeRivalries` — an unordered pair who swap adjacent standings order across ≥2 round boundaries (use `standingsByRound` rank sequences). Test with a fixture where A>B then B>A then A>B.
- [ ] **Step 2:** Add `punchingBagGuard: string[]` to `SeasonSignals` — players who are the "negative subject" (faller + rivalry-loser) this update; computed from current signals. Test it lists the faller. (Suppression of repeat pile-on is applied in the narration prompt — Task A3 — using prior `seasonUpdate`, but the guard list is computed here.)
- [ ] **Step 3:** `npx vitest run src/lib/dashboard/seasonSignals.test.ts` green; commit path-scoped.

### Task A3: `seasonUpdateTask` narration task
**Files:** `dashboard/generators/seasonUpdate.ts` (+ `seasonUpdate.test.ts`)

Follow the `narrative.ts` PredictionTask pattern + the `runPrediction` runner.

- [ ] **Step 1:** Write the failing test (mock not needed for `buildMessages` — test the prompt). Define fixtures of `SeasonSignals` + assert `buildSeasonUpdateMessages` includes: the as-of round, the mover/streak/discovery/rivalry facts, the snark level, and the guardrail text (artists-OK-songs-forbidden; safe targets Matt/Mara/Jordan; punching-bag suppression; funny/fact-based-never-cruel). Assert `SeasonUpdateOutputSchema` parses `{title, body}`.
- [ ] **Step 2:** Run it, verify it fails (module missing).
- [ ] **Step 3:** Implement `seasonUpdate.ts`:
```ts
import { z } from 'zod';
import type { PredictionTask } from '../../predict/predict.js';
import type { SeasonSignals } from '../seasonSignals.js';

export const SeasonUpdateInputSchema = z.object({
  leagueName: z.string(),
  season: z.string(),
  snarkLevel: z.number().int().min(0).max(2),
  signals: z.custom<SeasonSignals>(),
  recentSubjects: z.array(z.string()), // prior-update butts, for the punching-bag guard
});
export type SeasonUpdateInput = z.infer<typeof SeasonUpdateInputSchema>;

export const SeasonUpdateOutputSchema = z.object({ title: z.string(), body: z.string() });
export type SeasonUpdateOutput = z.infer<typeof SeasonUpdateOutputSchema>;

const SNARK = ['gentle and warm', 'playful with teeth', 'spicy — full needle'];

export function buildSeasonUpdateMessages(input: SeasonUpdateInput) {
  const s = input.signals;
  const facts: string[] = [];
  if (s.bigMover) facts.push(`Big mover: ${s.bigMover.player} rank ${s.bigMover.fromRank}->${s.bigMover.toRank} (+${s.bigMover.roundPoints} pts, total ${s.bigMover.total}).`);
  if (s.faller) facts.push(`Faller: ${s.faller.player} rank ${s.faller.fromRank}->${s.faller.toRank}.`);
  for (const st of s.streaks) facts.push(`Streak: ${st.player} ${st.direction} ${st.rounds} rounds.`);
  for (const d of s.discoveryShifts) facts.push(`Discovery shift: ${d.player} ${d.direction} (${d.detail}).`);
  for (const r of s.rivalries) facts.push(`Rivalry (${r.kind}): ${r.players.join(' vs ')} — ${r.detail}.`);
  if (s.upcomingTension) facts.push(`Next up "${s.upcomingTension.nextRound?.name ?? 'TBD'}": ${s.upcomingTension.contenders.map(c => `${c.player} (${c.total}, gap ${c.gapToLeader})`).join('; ')}.`);

  const system = `You are the b-side season-pulse writer for the music league "${input.leagueName}". Write a short editorial "season update" — what stands out RIGHT NOW given the latest digest.
VOICE (${SNARK[input.snarkLevel]}): strife is welcome when it is FUNNY and FACT-BASED; never cruel or mean. Pattern-calling is fine when the facts support it. Matt (Mashew), Mara, and Jordan are always fair game. Do NOT pile on anyone in this list again: ${input.recentSubjects.join(', ') || '(none)'}.
HARD RULES: every competitive claim must come from the FACTS below — invent nothing. When you look ahead to the next round you MAY name artists but you may NOT name songs (it spoils pickability).
Output JSON: {"title": <punchy section title>, "body": <2-4 short paragraphs>}.`;

  const user = `Season: ${input.season}\nAs of: round ${s.asOfRound?.number} "${s.asOfRound?.name}".\nFACTS:\n${facts.join('\n') || '(season just starting — no trends yet)'}`;
  return [ { role: 'system' as const, content: system }, { role: 'user' as const, content: user } ];
}

export const seasonUpdateTask: PredictionTask<SeasonUpdateInput, SeasonUpdateOutput> = {
  id: 'season-update',
  inputSchema: SeasonUpdateInputSchema,
  buildMessages: buildSeasonUpdateMessages,
  model: process.env.OPENROUTER_DIGEST_MODEL ?? 'anthropic/claude-sonnet-4-5',
  outputSchema: SeasonUpdateOutputSchema,
};
```
- [ ] **Step 4:** Run the test green; commit path-scoped.

### Task A4: wire `seasonUpdate` into both read-model paths
**Files:** `dashboard/buildReadModel.ts`, `routes/api/content/[leagueId]/update/+server.ts`

- [ ] **Step 1:** Add `seasonUpdate: SeasonUpdateOutputSchema.nullable()` to `ReadModelSchema`.
- [ ] **Step 2:** In `buildReadModel` (after the moments step), compute signals + narrate:
```ts
import { computeSeasonSignalsForLeague } from './seasonSignals.js';
import { seasonUpdateTask } from './generators/seasonUpdate.js';
import { getSnarkLevel } from '...'; // A1 reader

const signals = computeSeasonSignalsForLeague(db, leagueId);
let seasonUpdate: { title: string; body: string } | null = null;
if (signals.asOfRound && (signals.bigMover || signals.faller || signals.streaks.length)) {
  const r = await runPrediction(db, seasonUpdateTask, {
    leagueName: leagueRow.name, season: leagueMeta.latestSeason,
    snarkLevel: getSnarkLevel(db, leagueId), signals, recentSubjects: [],
  });
  seasonUpdate = r.output;
}
```
Add `seasonUpdate` to the returned `readModel` object.
- [ ] **Step 3:** Mirror the same population in `buildUpdatedReadModel` (the update path) — pass `recentSubjects` from the PRIOR read-model's `seasonUpdate` if you can cheaply derive featured names (else `[]` for v1). Re-parse `ReadModelSchema`.
- [ ] **Step 4:** Extend the `buildReadModel` test's mock dispatcher with a `'season-pulse writer'` branch returning a `{title, body}` fixture; assert `readModel.seasonUpdate` is populated. `npx vitest run src/lib/dashboard` green; commit path-scoped.

---

## Lane B — frontend (bside SPA + operator control)

### Task B1: bside type + HomeScreen section
**Files:** `bside/src/lib/types.ts`, `bside/src/routes/HomeScreen.svelte`

- [ ] **Step 1:** Add to the `ReadModel` interface in `bside/src/lib/types.ts`: `seasonUpdate: { title: string; body: string } | null;`.
- [ ] **Step 2:** In `HomeScreen.svelte`, **immediately after the KPI ribbon `</section>` and before the Superlative reel `<section>`**, add (guarded on presence):
```svelte
{#if readModel.seasonUpdate}
  <section class="bs-sec">
    <div class="bs-eyebrow bs-acc-violet">The pulse</div>
    <h2 class="bs-sec-title">{readModel.seasonUpdate.title}</h2>
    <div class="bs-pulse-body">
      {#each readModel.seasonUpdate.body.split('\n\n') as para}
        <p>{para}</p>
      {/each}
    </div>
  </section>
{/if}
```
Match existing section classes (`bs-sec`, `bs-eyebrow`, `bs-sec-title`); reuse an existing accent token (confirm one in the bside CSS).
- [ ] **Step 3:** Build the bside SPA to verify it compiles: `cd bside && npm run build` (or the project's check). Expected: success. Commit path-scoped.

### Task B2: operator snark-dial control
**Files:** `ui/src/lib/content/UpdateModal.svelte` (+ the content screen publish row if a first-publish control is wanted)

- [ ] **Step 1:** Add a 3-way snark control (Gentle / Medium / Spicy → level 0/1/2) to `UpdateModal.svelte`, defaulting to the league's current `snark_level` (fetch from the site row or pass in via load). On change, `PATCH /api/content/${leagueId}/snark` `{ level }`.
- [ ] **Step 2:** `cd ui && npm run check` passes for the modal (0 errors in the changed file). Commit path-scoped.

---

## Gate (orc)

- [ ] Cross-check both lanes committed path-scoped on a clean tree.
- [ ] `cd ui && npm run check` → 0 errors; `cd ui && npx vitest run` → all green.
- [ ] `cd bside && npm run build` → success (the SPA typechecks/builds).
- [ ] **Content review (owner gate):** this ships USER-FACING generated content with the loosened voice — regenerate a real league's b-side on **dev**, screenshot the Season-Update section (412 + desktop), and surface to owner for ratification against the voice mandate (funny/fact-based, not cruel, guardrails respected, no song-spoilers) **before any prod deploy.**
- [ ] On owner sign-off: version bump + CHANGELOG, deploy (`scripts/deploy.sh` equivalent / the mlb docker deploy), assert the section live; close sprint.

## Self-Review

- **Spec coverage:** narration (A3), voice+guardrails (A3 prompt), snark dial (A1+B2), regenerate-on-update (A4 both paths), placement (B1), carry-over signals spot-trading + punching-bag (A2). Chat-barbs explicitly deferred (logged). "Below standings" → "after the KPI ribbon" (no standings table on the public home) — FLAGGED for owner.
- **Placeholder scan:** real code/skeletons in each load-bearing step; the bside accent token + the snark control's current-value fetch are the two "confirm in code" spots, called out explicitly (not silent TODOs).
- **Type consistency:** the `{title, body}|null` contract is identical in `ReadModelSchema` (zod), `bside/types.ts`, and `SeasonUpdateOutputSchema`. `getSnarkLevel` (A1) is consumed in A4.

## Notes for executors

- **Two build targets:** `ui/` (operator app) and `bside/` (public SPA) are separate — the gate runs `npm run check`/`vitest` in `ui/` AND `npm run build` in `bside/`.
- This is **user-facing content** — unlike S1, S2 has an owner content-review gate before deploy.
- Shared working tree → path-scoped commits; never `--amend` shared HEAD.
- Deferred to a later card (logged, not dropped): chat-barb rivalry signal (LLM-assisted over `chat_mentions`).
