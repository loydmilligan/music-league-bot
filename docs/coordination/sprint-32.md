---
project: music-league-bot
sprint: sprint-32
campaign: the-b-side
title: the b-side — Public site (Home / Profile / Archive)
status: active
created: 2026-06-15T00:00:00Z
activated: 2026-06-15
updated: 2026-06-15T04:45:00Z
---

# music-league-bot — coordination doc (sprint-32)

> **Campaign `the-b-side`, sprint 2 of 3.** Builds the **public, no-auth,
> read-only micro-site** that renders the read-model sprint-31 already generates.
> Three routes (League Home / Player Profile / Digest Archive) hosted on
> `digest.mattmariani.com/{slug}`, served as **static files by the existing
> `digest-static` host** — fully isolated from the operator app. Claude Design's
> handoff packet `docs/design/dashboard/` (HANDOFF-README.md, IMPLEMENTATION-PROMPT.md,
> the `.jsx` components, `ml-dashboard-styles.css`, the fixture, and the
> `the b-side - League Dashboard Preview.html` visual target) is the spec — port
> it. Campaign design: `docs/superpowers/specs/2026-06-14-bside-campaign-design.md`.

## Sprint Goals

- Make the b-side viewable — a real shareable league link
  Home / Profile / Archive on digest.mattmariani.com, static, no login, mobile-first.

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | static-gen pipeline (extend `publishSite`), `digest-static`/host config, `$lib/dashboard/*`, `/api/*` | the b-side Svelte components |
| frontend | the b-side app — Svelte components, routes, shared atoms, CSS, hands-on verification | DB, the host pipeline, operator-app routes |
| orc | sprint gate: cross-check, version + CHANGELOG, ratification card, deploy, prod walk, context resets | project code |

## Working agreements (sprint-32)

- **The handoff IS the spec.** `docs/design/dashboard/IMPLEMENTATION-PROMPT.md` + the `.jsx`
  reference + `ml-dashboard-styles.css` + the `…Preview.html` visual target. Port the `.jsx` to
  Svelte; **lift `ml-dashboard-styles.css` wholesale** (Mash tokens only, no new hex/hues).
- **Hosting model (decided — honor it):** the b-side is a **standalone static SPA** served ONLY by
  `digest-static` (the dumb caddy host on `digest.mattmariani.com`), NOT by the operator app at
  runtime. Build the SPA bundle once at deploy; **`publishSite` writes per-slug data**
  (`DIGESTS_DIR/{slug}/read_model.json` + a slug index that boots the shared bundle); caddy serves
  `digest.mattmariani.com/{slug}/*` with SPA fallback. The SPA reads its slug from the URL and
  fetches the co-located `read_model.json` — **no LLM, no DB, no operator route reachable from the
  public domain.** This mirrors the existing digest html-share model (slug folders under DIGESTS_DIR).
- **Strip ALL review scaffolding:** the iOS bezel, concept rail, Home/Profile/Archive flip pills,
  and mock URL bar are review-only — the product is the responsive page inside `.bs-browser`.
- **No-strife + lite-tier are load-bearing:** never render a win/loss ladder; lite-tier members
  render a coherent shorter profile (omit absent sections — no empty headers). `noindex, nofollow`
  on every route; no link back to `mlbot2.mattmariani.com`.
- Hands-on means hands-on: **mobile-first** — verify at 412×892 AND desktop on the real built
  output; the gate verifies the LIVE `digest.mattmariani.com/{slug}`.
- Mid-task context discipline: past ~60-70% context, write a handoff and request a reset from orc.
- No prod deploy except by orc at the gate.

## Active Sprint Plan

<!-- Task syntax (parser contract):
     - [ ] {agent: <roster>, id: <slug>, depends: <id,id>} Body
       - **Acceptance:** verifiable check.
     Status marks: [ ] pending · [-] in-progress · [x] done · [!] blocked.
     `agent:` must match the Agent Roster. `depends:` is one comma-separated key. -->

- [x] {agent: backend, id: host-pipeline} **Static-gen + host the b-side under digest.mattmariani.com** (handoff §2, §9; campaign decision). Extend `publishSite` (`ui/src/lib/dashboard/publish.ts`) so publishing a league ALSO writes the public artifact: `DIGESTS_DIR/{slug}/read_model.json` (the persisted read-model) plus a slug `index.html` that boots the shared b-side SPA bundle for that slug. Configure `digest-static` (caddy) to serve `digest.mattmariani.com/{slug}/*` with SPA fallback to the slug index and `noindex, nofollow` headers; a bad slug → generic 404 (no league enumeration). The operator app must NOT serve these routes on its own domain. Document the build/serve wiring (where the SPA bundle is built + copied).
  - **Acceptance:** after `POST /api/content/2/publish`, `DIGESTS_DIR/{slug}/read_model.json` exists and matches the DB read_model; caddy serves `/{slug}/` (200, SPA shell) and `/{slug}/read_model.json` (200, JSON) with `X-Robots-Tag: noindex`; a random bad slug → 404; nothing under the slug links to or reaches the operator app; `npm run check` 0 errors.

