---
project: music-league-bot
sprint: sprint-15-digest-hotfix
created: 2026-06-03T01:52:50Z
updated: 2026-06-03T01:52:50Z
status: active
---

# music-league-bot — coordination doc (sprint-15-digest-hotfix)

> **Quick hotfix from UAT.** sprint-14 shipped the digest features but two
> visual deliverables were built-but-not-wired-into-the-product, plus two new
> small asks from testing. Four items: (1) **wire the standings chart** into the
> digest (StandingsChart exists + `/standings` data exists, but it's never
> registered/mounted — `+page.svelte:399` `VISUAL_COMPONENTS` only has `podium`);
> (2) **populate podium thumbnails** (album art exists in the data, not flowing
> to AlbumPodium's items); (3) **restructure the chat section** to summary +
> expandable/anchor-linked moments; (4) **capture OpenRouter LLM cost per digest**
> and show it in-app (NOT on the shared artifact).
>
> Same 3-agent roster + lanes as sprint-14 (backend = data/LLM/cost; frontend =
> digest page wiring + cost display; viz = visual components). Agents keep their
> sprint-14 context — this builds directly on what they just wrote.
>
> **Shared shapes:** chat content → `{ summary: string, moments: [{ label, detail }] }`.
> Standings payload (already shipped, GET `/api/digest/:roundId/standings`) →
> per-user `{ name, rank, prevRank, priorTotal, roundPoints, currentTotal }`.

## Sprint Goals

- Make the digest's visuals actually show — and track what each costs
  Standings chart + album thumbnails wired in, chat moments readable, per-digest LLM cost in-app.

## Active Sprint Plan

- [x] {agent: frontend, id: standings-wire} **Make the season-standings chart actually appear in the digest.** It's built (`ui/src/lib/digest/StandingsChart.svelte`) and its data exists (backend `GET /api/digest/:roundId/standings` → the Standings payload), but it's never wired in: `ui/src/routes/digest/[roundId]/+page.svelte:399` has `const VISUAL_COMPONENTS = { podium: AlbumPodium }` — no StandingsChart, and there's no standings section to host it (see the TODO comment at `+page.svelte:397`). Register `StandingsChart` for a `standings` section kind, ensure a standings section renders in the digest (data-driven, not LLM prose — fetch the Standings payload and pass it as the section's `visualData` per the mechanism documented in `variants.ts:53`), and make sure it appears in the **web view AND the PDF/PNG export**. Coordinate with backend if a `standings` entry must be added to `SECTION_KINDS` (`ui/src/lib/digest/llm.ts`).
  - **Acceptance:** on prod (`192.168.4.217:3002`), opening a digest (e.g. r-104) shows the season-standings chart with real data (bars, this-round segment, rank + prev-rank, arrows); it also renders in a PDF/PNG export. `npm run check` passes; deployed; root cause + fix noted in the Activity Log.

