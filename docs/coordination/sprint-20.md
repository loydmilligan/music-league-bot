---
project: music-league-bot
sprint: sprint-20-html-share
created: 2026-06-05T06:00:00Z
updated: 2026-06-05T06:00:00Z
status: active
---

# music-league-bot — coordination doc (sprint-20-html-share)

> **Ship a shareable, interactive HTML digest at `digest.mattmariani.com`.**
> Approved spec: `~/.config/taw/wiki/Projects/music-league-bot/digest-html-share-spec.md`
> (read it — output treatment §3, infra §3b, gen/regen §4).
>
> A new **`html`** export renders the **existing** interactive digest (all
> sections as already built — NOT a new design) into a **self-contained
> artifact**, published to a **dedicated public static host** under an
> **unguessable, stable-per-round slug** (`/d/<slug>`; re-export overwrites in
> place → shared links never break). Recipients open a link, **no login**, and
> get the *interactive* digest (tastemaker tap-modal works) — not a screenshot.
> The point: share interactively **without exposing the Access-gated
> `mlb.mattmariani.com` hostname.**
>
> **Spike-led:** the first task proves self-contained interactivity on a dumb
> static host and picks the mechanism; everything else builds on its outcome.
> **Key gotcha:** the existing `?export=1` render flag DISABLES interactivity
> (sprint-18) — the HTML path must render with interactivity ON.
>
> Roster: **backend** (render + export endpoint + the `digest-static` container)
> + **frontend** (export-toggle option + copy-share-link + e2e). **viz idle.**
> **USER step:** create the `digest.mattmariani.com` DNS + Cloudflare tunnel,
> public / no Access (you own the CF console). **NOT in this sprint:** richer
> drill-down beyond today's web view, an index/listing page, link expiry,
> per-recipient access, auto-publish-on-finalize.

## Sprint Goals

Share interactive digests by link, no login
A public digest.mattmariani.com page keeps the tap-modal alive, mlb stays hidden.

## Active Sprint Plan

- [x] {agent: backend, id: packaging-spike} **SPIKE (gating).** Prove a self-contained, still-interactive digest can be served from a dumb static host (no app backend). Render one round's digest with interactivity ON (do NOT use the `?export=1` static path), embed/bundle data + JS + assets, and confirm a client-side interaction survives. Try the leading approach (SSR + bundled assets in a `<slug>/` folder) vs a true single-file build; pick one. Throwaway code is fine — **the decision + a working sample are the deliverable.**
  - **Acceptance:** a sample artifact for HJ S3 r104 served by a plain static server (e.g. `python3 -m http.server` or a throwaway caddy) with **no app/DB process running** loads in a browser and the **tastemaker tap-modal opens** (bucket count → chunked-bar song modal). Chosen mechanism (folder-vs-single-file), how data/JS/assets are embedded, and the on-disk + URL layout (`/d/<slug>/…`) recorded in the Activity Log for render-pipeline + digest-static-container.

- [x] {agent: backend, id: render-pipeline, depends: packaging-spike} Productionize the spike into a render function in `src/lib/digest/export.ts` (e.g. `renderDigestHtml(roundId)`) that renders any round's full digest to the self-contained artifact **with interactivity ON**, under the round's **stable unguessable slug**, and writes it into a shared `digests/` volume. Persist the **slug ⇄ round mapping** (DB row or json manifest in the volume — your call) so a round always resolves to the same slug and re-render overwrites in place.
  - **Acceptance:** `renderDigestHtml()` writes a working artifact for **r104 (HJ S3)** and **r101 (Fam Jam S3)** into the `digests/` volume at the spike's layout; re-running for the same round resolves to the **same slug** and overwrites (mapping persisted); the served artifact contains **no `mlb.mattmariani.com`** reference (relative/embedded assets only). `npm run check` passes.

