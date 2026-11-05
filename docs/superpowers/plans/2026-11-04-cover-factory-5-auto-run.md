# Cover Factory — Piece 5: Automatic Round-End Run — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** When a round's digest draft is built for a league with the Cover Factory auto-run ON (default ON: `boarz-ii-men`, `second-best`, `hip-jammers`), a background job makes swapped covers for the podium's medal songs (ranks 1–3), writes each wipe GIF into the draft's podium `coverUrl`, keeps Matt's chosen cover across regenerations, stays within a per-round budget (≤ $1 free, $1–$2 after ntfy approval on `mlb-alert`, hard stop $2), leaves operator-only notes on failures, and promotes covers to public URLs only at finalize/share. Leagues with the setting OFF see zero behavior change.

**Architecture:** New tables `cover_podium_slots` (one row per round × podium song: project, status, note, public URL) and `cover_auto_jobs` (round-level queue + budget/approval state). A pure `podium.ts` (match podium items ↔ submissions, apply keepers, notes), an `autoRun.ts` engine (plan → generate with retries/fal fallback → keeper → GIF), a `startCoverAutoRunner()` poller started from `hooks.server.ts` (same pattern as `startDigestRunner`), hooks after the three podium write paths, a promote step called by digest finalize and the d2 publish, ntfy approval routes, and UI bits (podium notes banner hidden from export, per-league toggles, slot link in the factory).

**Spec:** `docs/superpowers/specs/2026-11-04-cover-factory-design.md` §5 + "Decisions from the builder check"; briefing `docs/onboarding/agent-briefing-cover-factory.md`.

## Global Constraints

- Work in `ui/`. Tests/build/GitNexus rules as in earlier pieces (full `npm test` keeps only ~15 pre-existing unrelated failures; `npm run build` passes; impact analysis before editing existing functions — `writeDraft`, `enrichPodiumArt`, `backfillPodiumArt`, the draft/regenerate/finalize routes, `publishDigest2`, `hooks.server.ts` are HIGH-traffic: report risk levels in the task report).
- **OFF leagues: zero behavior change.** Every new hook first checks the league setting (or the existence of slot rows for the round) and returns the input unchanged otherwise. Tests must prove an OFF league's draft content is byte-identical through each hooked path.
- Settings key `cover_factory_auto_leagues` = JSON `{ [leagueSlug]: boolean }`; missing key → defaults `{ "boarz-ii-men": true, "second-best": true, "hip-jammers": true }`; missing league → false.
- Medal songs only: podium items with rank/place/position 1–3 (ties included; max 5 slots per round).
- **Never overwrite a hand-made cover:** a podium item whose `coverUrl` is not a Spotify CDN URL (`i.scdn.co`) and not one this system wrote is left alone and its slot marked `skipped` with note "hand-made cover kept".
- Budget per round = sum of `cover_requests.cost_usd` for projects linked to that round's slots. ≤ $1.00: proceed. Next step would exceed $1.00 and no approval yet: send one ntfy to topic **`mlb-alert`** on `NTFY_URL` (= `https://ntfy.mattmariani.com`) with Approve/Deny actions (reuse `buildStyleHilNotification`/`publishStyleHil`/`mintHilToken`/`hilBearerOk` from `avatarFactory/hil.ts`, overriding the topic), and park the job `awaiting_approval`. Approved: continue up to $2.00. Denied/timeout (24 h): remaining slots `failed` with note "budget not approved". **Hard stop $2.00** — never start a call when spend ≥ $2.00.
- Retries per slot: generator attempt + up to 2 retries on failed versions, then one `fal-ai/nano-banana/edit` attempt if `FAL_KEY` is set; then `failed` with the last reason.
- Plan per slot (my call, from spec): main subject → submitter replaces it; ≥ 2 people, no main → submitter replaces all; no people → pitch (submitter only, count 3) and apply the first non-`alternate` concept; if the first concept is `alternate`, use that alternate cover then read + default treatments. No usable headshot → `failed` "no headshot for <name>".
- Draft URLs for auto covers are app-relative private URLs (`/api/cover-factory/media/export/<versionId>.gif`) — never public before finalize/share. At finalize and at d2 publish, `promotePodiumCovers` calls `shareKeeper` for each done slot and rewrites the podium `coverUrl` to the public `${digestBaseUrl()}/_media/covers/<dir>/wipe.gif` (persisted in `digest_sections`) **before** export/capture, so the leak gate passes.
- The project keeper is the source of truth for a slot: after any podium write (fresh draft, cached backfill, whole regen) `applyCoverKeepers` re-sets `coverUrl` for done slots; changing the keeper in the factory re-applies to the draft immediately.
- Operator notes live in podium `content_json._coverNotes: { [rankOrTitle]: string }` and render only in the app with `data-export-hide="1"`; never in exports/shares.
- No WhatsApp sends, no finalize/publish triggered by this code path, no host-timer changes.
- Commit per task (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); never push.

## Review Focus

