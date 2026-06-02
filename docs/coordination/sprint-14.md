---
project: music-league-bot
sprint: sprint-14-digest-improvements
created: 2026-06-02T23:05:57Z
updated: 2026-06-02T23:05:57Z
status: active
---

# music-league-bot — coordination doc (sprint-14-digest-improvements)

> **Feature sprint — digest quality + workflow.** Three threads: (1) **accuracy**
> — fix the generation prompt (ML rules + round order) so the LLM stops making
> impossible claims; (2) **control** — a per-section generate modal (style /
> context / paste-chat / layout variant), unfinalize, and a working inline edit;
> (3) **visuals + truth** — album-art podium, a season-standings-with-round-impact
> chart backed by a human-verified standings table, and crisp PDF / per-section
> PNG output.
>
> **Roster is 3 agents this sprint** (viz added). Lanes are by *feature area*, not
> file type, to keep two UI agents from colliding: **backend** = the brains (LLM
> prompt, generation, standings math + DB); **frontend** = the digest workflow
> chrome (modal, variant system, export, unfinalize, inline-edit); **viz** = the
> visual components (podium, standings chart, standings-table UI, reconcile modal).
>
> **Shared contracts (write once, both sides build to these):**
> - **Generation params** (modal → backend draft): `{ sections: [{id, enabled,
>   style: string[], variant: 'textual'|'visual'|'both', context: string}],
>   pastedChat: string }`.
> - **Standings payload** (backend → viz): per user `{ name, rank, prevRank,
>   priorTotal, roundPoints, currentTotal }` in standing order, + a
>   `reconcile: { status: 'match'|'mismatch', diffs: [...] }` block at gen time.

## Sprint Goals

- Make the digest accurate, controllable, and worth looking at
  Smarter prompt, a per-section generate modal, verified standings, real visuals, crisp output.

## Active Sprint Plan

- [x] {agent: backend, id: prompt-rules} Add Music League rules + round-order awareness to the generation prompt. Rules: (1) users **cannot vote on their own submission** (so never imply someone "didn't even vote for their own song" or that commenting on their own song = a vote); (2) **max 1 downvote per round** — never flag "only 1 downvote" as meaningful; (3) when a song lists **multiple artists, always use the first listed**. Round order: the LLM is passed recent digests from the league but currently orders them by *generation time*, not *round sequence* (caused a round-3 digest to cite a round-5 event as "last round"). Pass explicit round numbers / sequence for the current round AND the prior-digest context so chronology is correct.
  - **Acceptance:** the generation prompt includes the three rules verbatim-equivalent and a round-sequence field for the current round + each prior-digest reference; a regen of a recent round no longer produces self-vote / "only 1 downvote" / wrong-chronology claims (spot-checked on a real round). Deployed to prod; noted in the Activity Log.

- [x] {agent: backend, id: generation-wiring} Thread the generate modal's per-section params into the LLM draft call per the **Generation params** contract above: honor per-section `enabled` (skip unchecked sections), inject per-section `style` words + `context`, respect the `variant` choice, and when `pastedChat` is present use it as the chat-window section's source (bypassing the flaky auto-capture). Endpoint: extend `POST /api/digest/[roundId]/draft`.
  - **Acceptance:** `POST /api/digest/:id/draft` accepts the Generation-params body; a request with one section disabled omits it from the draft; per-section style/context measurably change that section's output; a request with `pastedChat` produces a chat section sourced from the pasted text. Deployed; logged.

- [x] {agent: backend, id: standings-data} Create the canonical **`season_standings`** table (per league/season/round/user → `prior_total`, `round_points`, `current_total`, standing order) computed from the export + CLI vote data (all votes up to that round). Expose it per the **Standings payload** contract. **Reconciliation:** at generation, compute standings from raw vote data and diff against the table — return `reconcile.status` (`match`/`mismatch`) + per-user `diffs`. Provide an "adopt computed values" path that **overwrites the table** with the computed numbers; and an "edit" path (used by viz) that writes user-corrected values as the new gospel. The table is always the source the digest renders from.
  - **Acceptance:** `season_standings` exists + is populated for an existing league/season from vote data; a gen request returns the Standings payload + a `reconcile` block; forcing a deliberate mismatch (tweak one stored row) yields `status:'mismatch'` with the offending `diffs`; the adopt-computed path updates the row and a re-check returns `match`. Deployed; logged with the table shape.

