---
last-touched: 2026-05-16
status: active
project: music-league-bot
sprint: sprint-5-round-state-model
sprint_status: planning
sprint_a_status: not-started
sprint_b1_status: not-started
sprint_b2_status: not-started
sprint_b3_status: not-started
sprint_b4_status: not-started
sprint_c1_status: not-started
sprint_c2_status: not-started
sprint_d1_status: not-started
tags:
  - music-league-bot
  - sprint-5
  - round-state
  - voting-workflow
  - tracking
related:
  - "[[sprint-5]]"
  - "[[../tests/sprint 2-3-results]]"
parent:
  - music-league-bot
---

# Sprint 5 — Round State Model + Voting Workflow

A walkthrough checklist for sprint-5 work on `music-league-bot`. Each
initiative is a collapsible callout. Tick checkboxes as you finish tasks;
the dashboard at the top reflects per-initiative status via metabind
frontmatter fields.

> [!abstract]- 📋 Sprint Dashboard
> | Initiative | Status | Task ID | Wave | Agent | Effort |
> | --- | :---: | :---: | :---: | --- | :---: |
> | **A.** Round status model | `VIEW[{sprint_a_status}]` | `round-status-model` | 1 | `backend` | M |
> | **B1.** Round edit API | `VIEW[{sprint_b1_status}]` | `round-edit-api` | 2 | `backend` | M |
> | **B2.** Playlist ingest | `VIEW[{sprint_b2_status}]` | `playlist-ingest` | 3 | `backend` | M |
> | **B3.** Round edit modal | `VIEW[{sprint_b3_status}]` | `round-edit-modal` | 3 | `frontend` | M |
> | **B4.** Round state display | `VIEW[{sprint_b4_status}]` | `round-state-display` | 2 | `frontend` | S |
> | **C1.** Anonymous ML rating | `VIEW[{sprint_c1_status}]` | `rate-anonymous-ml` | 2 | `frontend` | M |
> | **C2.** H2H rate + Spotify embed | `VIEW[{sprint_c2_status}]` | `h2h-rate-and-spotify` | 1 | `frontend` | M |
> | **D1.** Settings deadlines collapsible | `VIEW[{sprint_d1_status}]` | `settings-deadlines-collapsible` | 1 | `frontend` | S |
>
> **Overall sprint status:** `INPUT[inlineSelect(option(planning,"📝 Planning"),option(in-progress,"🟡 In progress"),option(blocked,"🚧 Blocked"),option(done,"✅ Done")):sprint_status]` `VIEW[{sprint_status}]`
>
> **Agent ownership at a glance:**
> - **`backend`** — A, B1, B2 (round status model, edit API, playlist ingest). Heaviest backend lift since sprint-1.
> - **`frontend`** — B3, B4, C1, C2, D1 (modal, state display, rating expansions, settings fix). 5 tasks.
> - **`infra`** — no own-lane tasks; available as `(as frontend, parallel)` load-balancing pool per sprint-1 review Q2 ratification.
>
> **Recommended dispatch order:**
> 1. **Wave 1** (no deps) — `backend` on `A`, `frontend` on `D1` (small, isolated win), `infra (as frontend)` on `C2` (h2h card component-only)
> 2. **Wave 2** (after A) — `backend` on `B1`, `frontend` on `B4` or `C1` (pick one), `infra (as frontend)` on the other of B4/C1
> 3. **Wave 3** (after B1) — `backend` on `B2`, `frontend` on `B3`

---

## TL;DR

**Goal:** make rounds, voting, and ratings reflect real-world state.
Today the app has no canonical sense of round phase, can't edit rounds,
can't rate during voting, and the sprint-4 settings layout left the
weights column padded with empty space.

**Why this sprint, why now:** the user is in four currently-active
leagues. None of them surface as active because the loader has no phase
model. Voting workflows are blocked. Settings layout needs to actually
solve the scroll problem. All of these unblock realistic daily use.

**Wave structure (parallelization):**