1. OFF league (e.g. `sssc`) draft build → podium content and DB rows byte-identical to before; no job enqueued. (Task 1/3 tests.)
2. Podium item with a hand-made `_media/…gif` cover (like R182) → untouched, slot `skipped`. (Task 2 test.)
3. Budget crossing: spend at $0.95 and a slot needing ~$0.15 → ntfy sent once, job parked; approve → continues; spend ≥ $2.00 → no further calls. (Task 3 test.)
4. Whole-regen / force rebuild after a done slot → keeper cover re-applied, not reverted to Spotify art. (Task 1 test.)
5. Finalize/d2 publish with a done slot → podium URL public before export; leak gate passes; shareKeeper idempotent across repeated publishes. (Task 4 test.)

---

### Task 1: settings, slots table, podium matching + keeper re-apply hooks

**Files:** create `ui/src/lib/server/coverFactory/podium.ts` (+ test); modify `schema.ts` (tables), `ui/src/lib/digest/llm.ts` (`writeDraft` path) or the call sites in `ui/src/routes/api/digest/[roundId]/draft/+server.ts` and `…/regenerate/+server.ts` (hook after `enrichPodiumArt`/`backfillPodiumArt`), `service.ts` (keeper change → re-apply).

**Produces:**
```ts
// tables
cover_podium_slots(id INTEGER PK, round_id INT NOT NULL, rank INT NOT NULL, title TEXT NOT NULL, submission_id INT, project_id INT REFERENCES cover_projects(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','running','done','failed','skipped')), note TEXT, public_url TEXT, updated_at TEXT NOT NULL, UNIQUE(round_id, rank, title))
// podium.ts
export function autoLeagues(db): Record<string, boolean>; export function setAutoLeague(db, slug: string, on: boolean): void
export function isAutoLeague(db, roundId: number): boolean   // via rounds→seasons→leagues
export interface PodiumItemRef { index: number; rank: number; title: string; artist: string; coverUrl: string | null }
export function medalItems(content: unknown): PodiumItemRef[]                // ranks 1–3 from rank|place|position
export function matchSubmission(db, roundId: number, ref: PodiumItemRef): number | null   // normalized title (same normalization enrichPodiumArt uses — reuse it, export if needed)
export function isHandMade(url: string | null, roundId: number): boolean      // not i.scdn.co and not a cover-factory URL
export function applyCoverKeepers(db, roundId: number, content: any): any     // pure-ish: returns content with done-slot coverUrls set (private export URL until public_url exists, then public_url) and _coverNotes from slot notes; unchanged object if no slots
export function writePodiumCover(db, roundId: number): void                    // load the draft's podium section, applyCoverKeepers, persist if changed
```
Hooks: after the podium content is written by fresh draft, cached backfill and whole regen, call `writePodiumCover(db, roundId)`; `actKeeper` calls it when the project is linked to a slot (and sets that slot `done`).

- [ ] Tests (RED→GREEN): settings defaults + set; `medalItems` with ties and `place`-only items; `isHandMade` for `https://digest.mattmariani.com/_media/r182/x.gif` → true, `https://i.scdn.co/...` → false, `/api/cover-factory/media/export/9.gif` → false; `applyCoverKeepers` with no slots returns the identical object (`toBe`); with a done slot sets coverUrl and `_coverNotes`; regenerate route path re-applies (route-level test with in-memory DB, fake generateDraft); an OFF-league round's podium JSON byte-identical after the draft route.
- [ ] Commit `cover factory: podium slots, keeper re-apply hooks`.

### Task 2: auto-run engine

**Files:** create `ui/src/lib/server/coverFactory/autoRun.ts` (+ test).

**Produces:**
```ts
export interface AutoDeps { fetchImpl?: FetchLike; notify?: (n) => Promise<boolean>; now?: () => number }
export type SlotOutcome = 'done' | 'failed' | 'skipped' | 'needs_approval'
export async function runSlot(db, roundId: number, slotId: number, budget: { capUsd: number }, deps?: AutoDeps): Promise<SlotOutcome>
export function roundSpend(db, roundId: number): number
```
`runSlot`: create (or reuse) a project from the slot's submission (`actCreate` round path logic — call the service function, don't duplicate), read, choose plan (Global Constraints), identity, generate with retries + fal fallback, set keeper on the first ok version, link project to slot, status `done` and note; any provider/no-headshot failure → `failed` + note; before every paid call check `roundSpend + estimate (read 0.02, identity 0.01, pitch 0.05, generate 0.10)` against `capUsd` → `needs_approval` (if cap is 1.00) or `failed` "budget cap reached" (if cap is 2.00). Uses the pinned models and the pause gate (a pause → slot stays `pending`, job retries later).

- [ ] Tests with fake fetch: person cover → main replaced, keeper set, slot done; no-person cover → pitch then generate; two failed versions + fal ok → done with provider fal; all fail → failed with reason; no headshot → failed note; budget estimate over $1 → needs_approval with no paid call made; over $2 → failed, no call; hand-made slot never touched (slot pre-marked skipped by Task 3 enqueue — assert runSlot refuses non-pending).
- [ ] Commit `cover factory: auto-run engine`.