- [x] {agent: backend, id: digest-static-container, depends: packaging-spike} Add a **`digest-static`** service (caddy/nginx, static file server only — no app, no Access) to `docker-compose.yml`, serving the shared `digests/` volume **read-only**; the same volume is mounted **read-write** into `bot-ui` (which writes artifacts). Expose it on an internal port. Document the **cloudflared ingress entry** the user's tunnel needs (`digest.mattmariani.com` → `digest-static:<port>`) — cloudflared is host/CF-managed, so this is the config the USER applies in the cf-tunnel step.
  - **Acceptance:** `docker compose up -d digest-static` serves a file placed in the `digests/` volume at `http://192.168.4.217:<port>/d/<slug>/` (or the spike's layout) → **HTTP 200**; the shared volume is mounted into both `bot-ui` (rw) and `digest-static` (ro); the exact cloudflared ingress mapping for the user is written to the Activity Log. Deployed; `npm run check` passes.

- [x] {agent: backend, id: export-endpoint, depends: render-pipeline} Extend the **existing** export route `src/routes/api/digest/[roundId]/export/+server.ts` to handle **`format: 'html'`**: call `renderDigestHtml`, write to the `digests/` volume, and return the public URL `https://digest.mattmariani.com/d/<slug>`. Do NOT add a new route — extend the existing format dispatch (peer of pdf/mobile/wide/png-sections).
  - **Acceptance:** `POST /api/digest/104/export {"format":"html"}` on prod returns **200** with `{ url: "https://digest.mattmariani.com/d/<slug>" }`; the artifact is present in the volume; a second POST returns the **same** URL (stable slug). `npm run check` passes; deployed.

- [ ] {agent: frontend, id: html-export-ui} Add **`html`** to the export-format toggle (`EXPORT_FORMATS` in `src/routes/digest/[roundId]/+page.svelte`) + a **"copy share link"** affordance that surfaces the URL returned by the export endpoint after an `html` export. Build against the documented contract (`{format:'html'}` → `{url}`) — can start in parallel with the backend chain; do the live verify once `export-endpoint` is deployed.
  - **Acceptance:** the digest-page export toggle shows an `html` option; selecting it + exporting calls the endpoint and renders the returned `digest.mattmariani.com/d/<slug>` URL with a working **copy-link** control + a clear "published" confirmation; loading/error states present. `npm run check` passes; deployed; mobile + desktop visual check logged.

- [ ] {id: cf-tunnel} **USER STEP (not an agent task).** In the Cloudflare console, create the `digest.mattmariani.com` DNS + a **separate** tunnel pointing at the `digest-static` container (per the ingress mapping `digest-static-container` logs), **public / NO Access policy** — fully distinct from the mlb tunnel. Confirm the hostname resolves and is reachable without login.
  - **Acceptance:** `https://digest.mattmariani.com/` resolves over the new tunnel with **no Cloudflare Access prompt**; a file in the `digests/` volume is reachable at its `/d/<slug>` URL from off the local network.

- [ ] {agent: frontend, id: e2e-verify, depends: export-endpoint,html-export-ui,digest-static-container,cf-tunnel} **End-to-end + hostname-leak check.** From the digest page, export `html`, open the returned public URL in a fresh browser session (no login), confirm the digest renders and **interactivity works**, and confirm the **mlb hostname is not exposed** anywhere in the served artifact or HTTP responses.
  - **Acceptance:** exporting `html` for a round → opening `https://digest.mattmariani.com/d/<slug>` in a **fresh/incognito** session renders the digest and the **tastemaker tap-modal opens**; `curl -sI` the URL + grep the served HTML/assets shows **zero `mlb.mattmariani.com`** strings and no Access redirect; verified on a real mobile viewport too. Logged in the Activity Log → closes sprint-20.

### Deploy

Deploy per `CLAUDE.md` (now fast — chromium base layer, sprint-19): `docker compose build --no-cache <service> && docker compose up -d --force-recreate <service>` against `192.168.4.217:3002`. New `digest-static` service deploys the same way (`up -d digest-static`). **Serialize deploys.** The public `digest.mattmariani.com` tunnel is created by the USER (cf-tunnel) once `digest-static-container` logs the ingress mapping.

---

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | the HTML render (`src/lib/digest/export.ts`), the export endpoint format dispatch (`src/routes/api/digest/[roundId]/export/+server.ts`), the slug store, the `digest-static` container + `docker-compose.yml` + shared volume | the export-toggle UI / share-link UI internals, the digest section components |
| frontend | the digest-page export toggle + copy-share-link affordance (`src/routes/digest/[roundId]/+page.svelte`), the e2e verification | the render pipeline, the export endpoint internals, the container/infra |
| viz | _idle this sprint — no tasks_ | — |

---

## Decision Log

- **D1** — `html` is a new **export format** (peer of pdf/mobile/wide/png-sections), NOT a `DigestKind`. It packages the existing interactive digest; no new sections, no new drill-down this sprint.
- **D2** — Served from a **self-hosted `digest-static` container** + a **separate public Cloudflare tunnel** (`digest.mattmariani.com`, no Access). The mlb hostname must never appear in served artifacts/headers (e2e-verify checks this).
- **D3** — Privacy = **unguessable slug, no index, non-enumerable, no login.** Acceptable for low-sensitivity league results; zero recipient friction is the goal.
- **D4** — **Stable slug per round**; re-export overwrites in place so shared links never break.
- **D5** — Packaging mechanism (folder-per-slug vs single-file) is **decided by the spike**, not pre-committed. The rest of the sprint adapts to its outcome.
- **D6** — The Cloudflare DNS/tunnel is a **USER step** (cf-tunnel); cloudflared is host/CF-managed, not in compose. Agents log the exact ingress mapping for the user to apply.

## Blockers

## Activity Log

### 2026-06-05 — backend — export-endpoint DONE (deployed) → **backend chain complete; frontend e2e unblocked**
Extended the **existing** export route `src/routes/api/digest/[roundId]/export/+server.ts` (no new route) to handle **`format: 'html'`** as a peer of pdf/mobile/wide/png-sections: reads the raw requested format, keeps the round + draft existence checks, then branches — `html` → `renderDigestHtml(roundId)` → `json({ ok, roundId, format:'html', slug, url })`; everything else falls through to the unchanged `runDigestExport` files path (`isExportFormat` still gates the screenshot formats, invalid → `mobile`).

**Verified on prod (real path — render runs INSIDE the bot-ui container):**
- `POST /api/digest/104/export {"format":"html"}` → **200** `{"ok":true,"roundId":104,"format":"html","slug":"v0lGP7SftWx-FQ3S","url":"https://digest.mattmariani.com/d/v0lGP7SftWx-FQ3S"}` — matches r104's stored slug exactly.
- **Second POST → identical url** (stable slug, artifact re-written in place; index.html mtime refreshed by the container).
- Artifact served by the real `digest-static` caddy: `/d/v0lGP7SftWx-FQ3S/` → **200 text/html**; **0 `mlb.mattmariani.com`**, **0 google-fonts**, 23 local woff2 (font localization confirmed running inside the container too).
- Regression: `{"format":"bogus"}` still returns `"format":"mobile"` — existing screenshot formats untouched.
- `npm run check` → 0 errors. bot-ui rebuilt `--no-cache` (no chromium download) + deployed.
- **Contract for `html-export-ui` / `e2e-verify` is live:** `POST …/export {format:'html'}` → `{ ok, roundId, format:'html', slug, url }`. Frontend can now exercise the full flow against prod. (Public `digest.mattmariani.com` requires the user's `cf-tunnel`; locally reachable at `192.168.4.217:8088/d/<slug>/`.)

### 2026-06-05 — backend — render-pipeline DONE (deployed) → **export-endpoint unblocked**
Added **`renderDigestHtml(roundId)`** to `src/lib/digest/export.ts` — renders the LIVE interactive digest (headless chromium, **no `?export=1`**) into the self-contained folder-per-slug artifact and writes it to `DIGESTS_DIR/d/<slug>/` (`/app/digests` → shared volume). Returns `{ slug, url, dir, bytes, files }`.

**Slug store:** new `digest_shares` table (`schema.ts`) — `round_id` PK ⇄ unguessable `slug` (`randomBytes(12).base64url`, 16 url-safe chars), `UNIQUE(slug)`. One slug per round forever; re-render **overwrites in place** (`rm -rf` the dir, same slug) so shared links never break. `CREATE TABLE IF NOT EXISTS` → created automatically on bot-ui boot (verified present in prod `league.db`).

**Method (per the spike decision):** capture the same-origin `/_app/` asset closure a real hydrated load fetches → rewrite page→entry `../_app/`→`./_app/` → write the tree verbatim. **Spike follow-ups addressed:**
- **(1) Fonts localized** — fetch the Google-Fonts CSS + every `woff2` (Chrome UA), save under `_app/fonts/` + `_app/fonts.css`, rewrite `url()`s; swap the doc's Google `<link>`s for the local stylesheet. Result: **0 `fonts.googleapis/gstatic` refs** (23 woff2 bundled). Artifact is now self-contained for fonts.
- **(3) Auth probe neutralized** — inject a tiny `<head>` script that patches `window.fetch` to short-circuit `/api/ml-auth*` (the `MlAuthBadge` 60 s poll) → no failed request on the backendless host.
- **(2) Root-absolute `<link rel=icon|apple-touch-icon|manifest>` dropped** (would 404 under `/d/<slug>/`).

**Verified — r104 (HJ S3) + r101 (Fam Jam S3):** both write working artifacts (41 files each); **re-render resolves to the SAME slug and overwrites in place** (stableSlug ✓); content is distinct (`<title> r-104` vs `r-101`); served via the real `digest-static` caddy (`:8088`) the **tap-modal opens** for both (r104 "Mashew", r101 "Em" → "Hide and Seek — Imogen Heap"), **0 page errors**. Sweep across both artifacts: **0 `mlb.mattmariani.com`**, **0 google-fonts**, 0 icon/manifest links, auth-probe guard present. `npm run check` → 0 errors. bot-ui rebuilt `--no-cache` (33 s, no chromium download) + deployed. Persisted slugs: **104→`v0lGP7SftWx-FQ3S`, 101→`xEAD2nPUSuURtX5o`** (stable; export-endpoint will resolve the same).
- New env: `DIGESTS_DIR=/app/digests`, `PUBLIC_DIGEST_BASE_URL` (default `https://digest.mattmariani.com`).
- **Prod end-to-end** invocation of the exported `renderDigestHtml()` is wired by **export-endpoint** (next task); render-pipeline verified here via an equivalent harness exercising the REAL prod app + REAL `league.db` (`digest_shares`) + REAL `./digests` volume + REAL caddy.
- **New follow-up (not in the original spike, not acceptance-blocking):** r101 embeds **album art from Spotify's CDN (`i.scdn.co`)** — external but benign (public image CDN; not mlb/app/DB; **no hostname leak**). r104 had none. For fully-offline artifacts a later pass could localize cross-origin `<img>` art; acceptance (no mlb ref + interactivity) is already met.

### 2026-06-05 — backend — digest-static-container DONE (deployed) → **🔔 USER: cf-tunnel is unblocked — ingress mapping below**
Added a static-only `digest-static` service (caddy:2-alpine, no app/DB, **no Access**) serving the shared `digests/` volume **read-only**; the same volume is mounted **read-write** into `bot-ui`.

**>>> CLOUDFLARED INGRESS MAPPING (cf-tunnel — create a SEPARATE, PUBLIC tunnel, NO Access policy) <<<**
```yaml
# In the NEW digest tunnel's config (distinct from the mlb tunnel):
ingress:
  - hostname: digest.mattmariani.com
    service: http://192.168.4.217:8088   # → digest-static container (host-published 8088 → container :8080)
  - service: http_status:404
```
- Public host endpoint the tunnel targets: **`http://192.168.4.217:8088`** (same-host cloudflared may use `http://localhost:8088`). Mirrors the mlb pattern (`mlb → 192.168.4.217:3002`) but **must be a separate tunnel, public / NO Access** (D2/D6).
- Live test artifact already in the volume: **`https://digest.mattmariani.com/d/spike-hjs3-r104/`** (the proven spike sample) — use it to confirm the tunnel resolves with no login. render-pipeline will replace it with real per-round slugs.

**Wiring (docker-compose.yml):**
- `bot-ui`: added `./digests:/app/digests` (rw) + env `DIGESTS_DIR=/app/digests` (render-pipeline writes here).
- `digest-static`: `./digests:/srv/digests:ro` + `./Caddyfile.digest:/etc/caddy/Caddyfile:ro`; ports `8088:8080`.
- `Caddyfile.digest`: `root /srv/digests`, `file_server` (serves `<dir>/index.html` for trailing-slash dirs, 308-redirects bare dirs; **no browse**), gzip/zstd, `Cache-Control public,max-age=300`, `admin off`/`auto_https off`. `digests/` added to `.gitignore` + `.dockerignore` (generated, not source).

**Verified (deployed):** `docker compose up -d digest-static` + recreated `bot-ui`.
- `GET http://192.168.4.217:8088/d/spike-hjs3-r104/` → **200** `text/html`; `/d/<slug>` (no slash) → **308** → trailing slash; `_app/.../start.*.js` → **200 `text/javascript`** (correct for ESM); unknown slug → **404**.
- Volume split confirmed: `bot-ui` WROTE `/app/digests/.rw-probe` OK; `digest-static` write → **`Read-only file system`** (ro enforced).
- **End-to-end through the real caddy container** (headless chromium → `:8088/d/spike-hjs3-r104/` → tap bucket): `{modalOpened:true, modalTitle:"Mashew", pageErrors:[]}`.
- `npm run check` → 0 errors (31 pre-existing warnings).

### 2026-06-05 — backend — packaging-spike DONE → **mechanism decided; render-pipeline + digest-static-container unblocked**
**Result: PROVEN.** A self-contained, still-interactive r104 (HJ S3) digest served by a plain `python3 -m http.server` (NO app/DB process) loads in chromium and the **tastemaker tap-modal opens** — tapping a bucket → chunked-bar song modal ("RECOGNIZABLE · 1 song · Mashew" → "Fight For Your Right — Beastie Boys, ob 13"). 0 page errors, 0 failed requests, **0 `mlb.mattmariani.com`** strings across all served files. Screenshot: `/tmp/html-share-spike/modal-open.png`.

**DECISION — folder-per-slug (SSR HTML + bundled `_app/` assets). NOT single-file.**
- Why not single-file: the app is SvelteKit (Svelte 5 runes, adapter-node) and code-splits via native ESM `import()` of `_app/immutable/{entry,chunks,nodes}/*.js`. Inlining a dynamic ESM module graph into one file (import-maps + blob/data-URLs) is fragile and fights the framework. Folder-per-slug is the spec's leading candidate and the robust fit. Artifact is tiny (~492 KB / 20 files for r104), so per-slug asset duplication is a non-issue.

**How data/JS/assets are embedded:**
- **Data:** the full digest payload (every section incl. tastemaker `players[].songs/buckets`) is **inlined into the SSR HTML** by `+page.server.ts` at render time. The tap-modal (`TastemakerSection.svelte` `openModal`) reads already-loaded props (`p.songs`) — **no fetch at tap-time**, so interactivity needs zero backend. Confirmed `?export=1` is NOT set (it would disable the modal, sprint-18) → interactivity ON.
- **JS/CSS:** capture the full same-origin asset closure the browser loads during a real hydrated view of `/digest/<id>` (entry `app.*.js`+`start.*.js`, transitively-imported `chunks/*` + route `nodes/*`, the section CSS) and save them **preserving the `_app/immutable/…` tree verbatim** — JS-to-JS relative imports then stay self-consistent regardless of where the folder is mounted.
- **The only rewrite:** page→entry refs `../_app/` → `./_app/` (page depth changes from `/digest/104` to `/d/<slug>/`). **The `./` prefix is mandatory** — a bare `_app/…` specifier is illegal for dynamic `import()` (the one bug found + fixed in the spike; symptom = `Failed to resolve module specifier`).

**On-disk + URL layout (for render-pipeline + digest-static-container):**
```
digests/                      ← shared volume root (digest-static serves this ro; bot-ui writes rw)
  d/<slug>/
    index.html                ← SSR HTML, interactivity ON, data inlined, ./_app refs
    _app/immutable/
      entry/{app,start}.*.js
      chunks/*.js
      nodes/{0,1,6}.*.js       ← root layout / layout / digest page
      assets/*.css
```
URL: `https://digest.mattmariani.com/d/<slug>/` (trailing slash → `index.html`). **digest-static must serve `d/<slug>/` as a directory with an index.** Slug is unguessable+stable-per-round (render-pipeline owns the store; spike used a readable `spike-hjs3-r104`).

**Render method for render-pipeline:** drive headless chromium (already in the sprint-19 base image) to load the LIVE page **without `?export=1`**, capture the SSR doc + same-origin asset closure, apply the single `../_app/`→`./_app/` rewrite, write the folder into `digests/d/<slug>/`. (Spike did this via puppeteer network-capture; productionize in `src/lib/digest/export.ts`.)

**Follow-ups for render-pipeline (noted, none block the spike's claim):**
1. **Google Fonts load from CDN** (`fonts.googleapis.com`/`gstatic.com`) — external but not app/DB. For a fully self-contained, zero-external, guaranteed-no-leak artifact, **localize the font CSS + woff2 into `_app/`** (recommended).
2. **Absolute-root assets** (`/manifest.webmanifest`, `/m-l-favicon-*.png`) 404 under `/d/<slug>/` — non-critical (page renders), rewrite to `./` or drop.
3. **Layout auth probe**: page fires a same-origin `GET /api/ml-auth/...` on load (captured as a static 200) — harmless on the static host; strip it.
4. **SPA nav links** (`/digest`, `/chat`, logo `/`) 404 on the static host — out of scope (single-digest view; no index page by D3).

Throwaway capture/verify scripts removed from `ui/` (kept the working sample at `/tmp/html-share-spike/`).

### 2026-06-05 — docs — Sprint plan created: html-share (sprint-20)
- 7 items: packaging-spike → (render-pipeline ∥ digest-static-container) → export-endpoint [backend]; html-export-ui [frontend, parallel]; cf-tunnel [USER, parallel]; e2e-verify [frontend, ← endpoint+ui+container+tunnel]
- 4 backend / 2 frontend / 1 user / 0 viz (viz idle); spec-driven (`digest-html-share-spec.md`, approved)
- spike-led: packaging-spike gates render-pipeline + digest-static-container (artifact shape). Kickoff = packaging-spike (backend) ∥ html-export-ui (frontend) ∥ cf-tunnel (user) in parallel
- methodology: testing none / review none — no TDD or review scaffolding; acceptance gates on `npm run check` + prod/public-URL verification
- key constraints pre-noted: existing `?export=1` disables interactivity (HTML path must keep it ON); `html` extends the EXISTING export route, not a new one; mlb hostname must not leak (e2e check)
- sprint-19 (deploy-and-mobile) closed + pushed so the warren advances here