```
Wave 1 (3 starters, all parallel-safe):
  ┌─ A   round-status-model         ◀─── BACKEND FOUNDATION (gates 4 tasks)
  ├─ C2  h2h-rate-and-spotify
  └─ D1  settings-deadlines-collapsible

Wave 2 (3 tasks, after A lands):
  ┌─ B1  round-edit-api
  ├─ B4  round-state-display
  └─ C1  rate-anonymous-ml

Wave 3 (2 tasks, after B1 lands):
  ┌─ B2  playlist-ingest
  └─ B3  round-edit-modal
```

Backend handles A → B1 → B2 sequentially. Frontend handles the rest with
infra load-balancing one or two of them.

---

## Initiative A — Round status model `round-status-model`

> [!todo]- A. Round status model — full task list
> Status: `INPUT[inlineSelect(option(not-started,"⬜ Not started"),option(in-progress,"🟡 In progress"),option(blocked,"🚧 Blocked"),option(done,"✅ Done")):sprint_a_status]` `VIEW[{sprint_a_status}]`
>
> **Agent:** `backend` · **Task ID:** `round-status-model` · **Effort:** M (½–¾ day) · **Surface:** Backend / DB · **Deps:** none
>
> **Why it matters:** Gateway feature for B1, B4, C1, and (transitively) B3, B2. Without canonical phase derivation, every consumer (home loader, season loader, round page, rating UI) re-implements ad-hoc state logic and gets it wrong. With one helper module, phase becomes a derived field that every loader and every UI surface can trust. The user's 4 active leagues land in "Needs you this week" the moment this lands and propagates through B4.
>
> **Files touched:** `ui/src/lib/lifecycle.ts` (new), `ui/src/routes/+layout.server.ts`, `ui/src/routes/league/[league]/season/[n]/+page.server.ts`, `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.server.ts`, `ui/src/lib/types.ts`
>
> ### Helper module
>
> - [ ] Create `ui/src/lib/lifecycle.ts`
> - [ ] Export `getRoundPhase(round): 'upcoming' | 'submission' | 'voting' | 'archive'`
> - [ ] Logic per task body: `now` vs `submission_deadline` vs `voting_deadline`
> - [ ] Handle null deadlines (→ `upcoming`)
> - [ ] Export `seasonIsActive(season): boolean` — true if any round in season has phase ∈ {submission, voting}
>
> ### Loader integration
>
> - [ ] `+layout.server.ts` returns `phase` on every round in the leagues list
> - [ ] `getAllAdoptedLeagues()` league `status` driven by `seasonIsActive`
> - [ ] Season detail loader returns `phase` per round
> - [ ] Round detail loader returns `phase` on the focused round
>
> ### Types
>
> - [ ] Add `RoundPhase = 'upcoming' | 'submission' | 'voting' | 'archive'` to `ui/src/lib/types.ts`
> - [ ] Extend the existing `Round` type with `phase: RoundPhase`
>
> ### Verification
>
> - [ ] Vitest covers all four phase boundaries against fixture deadlines
> - [ ] `sqlite3 data/league.db` query confirms fam-jam s3 / hip-jammers s3 / second-best s1 / nostalgia-pit s1 each have at least one current-phase round (so they show as active leagues post-B4)
> - [ ] Home loader response shows correct phase on each round
>
> ### Definition-of-done
>
> - [ ] Commit hash recorded in coord-doc Activity Log
> - [ ] `[x]` flip in `docs/coordination/sprint-5.md` per sprint-1 ratification

---

## Initiative B1 — Round edit API `round-edit-api`

