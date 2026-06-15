---
project: music-league-bot
sprint: sprint-33
campaign: the-b-side
title: the b-side — Operator Content screen
status: closed
created: 2026-06-15T06:20:00Z
activated: 2026-06-15
updated: 2026-06-15T06:25:00Z
---

# music-league-bot — coordination doc (sprint-33)

> **Campaign `the-b-side`, sprint 3 of 3 — the final one.** Gives the operator a
> UI to publish + update each league's b-side, replacing the orc-curl path. The
> sidebar's **Digest** item becomes **Content**, split into two tabs: **Digest**
> (the existing generate→refine→finalize pipeline, unchanged) and **Archive**
> (manage each league's b-side — first publish, or add a finalized round with a
> per-section refresh/hold/lock update modal, always on the same slug, then a
> reshare card). Claude Design's handoff `docs/design/content/`
> (IMPLEMENTATION-PROMPT.md, the `.jsx` reference, `ml-content-styles.css`, the
> `Music League Bot - Content Screen.html` 4-artboard target) is the spec — port
> it. Schema (`dashboard_sites`, `dashboard_section_state`) + `publishSite` + the
> read-model generator already exist (sprints 31/32).

## Sprint Goals

- Publish + update the b-side from the operator UI
  Content tabs, the archive list, a refresh/hold/lock update modal, and a reshare card.

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | `/api/content/*` routes, the incremental update logic (`$lib/dashboard/*`), `$lib/db/*` | Svelte components, page routes |
| frontend | the Content screen — Svelte components + routes (operator app), hands-on verification | DB, the update logic, API internals |
| orc | sprint gate: cross-check, version + CHANGELOG, ratification card, deploy, prod walk, context resets | project code |

## Working agreements (sprint-33)

- **The handoff IS the spec.** `docs/design/content/IMPLEMENTATION-PROMPT.md` + `ml-content.jsx` +
  `ml-content-styles.css` + the `Music League Bot - Content Screen.html` 4-artboard target. Port
  `.jsx` → Svelte; lift `ml-content-styles.css` wholesale (Mash tokens only).
- **Reuse, don't rebuild:** the Digest tab IS the existing digest pipeline (just wrapped in the new
  tab chrome — don't rebuild it). `publishSite` (sprint-31) handles first publish; the update flow
  reuses `buildReadModel` **section-wise** + persists per-section decisions in `dashboard_section_state`.
- **Same slug, all season:** an archive update rewrites the read-model IN PLACE on the existing slug —
  never mint a new slug on update (only on first publish or a deliberate rotation). Don't auto-refresh
  `lock`ed sections; don't regenerate the whole archive every round (add the one entry, recompute only
  `refresh` sections). Don't leak operator chrome (🔒/↻/✓ glyphs, the modal) into the public b-side.
