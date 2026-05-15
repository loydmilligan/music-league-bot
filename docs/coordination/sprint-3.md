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

- [ ] {agent: backend, id: h2h-schema} Add `head_to_head_matches` table to `ui/src/lib/db/schema.ts` — columns `(id INTEGER PRIMARY KEY, round_id INTEGER NOT NULL, winner_id INTEGER NOT NULL, loser_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (winner_id) REFERENCES research_songs(id), FOREIGN KEY (loser_id) REFERENCES research_songs(id))` + index on `(round_id, created_at)`. Apply via the existing `CREATE TABLE IF NOT EXISTS` startup path in `client.ts` so dev + docker pick it up automatically (no separate migration runner needed at this scale). Add a vitest exercising insert + foreign-key constraint behavior.
  - **Acceptance:** `cd ui && npm run dev` (or restart docker) — `sqlite3 data/league.db ".schema head_to_head_matches"` shows the table; vitest passes (1+ test for insert; 1+ test confirming FK violation when winner_id or loser_id doesn't exist in research_songs); the test fixture cleans up after itself.

- [ ] {agent: backend, id: h2h-candidates} Add `getH2HCandidates(roundId)` in `ui/src/lib/db/research.ts` (or new `ui/src/lib/db/headToHead.ts` — your call). Returns research_songs eligible for head-to-head: anything from that round whose status indicates active consideration (define this — proposed: `themeFit >= 3` OR a dedicated `status='reviewing'`/`'shortlist'` field if you decide to add one). If the research_songs table doesn't have a status column yet, add `status TEXT NOT NULL DEFAULT 'reviewing'` to the schema in this same task (research candidates default to in-the-running). Returns `{ id, artist, title, themeFit, discoveryPotential, nostalgiaPotential, personalRating, notes, spotifyUri, ytmUrl, weightedScore }[]`. Sort by `weightedScore` desc so the highest-rated candidate naturally becomes the initial champion.
  - **Acceptance:** vitest exercises `getH2HCandidates(roundId)` against a fixture with 5+ research_songs of varying ratings — returns them sorted by weighted score desc, excludes any with status not eligible; weightedScore reflects the user's current settings weights (use the same `computeScore` from `ui/src/lib/scoring.ts`).

- [ ] {agent: backend, id: h2h-api, depends: h2h-schema, h2h-candidates} Add two API routes:
  - `POST /api/h2h/match` in `ui/src/routes/api/h2h/match/+server.ts` — body `{ roundId, winnerId, loserId }`, inserts a row in `head_to_head_matches`, returns the inserted row plus the updated state (see below). Validates both IDs belong to the same round and to `research_songs`.
  - `GET /api/h2h/state/[roundId]` in `ui/src/routes/api/h2h/state/[roundId]/+server.ts` — returns `{ candidates: H2HCandidate[], matches: H2HMatch[], champion: H2HCandidate | null, challenger: H2HCandidate | null, queue: H2HCandidate[], retired: H2HCandidate[], isComplete: boolean }`. Logic: champion is the candidate with the most wins among recent matches (default to highest weighted score on cold start); challenger is the next un-played candidate from the queue; queue is the remaining un-played candidates sorted by weighted score desc; retired is anyone who's lost a match; isComplete when queue is empty.
  - Reuse the existing `getDb()` pattern; export the H2HCandidate/H2HMatch types from `ui/src/lib/types.ts`.
  - **Acceptance:** `curl -X POST http://localhost:5174/api/h2h/match -H 'content-type: application/json' -d '{"roundId":97,"winnerId":X,"loserId":Y}'` returns the new row + state; `curl http://localhost:5174/api/h2h/state/97` returns the structured state; vitest covers both endpoints including the FK-violation error path; if both IDs match the same research_song, the API returns 400.

- [ ] {agent: frontend, id: h2h-card} Build `ui/src/lib/components/HeadToHeadCard.svelte` matching prototype C's two-card layout asymmetry. Props: `song: H2HCandidate`, `role: 'holding-lane' | 'challenger'`, `onPick: () => void`. **Holding-lane variant:** dark card (`bg-bg-elevated` or even darker `bg-bg`), prominent `<SectionLabel>` reading `HOLDING LANE`, big bold artist+title, mono dim metadata line (`themeFit / discoveryPotential / nostalgia / personal`) using dot rows, a description/notes block. **Challenger variant:** lighter card (`bg-surface` or a warm-cream tint if you can derive one from existing tokens), `<SectionLabel>` reading `CHALLENGER`, same content treatment but visually less-anointed. Both cards have a `<button>Pick winner</button>` styled with the design system accent button. The asymmetry is doing real cognitive work — visually nudges the user to think "do you really want to dethrone the holding lane?"
  - **Acceptance:** Showcase the component on `/_examples` with two fixture songs (one as holding-lane, one as challenger) — visually consistent with prototype C's H2H block. Hover state on the Pick winner button works. `svelte-check` clean.

- [ ] {agent: frontend, id: h2h-page, depends: h2h-card, h2h-api} Add a new `Head-to-Head` tab to the round page (`ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte`) as a sibling to ML / Chat / Research. The tab content: fetches `GET /api/h2h/state/[roundId]` on mount, renders the two `<HeadToHeadCard>` instances side-by-side (HoldingLane on left, Challenger on right) with the `onPick` handlers wired to `POST /api/h2h/match` and then refetches state. Empty state if `candidates.length < 2`: show a friendly message ("Need at least two research candidates with themeFit ≥ 3 to start head-to-head. Visit the Research tab to add some.").
  - **Acceptance:** Visit `/league/second-best/season/1/round/97` → click `Head-to-Head` tab → if there are ≥2 candidates, two cards render and clicking Pick winner records a match + advances to the next challenger; if not, the empty state shows; tab styling matches the existing ML/Chat/Research tabs from sprint-2. `svelte-check` clean.

- [ ] {agent: frontend, id: h2h-queue, depends: h2h-page} Under the two cards, render a "Up next · {N} songs to compare" list matching prototype C's bottom queue (numbered list, mono artist+title, optional rating dots, deadline-ish metadata). Show retired candidates in a separate "Retired" section below the queue (dimmer styling), in the order they lost. Both lists update reactively after each match.
  - **Acceptance:** After picking 1 winner, the queue list shows N-1 challengers remaining and the retired list shows 1 song; visually consistent with prototype C's queue treatment; mono fonts + dot scoring throughout.

- [ ] {agent: frontend, id: h2h-champion, depends: h2h-page} When `state.isComplete` is true (queue empty), show a winner banner above the cards: orange accent panel with `<StatusChip tone='accent'>WINNER</StatusChip>`, big bold artist+title of the surviving champion, a one-line "Survived N matches" stat, and a `<button>Reset and pick again</button>` button. Reset clears the round's matches (call `DELETE /api/h2h/state/[roundId]` — coordinate the new endpoint shape with backend if needed; if simpler, just call `POST /api/h2h/match` with a `reset: true` flag — your call, but file a Blocker if you need backend to add the reset endpoint).
  - **Acceptance:** After all matches are recorded, the winner banner renders with the champion's metadata; clicking Reset and pick again clears the matches and returns the view to a fresh head-to-head; if reset requires a new backend endpoint, file a Blocker first and ship the rest of this task.

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

_New types `H2HMatch` and `H2HCandidate` will be added to `ui/src/lib/types.ts` by h2h-api — that's a contract change worth noting here when it lands, so future sprint agents reference these types instead of redefining them._

## Blockers

- _None._

## Activity Log

### 2026-05-15 — docs — Sprint plan refresh: head-to-head picker
- replaced `## Active Sprint Plan` body with 7 tasks for the head-to-head picker (3 backend / 4 frontend / 0 infra)
- scope: a single focused feature — pairwise comparison UI to help pick a round's nominee from research candidates. Source design: prototype C (Head-to-head compare) from `docs/prototype/`.
- depends graph: `h2h-schema` + `h2h-candidates` first (backend, parallel); `h2h-api` after both (backend); `h2h-card` independent (frontend, can start immediately — uses existing components); `h2h-page` after `h2h-card` + `h2h-api`; `h2h-queue` + `h2h-champion` after `h2h-page`.
- in parallel: user is clicking through sprint-2's deployed state and building a sprint-4 candidate list. Any sprint-2 bug surfaced during that pass should be triaged: blocking issues become hotfix tasks in sprint-3 (add to this plan); non-blocking polish goes into the sprint-4 list.