### Task 3: job queue, poller, enqueue hook, ntfy approval

**Files:** schema (`cover_auto_jobs(id PK, round_id INT UNIQUE, status CHECK IN ('queued','running','awaiting_approval','done','failed'), cap_usd REAL NOT NULL DEFAULT 1.0, hil_token TEXT, notified_at TEXT, created_at, updated_at)`); create `ui/src/lib/server/coverFactory/autoQueue.ts` (+ test); `ui/src/hooks.server.ts` (start `startCoverAutoRunner()` next to `startDigestRunner`, skipped when `STATS_ONLY=1`; env `COVER_AUTO_POLL_MS` default 60000); draft route (after a fresh draft build only: `enqueueCoverAuto(db, roundId)` when `isAutoLeague`); routes `ui/src/routes/api/cover-factory/auto/approve/+server.ts` and `…/deny/+server.ts` (bearer via `hilBearerOk`, body `{token}`); action `run-auto {roundId}` in service.ts (operator "run now" — enqueues even if the draft wasn't just rebuilt; requires the league ON).

**Produces:** `enqueueCoverAuto(db, roundId)` creates slots for medal items (marks hand-made ones `skipped`) and a `queued` job (idempotent: an existing non-terminal job is reused, done slots kept). `tickCoverAuto(db, deps)` takes one job, runs pending slots sequentially via `runSlot`, handles `needs_approval` (one ntfy to `mlb-alert` via the hil helpers with the topic overridden; job → `awaiting_approval`), approval → `cap_usd = 2.0` + `queued`, deny or 24 h timeout → remaining slots failed "budget not approved", job done; at the end `writePodiumCover`. One job at a time; never blocks the digest runner (own interval, `unref()`).

- [ ] Tests: enqueue for ON league creates slots + job; OFF league → nothing; hand-made → skipped; tick runs slots and writes podium; crossing $1 sends exactly one notification (fake notify) and parks; approve route with wrong bearer → 401, right → cap 2 + queued; deny → failed notes; idempotent re-enqueue.
- [ ] Commit `cover factory: auto-run queue, poller, ntfy budget approval`.

### Task 4: promote at finalize / d2 publish + punch-up helper

**Files:** `podium.ts` (`promotePodiumCovers(db, roundId): Promise<number>`), `ui/src/routes/api/digest/[roundId]/finalize/+server.ts` (call before `runDigestExport`), `ui/src/lib/digest2/publish.ts` (`publishDigest2`, before capture), create `scripts/digest-qa/cover_keepers.py` (reads `cover_podium_slots` for a round → `{rank: public_url or None}`; prints JSON; documented in its docstring for punch-up scripts to call instead of hardcoding `_media` URLs).
`promotePodiumCovers`: for each done slot without `public_url` (or whose project keeper changed since), `shareKeeper` → store `public_url` → `writePodiumCover`. No slots → returns 0 and touches nothing.
- [ ] Tests: finalize path with a done slot → podium coverUrl is the public URL before export is called (spy order); d2 publish → leak gate sees no app URLs; repeat publish reuses the same dir; round with no slots → finalize unchanged. Python helper: a tiny pytest-free self-check (`python3 cover_keepers.py --round N --db <copy>`), shown in the report.
- [ ] Commit `cover factory: promote podium covers at finalize/share + punch-up helper`.

### Task 5: UI

**Files:** `ui/src/lib/digest/AlbumPodium.svelte` (render `_coverNotes` per item as a small amber note with an "Open in Cover Factory" link to `/cover-factory?project=<id>`, both `data-export-hide="1"`; the slot→project id comes via `_coverNotes`/`_coverProjects` maps written by `applyCoverKeepers`), cover-factory page (header "Auto-run" popover: per-league toggles via new actions `auto-leagues` GET/POST; project header chip "Podium R<round> #<rank>" when linked; `?project=` deep link opens that project; round panel listing slots with status + "Run auto now" button per round), `api.ts`.
- [ ] `npm run build`; browser check on a production build + DB copy: toggles persist; a round's slot panel; "Run auto now" on a DB-copy round with plain Spotify podium art (one real run ≤ $0.60) → draft podium shows GIFs + notes in the app, export-hide verified (inspect DOM attribute). Screenshots `<scratchpad>/cf5-shots/`.
- [ ] Commit `cover factory: auto-run UI (notes, toggles, slots)`.

### Task 6: deploy + live auto-run

Merge (stash/pop Matt's compose WIP), deploy with the override, verify poller started in container logs. Live: pick an **unfinalized draft whose podium covers are all Spotify art** (check `digest_sections` JSON first; never R170/R182 or any draft with `_media` covers), run "Run auto now" via the live API, wait for the job, inspect the draft podium (GIF URLs private, notes), view the covers. Do **not** finalize or publish. Report cost/latency.