- The reshare "Send to WhatsApp" uses the **existing WhatsApp bridge** (don't add a new one).
- Hands-on means hands-on: this is an **operator** screen → verify on the operator app
  (`npm run dev`, 5173, NEVER 4444) primarily at desktop (1280) + a mobile pass; the gate walks the
  live screen on `mlbot2.mattmariani.com` and the happy path (finalize → badge → update → published).
- Mid-task context discipline: past ~60-70% context, write a handoff and request a reset from orc.
- No prod deploy except by orc at the gate.

## Active Sprint Plan

<!-- Task syntax (parser contract):
     - [ ] {agent: <roster>, id: <slug>, depends: <id,id>} Body
       - **Acceptance:** verifiable check.
     Status marks: [ ] pending · [-] in-progress · [x] done · [!] blocked.
     `agent:` must match the Agent Roster. `depends:` is one comma-separated key. -->

- [x] {agent: backend, id: content-api} **Content API — leagues, update-plan, update, reshare** (handoff §8, §9). Add to `/api/content/*` (following the existing `:leagueId/publish` route): `GET /api/content/leagues` (one row per league + b-side state — published?/slug, members, rounds archived, last updated, and the pending-update flag = a finalized digest whose round_id ∉ `dashboard_sites.archived_rounds`); `GET /api/content/:leagueId/update-plan` (the "add this round" entry + the recompute sections each with a concrete-change detail); `POST /api/content/:leagueId/update` (body `{decisions:{section:'refresh'|'hold'|'lock'}, steer, announce}` → recompute only `refresh` sections via `buildReadModel` section-wise, persist decisions in `dashboard_section_state`, rewrite `read_model` + add the round to `archived_rounds` IN PLACE on the same slug, re-write public artifacts); `POST /api/content/:leagueId/reshare` (body `{mode:'card'|'link'|'silent'}` → produce the announcement; `card`/`link` via the existing WhatsApp bridge / copy payload, `silent` no-op).
  - **Acceptance:** `GET /api/content/leagues` returns the 4 leagues with correct state flags (Fam-Jam = published, pending flag accurate); `update` with `{superlatives:'lock'}` leaves that section unchanged on re-publish while `refresh` sections regenerate; `archived_rounds` gains the round; slug unchanged; `dashboard_section_state` persists `lock`; route tests green; `npm run check` 0 errors.

- [x] {agent: frontend, id: content-nav} **Sidebar Digest → Content + the two-tab chrome** (handoff §2, §3). Rename the sidebar `digest` item to **Content** (`/content`, keep a redirect from `/digest`), with a count badge (`.ml-nav-badge`) = number of leagues with a pending archive update. Add the Mash header-tab idiom (`.ct-tabs`/`.ct-tab`): **Digest** tab = the existing pipeline screen, UNCHANGED (just wrapped); **Archive** tab = the new surface (built in the next tasks) with a `.ct-count` badge. Lift `ml-content-styles.css`.
  - **Acceptance:** sidebar shows "Content" with a pending-count badge; `/digest` redirects to `/content`; the Digest tab renders the existing pipeline unchanged; the Archive tab mounts (placeholder ok this task); verified hands-on on dev at 1280 + mobile; `npm run check` 0 errors.

- [x] {agent: frontend, id: archive-list, depends: content-nav,content-api} **Archive tab — league list + first publish + reshare state** (handoff §4, §6, §7). The Archive tab league list (`.ct-league`, one row per league) with the three states — **update-ready** (pulp row, "N update ready" pill, "Update archive →"), **up-to-date** (moss "✓ up to date"), **not-published** (dashed row, "Publish b-side →"). Each row: emblem, name, season, the b-side URL w/ lock glyph, meta (members · rounds archived · last updated). First-publish action calls `POST /api/content/:leagueId/publish`. The published/reshare state (`.ct-published` banner + `.ct-reshare-card`) with `↗ Send to WhatsApp` / `⧉ Copy share card` / `⧉ Copy link`, honoring the Announce config. Data from `GET /api/content/leagues`.
  - **Acceptance:** the list renders all 4 leagues in the correct state from the API; "Publish b-side →" on an unpublished league mints the slug + shows the published/reshare state; the reshare card shows the URL + actions; verified hands-on on dev at 1280 + mobile; `npm run check` 0 errors.

- [x] {agent: frontend, id: update-modal, depends: archive-list} **Archive-update modal — refresh / hold / lock + steer** (handoff §5). The update modal (reuse the digest `.dg-modal` shell), opened from "Update archive →": header "Update b-side · {league}", the required "New archive entry" row + the recompute rows (superlatives, stats·KPIs, fingerprints, moments, overlap), each with the `.ct-seg` refresh/hold/lock control + a per-row note/detail; steerable rows expose "↻ steer this rewrite" (the quick-steer chips + free-text idiom); the config strip (Announce: card/link/silent + the locked same-slug line); footer cost estimate + "Generate update →" → `POST /api/content/:leagueId/update` → closes to the published/reshare state. Loads the plan from `GET /api/content/:leagueId/update-plan`.
  - **Acceptance:** the modal opens with the add-entry + recompute rows from the update-plan; each row's refresh/hold/lock toggles; a steerable row opens the steer chips; "Generate update →" calls the update endpoint and flips to the published state; the same-slug line is shown locked; verified hands-on on dev at 1280; `npm run check` 0 errors.

- [x] {agent: orc, id: gate-close, depends: content-api,content-nav,archive-list,update-modal} **Gate — cross-check, ship, walk the operator flow, close.** Orc runs the gate: cross-check all lanes, `npm run check` + `npx vitest run`, version bump + CHANGELOG, ratification card, build + deploy, then walk the LIVE Content screen on `mlbot2.mattmariani.com`: the two tabs, the Archive list states, a first-publish (or an update on Fam-Jam) → published/reshare, and confirm the public b-side reflects the change on the same slug. Panes reset, doc closed. This **completes the campaign** — note the campaign close in the doc.
  - **Acceptance:** all worker tasks `[x]`; 0 typecheck errors + vitest green; v-bump + CHANGELOG committed; ratification card emitted + ratified; the live Content screen works (tabs, archive states, publish/update → reshare, same-slug guarantee holds, public site reflects the update); 0 console errors; doc `status: closed`; campaign `the-b-side` complete.

## Decision Log

### 2026-06-15 — Campaign `the-b-side` sprint 3 = operator Content screen (owner)
The final campaign sprint. Gives the operator a UI to publish/update the b-side (replacing orc
curl). Schema + publishSite + read-model generator already exist (sprints 31/32); this adds the
Content tabs, archive management, the refresh/hold/lock update flow, and reshare. Handoff:
docs/design/content/. After this, a separate b-side content-polish sprint (backlog) tunes the
generated content per owner's tweaks.

## Ratification Log

### 2026-06-15 — Campaign `the-b-side` RATIFIED + closed (owner)
- Owner ran a full segment-by-segment UAT of the public site + operator screen
  (`wiki/Projects/music-league-bot/sessions/testing/2026-06-15-the-b-side-campaign-review.md`).
  Verdict: **overall `ship`, `ratify`**. All 20 segments rated; the three "content off"
  ratings (moments, latest-round teaser, voice) explicitly flagged as **non-blocking polish**,
  not release blockers.
- Gate verification: `npm run check` 0 errors, `npx vitest run` 485/485, live walk on
  mlbot2.mattmariani.com (tabs, 4-league archive states, update modal w/ live plan, Digest
  tab unchanged), 0 console errors. Shipped v1.1.1 (CHANGELOG updated, deployed).
- Campaign `the-b-side` (sprints 31→32→33) is **complete**. Follow-on: a dedicated
  **the-b-side-polish** campaign captures all UAT polish notes (see roadmap.md).

## Blockers

_None._

## Activity Log

### 2026-06-15 — orc — GATE CLOSED · campaign `the-b-side` complete
- Cross-check: all 4 worker tasks `[x]`. Verification: `npm run check` 0 errors,
  `npx vitest run` 485/485 (50 files). v1.1.1 + CHANGELOG + repo hygiene committed (00204ab);
  `bot-ui` rebuilt + deployed; prod serving v1.1.1 on :3002.
- Live walk on mlbot2.mattmariani.com/content: Content nav + two tabs, Archive list 4-league
  states (Fam-Jam published "1 update ready"; HJ/SB/NP not-published), update modal loaded the
  live update-plan with refresh/hold/lock + steer, Digest tab unchanged. 0 console errors.
- Owner UAT ratified (`ship`/`ratify`) — see Ratification Log. Polish notes routed to the new
  `the-b-side-polish` campaign + roadmap cards. Sprint status → closed.

### 2026-06-15 — frontend — update-modal complete (7840280)
- UpdateModal.svelte: fetches GET /api/content/:leagueId/update-plan on open
- Renders "New archive entry" add row + 5 recompute rows (superlatives, stats·KPIs,
  fingerprints, moments, overlap) each with .ct-seg refresh/hold/lock segmented control
- Steerable rows (superlatives, fingerprints, moments) expose inline steer panel:
  ARCHIVE_STEER_CHIPS + free-text textarea, activated by "↻ steer this rewrite" button
- Config strip: Announce card/link/silent + locked 🔒 same-slug line (never editable)
- Footer: N-sections-refresh cost estimate + Generate update → button
- Generate POSTs /api/content/:leagueId/update; on success calls onPublished → flips
  archive-list to ct-published banner + ct-reshare-card
- +page.svelte: openUpdateStub replaced with openUpdate + handlePublished;
  UpdateModal mounted on updateLeague state
- 0 typecheck errors; verified hands-on at 192.168.4.217:5179 (modal opens, rows correct,
  refresh/hold/lock toggles, steer chips expand, slug locked, Generate → published state)

### 2026-06-15 — backend — content-api complete (702b974)
- GET /api/content/leagues: all leagues + bside state + pending flag (finalized digest ∉ archived_rounds)
- GET /api/content/:leagueId/update-plan: entry row + 5 recompute sections with concrete details
- POST /api/content/:leagueId/update: section-wise refresh/hold/lock, archived_rounds updated in place,
  dashboard_section_state persists decisions, same slug guaranteed, writePublicArtifacts called
- POST /api/content/:leagueId/reshare: card/link/silent announce payload from latest archive entry
- publish.ts: exported writePublicArtifacts, round-ID–based archived_rounds tracking
- 16 route tests (server.test.ts); 485/485 full suite green; 0 typecheck errors; no deploy

### 2026-06-15 — orc — Sprint-33 ACTIVATED · content-api + content-nav dispatched (Wave 1)
- status planned → active; dispatched the two no-dep tasks in parallel — content-api to backend (%55), content-nav to frontend (%56). File-disjoint. Both `[-]`.
- archive-list opens after content-nav + content-api; update-modal after archive-list; gate closes the CAMPAIGN.

### 2026-06-15 — frontend — archive-list complete (da5fb67)
- Page server loads leagues via internal fetch to GET /api/content/leagues
- ContentLeague type exported from +page.server.ts; data.leagues flows into $state
- League rows: 3 states (update-ready/up-to-date/not-published) with emblem, name,
  season pill, b-side URL + lock glyph, meta (members · rounds archived · last updated)
- Emblem colors: 4-color oklch palette by index (no hardcoded hex)
- First-publish: POST /publish → POST /reshare → flips Archive tab to ct-published banner
  + ct-reshare-card (round, theme, blurb, URL); ↗ Send to WhatsApp via wa.me deep link;
  ⧉ Copy share card / ⧉ Copy link via navigator.clipboard
- "Update archive →" wired as stub function for update-modal task
- 0 typecheck errors; verified at 192.168.4.217:5178 (4 leagues, correct states:
  Fam-Jam=update-ready, 3 others=not-published); mobile pass checked

### 2026-06-15 — frontend — content-nav complete (d13d412)
- Sidebar Digest→Content (/content), .ml-nav-badge = getContentPendingCount from layout server
- /digest redirects to /content; /digest/[roundId] pages unchanged except tab chrome added at top
- New /content route: .ct-tabs/.ct-tab chrome, Archive tab (placeholder), Digest tab links to /digest/:roundId
- ml-content-styles.css lifted → ui/src/lib/content/content.css; isCurrent matches /content + /digest/*
- 0 typecheck errors; verified at 192.168.4.217:5177 (1280 + mobile); no deploy
- archive-list can start once content-api also lands (both deps satisfied)

### 2026-06-15 — docs — Sprint plan authored: the b-side operator Content screen (campaign sprint 3, final)
- created sprint-33 coord-doc; `## Active Sprint Plan` body has 5 tasks
- 1 backend (content-api) / 3 frontend (content-nav → archive-list → update-modal) / 1 orc gate
- deps: archive-list ← content-nav + content-api; update-modal ← archive-list; gate ← all
- content-api ∥ content-nav (parallel start); the operator-screen frontend tasks chain (same area)
- UI spec = docs/design/content/ handoff; reuses dashboard_sites/section_state + buildReadModel (section-wise)
- closes the campaign on gate; content-polish is a separate post-campaign sprint (backlog)
- status `planned` — kickoff (first dispatch) is confirmation-gated; awaiting owner "go"