- [x] {agent: backend, id: unfinalize-endpoint} Add an unfinalize endpoint that clears a digest's `finalized_at` (and any finalize-locked state) so it can be regenerated/edited again. Idempotent; safe to call on an already-unfinalized digest.
  - **Acceptance:** `POST /api/digest/:roundId/unfinalize` (or equivalent) returns 200 and `finalized_at` becomes null in the DB; a previously-finalized digest re-enters the editable/regenerate flow. Deployed; endpoint shape noted in the Activity Log for the frontend button.

- [ ] {agent: frontend, id: inline-edit-fix} Fix the broken **non-LLM inline edit** — the manual edit of a generated section's text (no LLM call) currently doesn't work. Diagnose (save not persisting? state not re-rendering? wrong endpoint?) and repair so a manual edit saves and survives reload.
  - **Acceptance:** on prod, editing a section's text manually (the non-LLM edit path), saving, and reloading shows the edited text persisted; root cause noted in the Activity Log.

- [ ] {agent: frontend, id: generate-modal} Build the initial-generation modal, modeled on the regen modal: a **checkbox per section** (all checked by default), each row **expandable** to per-section controls — **style words** (plain tags: mean / nice / negative / concise / funny / … under a "style / focus" label, replacing the regen modal's "more/less ___" phrasing), a **context** text box, and a **Textual / Visual / Both** layout picker (with an icon indicating each). Plus a dedicated **paste-WhatsApp-chat** text box (separate from per-section context) feeding the chat section. On submit, send the **Generation params** contract to the draft endpoint. Also add an **Unfinalize** button on the finalized-digest view that calls the unfinalize endpoint.
  - **Acceptance:** the generate modal renders per-section checkboxes (default checked) + expandable style/context/variant controls + a paste-chat box; submitting posts the Generation-params shape; the Unfinalize button reverts a finalized digest (calls the endpoint) and returns it to the editable flow. `npm run check` passes; deployed; visual check on prod.

- [ ] {agent: frontend, id: variant-system} Build the per-section **layout-variant system**: each section can render `textual`, `visual`, or `both`; the renderer reads the chosen variant (from the draft/section state set by the modal) and slots the matching component. Define the **variant slot interface** that viz's visual components (podium, standings chart) plug into, and the icon set indicating a section's available variants. Sections without a visual form stay textual.
  - **Acceptance:** a digest section renders the textual form, the visual form, or both based on its `variant` value; the slot interface is documented in-code for viz to implement against; switching a section's variant re-renders without a full reload. `npm run check` passes; deployed.

- [ ] {agent: frontend, id: export-formats} Make the shared digest artifact readable on phones. Add a **PDF** export via Puppeteer `page.pdf()` (phone-portrait page size, `@page` CSS for clean section breaks, crisp/selectable text) as the **primary** share artifact; add a **PNG-per-section** mode (one image per section, plus a **podium-only** single image); keep the existing wide/mobile PNG. Plumb format selection through the finalize/export trigger + the export action UI.
  - **Acceptance:** exporting a real round (e.g. r-104) as **PDF** yields a multi-page phone-portrait PDF with crisp text and no horizontal scroll; **PNG-per-section** yields one image per section (+ a podium-only image); wide/mobile PNG still works; all selectable from the export action. Deployed; artifacts spot-checked on prod and noted in the Activity Log.

- [x] {agent: viz, id: album-podium} Build the **visual album-art podium** component for the top section: top songs' **album covers** in a podium/grid with rank + points badges, slimming the section's prose to short captions (so adding art doesn't grow the section). Implement it as the **visual** form of the top section, plugging into the variant slot interface (build the component against the documented interface; integrate as `variant-system` lands).
  - **Acceptance:** the podium renders album art + rank/points for the top songs; the top section in `visual`/`both` mode shows it (prose trimmed to captions); `both` shows art + caption, `textual` unchanged. Renders cleanly in the mobile/PDF export. `npm run check` passes; deployed; visual check on prod.

- [x] {agent: viz, id: standings-chart} Build the **season-standings-with-round-impact** visual (per the Standings payload contract): a horizontal bar per user = season total, with **this round's points as a highlighted end-segment**, the **current rank** + **(prev rank)** in parens, and a **▲ green / ▼ red / – arrow** for the round's standings change. Compact + legible on mobile. Plugs into the variant slot interface; reads the Standings payload (build against the contract; integrate as `standings-data` lands).
  - **Acceptance:** given a Standings payload, the chart renders ordered bars with the round-delta segment, rank + (prev rank), and up/down/no-change arrows; readable at mobile width and in the PDF/PNG export. `npm run check` passes; deployed; visual check on prod.

- [ ] {agent: viz, id: editable-standings-table, depends: standings-data} Build the **editable standings table** UI (reachable from the standings section's non-LLM edit and from its regen): a grid in standing order showing current total / round points / prior total, all editable. On submit, a **confirmation modal details the changes**, then it **persists to `season_standings` as gospel** (via the backend edit path). The standings visual then reflects the corrected numbers.
  - **Acceptance:** the editable grid loads the current standings; editing values + submitting shows a confirm modal listing the diffs, then persists (DB row updated, table reflects it on reload); the standings visual re-renders from the corrected data. `npm run check` passes; deployed; visual check on prod.

- [ ] {agent: viz, id: reconciliation-modal, depends: standings-data} Build the **generation-time reconciliation modal**: when a gen returns `reconcile.status === 'mismatch'`, surface a modal — **default = use the stored table**, with an option to **adopt the AI's computed values** (which then updates the table), showing a clear **diff of the differences** (per user: stored vs computed). Either choice proceeds with the table values. Consumes the backend reconcile payload.
  - **Acceptance:** a mismatch at generation pops the modal with a per-user stored-vs-computed diff; choosing "use table" proceeds on stored values; choosing "adopt computed" calls the adopt path (table updated) and proceeds; a match produces no modal. `npm run check` passes; deployed; flow verified on prod.

### Deploy

Each change deploys to prod per the always-deploy-to-prod convention in `CLAUDE.md`: `docker compose build --no-cache bot-ui && docker compose up -d --force-recreate bot-ui`. No `ml-auth-trigger` daemon involvement this sprint.

---

## Agent Roster

| Agent | Owns (feature area) | Does not touch |
|---|---|---|
| backend | the LLM generation prompt + draft logic, generation-param wiring, **standings math + the `season_standings` DB table + reconciliation logic**, the unfinalize endpoint | the digest `.svelte` page / modal / export UI, and the visual components |
| frontend | the digest **workflow chrome** — the generate modal, the variant *system* + slot interface, the export pipeline (`export.ts` + export UI), the unfinalize **button**, the inline-edit fix, digest page layout | the LLM prompt + generation/standings backend logic; the **visual component internals** (podium / standings chart / standings-table UI) |
| viz | the **visual components** — album-art podium, standings-with-round-impact chart, editable standings-table UI + confirmation modal, the generation-time reconciliation modal (new `.svelte` files + their scoped CSS) | the LLM/generation/standings backend; the generate modal, variant *system*, export pipeline, and inline-edit (frontend's) |

> **Collision rule:** frontend owns the variant *mechanism* + the digest page + `export.ts`; viz owns the *visual component files* it adds and their scoped CSS. They coordinate only through the **variant slot interface** (frontend defines, viz implements) and the **Standings payload** contract (backend defines, viz consumes). Don't both edit the same file — viz adds new components; frontend wires the slots.

---

## Decision Log

- **D1** — 3-agent roster this sprint (viz added at pane 1.4) to parallelize the UI-heavy work. Lanes are by feature area (brains / workflow-chrome / visuals), not file type.
- **D2** — Standings are a **human-verified source of truth**: a persisted `season_standings` table the digest renders from. At gen, the AI computes from raw votes and reconciles against the table; mismatches surface a modal (default = table). Bad AI math can't silently propagate.
- **D3** — Mobile output: **PDF primary** (crisp, paginated, selectable), **PNG-per-section** secondary (+ podium-only), wide/mobile PNG retained. (Multi-page PNG paging + multi-image album deferred.)
- **D4** — Per-section **layout variants** (textual / visual / both) chosen in the generate modal; build the variant *system* once, ship podium + standings as visual variants, expand others later.
- **D5** — Paste-WhatsApp-chat is a **dedicated modal field** feeding the chat section — a manual override while the auto-capture stays flaky.
- **D6** — Deferred to backlog (captured, not this sprint): by-the-numbers stat strip, next-round preview section, bump-chart "season arc" standings visual, PNG multi-page paging / multi-image album.
- **D7** — sprint-13 (YTM play button) stays **paused** on Blocker B2 (Odesli data source); resumes after this sprint + the B2 decision.

## Blockers

## Activity Log

### 2026-06-02 — docs — Sprint plan created: digest improvements (sprint-14)
- authored `## Active Sprint Plan` with 12 tasks across a new 3-agent roster (backend / frontend / **viz** added at pane 1.4)
- 4 backend / 4 frontend / 4 viz
- threads: accuracy (prompt rules + round order), control (generate modal, generation wiring, unfinalize, inline-edit fix), visuals+truth (album podium, standings chart, `season_standings` table + reconciliation, editable standings table + reconcile modal), output (PDF + per-section PNG)
- parallelism: lanes by feature area to avoid two-UI-agent collisions; two shared contracts (Generation params, Standings payload) written into the doc so all three build in parallel. Only `editable-standings-table` + `reconciliation-modal` (viz) hard-depend on `standings-data` (backend); everything else starts at kickoff (~10 tasks parallel across 3 panes)
- deferred to backlog (D6): by-the-numbers strip, next-round preview, bump-chart season-arc, PNG paging/album
- sprint-13 set to `paused` (D7) so the warren advances to sprint-14

### 2026-06-02 — viz — Wave 1 done: `album-podium` + `standings-chart` built (commit 8d872f4)
- **album-podium** → `ui/src/lib/digest/AlbumPodium.svelte`. Album-art medal podium (gold/silver/bronze, gold tallest) + a slim list for ranks 4+, rank + points badges. Reads ranked rows from `content.items`; collapses prose to short captions (in `both`, the textual caption is rendered *below* by `DigestSection`, so the component renders art only). Graceful cover-art fallback (vinyl-glyph tile) when no art; accepts `coverUrl` / `albumArtUrl` / `album_art_url` keys.
- **standings-chart** → `ui/src/lib/digest/StandingsChart.svelte`. Per-user horizontal bar = season total, with **this round's points as a highlighted (pulp) end-segment**, **current rank + (prev rank)**, and a **▲ green / ▼ red / – arrow** for the round's rank change, + a legend. Reads the **Standings payload** from the `data` prop (`StandingsResult.standings`; bare array also tolerated). Ignores the `reconcile` block (that's Wave-2's reconciliation-modal).
- **Contract alignment:** both implement frontend's `VisualComponentProps` (variants.ts) exactly — mounted by `DigestSection` as `<Slot {kind} {content} data={visualData} variant=… />`. Verified backend `standings.ts` `StandingRow` field names match the Standings payload contract 1:1 (`name, rank, prevRank, priorTotal, roundPoints, currentTotal`).
- **Verification:** `npm run check` clean (0 errors; neither component flagged). Visually smoked in isolation via Playwright at desktop (820px) **and** 430px mobile through the real prop shape — podium + slim list + cover/fallback render; standings bars/segments/arrows/legend render; mobile reflow drops the slim-list submitter and tightens the rank cell. Temp `_viz-preview` harness removed after.
- **Lane hygiene:** only added the two new `.svelte` files + their scoped CSS. Did **not** touch `DigestSection.svelte`, `variants.ts`, the page, `export.ts`, or any backend file (those carry frontend/backend's in-progress changes in the working tree).
- **➡ handoff to frontend:** register `AlbumPodium` for `SectionKind 'podium'` in the page's `VISUAL_COMPONENTS` map (one import + map entry) to replace the `VariantPlaceholder` for that slot. `standings-chart` needs its host section + the `visualData` (Standings payload) wired through once the standings section lands. **Prod visual check is gated on that registration** — not deployed standalone (nothing reachable on prod until wired); will surface on frontend's variant-system deploy.
- HELD for Wave 2 (await `standings-data`): `editable-standings-table` + `reconciliation-modal`.

### 2026-06-02 — backend — Wave 1 ALL 4 backend tasks done + deployed + prod-smoked

**🔓 `standings-data` is LANDED — viz Wave 2 (`editable-standings-table`, `reconciliation-modal`) is unblocked.**

- **standings-data** (commit 48e56cd) — `season_standings` table (PK `(round_id, competitor_id)`) + `ui/src/lib/db/standings.ts`. Computed from raw vote data: a competitor's points = sum of votes their submitted songs received, accumulated over the season's round sequence (rounds ordered by `id`). The table is the gospel the digest renders from; gen-time reconcile diffs computed-vs-stored.
  - **Standings payload** (backend→viz), per user in standing order — matches viz's `StandingRow` 1:1:
    `{ competitorId, name, rank, prevRank, priorTotal, roundPoints, currentTotal }`
  - **reconcile block:** `{ status: 'match'|'mismatch', diffs: [{ competitorId, name, presence?: 'stored-only'|'computed-only', fields: [{ field, stored, computed }] }] }`
  - **Endpoints:**
    - `GET  /api/digest/:roundId/standings` → `{ seasonId, standings, reconcile }` (lazily computes + persists the table on first access).
    - `POST /api/digest/:roundId/standings` `{ action:'adopt' }` → overwrite table with computed values (reconcile→match); `{ action:'edit', edits:[{competitorId, priorTotal?, roundPoints?, currentTotal?}] }` → write human-corrected values as gospel + re-rank.
    - `POST /api/digest/:roundId/draft` response now also carries `{ standings, reconcile }` (the gen-time payload for the reconciliation-modal).
  - **Prod smoke (r104, Hip Jammers S3):** GET → 9 users, prior+round=current, ordered, prevRank deltas (Kristin 4→3, margs 5→6); `reconcile:match`. edit Ronm→999 → `reconcile:mismatch` w/ `{currentTotal stored:999 computed:35}` → adopt → `match`, restored to 35.
- **prompt-rules** (commit 3-ML-rules) — system prompt now states the 3 ML rules (no self-voting; max-1-downvote/round so "only 1 downvote" is never noteworthy; multi-artist→first listed) + a chronology rule. `RoundData` carries `roundSequence {number,total}` + `priorRounds[]`; the user prompt's chronology block anchors "last round" to the prior round by sequence and forbids referencing rounds after the current one (fixes the r3-citing-r5 bug). 11 unit tests.
- **generation-wiring** (same commit as prompt-rules) — `POST /draft` accepts the **Generation params** contract `{ sections:[{id,enabled,style,variant,context}], pastedChat }`. Disabled sections omitted; per-section style/context injected; `variant` persisted to `digest_sections.variant`; `pastedChat` feeds the chat section (bypassing auto-capture). A params body forces a fresh generation (replaces prior draft); empty body keeps cached behavior.
  - **Prod smoke (r95, draftless):** posted villain-disabled + podium `style:['mean','concise'] variant:visual` + pastedChat → sections `[podium,flow,consensus,quotes,chat]` (**villain omitted**), podium `variant:visual` persisted, **chat sourced from the pasted Alice/Bob lines**. Test draft cleaned up after.
- **unfinalize-endpoint** (commit, separate) — **`POST /api/digest/:roundId/unfinalize`** → `{ ok, roundId, draftId, wasFinalized, finalizedAt:null }`. Clears the active draft's `finalized_at` (404 no round / 409 no draft). Idempotent: 2nd call returns `wasFinalized:false`. **➡ frontend:** wire the Unfinalize button to this; on success the digest re-enters the editable/refine flow.
  - **Prod smoke (r14):** 1st call `wasFinalized:true`→null; 2nd `wasFinalized:false`; restored r14's original `finalized_at` after.
- **Verification:** `npm run check` 0 errors; full vitest suite **110 passing** (+18 new: 7 standings, 11 prompt/gen). Deployed via `docker compose build --no-cache bot-ui && up -d --force-recreate`; all 4 endpoints smoked live on `192.168.4.217:3002`.
- **Lane note:** the `digest_sections.variant` column + its `client.ts` migration are frontend's variant-system work (already in the tree); generation-wiring writes that column but I left those files to frontend to commit. Did not touch the digest `.svelte` page/modal/export UI or visual components.