> [!todo]- B1. Round edit API — full task list
> Status: `INPUT[inlineSelect(option(not-started,"⬜ Not started"),option(blocked-on-a,"🚧 Blocked on A"),option(in-progress,"🟡 In progress"),option(done,"✅ Done")):sprint_b1_status]` `VIEW[{sprint_b1_status}]`
>
> **Agent:** `backend` · **Task ID:** `round-edit-api` · **Effort:** M · **Surface:** Backend / API · **Deps:** **A `round-status-model`**
>
> **Why it matters:** Without an edit endpoint, the user can't update round metadata (themes, deadlines) and can't attach a Spotify playlist URL to trigger anonymous song ingest during voting. Gates B2 (playlist-ingest depends on the PATCH route firing it) and B3 (round-edit-modal UI consumes this endpoint).
>
> **Files touched:** `ui/src/routes/api/rounds/[roundId]/+server.ts` (new), `ui/src/lib/db/schema.ts`, `ui/src/lib/db/rounds.ts` (or wherever rounds live), `ui/src/lib/types.ts`
>
> ### Schema change
>
> - [ ] Add `playlist_url TEXT` column to `rounds` table (nullable)
> - [ ] Update `CREATE TABLE IF NOT EXISTS` so fresh installs get the column
> - [ ] Document the change in coord-doc `## Contract Changes`
>
> ### PATCH endpoint
>
> - [ ] Create `ui/src/routes/api/rounds/[roundId]/+server.ts`
> - [ ] Accept partial body: `{ name?, theme?, submission_deadline?, voting_deadline?, playlist_url? }`
> - [ ] Validate: ISO date strings, `voting_deadline > submission_deadline` if both present, Spotify URL pattern on `playlist_url`
> - [ ] Update row, compute new `phase` via `getRoundPhase` helper from A
> - [ ] Return `{ ...updatedRow, phase }`
> - [ ] 404 on missing round, 400 on validation failure
>
> ### Playlist-ingest trigger
>
> - [ ] If `playlist_url` is set/changed AND new phase is `voting`, fire-and-forget call to `ingestPlaylist(roundId, playlistUrl)` from B2
> - [ ] Don't block the PATCH response on ingest completion
>
> ### Verification
>
> - [ ] `curl -X PATCH /api/rounds/97 -d '{"theme":"Test"}'` returns 200 with the row + phase
> - [ ] Invalid deadline ordering → 400
> - [ ] Non-existent round ID → 404
> - [ ] Vitest covers each path
>
> ### Definition-of-done
>
> - [ ] Commit hash recorded in coord-doc Activity Log
> - [ ] Contract Changes section in coord-doc updated
> - [ ] `[x]` flip per sprint-1 ratification

---

## Initiative B2 — Playlist ingest `playlist-ingest`

> [!todo]- B2. Playlist ingest — full task list
> Status: `INPUT[inlineSelect(option(not-started,"⬜ Not started"),option(blocked-on-b1,"🚧 Blocked on B1"),option(in-progress,"🟡 In progress"),option(done,"✅ Done")):sprint_b2_status]` `VIEW[{sprint_b2_status}]`
>
> **Agent:** `backend` · **Task ID:** `playlist-ingest` · **Effort:** M · **Surface:** Backend / Spotify integration · **Deps:** **B1 `round-edit-api`**
>
> **Why it matters:** During the voting phase of a Music League round, the songs are revealed but submitter identity isn't. The user wants to attach the round's published Spotify playlist URL so the ML tab on the round page shows the songs (anonymously) — and so the user can rate them during voting. This is the ingest path that makes that work.
>
> **Files touched:** `ui/src/lib/import/playlistIngest.ts` (new), `ui/src/lib/spotify.ts` (existing helpers from sprint-1)
>
> ### Ingest function
>
> - [ ] Create `ui/src/lib/import/playlistIngest.ts`
> - [ ] Export `ingestPlaylist(roundId: number, playlistUrl: string): Promise<{inserted: number, skipped: number}>`
> - [ ] Parse the playlist ID from the URL (Spotify URLs come in a few shapes)
> - [ ] Fetch tracks via existing `spotify.ts` helpers (auth handled there)
> - [ ] For each track: insert into `ml_submissions` with `competitor_id IS NULL`, `artist`, `title`, `spotify_uri`
> - [ ] Idempotent: skip rows where `(round_id, spotify_uri)` already exists
>
> ### Graceful no-op when Spotify isn't configured
>
> - [ ] If `SPOTIFY_CLIENT_ID` env var is empty/missing, log a warning and return `{inserted: 0, skipped: 0}` without throwing
> - [ ] The PATCH endpoint that fires this stays 200 — the API contract doesn't depend on Spotify being configured
>
> ### Wire-up
>
> - [ ] B1's PATCH endpoint imports `ingestPlaylist` and fires it when `playlist_url` is set + phase is `voting`
>
> ### Verification
>
> - [ ] Vitest mocks Spotify response, verifies ingest writes correct rows
> - [ ] Idempotency test: run ingest twice with the same playlist, second run inserts 0
> - [ ] End-to-end smoke against a real Music League round (the user can provide a real playlist URL): `curl -X PATCH /api/rounds/<id> -d '{"playlist_url":"https://open.spotify.com/playlist/..."}'` → wait a few seconds → `sqlite3 data/league.db "select count(*), count(competitor_id) from ml_submissions where round_id = <id>";` shows N rows / N nulls
>
> ### Definition-of-done
>
> - [ ] Commit hash recorded in coord-doc Activity Log
> - [ ] `[x]` flip per sprint-1 ratification

