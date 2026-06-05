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

- [ ] {agent: backend, id: packaging-spike} **SPIKE (gating).** Prove a self-contained, still-interactive digest can be served from a dumb static host (no app backend). Render one round's digest with interactivity ON (do NOT use the `?export=1` static path), embed/bundle data + JS + assets, and confirm a client-side interaction survives. Try the leading approach (SSR + bundled assets in a `<slug>/` folder) vs a true single-file build; pick one. Throwaway code is fine — **the decision + a working sample are the deliverable.**
  - **Acceptance:** a sample artifact for HJ S3 r104 served by a plain static server (e.g. `python3 -m http.server` or a throwaway caddy) with **no app/DB process running** loads in a browser and the **tastemaker tap-modal opens** (bucket count → chunked-bar song modal). Chosen mechanism (folder-vs-single-file), how data/JS/assets are embedded, and the on-disk + URL layout (`/d/<slug>/…`) recorded in the Activity Log for render-pipeline + digest-static-container.

- [ ] {agent: backend, id: render-pipeline, depends: packaging-spike} Productionize the spike into a render function in `src/lib/digest/export.ts` (e.g. `renderDigestHtml(roundId)`) that renders any round's full digest to the self-contained artifact **with interactivity ON**, under the round's **stable unguessable slug**, and writes it into a shared `digests/` volume. Persist the **slug ⇄ round mapping** (DB row or json manifest in the volume — your call) so a round always resolves to the same slug and re-render overwrites in place.
  - **Acceptance:** `renderDigestHtml()` writes a working artifact for **r104 (HJ S3)** and **r101 (Fam Jam S3)** into the `digests/` volume at the spike's layout; re-running for the same round resolves to the **same slug** and overwrites (mapping persisted); the served artifact contains **no `mlb.mattmariani.com`** reference (relative/embedded assets only). `npm run check` passes.

- [ ] {agent: backend, id: digest-static-container, depends: packaging-spike} Add a **`digest-static`** service (caddy/nginx, static file server only — no app, no Access) to `docker-compose.yml`, serving the shared `digests/` volume **read-only**; the same volume is mounted **read-write** into `bot-ui` (which writes artifacts). Expose it on an internal port. Document the **cloudflared ingress entry** the user's tunnel needs (`digest.mattmariani.com` → `digest-static:<port>`) — cloudflared is host/CF-managed, so this is the config the USER applies in the cf-tunnel step.
  - **Acceptance:** `docker compose up -d digest-static` serves a file placed in the `digests/` volume at `http://192.168.4.217:<port>/d/<slug>/` (or the spike's layout) → **HTTP 200**; the shared volume is mounted into both `bot-ui` (rw) and `digest-static` (ro); the exact cloudflared ingress mapping for the user is written to the Activity Log. Deployed; `npm run check` passes.

- [ ] {agent: backend, id: export-endpoint, depends: render-pipeline} Extend the **existing** export route `src/routes/api/digest/[roundId]/export/+server.ts` to handle **`format: 'html'`**: call `renderDigestHtml`, write to the `digests/` volume, and return the public URL `https://digest.mattmariani.com/d/<slug>`. Do NOT add a new route — extend the existing format dispatch (peer of pdf/mobile/wide/png-sections).
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

### 2026-06-05 — docs — Sprint plan created: html-share (sprint-20)
- 7 items: packaging-spike → (render-pipeline ∥ digest-static-container) → export-endpoint [backend]; html-export-ui [frontend, parallel]; cf-tunnel [USER, parallel]; e2e-verify [frontend, ← endpoint+ui+container+tunnel]
- 4 backend / 2 frontend / 1 user / 0 viz (viz idle); spec-driven (`digest-html-share-spec.md`, approved)
- spike-led: packaging-spike gates render-pipeline + digest-static-container (artifact shape). Kickoff = packaging-spike (backend) ∥ html-export-ui (frontend) ∥ cf-tunnel (user) in parallel
- methodology: testing none / review none — no TDD or review scaffolding; acceptance gates on `npm run check` + prod/public-URL verification
- key constraints pre-noted: existing `?export=1` disables interactivity (HTML path must keep it ON); `html` extends the EXISTING export route, not a new one; mlb hostname must not leak (e2e check)
- sprint-19 (deploy-and-mobile) closed + pushed so the warren advances here
