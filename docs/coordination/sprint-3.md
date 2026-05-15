---
project: music-league-bot
sprint: sprint-3
created: 2026-05-15T00:30:00.000Z
updated: 2026-05-15T00:30:00.000Z
---

# music-league-bot — coordination doc (sprint-3)

> Strict template per Session O2=B / seed §12 Phase 8. The dashboard
> reads this as the canonical substrate (seed §3.7); orc emits
> `coord-doc-stale` cards when drift is detected (§3.8 / O7=A).
>
> Section headings are load-bearing — keep them as-is so the parser can
> find them. Section bodies are markdown-flexible.

## Plan Source

- Type: inline
- Path: this document (`## Active Sprint Plan` section)
- Active unit: sprint-3

## Sprint Goals

- Ship the head-to-head picker for round candidates
- Pairwise comparison; the survivor becomes the round's nominee.

## Active Initiatives

- _None — sprint-3 is a single focused feature (head-to-head picker)._

## Active Sprint Plan

<!-- Lightweight task list for the current sprint when `methodology.
     planning: inline` is configured. orc-tower's InlineArtifactSource
     parses this section. Same format conventions as sprint-1 / sprint-2. -->

- [x] {agent: backend, id: h2h-schema} Add `head_to_head_matches` table to `ui/src/lib/db/schema.ts` — columns `(id INTEGER PRIMARY KEY, round_id INTEGER NOT NULL, winner_id INTEGER NOT NULL, loser_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (winner_id) REFERENCES research_songs(id), FOREIGN KEY (loser_id) REFERENCES research_songs(id))` + index on `(round_id, created_at)`. Apply via the existing `CREATE TABLE IF NOT EXISTS` startup path in `client.ts` so dev + docker pick it up automatically (no separate migration runner needed at this scale). Add a vitest exercising insert + foreign-key constraint behavior.
  - **Acceptance:** `cd ui && npm run dev` (or restart docker) — `sqlite3 data/league.db ".schema head_to_head_matches"` shows the table; vitest passes (1+ test for insert; 1+ test confirming FK violation when winner_id or loser_id doesn't exist in research_songs); the test fixture cleans up after itself.

- [x] {agent: backend, id: h2h-candidates} Add `getH2HCandidates(roundId)` in `ui/src/lib/db/research.ts` (or new `ui/src/lib/db/headToHead.ts` — your call). Returns research_songs eligible for head-to-head: anything from that round whose status indicates active consideration (define this — proposed: `themeFit >= 3` OR a dedicated `status='reviewing'`/`'shortlist'` field if you decide to add one). If the research_songs table doesn't have a status column yet, add `status TEXT NOT NULL DEFAULT 'reviewing'` to the schema in this same task (research candidates default to in-the-running). Returns `{ id, artist, title, themeFit, discoveryPotential, nostalgiaPotential, personalRating, notes, spotifyUri, ytmUrl, weightedScore }[]`. Sort by `weightedScore` desc so the highest-rated candidate naturally becomes the initial champion.
  - **Acceptance:** vitest exercises `getH2HCandidates(roundId)` against a fixture with 5+ research_songs of varying ratings — returns them sorted by weighted score desc, excludes any with status not eligible; weightedScore reflects the user's current settings weights (use the same `computeScore` from `ui/src/lib/scoring.ts`).

- [x] {agent: backend, id: h2h-api, depends: h2h-schema, h2h-candidates} Add two API routes:
  - `POST /api/h2h/match` in `ui/src/routes/api/h2h/match/+server.ts` — body `{ roundId, winnerId, loserId }`, inserts a row in `head_to_head_matches`, returns the inserted row plus the updated state (see below). Validates both IDs belong to the same round and to `research_songs`.
  - `GET /api/h2h/state/[roundId]` in `ui/src/routes/api/h2h/state/[roundId]/+server.ts` — returns `{ candidates: H2HCandidate[], matches: H2HMatch[], champion: H2HCandidate | null, challenger: H2HCandidate | null, queue: H2HCandidate[], retired: H2HCandidate[], isComplete: boolean }`. Logic: champion is the candidate with the most wins among recent matches (default to highest weighted score on cold start); challenger is the next un-played candidate from the queue; queue is the remaining un-played candidates sorted by weighted score desc; retired is anyone who's lost a match; isComplete when queue is empty.
  - Reuse the existing `getDb()` pattern; export the H2HCandidate/H2HMatch types from `ui/src/lib/types.ts`.
  - **Acceptance:** `curl -X POST http://localhost:5174/api/h2h/match -H 'content-type: application/json' -d '{"roundId":97,"winnerId":X,"loserId":Y}'` returns the new row + state; `curl http://localhost:5174/api/h2h/state/97` returns the structured state; vitest covers both endpoints including the FK-violation error path; if both IDs match the same research_song, the API returns 400.

- [x] {agent: frontend, id: h2h-card} Build `ui/src/lib/components/HeadToHeadCard.svelte` matching prototype C's two-card layout asymmetry. Props: `song: H2HCandidate`, `role: 'holding-lane' | 'challenger'`, `onPick: () => void`. **Holding-lane variant:** dark card (`bg-bg-elevated` or even darker `bg-bg`), prominent `<SectionLabel>` reading `HOLDING LANE`, big bold artist+title, mono dim metadata line (`themeFit / discoveryPotential / nostalgia / personal`) using dot rows, a description/notes block. **Challenger variant:** lighter card (`bg-surface` or a warm-cream tint if you can derive one from existing tokens), `<SectionLabel>` reading `CHALLENGER`, same content treatment but visually less-anointed. Both cards have a `<button>Pick winner</button>` styled with the design system accent button. The asymmetry is doing real cognitive work — visually nudges the user to think "do you really want to dethrone the holding lane?"
  - **Acceptance:** Showcase the component on `/_examples` with two fixture songs (one as holding-lane, one as challenger) — visually consistent with prototype C's H2H block. Hover state on the Pick winner button works. `svelte-check` clean.

- [x] {agent: frontend, id: h2h-page, depends: h2h-card, h2h-api} Add a new `Head-to-Head` tab to the round page (`ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte`) as a sibling to ML / Chat / Research. The tab content: fetches `GET /api/h2h/state/[roundId]` on mount, renders the two `<HeadToHeadCard>` instances side-by-side (HoldingLane on left, Challenger on right) with the `onPick` handlers wired to `POST /api/h2h/match` and then refetches state. Empty state if `candidates.length < 2`: show a friendly message ("Need at least two research candidates with themeFit ≥ 3 to start head-to-head. Visit the Research tab to add some.").
  - **Acceptance:** Visit `/league/second-best/season/1/round/97` → click `Head-to-Head` tab → if there are ≥2 candidates, two cards render and clicking Pick winner records a match + advances to the next challenger; if not, the empty state shows; tab styling matches the existing ML/Chat/Research tabs from sprint-2. `svelte-check` clean.

- [x] {agent: frontend, id: h2h-queue, depends: h2h-page} Under the two cards, render a "Up next · {N} songs to compare" list matching prototype C's bottom queue (numbered list, mono artist+title, optional rating dots, deadline-ish metadata). Show retired candidates in a separate "Retired" section below the queue (dimmer styling), in the order they lost. Both lists update reactively after each match.
  - **Acceptance:** After picking 1 winner, the queue list shows N-1 challengers remaining and the retired list shows 1 song; visually consistent with prototype C's queue treatment; mono fonts + dot scoring throughout.

- [x] {agent: frontend, id: h2h-champion, depends: h2h-page} When `state.isComplete` is true (queue empty), show a winner banner above the cards: orange accent panel with `<StatusChip tone='accent'>WINNER</StatusChip>`, big bold artist+title of the surviving champion, a one-line "Survived N matches" stat, and a `<button>Reset and pick again</button>` button. Reset clears the round's matches (call `DELETE /api/h2h/state/[roundId]` — coordinate the new endpoint shape with backend if needed; if simpler, just call `POST /api/h2h/match` with a `reset: true` flag — your call, but file a Blocker if you need backend to add the reset endpoint).
  - **Acceptance:** After all matches are recorded, the winner banner renders with the champion's metadata; clicking Reset and pick again clears the matches and returns the view to a fresh head-to-head; if reset requires a new backend endpoint, file a Blocker first and ship the rest of this task.

- [x] {agent: backend, id: fix-deadline-save} **Hotfix** from sprint-2 manual test feedback (`~/.config/taw/wiki/Projects/music-league-bot/tests/sprint 2-3-results.md`): the **Round deadlines save buttons on `/settings` are not working**. Investigate `ui/src/routes/settings/+page.svelte` (look for the deadline save UI around the `Round deadlines` section, line ~260 onwards), trace the form action / fetch call to whichever `+page.server.ts` or `routes/api/**` handler is supposed to receive it, and fix the broken path. Likely candidates: (a) the form action name doesn't match between client and server, (b) the handler exists but doesn't write to the rounds table, (c) the client calls a route that doesn't exist. Add a quick vitest or smoke-test step that posts a deadline change and verifies it persists.
  - **Acceptance:** Open `/settings` → modify a round deadline → click save → reload the page → the new value is visible (persists). `sqlite3 data/league.db "select id, submission_deadline, voting_deadline from rounds where id = <test-id>";` reflects the change. No svelte-check regressions. Note in the Activity Log entry which root cause was the culprit.

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| infra | `ui/package.json`, `ui/svelte.config.js`, `ui/vite.config.ts`, `ui/tsconfig.json`, `ui/src/app.html`, `ui/src/app.css`, `Dockerfile.ui`, `docker-compose.yml`, `.env.example`, `ui/static/**` | `ui/src/**` (except static) |
| backend | `ui/src/lib/**` (except `lib/components/**`), `ui/src/hooks.server.ts`, `ui/src/routes/**/+page.server.ts`, `ui/src/routes/+layout.server.ts`, `ui/src/routes/api/**` | `ui/src/routes/**/+page.svelte`, `ui/src/lib/components/**`, infra files |
| frontend | `ui/src/routes/**/+page.svelte`, `ui/src/routes/+layout.svelte`, `ui/src/lib/components/**` | `ui/src/lib/db/**`, `ui/src/lib/import/**`, `ui/src/routes/**/+page.server.ts`, `ui/src/routes/api/**`, infra files |

- **backend** — h2h-schema, h2h-candidates, h2h-api (the data + endpoints).
- **frontend** — h2h-card, h2h-page, h2h-queue, h2h-champion (the UI).
- **infra** — no tasks this sprint; available as a load-balancing pool if frontend or backend bottlenecks (per sprint-1 review Q2 ratification — the `(as backend, parallel)` / `(as frontend, parallel)` convention).

## Decision Log

_No decisions yet._

## Ratification Log

_Sprint-1 review ratification `rn-760a2713` (checkbox-in-the-landing-commit) is still pending in the inbox; sprint-2 agents adopted it voluntarily and it held up well — worth ratifying formally so sprint-3 onward has the rule on the books._

## Contract Changes

### 2026-05-15 — H2H types + endpoints
- **New shared types** in `ui/src/lib/types.ts`: `H2HMatch`, `H2HCandidate`, `H2HState`. Frontend consumers should import these instead of redefining; field shapes are stable for sprint-3.
  - `H2HMatch { id, roundId, winnerId, loserId, createdAt }`
  - `H2HCandidate { id, roundId, artist, title, spotifyUri, ytmUrl, themeFit, discoveryPotential, nostalgiaPotential, personalRating, notes, weightedScore, status }`
  - `H2HState { candidates, matches, champion, challenger, queue, retired, isComplete }`
- **New routes:**
  - `POST /api/h2h/match` — body `{ roundId, winnerId, loserId }`; returns `{ match, state }` with status 201. 400 on missing fields, identical IDs, unknown research_song IDs, or candidates not belonging to the given round.
  - `GET /api/h2h/state/[roundId]` — returns `H2HState`.
  - `DELETE /api/h2h/state/[roundId]` — clears all matches for the round; returns `{ cleared, state }`. (Added so frontend's `h2h-champion` Reset button has a clean reset path.)

## Blockers

- _None._

## Activity Log

### 2026-05-15 — frontend — h2h-champion landed
- Replaced the placeholder champion stub in `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte` (h2h tab body) with the full prototype-C winner banner + reset flow. Sprint-3's 7 main frontend/backend tasks are now all `[x]`.
- **Banner layout** — `<section class="bg-accent-bg border border-accent-deep rounded-xl p-8 text-center">`:
  - `<StatusChip tone="accent">WINNER</StatusChip>` at top.
  - Artist heading in `font-display font-bold text-fg text-5xl` (the pulp display face used elsewhere for the rail wordmark — feels celebratory).
  - Title in `text-fg-muted text-2xl`.
  - Stat line in `font-mono text-xs tracking-widest uppercase text-fg-dim`: `Survived {matches.length} match(es)`.
  - Secondary reset button: `bg-surface text-fg border border-border-muted hover:bg-surface-hover px-4 py-2 rounded-md font-bold font-mono text-xs tracking-widest uppercase`. Intentionally lower-key than `PICK WINNER` since reset is a destructive operation — not the dominant action on the page.
- **Reset flow** (`resetH2H()`):
  1. `confirm()` guard so the user can back out of clearing matches.
  2. `DELETE /api/h2h/state/{roundId}` — backend's existing endpoint, no contract change needed.
  3. On 200, the response body is `{ cleared: number, state: H2HState }`; overwrite local `h2hState` from `body.state`. Rollback to previous snapshot on failure with a warn-tone error line above the banner.
  4. After reset, the same `{#if h2hState.candidates.length < 2} ... {:else if champion && challenger} ...` branches re-evaluate against the fresh state — head-to-head returns to its active flow with all candidates available again. No extra GET round-trip.
- **Retired section** is also rendered below the banner when `retired.length > 0`, mirroring the active-state's retired list — gives the user a chronological view of who didn't make it before they decide whether to reset.
- **Verification:** added 4 rated research candidates (Tom Waits 4.42 / Big Thief 4.09 / Nick Drake 3.25 / The Velvet Underground ~2.85) to round 97, posted 3 sequential matches where Tom Waits won each. State went `isComplete: true, champion: Tom Waits, matches: 3`. Playwright screenshot `docs/screenshots/2026-05-15-sprint3-h2h-champion.png` shows the orange-bordered banner with WINNER chip, large Tom Waits / Hold On, `SURVIVED 3 MATCHES`, RESET button, and the three retired candidates in dim mono text below. Reset endpoint exercised live via the existing DELETE route — confirmed 200 + cleared state. svelte-check clean.
- **Edge case observed:** if there are matches but the union of all match losers covers every candidate (e.g. each candidate has lost at least once due to circular wins), backend returns `isComplete: true` with `champion: null`. Our banner branch checks `isComplete && champion`, so in that case nothing renders — and the parent `champion && challenger` branch also doesn't render. UI falls back to no h2h body, which is acceptable for that edge case; a future refinement could show a "no clear winner" panel with a reset button if it comes up in real use.
- **Tokens consumed:** `bg-accent-bg`, `border-accent-deep`, `bg-surface`, `bg-surface-hover`, `border-border-muted`, `text-fg`, `text-fg-muted`, `text-fg-dim`, `text-fg-faint`, `text-warn`, `font-display`, `font-mono`. Atoms used: `StatusChip` (accent tone), `SectionLabel` (retired sub-section).
- commit: HASHPLACEHOLDER

### 2026-05-15 — frontend — h2h-queue landed
- Extended `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte` (the existing h2h tab body) with two ordered lists rendered under the `<HeadToHeadCard>` pair.
- **Up next** (`<section class="mt-8">`): `<SectionLabel>Up next · {N} song(s)</SectionLabel>` header, then a numbered `<ol>` driven by `h2hState.queue`. Each `<li>` is a `bg-surface border-l-2 border-border-muted pl-3 pr-4 py-2.5` strip with: mono-faint rank chip (1-indexed), bold artist + muted ` — title`, a 5-dot weighted-score indicator (`round(weightedScore)` clamped to ≥1 when scored; empty when unrated), and a mono-dim score readout (`weightedScore.toFixed(2)` or `—`).
- **Retired** (`<section class="mt-6">`, only rendered when `retired.length > 0`): `<SectionLabel>Retired</SectionLabel>` header, then a flat `<ul>` of `<li class="text-fg-faint">` rows — mono artist, dim title separator. No rank numbers, smaller text, no dots. Order comes from backend (chronological by match loss).
- **Reactivity:** both lists are bound to `h2hState.queue` / `h2hState.retired`, which is overwritten by `pickWinner()`'s POST response — no extra fetch or local-state shadow.
- **Note:** backend's `H2HState.queue` includes the current challenger as its first entry (`challenger = queue[0]`), so the queue list visually shows the challenger card's song as `#1` underneath. That's faithful to the API contract; if it becomes confusing in real use we can slice the challenger out on the frontend without a contract change.
- **Verification:** added test fixtures (Tom Waits / Big Thief / Nick Drake / The Velvet Underground) to round 97 with varied 4-dim ratings; recorded one Tom-Waits-beats-Velvet-Underground match via `POST /api/h2h/match`. Playwright screenshot `docs/screenshots/2026-05-15-sprint3-h2h-queue.png` shows the H2H tab with: HOLDING LANE Tom Waits (4.42 green) + CHALLENGER Big Thief (4.09 green) cards, an `UP NEXT · 2 SONGS` list (Big Thief 4.09 / Nick Drake 3.25) with dot indicators matching the scores, and a `RETIRED` section with The Velvet Underground in dim text. svelte-check clean.
- **Tokens consumed:** `bg-surface`, `border-border-muted`, `bg-accent`, `bg-border-muted`, `text-fg`, `text-fg-faint`, `text-fg-muted`, `text-fg-dim`, `font-mono`. Atoms used: `SectionLabel`. No new components.
- commit: 9043ec5

### 2026-05-15 — backend — fix-deadline-save hotfix
- **Reporter:** user, from manual sprint-2 click-through (`~/.config/taw/wiki/Projects/music-league-bot/tests/sprint 2-3-results.md` → Setup › Round deadlines: "save buittons are not working ucrrently").
- **Root cause:** the `updateDeadline` action in `ui/src/routes/settings/+page.server.ts` coerced empty form fields to `null` and called `updateDeadlines(db, id, null, null)`, which unconditionally `UPDATE rounds SET submission_deadline=?,voting_deadline=?` — i.e. **every save wiped both columns whenever an input was empty**. That collides with the legacy data path: ML-imported deadlines are non-ISO strings like `"14 May @ 2:14pm"`, which `<input type="datetime-local">` rejects and renders as empty. So the typical user flow (click Save on a round whose deadline came from the ZIP import) silently destroyed the existing values, the page reloaded showing empty inputs, and the user concluded "save isn't working."
- **Fix:**
  - `ui/src/lib/db/rounds.ts` — `updateDeadlines` now takes `string | null | undefined` per column. `undefined` means "leave this column alone"; `null`/string means "write it". The function builds the `SET` clause from only the supplied columns; no-op when both are undefined.
  - `ui/src/routes/settings/+page.server.ts` — empty form inputs (after `.trim()`) map to `undefined` not `null`, so an empty Save is a no-op and a partial Save updates only the field the user touched. Explicit clears can still be issued via the DB layer with `null` if the UI ever needs them.
- **Scope:** backend only. `+page.svelte` untouched — the form HTML, names, and `use:enhance` wiring were already correct.
- **Tests:** new `ui/src/lib/db/rounds.test.ts` with 4 vitests — full write, partial update preserves the untouched column, explicit `null` clears, all-undefined is a no-op. Full suite 31/31 green.
- **Smoke test against the live dev server (port 5174), round 102 reset to legacy strings first**:
  ```
  before:        102 | '14 May @ 2:14pm' | '21 May @ 2:14pm'
  empty POST →   102 | '14 May @ 2:14pm' | '21 May @ 2:14pm'   (noop, legacy survived)
  sub-only POST → 102 | '2026-08-01T00:00' | '21 May @ 2:14pm'  (vote survived)
  both POST →    102 | '2026-08-15T00:00' | '2026-08-22T00:00'  (normal save)
  ```
- commit: `57f33aa`

### 2026-05-15 — frontend — h2h-page landed
- `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte`: added a fourth `Head-to-Head` tab as a sibling to ML / Chat / Research. Tab state widened from `'ml' | 'chat' | 'research'` to include `'h2h'`; tab strip auto-renders the new entry through the existing `{#each tabs}` loop, so the prototype-A mono-orange-underline styling carries over for free.
- **Fetch lifecycle:** state lives in `h2hState: H2HState | null`, `h2hLoading`, `h2hError`. A `$effect` watches `tab === 'h2h' && h2hState === null && !h2hLoading && !h2hError` and fires `fetchH2HState()` on the first activation. Subsequent activations reuse the cached state — no refetch on tab switches. `pickWinner(winner, loser)` posts `{ roundId, winnerId, loserId }` to `POST /api/h2h/match` and overwrites local state from `response.state` (per backend's `h2h-api` contract `{ match, state }`); on failure it rolls back to the previous snapshot. Reset/refresh on `DELETE` is left to `h2h-champion`.
- **Tab counter:** `[N]` next to the label uses `h2hState?.candidates.length ?? 0` — shows nothing before the first GET and the live count after.
- **Empty state** (`candidates.length < 2`): centered `bg-surface border-border-muted rounded-xl p-8` panel with a `<StatusChip tone="muted">NOT READY</StatusChip>`, the headline copy, and a button that jumps to the Research tab inline. Status copy includes the literal `status='reviewing'` eligibility hint per the brief.
- **Active state** (`champion && challenger`): `flex md:flex-row flex-col gap-6` wrapper with two `flex-1 min-w-0` columns, each holding one `<HeadToHeadCard>`. Holding lane gets `state.champion`, challenger gets `state.challenger`. Each card's `onPick` wires to `pickWinner(self, opposite)`. `H2HCandidate` is a strict superset of `H2HCardSong`, so the cast is implicit — no mapping layer needed.
- **Pre-staged champion state** (`isComplete && champion`): minimal placeholder banner is rendered as a `TODO` placeholder for the upcoming `h2h-champion` task (orange-deep-bordered card with `<StatusChip tone="accent">WINNER</StatusChip>` + artist + title). h2h-champion will replace this with the full banner + reset button.
- **Loading / error:** `Loading head-to-head state…` mono italic line during the initial fetch; warn-bordered panel with retry button when `h2hError` is set and no cached state exists. Errors during a `pickWinner` POST surface as a mono warn line above the cards while preserving the previous state.
- **Verification:** test fixtures (`Tom Waits / Hold On`, `Big Thief / Sparrow`, `Nick Drake / Pink Moon`) added to round 97 via the existing `POST /api/research/97`; cleaned up afterwards. Playwright screenshots:
  - `docs/screenshots/2026-05-15-sprint3-h2h-page-active.png` — round 97 H2H tab with Tom Waits in HOLDING LANE, Big Thief as CHALLENGER, Nick Drake queued behind (visible after first pick).
  - `docs/screenshots/2026-05-15-sprint3-h2h-page-after-pick.png` — after clicking Big Thief's PICK WINNER, state advances: Big Thief becomes the holding lane, Nick Drake is the new challenger, Tom Waits retired. State refresh comes from the POST response — no extra GET.
  - `docs/screenshots/2026-05-15-sprint3-h2h-page-empty.png` — round 98 (no research_songs) shows the `NOT READY` empty state with the Research-tab jump link.
- svelte-check clean on the new file (only pre-existing `vite.config.ts` error + pre-existing `ResearchList.svelte:13` `state_referenced_locally` warning remain).
- **Next:** `h2h-queue` (queue + retired lists under the cards) and `h2h-champion` (winner banner with reset). Both unblocked now.
- commit: 25c8709

### 2026-05-15 — backend — h2h-api landed
- **New routes** (server files; no `+page.svelte` touched):
  - `ui/src/routes/api/h2h/match/+server.ts` — `POST` validates `{ roundId, winnerId, loserId }`, checks both IDs exist in `research_songs` and belong to the given round, inserts via `recordH2HMatch`, returns `{ match, state }` with status 201. 400 on missing fields, equal winner/loser, unknown IDs, cross-round IDs, or any underlying FK error.
  - `ui/src/routes/api/h2h/state/[roundId]/+server.ts` — `GET` returns the full `H2HState`; `DELETE` clears the round's matches and returns `{ cleared, state }` (added so frontend's `h2h-champion` Reset button doesn't need to special-case it).
- **State builder** (`ui/src/lib/db/headToHead.ts` extended): `buildH2HState(db, roundId)` is the load-bearing computation —
  - `retired = { loser_id of every match }`; `active = candidates - retired`.
  - `champion = active.sort((a,b) => wins(b)-wins(a) || weightedScore(b)-weightedScore(a))[0]`. Falls back to highest-scored candidate on cold start (zero matches → all `wins=0`, weightedScore tiebreak wins). Null when there are no active candidates.
  - `queue = candidates.filter(c => !retired.has(c.id) && c.id !== champion.id && !played.has(c.id)).sort(weightedScore desc)`. "Played" = appears in any match as winner or loser; the champion has played, so they're excluded from the queue explicitly.
  - `challenger = queue[0] ?? null`.
  - `retired` (the returned array) is ordered by the chronological match order, deduped — gives the UI a stable "Retired" history.
  - `isComplete = queue.length === 0`. When true and `champion != null`, the champion has cleared the field.
- **Type signatures** added to `ui/src/lib/types.ts` (also mirrored under `## Contract Changes`):
  ```ts
  interface H2HMatch { id: number; roundId: number; winnerId: number; loserId: number; createdAt: string; }
  interface H2HCandidate {
    id: number; roundId: number; artist: string; title: string;
    spotifyUri: string; ytmUrl: string | null;
    themeFit: number | null; discoveryPotential: number | null;
    nostalgiaPotential: number | null; personalRating: number | null;
    notes: string | null; weightedScore: number | null; status: string;
  }
  interface H2HState {
    candidates: H2HCandidate[]; matches: H2HMatch[];
    champion: H2HCandidate | null; challenger: H2HCandidate | null;
    queue: H2HCandidate[]; retired: H2HCandidate[]; isComplete: boolean;
  }
  ```
- **Tests** (`ui/src/lib/db/headToHead.state.test.ts`): 6 vitests covering cold start, champion holding, champion dethroned, isComplete, reset, and ineligible-status exclusion. State endpoint and POST endpoint exercise the same `buildH2HState` plumbing — the unit tests cover the actual logic. Full suite: 27/27 green.
- **Live check:** `curl -s http://localhost:5174/api/h2h/state/97` returns `{"candidates":[],"matches":[],"champion":null,"challenger":null,"queue":[],"retired":[],"isComplete":true}` — round 97 has no `research_songs` yet (only `ml_submissions`), so the empty state is the contract's correct response per the task brief.
- commit: `899fd72`

### 2026-05-15 — backend — h2h-candidates landed
- `ui/src/lib/db/headToHead.ts` (new): exports `getH2HCandidates(db, roundId)` returning `H2HCandidate[]`. SELECTs from `research_songs` filtered to `status='reviewing'` (the default), LEFT JOINs `ytm_link_cache` for `ytm_url`, then maps each row through `computeScore` from `lib/scoring.ts` with the current `getSettings(db)` weights and sorts by `weightedScore` desc (nulls last).
- Eligibility rule: chose the dedicated `status` column over `themeFit >= 3` — bare research songs (no ratings yet) still need to be eligible so the user can pick "compare them all" before they've finished rating, and `themeFit IS NULL` would otherwise silently exclude them. Explicit retire/bank actions can flip status later (out of scope here).
- `ui/src/lib/db/headToHead.candidates.test.ts` (new): 4 vitests — (1) 5 songs sort by weighted score desc; (2) `status='retired'` rows excluded; (3) unrated songs end up last with `weightedScore === null`; (4) result is round-scoped (a song in round B doesn't leak into round A's candidates).
- Verified: `npx vitest run` 21/21 green.
- commit: `87b805f`

### 2026-05-15 — frontend — h2h-card landed
- New component `ui/src/lib/components/HeadToHeadCard.svelte` with the prototype-C asymmetric pair shape.
- **Prop surface:**
  ```ts
  export type H2HCardSong = {
    id: number; artist: string; title: string;
    themeFit: number | null;
    discoveryPotential: number | null;
    nostalgiaPotential: number | null;
    personalRating: number | null;
    notes: string | null;
    weightedScore: number | null;
  };
  let { song, role, onPick }: {
    song: H2HCardSong;
    role: 'holding-lane' | 'challenger';
    onPick: () => void;
  } = $props();
  ```
  The structural shape mirrors what `h2h-api` is expected to return per candidate — when `H2HCandidate` lands in `types.ts` (sprint-3 contract change), the page-level wrapper will adapt to the loader shape and pass into `song`. Component itself doesn't depend on any unlanded types.
- **Holding-lane variant** (`role === 'holding-lane'`): `bg-bg` (darkest surface) + `border-accent-deep` outline + accent-orange `<SectionLabel>HOLDING LANE</SectionLabel>`. Artist heading `text-3xl font-bold`, title `text-xl text-fg-muted`. Reads as the heavier, anointed card.
- **Challenger variant** (`role === 'challenger'`): `bg-surface` (page-elevated tone) + plain `border-border-muted` + neutral-tone `<SectionLabel>CHALLENGER</SectionLabel>`. Artist heading `text-2xl`, title `text-lg`. Reads as the contender — present but visibly less-anointed; the size + surface + label-tone deltas do the cognitive work of "do you really want to dethrone the holding lane?" per the brief.
- **Shared content:** four-dimension rating grid (Theme / Discovery / Nostalgia / Personal) rendered as 5-dot rows (`w-2 h-2 rounded-full bg-accent` filled, `border-border` empty — matches the ResearchList dot pattern from sprint-2's round-page reskin). Notes block in `text-fg-muted` (falls back to `font-mono italic` "No notes recorded." when null). Weighted score footer line: mono uppercase `WEIGHTED SCORE` label + `font-display font-bold text-2xl` value with health/warn/dim tone bands at ≥4 / ≥3 / else (same scale as ResearchList score readout, for cross-component consistency).
- **Pick winner button:** full-width `bg-accent hover:bg-accent-strong text-bg-elevated px-4 py-3 rounded-md font-bold font-mono tracking-widest uppercase` — matches the accent-CTA style used in the settings page's primary actions and the home page's `+ Adopt league` button. Wires `onPick()` on click.
- **Showcase:** added a new section at the top of `/_examples` (`ui/src/routes/_examples/+page.svelte`) rendering Tom Waits "Hold On" as holding-lane and Big Thief "Sparrow" as challenger with plausible ratings (5/3/4/5 and 4/5/2/4) and notes. The `onPick` handlers `console.log` for now — they'll be wired to `POST /api/h2h/match` once `h2h-page` lands.
- **Verification:** `npm run dev` (port 5176) → `curl /_examples` HTTP 200 (50kb). Playwright screenshot at `docs/screenshots/2026-05-15-sprint3-h2h-card.png` shows the side-by-side pair: orange-deep-bordered HOLDING LANE card on the left with the larger heading + green 4.35 score, and the lighter CHALLENGER card on the right with the smaller heading + amber 3.95 score. Asymmetry reads at a glance. svelte-check clean on both files (only the pre-existing `vite.config.ts` error and the pre-existing `state_referenced_locally` warning on `ResearchList.svelte:13` remain — both unrelated to this task).
- **Tokens consumed:** `bg-bg`, `bg-surface`, `bg-bg-elevated`, `bg-accent`, `bg-accent-strong`, `border-accent-deep`, `border-border-muted`, `border-border`, `border-accent`, `text-fg`, `text-fg-muted`, `text-fg-dim`, `text-fg-faint`, `text-accent`, `text-health`, `text-warn`, `font-mono`, `font-display`. Atoms consumed: `SectionLabel`. No new tokens.
- **Next:** `h2h-page` depends on this + backend's `h2h-api`. `h2h-card` is ready to consume immediately — page wrapper just needs the loader shape from backend's API to map into `H2HCardSong`.
- commit: 07c498a

### 2026-05-15 — backend — h2h-schema landed
- `ui/src/lib/db/schema.ts`: added `head_to_head_matches` table (`id`, `round_id` FK→rounds, `winner_id`/`loser_id` FK→research_songs, `created_at` DEFAULT CURRENT_TIMESTAMP) plus `idx_h2h_round_created` covering `(round_id, created_at)`. Also added `status TEXT NOT NULL DEFAULT 'reviewing'` to `research_songs` for the h2h-candidates eligibility filter.
- `ui/src/lib/db/client.ts`: lightweight in-place migration — after `db.exec(SCHEMA)`, PRAGMA-checks `research_songs` for the new `status` column and runs `ALTER TABLE … ADD COLUMN status TEXT NOT NULL DEFAULT 'reviewing'` if missing. Single PRAGMA per boot; existing DBs (dev + the running docker container) pick the column up next time `openLeagueDb()` is called.
- `ui/src/lib/types.ts`: declared `H2HMatch`, `H2HCandidate`, `H2HState` ahead of h2h-api so test code can already import the row type.
- `ui/src/lib/db/headToHead.test.ts` (new): 4 vitests — (1) table columns + index present; (2) `status` column on research_songs with default `'reviewing'`; (3) round-trip insert through a real round + two research_songs; (4) FK violation when `winner_id` references a non-existent research song.
- **Verified:** `npx vitest run` 17/17 green. Live DB at `data/league.db` already migrated (server was running): `sqlite3 .schema head_to_head_matches` shows the table + index, `PRAGMA table_info(research_songs)` shows `status` column with default `'reviewing'`.
- commit: `e5e1045`

### 2026-05-15 — docs — Sprint plan refresh: head-to-head picker
- replaced `## Active Sprint Plan` body with 7 tasks for the head-to-head picker (3 backend / 4 frontend / 0 infra)
- scope: a single focused feature — pairwise comparison UI to help pick a round's nominee from research candidates. Source design: prototype C (Head-to-head compare) from `docs/prototype/`.
- depends graph: `h2h-schema` + `h2h-candidates` first (backend, parallel); `h2h-api` after both (backend); `h2h-card` independent (frontend, can start immediately — uses existing components); `h2h-page` after `h2h-card` + `h2h-api`; `h2h-queue` + `h2h-champion` after `h2h-page`.
- in parallel: user is clicking through sprint-2's deployed state and building a sprint-4 candidate list. Any sprint-2 bug surfaced during that pass should be triaged: blocking issues become hotfix tasks in sprint-3 (add to this plan); non-blocking polish goes into the sprint-4 list.