---

## Initiative B3 — Round edit modal `round-edit-modal`

> [!todo]- B3. Round edit modal — full task list
> Status: `INPUT[inlineSelect(option(not-started,"⬜ Not started"),option(blocked-on-b1,"🚧 Blocked on B1"),option(in-progress,"🟡 In progress"),option(done,"✅ Done")):sprint_b3_status]` `VIEW[{sprint_b3_status}]`
>
> **Agent:** `frontend` · **Task ID:** `round-edit-modal` · **Effort:** M · **Surface:** Frontend / round page · **Deps:** **B1 `round-edit-api`**
>
> **Why it matters:** This is the only user-facing surface for round metadata edits this sprint. League and season metadata editing is deferred to sprint-6+. Round metadata is the most common edit need (themes, deadlines, attaching the voting playlist) and ships first.
>
> **Files touched:** `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte`
>
> ### Edit trigger
>
> - [ ] Small wrench or pencil icon next to the round H1 in the page header
> - [ ] `aria-label="Edit round"` for a11y
> - [ ] Hover state in design system accent color
>
> ### Modal scaffolding (no library)
>
> - [ ] `{#if showEdit}<div role="dialog">…</div>{/if}` pattern
> - [ ] Backdrop with `bg-bg/70 backdrop-blur-sm` covering the page
> - [ ] Card panel centered, `bg-surface` + `border border-border-muted` + `rounded-xl` + `p-6`
> - [ ] Close on Esc
> - [ ] Close on backdrop click
>
> ### Form inputs
>
> - [ ] `<input>` for name
> - [ ] `<input>` for theme
> - [ ] `<input type="datetime-local">` for submission_deadline (pre-filled with current ISO value)
> - [ ] `<input type="datetime-local">` for voting_deadline
> - [ ] `<input type="url" placeholder="https://open.spotify.com/playlist/...">` for playlist_url
> - [ ] Save button (accent primary) + Cancel button (ghost)
>
> ### Save flow
>
> - [ ] On click Save → `fetch('/api/rounds/[id]', {method: 'PATCH', body: JSON.stringify(diff)})`
> - [ ] Diff: only include fields that changed
> - [ ] On 200: close modal + `invalidateAll()` to refresh page data
> - [ ] On 4xx/5xx: show inline error in modal, don't close
>
> ### Verification
>
> - [ ] Open modal, change theme, save → page header reflects new theme
> - [ ] Set a Spotify playlist URL during voting phase → ml_submissions row count grows (verifies B2 fires)
> - [ ] Esc + backdrop click both close the modal
> - [ ] svelte-check clean
> - [ ] Screenshot of modal open with fields populated
>
> ### Definition-of-done
>
> - [ ] Commit hash + Activity Log entry
> - [ ] `[x]` flip per sprint-1 ratification

---

## Initiative B4 — Round state display `round-state-display`