- [x] {agent: frontend, id: shell} **b-side app shell — brand, atoms, router, share card, CSS** (handoff §0, §8; `ml-dashboard-shell.jsx`). Build the standalone b-side Svelte app: the `b/s` brand mark, shared atoms (Avatar/monogram with one oklch lightness+chroma varying only hue, icon set, the `pulp|amber|sky|moss|ember` accent map), the **client router** for the 3 routes (`/{slug}`, `/{slug}/p/{memberId}`, `/{slug}/archive`), read-model loading (fetch the co-located `read_model.json` by slug), and the **shareable-card overlay** (tap a share icon → screenshot-ready card carrying ONLY award + league name, no URL/login). Lift `ml-dashboard-styles.css` wholesale into the app. Strip ALL review scaffolding (bezel, rail, flip pills, mock urlbar).
  - **Acceptance:** the shell builds as a standalone static bundle; routing resolves the 3 paths client-side; the share-card overlay opens and shows award + league only (no app URL); `b/s` mark uses the chunky extruded recipe (not flat italic); `npm run check` 0 errors; verified hands-on at 412×892 + desktop against a real read_model.json.

- [ ] {agent: frontend, id: route-home, depends: shell} **League Home — `/{slug}`** (handoff §4a; `ml-dashboard-home.jsx`). Masthead (b/s + share-the-league icon) → hero (league name display type, tagline, "Updated {date}" pill from `refreshed_at`) → KPI ribbon (horizontal scroll, celebratory facts) → superlative reel (award cards, each opens the winner's profile + has its own share icon) → the family (2-up member grid → profiles) → moments of the season → latest-round teaser → footer.
  - **Acceptance:** Home renders all sections from a real read_model; KPI ribbon + superlative reel scroll; a reel card opens the winner's profile; the share icon fires the share card; verified hands-on at 412×892 + desktop; `npm run check` 0 errors.

- [ ] {agent: frontend, id: route-profile, depends: shell} **Player Profile — `/{slug}/p/{memberId}` (the heart)** (handoff §4b, §5, §7; `ml-dashboard-profile.jsx`). Back-to-league bar → hero (monogram, name, role, joined, headline, 3-up statline) → signature superlative trophy + share → **Taste Fingerprint** (signature-artist chips w/ one starred favorite, genre chips, era chips, spectrum sliders, rewards/punishes two-col) → more superlatives (each shareable) → **Biggest Fan / Friendly Hater** (amber, affectionate) → **Your People** = Overlap v2 two labeled metrics (Vote Together within shared rounds = pulp; Taste Twins across leagues = sky) → Discovery playlist (name + agenda + 3 tracks-with-why). **Lite-tier degrades gracefully** — omit absent sections, no empty headers, lite footnote.
  - **Acceptance:** a full member renders every section; a `lite` member renders a coherent shorter profile with NO empty section headers; Your People shows the two metrics visually distinct; superlative share icons fire the card; verified hands-on at 412×892 + desktop on both a full and a lite member; `npm run check` 0 errors.

- [ ] {agent: frontend, id: route-archive, depends: shell} **Digest Archive — `/{slug}/archive`** (handoff §4c; `ml-dashboard-archive.jsx`). Hero, then rounds grouped by season (newest first), each a card with round number, theme, winning song + submitter monogram, date, "New" tag on the most recent. Each card deep-links to the existing full digest artifact at `/{slug}/archive/{roundId}` — **reuse the existing digest render pipeline; do not rebuild it.**
  - **Acceptance:** Archive renders rounds grouped by season newest-first from the read_model; a card deep-links to the existing digest artifact (resolves, not 404); the most-recent round shows the "New" tag; verified hands-on at 412×892 + desktop; `npm run check` 0 errors.

- [ ] {agent: orc, id: gate-close, depends: host-pipeline,route-home,route-profile,route-archive} **Gate — cross-check, ship, walk the live site, close.** Orc runs the gate: cross-check all lanes, independent `npm run check` + `npx vitest run`, version bump + CHANGELOG, ratification card, build + deploy, re-publish a league, then **load the LIVE `digest.mattmariani.com/{slug}` at 412×892** and walk Home → a full profile → a lite profile → Archive (+ a deep-linked digest), fire a share card, and verify `noindex` + NO operator-app link + bad-slug 404. Panes reset, doc closed.
  - **Acceptance:** all worker tasks `[x]`; 0 typecheck errors + vitest green; v-bump + CHANGELOG committed; ratification card emitted + ratified; the live public site loads at `digest.mattmariani.com/{slug}` (Home/Profile/Archive all render, share card works, lite member coherent, deep-link resolves), noindex set, no operator-app link, bad slug → 404, 0 console errors; doc `status: closed`.

## Decision Log

### 2026-06-15 — Campaign `the-b-side` sprint 2 = the public site (owner)
Renders sprint-31's read-model. Hosting honors the locked decision: standalone static SPA served
by digest-static (not the operator app), publish writes per-slug read_model.json + slug index.
The Claude Design handoff (docs/design/dashboard/) is the UI spec — port it. This is the sprint
that produces a real, viewable, shareable league link.

## Ratification Log

_(gate card lands here when it resolves)_

## Blockers

_None._

## Activity Log

### 2026-06-15 — backend — host-pipeline done (edb8e7c)
- `publishSite` writes `DIGESTS_DIR/{slug}/read_model.json` + `index.html` (SPA shell) after every DB write; fs mocked in tests
- `Caddyfile.digest` gains b-side routes: `/_bside/*` (shared bundle), `@league` regexp (≥14-char slug) with `try_files` SPA fallback + `X-Robots-Tag: noindex, nofollow`; bad slug → 404; `/d/*` digest routes unchanged
- `ArchiveEntrySchema` adds optional `digestUrl` so archive cards can deep-link to existing `/d/{roundSlug}/` digest artifacts
- `npm run check` 0 errors; 114/114 tests pass
- **Bundle wiring (for frontend `shell` task):** build b-side Vite app with stable output names `bside.js` + `bside.css`; copy to `DIGESTS_DIR/_bside/` at deploy time. SPA reads league slug from `document.body.dataset.leagueSlug` (set in the per-slug `index.html`).

### 2026-06-15 — orc — Sprint-32 ACTIVATED · host-pipeline + shell dispatched (Wave 1)
- status planned → active; dispatched the two no-dep tasks in parallel — host-pipeline to backend (%55), shell to frontend (%56). File-disjoint (backend = publish.ts + caddy; frontend = the b-side Svelte app). Both `[-]`.
- the 3 routes (home/profile/archive) open once shell lands; gate needs host-pipeline + all 3 routes.

### 2026-06-15 — frontend — shell done (COMMIT_HASH)
- Standalone Svelte 5 SPA at `bside/` — brand, atoms, router, share card, lifted CSS
- `b/s` mark: `.bs-mark` class uses full `--pulp-extrude` (6-step, chunky) + `-webkit-text-stroke`; not flat italic
- Shared atoms: `Avatar.svelte` (oklch hue, size sm/md/lg), `ShareOverlay.svelte` (award + league only, no URL)
- Client router in `App.svelte`: reads slug from `body.dataset.leagueSlug`, parses path for `/{slug}`, `/{slug}/p/{id}`, `/{slug}/archive`; `fetch(/${slug}/read_model.json)` at boot; `pushState` nav
- CSS: `colors_and_type.css` + `ml-dashboard-styles.css` lifted wholesale; `app.css` overrides `.bs-overlay` to `position: fixed` (product, no phone bezel)
- Routes: `HomeScreen.svelte` (hero, KPI ribbon, reel, family grid, archive link), `ProfileScreen.svelte` (full + lite paths, all taste fingerprint sections), `ArchiveScreen.svelte` (grouped by season, `digestUrl` deep-link)
- Dev fixture: `public/fam-jam-a9f3/read_model.json` (12 members, 6 reel, 8 archive entries)
- **Build output:** `bside/dist/bside.js` + `bside/dist/bside.css` (stable names, no hash) → deploy copies to `DIGESTS_DIR/_bside/`
- `npm run check` 0 errors; `npm run build` ✓ (63.95 kB JS / 30.27 kB CSS)
- **3 routes open:** dispatching route-home, route-profile, route-archive (all depend on shell ✓)

### 2026-06-15 — docs — Sprint plan authored: the b-side public site (campaign sprint 2)
- created sprint-32 coord-doc; `## Active Sprint Plan` body has 6 tasks
- 1 backend (host-pipeline) / 4 frontend (shell → home/profile/archive) / 1 orc gate
- deps: route-home/profile/archive ← shell; gate ← host-pipeline + the 3 routes; host-pipeline ∥ shell (both no-deps)
- the 3 routes parallelize once shell lands (separate route files); fix the sprint-31 read-model nits (backlog) where the components surface them
- UI spec = docs/design/dashboard/ handoff; hosting = standalone static on digest-static
- status `planned` — kickoff (first dispatch) is confirmation-gated; awaiting owner "go"