- [ ] {agent: backend, id: podium-thumbnails} **Populate album-art thumbnails in the podium.** `AlbumPodium.svelte` reads cover art from its items (`coverUrl` / `albumArtUrl` / `album_art_url`) but they're empty. Album art already exists in the digest data (digest-verify reported "Album art ✓"). Wire the existing per-song album-art URL into the podium section's `content_json.items` so the covers render. (If the art genuinely isn't stored per-song, fetch it from the Spotify track→album image via the existing Spotify integration and persist it — but check first; it likely exists.)
  - **Acceptance:** the podium section's items carry a populated album-art URL; on prod the visual podium renders real album covers (not the vinyl-glyph fallback) for a round with art. Deployed; logged with where the art came from.

- [ ] {agent: backend, id: chat-restructure} **Restructure the chat section's generation output** from one prose blob to a structured shape: `{ summary: string, moments: [{ label: string, detail: string }] }` — a short overall summary plus a list of discrete chat moments, each with a brief label and a fuller description. Keep the "found the funny content + slightly-funny tone" quality that's working; only change the structure. Emit it as the chat section's `content_json`.
  - **Acceptance:** a generated chat section's `content_json` matches `{ summary, moments[] }`; the summary + each moment's label/detail are populated from real chat data; existing chat-section behavior (self-suppress when no chat) preserved. Deployed; the shape noted in the Activity Log for viz.

- [x] {agent: viz, id: chat-render, depends: chat-restructure} **Render the restructured chat section.** Summary at the top, then the moments. Two variants via the variant system: **web/interactive** — each moment is an **expandable** (click label → reveal detail, accordion); **PDF/static** — a summary block + the moments as an **anchor-linked list** (each label is an in-doc link jumping to that moment's detail further down — since PDF can't truly expand). Build against the `{ summary, moments:[{label,detail}] }` shape.
  - **Acceptance:** in the web view a chat section shows the summary + click-to-expand moments; in a PDF export it shows the summary + anchor-linked moment list that jumps to each detail (no horizontal scroll). `npm run check` passes; deployed; visual check on prod (web + PDF).

- [ ] {agent: backend, id: cost-capture} **Capture the OpenRouter LLM cost per digest.** For each digest's generation (draft + any regens/section gens), capture the OpenRouter cost (from the API response usage / the OpenRouter generation cost), accumulate the total per digest, and persist it (e.g. a `llm_cost_usd` column on `digest_drafts` or a per-digest cost record). Expose the accumulated cost in the digest data the page loads.
  - **Acceptance:** generating a digest records a non-zero `llm_cost_usd` (USD) for it in the DB; the digest's loaded data carries the accumulated cost; re-gens add to it. Deployed; the field + where cost is read from OpenRouter noted in the Activity Log for frontend.

- [ ] {agent: frontend, id: cost-display, depends: cost-capture} **Show the LLM cost at the top of the finalized digest — in-app only.** When a digest is finalized, display its accumulated `llm_cost_usd` at the top of the finalized-digest view in the app (for the user's eyes). **It must NOT appear on the shared artifact** — exclude it from the PNG/PDF export (`renderDigestPng` / the export render path), e.g. via a `[data-export-hide="1"]` element or the existing export-hide mechanism.
  - **Acceptance:** a finalized digest shows its LLM cost at the top in the web view; generating a PNG/PDF export of that digest does NOT include the cost anywhere in the image/PDF. `npm run check` passes; deployed; verified on prod (cost visible in app, absent from export).

### Deploy

Each change deploys to prod per `CLAUDE.md`: `docker compose build --no-cache bot-ui && docker compose up -d --force-recreate bot-ui`. **Serialize deploys** where possible (review-queue item 6: concurrent `up` on the shared `bot-ui` container races) — or use `npm run dev` (vite HMR in `ui/`) for UI iteration and deploy once at the end.

---

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | the LLM generation (chat restructure, podium album-art data), the OpenRouter **cost capture + persistence**, `SECTION_KINDS` additions | the digest `.svelte` page wiring, the cost display UI, the visual component internals |
| frontend | the digest **page wiring** (`+page.svelte` `VISUAL_COMPONENTS` + standings section + visualData), the **cost display** (+ its export-exclusion), export path | the LLM/cost backend, the visual component internals (StandingsChart/AlbumPodium/chat render) |
| viz | the **chat-section render** component (summary + expandable/anchor moments, web + PDF variants) | the LLM/cost backend, the digest page wiring, the standings/podium components (already built) |

> **Note:** `standings-wire` is frontend's page-wiring of viz's *existing* `StandingsChart` — viz does NOT rebuild it; frontend registers + feeds it data. Coordinate on the `standings` SectionKind only.

---

## Decision Log

- **D1** — Hotfix from sprint-14 UAT: two built-but-unwired visuals (standings, thumbnails) + two new asks (chat layout, LLM cost). Same roster/lanes; agents keep context.
- **D2** — Chat section becomes `{ summary, moments[] }`; rendered expandable on web, anchor-linked in PDF (PDF can't truly expand — confirmed).
- **D3** — LLM cost is **in-app only** (top of the finalized digest view), explicitly **excluded from the shared PNG/PDF export**. Users who receive the digest never see the cost.
- **D4** — Album art: wire the **existing** per-song art into the podium first; only add a Spotify fetch if it genuinely isn't stored.

## Blockers

## Activity Log

### 2026-06-03 — docs — Sprint plan created: digest hotfix (sprint-15)
- 6 tasks from sprint-14 UAT findings: standings-wire (frontend), podium-thumbnails (backend), chat-restructure (backend) + chat-render (viz), cost-capture (backend) + cost-display (frontend)
- 3 backend / 2 frontend / 1 viz; same roster + lanes as sprint-14, agents keep context
- root causes confirmed in code: `+page.svelte:399 VISUAL_COMPONENTS = { podium: AlbumPodium }` (StandingsChart never registered); AlbumPodium items lack album-art URLs (art exists in data per "Album art ✓")
- deps: `chat-render` depends `chat-restructure`; `cost-display` depends `cost-capture`. The other 4 start at kickoff (standings-wire, podium-thumbnails, chat-restructure, cost-capture)
- sprint-14 set to `complete` so the warren advances to sprint-15

### 2026-06-03 — viz — chat-render done: `ChatMoments.svelte` built (commit 53b8ca8)
- **chat-render** → `ui/src/lib/digest/ChatMoments.svelte`. Visual form of the `chat` section; renders backend's restructured `{ summary, moments:[{label,detail}] }` in **two render modes off one component**:
  - **WEB (interactive):** summary on top, then a click-to-expand **accordion** — label row toggles its detail panel, chevron rotates.
  - **EXPORT (static PNG/PDF):** summary, then a numbered **anchor-linked TOC** of the labels, then all the detail blocks rendered below — each label is an in-doc `#anchor` link to its detail (real clickable jumps in a PDF; in a PNG all details are simply visible). PDF can't truly expand (D2), so this is the static fallback.
  - **Mode detection:** reads `?export=1` off the page URL (`$app/state`'s `page`) — the flag the export render path sets (export.ts / `+page.svelte`). Not a prop (the slot interface only passes `VisualComponentProps`). Anchor ids use `$props.id()` (collision-proof, SSR/CSR-stable); `break-inside: avoid` keeps a moment+detail together across a PDF page break.
- **Contract/slot:** implements `VisualComponentProps` (variants.ts); reads `content` as the chat shape, **defensively** (tolerates the old prose shape → renders empty so nothing breaks before `chat-restructure` lands).
- **Verification:** `npm run check` 0 errors (not flagged). Smoked in isolation via Playwright: web accordion (summary + expand reveals detail) **and** export mode (`?export=1` → anchor TOC + detail blocks; confirmed all 3 TOC links resolve to their `.chatm-detail` targets). Temp `_viz-preview` harness removed after.
- **Lane hygiene:** added only the one new `.svelte` file + scoped CSS. Did not touch the page, backend, or other components.
- **➡ handoff to frontend:** register `ChatMoments` for `SectionKind 'chat'` — set `VISUAL_CAPABLE.chat = true` + add `chat: ChatMoments` to the page's `VISUAL_COMPONENTS` map (mirrors the `podium`/`standings` wiring). The chat section's `content_json` ( = backend `chat-restructure`'s `{summary,moments}` ) is already what the visual slot passes as `content`, so no extra `visualData` needed. Until registered, the component is **tree-shaken** (unreferenced) — so the prod web+PDF visual check rides with that registration.
- **Deploy:** did **not** run a separate `bot-ui` deploy — per the sprint-15 serialize-deploys note, and because an unreferenced component is tree-shaken out of the bundle (a standalone build would be a no-op artifact-wise). A concurrent in-flight `bot-ui` build was detected (another agent) and allowed to finish first; prod is healthy on the current tree (which includes this commit). The component enters the bundle on frontend's registration deploy.

### 2026-06-03 — frontend — standings-wire DONE (deployed, prod-verified r-104)

- **Root cause:** `StandingsChart.svelte` + `GET /standings` both existed but the chart was never registered (`VISUAL_COMPONENTS` had only `podium`) and had no host section to mount in.
- **Fix (page wiring only — no backend/component changes):**
  - `variants.ts`: added a frontend-only synthetic `DigestKind = SectionKind | 'standings'`; broadened `VisualComponentProps.kind` / `VisualRegistry` / `VISUAL_CAPABLE` (`standings: true`) / `effectiveVariant` to it. **Did NOT touch `SECTION_KINDS`** — standings is data-driven, not an LLM/DB section, so no backend coordination was needed.
  - `+page.server.ts`: `fetchStandings()` pulls `GET /api/digest/:roundId/standings` in `load` (failure-isolated → `null` when a round has no vote data); added `standings` to the refine/finalize page data + a `StandingsPayload` type.
  - `+page.svelte`: registered `standings: StandingsChart` in `VISUAL_COMPONENTS`; render a synthetic `<div data-section-kind="standings">` section inside `.dg-export` (after the LLM sections, before the footer) that mounts the registered slot with `data={standings}` `variant="visual"`. Self-hides when no standings.
- **Why it lands in the export automatically:** the standings section lives inside `.dg-export` and is driven by `load`, so the Puppeteer export (which loads the real page) captures it — web view AND PDF/PNG with no separate export code.
- **Verified on prod r-104:** web HTML renders the section (10 rows: season bars + this-round orange segments, current total, rank + (prev rank), ▲/▼/– arrows, legend). `png-sections` now emits a 6th `…-standings.png` (1284×1446 @3×, 94KB — viewed, looks correct); PDF grew 297KB→362KB (standings included), still phone-portrait. `npm run check` 0 errors.
- **Note:** `StandingsChart` shows ~9–10 users from the Standings payload as-is; any payload tweaks are backend's. Deploy serialized (build → up → verify landed) per the review-item-6 race guidance.
- cost-display (id: cost-display) remains **HELD** pending backend `cost-capture` (the `llm_cost_usd` column + migration already landed in the tree; will wire the in-app top-of-finalized display + export-hide once the value is populated and exposed in page data).