> [!todo]- B4. Round state display — full task list
> Status: `INPUT[inlineSelect(option(not-started,"⬜ Not started"),option(blocked-on-a,"🚧 Blocked on A"),option(in-progress,"🟡 In progress"),option(done,"✅ Done")):sprint_b4_status]` `VIEW[{sprint_b4_status}]`
>
> **Agent:** `frontend` · **Task ID:** `round-state-display` · **Effort:** S · **Surface:** Frontend / home + season + round pages · **Deps:** **A `round-status-model`**
>
> **Why it matters:** This is the most user-visible win in the sprint. The user's 4 active leagues currently don't surface as active. After this lands, they all show up in `Needs you this week` with correct phase chips on each current round.
>
> **Files touched:** `ui/src/routes/+page.svelte` (home), `ui/src/routes/league/[league]/season/[n]/+page.svelte`, `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte`
>
> ### Phase chip pattern
>
> - [ ] Phase → chip mapping consistent across all three surfaces:
>     - `upcoming` → `<StatusChip tone='muted'>UPCOMING</StatusChip>`
>     - `submission` → `<StatusChip tone='accent'>SUBMITTING</StatusChip>` + `<DeadlineChip phase='submissions' duration={remaining}>`
>     - `voting` → `<StatusChip tone='warn'>VOTING</StatusChip>` + `<DeadlineChip phase='voting' duration={remaining}>`
>     - `archive` → `<StatusChip tone='muted'>ARCHIVED</StatusChip>`
> - [ ] Replace any ad-hoc `if round.something then accent else muted` logic with the loader-supplied `phase`
>
> ### Home page
>
> - [ ] Active vs Archive section split driven by `seasonIsActive` from loader
> - [ ] Current-round phase chip on each league tile
> - [ ] Verify: fam-jam s3, hip-jammers s3, second-best s1, nostalgia-pit s1 all show in Needs you this week
>
> ### Season detail page
>
> - [ ] Each round in the list shows its phase chip
> - [ ] Current rounds sort to the top, archived below
>
> ### Round detail page
>
> - [ ] Round header shows the phase chip next to the H1
> - [ ] Tab visibility logic (sprint-3 h2h tab, sprint-4 ML tab behavior) keys off `phase` instead of ad-hoc deadline math
>
> ### Verification
>
> - [ ] Visit `/` → 4 expected active leagues all in Needs you this week
> - [ ] Visit `/league/fam-jam/season/3` → round 10 shows VOTING, earlier rounds ARCHIVED
> - [ ] svelte-check clean
> - [ ] Screenshot of home page with active leagues populated
>
> ### Definition-of-done
>
> - [ ] Commit hash + Activity Log entry
> - [ ] `[x]` flip per sprint-1 ratification

---

## Initiative C1 — Anonymous ML rating `rate-anonymous-ml`

> [!todo]- C1. Anonymous ML rating — full task list
> Status: `INPUT[inlineSelect(option(not-started,"⬜ Not started"),option(blocked-on-a,"🚧 Blocked on A"),option(in-progress,"🟡 In progress"),option(done,"✅ Done")):sprint_c1_status]` `VIEW[{sprint_c1_status}]`
>
> **Agent:** `frontend` · **Task ID:** `rate-anonymous-ml` · **Effort:** M · **Surface:** Frontend / round page ML tab · **Deps:** **A `round-status-model`**
>
> **Why it matters:** Today the only way to rate a song is via the Research tab — which means the user has to manually add it as a research candidate. During voting, songs come in via the Spotify playlist (B2 ingest) but are read-only in the ML tab. The user wants to rate songs *while voting is happening*, then those ratings carry into the h2h picker once voting closes. **Blue dots** visually mark voting-phase ratings (vs archive-phase orange) so the user can tell at a glance which scoring epoch a rating is from.
>
> **Files touched:** `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte` (ML tab markup), possibly `ui/src/lib/components/RatingEditor.svelte` (extract if reusable)
>
> ### ML tab voting-phase mode
>
> - [ ] Detect `round.phase === 'voting'` and enable the rating editor
> - [ ] Each anonymous song row clickable → expands an inline rating panel below the row
> - [ ] Panel: 4 rating dimensions × 5-dot rows + a Save button
> - [ ] Save → upsert via `PUT /api/research/[roundId]` keyed by `(round_id, spotify_uri)` (the API may need to accept an upsert mode — coordinate with backend if it doesn't already)
>
> ### Visual differentiator: blue dots
>
> - [ ] Dots in the ML-tab rating editor render in blue (vs Research tab's orange)
> - [ ] Tailwind: try `bg-info` first; if no such token, add an inline style or file a Blocker asking infra to add `--color-blue-rating` to the design tokens
> - [ ] Once the round phase is `archive` (voting closed), the ML tab can show the ratings *too*, but in orange — the rating epoch is over and the rating dots match the standard system everywhere else
>
> ### After-the-fact rating
>
> - [ ] If the user rated a song during voting and the round is now archived, the rating data is preserved — `research_songs` is the source of truth and doesn't care which UI surface wrote it
>
> ### Verification
>
> - [ ] Visit fam-jam s3 round 10 (voting) → ML tab → click a song → rate it → save → `sqlite3 data/league.db "select * from research_songs where round_id = X order by created_at desc limit 1";` shows the new row
> - [ ] Dots render blue during voting phase
> - [ ] Switch to an archive-phase round → ML tab shows ratings but in orange
> - [ ] svelte-check clean
> - [ ] Screenshot of voting-phase ML tab with one rated song
>
> ### Definition-of-done
>
> - [ ] Commit hash + Activity Log entry
> - [ ] `[x]` flip per sprint-1 ratification

---

## Initiative C2 — H2H rate + Spotify embed `h2h-rate-and-spotify`

> [!todo]- C2. H2H rate + Spotify embed — full task list
> Status: `INPUT[inlineSelect(option(not-started,"⬜ Not started"),option(in-progress,"🟡 In progress"),option(blocked,"🚧 Blocked"),option(done,"✅ Done")):sprint_c2_status]` `VIEW[{sprint_c2_status}]`
>
> **Agent:** `frontend` · **Task ID:** `h2h-rate-and-spotify` · **Effort:** M · **Surface:** Frontend / `HeadToHeadCard` component · **Deps:** none (h2h plumbing from sprint-3 already exists)
>
> **Why it matters:** User feedback: "need to be able to rate songs after they get to the head-to-head screen — as I forgot to once and then I couldn't do it after they were there." Solves that. Plus the Spotify embed gives the user a play button right on the card so they can A/B the two songs without bouncing to another app.
>
> **Files touched:** `ui/src/lib/components/HeadToHeadCard.svelte` only
>
> ### Inline rating editor
>
> - [ ] Compact rating block: 4 dimensions × 5 dots, no notes field
> - [ ] Click a dot → updates the rating in the underlying `research_songs` row via `PUT /api/research/[roundId]`
> - [ ] Weighted score on the card recomputes after save
> - [ ] Dots render in orange (this is post-voting, archive-phase rating)
>
> ### Spotify embed
>
> - [ ] Play button: clickable element styled in the design system, `aria-label="Play preview"`
> - [ ] On click → reveal a `<details>` or toggleable panel showing `<iframe src="https://open.spotify.com/embed/track/{trackId}?utm_source=oembed">` with `width=100%` and `height=80` (compact Spotify embed)
> - [ ] Lazy load: iframe only inserts into the DOM after the user clicks Play (don't auto-load all embeds when the page renders)
> - [ ] If the song has no `spotify_uri`, show the Play button disabled with `<title>No Spotify URI on this song</title>`
>
> ### Verification
>
> - [ ] Open Head-to-Head tab on a populated round → both cards show rating dots
> - [ ] Click a dot → rating persists (verify in DB)
> - [ ] Weighted score on card updates
> - [ ] Click Play → Spotify embed loads + plays the preview
> - [ ] svelte-check clean
> - [ ] Screenshot of h2h cards with rating editors visible + one embed open
>
> ### Definition-of-done
>
> - [ ] Commit hash + Activity Log entry
> - [ ] `[x]` flip per sprint-1 ratification

---

## Initiative D1 — Settings deadlines collapsible `settings-deadlines-collapsible`

> [!todo]- D1. Settings deadlines collapsible — full task list
> Status: `INPUT[inlineSelect(option(not-started,"⬜ Not started"),option(in-progress,"🟡 In progress"),option(blocked,"🚧 Blocked"),option(done,"✅ Done")):sprint_d1_status]` `VIEW[{sprint_d1_status}]`
>
> **Agent:** `frontend` · **Task ID:** `settings-deadlines-collapsible` · **Effort:** S · **Surface:** Frontend / `/settings` · **Deps:** none
>
> **Why it matters:** Sprint-4's two-column layout half-solved the scroll problem. User feedback: "the panel on the left — rating weights — is just filled with empty space so that it is as big as the big list — please make it so the long list is at the bottom and collapsible." This delivers the actual user intent: weights and import/queue/auto-fill in two natural-height columns at top; deadlines big-list collapsible at the bottom.
>
> **Files touched:** `ui/src/routes/settings/+page.svelte` only
>
> ### Layout restructure
>
> - [ ] Pull the `Round deadlines` card out of the two-column grid
> - [ ] Two-column grid above contains only: weights (left) + import + queue + auto-fill (right)
> - [ ] Remove any `align-items: stretch` or grid template that forces equal column heights
> - [ ] Below the two-column grid: full-width `<details>` element
>
> ### Collapsible deadlines
>
> - [ ] `<details>` default closed (no `open` attribute)
> - [ ] `<summary>` shows a clickable header: `<SectionLabel>ROUND DEADLINES · CLICK TO EXPAND</SectionLabel>` plus a caret/chevron
> - [ ] Inside `<details>`: the existing deadlines table/list, unchanged behavior
>
> ### Verification
>
> - [ ] Desktop view: weights column ends at its natural height (no empty space below sliders)
> - [ ] Right column ends at its natural height (no padding to match)
> - [ ] Deadlines collapsed by default; click expands
> - [ ] Mobile view: still stacks vertically
> - [ ] svelte-check clean
> - [ ] Screenshot: desktop view collapsed + desktop view expanded
>
> ### Definition-of-done
>
> - [ ] Commit hash + Activity Log entry
> - [ ] `[x]` flip per sprint-1 ratification

---

## What this sprint does NOT include

To keep sprint-5 shippable in a few sessions and avoid scope creep, the
following items from prior feedback are deferred to **sprint-6** (or
later) even though they came up in the feedback file:

- **BIG LIST overview** — landing page section showing all songs across all
  participated leagues as a unified Spotify playlist (+ YouTube if
  convertible). Big feature; sprint-6 candidate.
- **Email ingestion via n8n** — live submission/vote counts from Music
  League notification emails. Needs n8n integration setup.
- **Manual submit/vote entry** — manual "I submitted" / "I voted" path
  since Music League doesn't notify users about their own actions.
  Depends on broader tracking schema decisions.
- **Historical card fun facts** — total songs, players, genre breakdown,
  "biggest procrastinator," rotating fun facts on archive cards. Needs
  new aggregation queries.
- **League / season metadata CRUD** — sprint-5 only does round edits.
  League and season editing modals deferred.
- **Standings data** — `My place: —` and `Finished: —/N` placeholders
  ship in sprint-4 cards; the actual standings query needs
  `MY_COMPETITOR_ID` wiring + a standings aggregation.

All of these stay in the coord-doc `## Deferred to sprint-5+` section of
`docs/coordination/sprint-4.md` until promoted into a future sprint.

---

## How to use this doc

1. **Per task:** click the checkbox in editing view; Obsidian persists
   the `[x]` state. Agents working in the repo flip checkboxes in
   `docs/coordination/sprint-5.md` (the canonical coord-doc); the two
   files are intentionally not auto-synced (one is the warren contract,
   the other is the planning narrative).
2. **Per initiative:** click the status `INPUT[inlineSelect(...)]` to
   advance through `not-started → in-progress → done`. The dashboard
   table at the top reflects the new state via metabind VIEW expressions.
3. **At sprint completion:** flip `sprint_status` to `done`, update
   `shipped_tasks` / `deferred_tasks` in frontmatter, set `closed` to
   the completion timestamp. Archive by moving to
   `docs/tracking/done/sprint-5-tracking.md` or renaming with an
   `archived-` prefix.
4. **Adding tasks mid-sprint:** add `- [ ] <task>` under the relevant
   initiative; if it's a meaningful sub-deliverable, also add it to
   `docs/coordination/sprint-5.md`'s `## Active Sprint Plan` so the
   warren parser sees it.

---

## Cross-references

- Canonical coord-doc: `docs/coordination/sprint-5.md` (warren-parsed)
- Planning narrative: [[sprint-5]] (`docs/planning/sprint-5.md`)
- Source feedback: [[../tests/sprint 2-3-results]] (manual testing notes from sprint-4 deploy)
- Sprint-4 deferred items: `docs/coordination/sprint-4.md` `## Deferred to sprint-5+`
- HLD: [[../HIGH_LEVEL_DESIGN]]

---

*Created 2026-05-16. Update `last-touched` in frontmatter as you work.*
