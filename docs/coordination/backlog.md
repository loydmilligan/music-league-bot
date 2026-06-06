---
project: music-league-bot
type: backlog
created: 2026-05-20T00:00:00Z
updated: 2026-06-04T00:00:00Z
---

# music-league-bot — backlog

> Items deferred from active sprints. These are paused, not in flight. When ready to pull, move into `docs/coordination/sprint-N.md` under `## Active Sprint Plan`.

---

## YouTube Music play button alongside Spotify (drafted 2026-05-20) — ✅ PULLED into sprint-13 (2026-06-02)

**Source:** user request 2026-05-20 while wrapping sprint-10. Every song card in the webapp currently has a Spotify play button. We want a parallel YTM play button so the user can listen via whichever service they prefer.

**Problem.** Songs in `shortlist_songs` (and elsewhere) typically have a Spotify URL but no YTM URL (or vice versa for songs ingested via the YTM extension path once that lands). When the user wants to play via YTM but only the Spotify link is cached, today they have nothing to click. We have a Songlink integration that can resolve one to the other.

**Direction.**

1. **DB layer.** `shortlist_songs` (and any other song table — `ml_submissions`, `research_songs`, `chat_songs`) needs a `ytm_url` column if it doesn't already have one. Check the schema first — `ytm_link_cache` and `ytm_resolution_queue` exist; the cache may already handle this. Reuse before adding columns.

2. **Resolution endpoint.** `POST /api/songs/:id/resolve-ytm` (or generic `POST /api/songlink/resolve` that takes a Spotify URL + song id). When called:
   - If `ytm_url` is already populated, return it (idempotent).
   - Else: hit Songlink with the Spotify URL, extract YouTube Music link from the response, persist to `ytm_url` (or to `ytm_link_cache`), return.
   - On failure (no YTM equivalent on Songlink): persist a "no-match" marker so we don't re-call Songlink for the same Spotify URL on every click.

3. **Reverse direction (YTM → Spotify).** Symmetrical — `POST /api/songs/:id/resolve-spotify` when the song was ingested via the YTM extension path and only has `ytm_url`. Reuses the same Songlink call (it returns both directions).

4. **UI affordance.** Wherever the Spotify play button renders, add a YTM play button. Two states:
   - **Resolved:** YTM URL is in the row → button is a direct `<a>` to the YTM URL.
   - **Unresolved:** YTM URL is missing → button triggers the resolve endpoint, shows a small spinner, then re-renders as the resolved direct link (or shows "no YTM match" if Songlink returned no equivalent).
   - Reverse for songs that only have YTM URLs.

5. **Background backfill (optional).** A small worker that periodically scans for rows missing one platform URL and pre-resolves via Songlink, so the UI button is almost always pre-resolved by the time a user clicks. Probably not v1 — start with on-click resolution and add the backfill if the UX needs it.

**Why this matters.** User has a strong YTM preference for some listening contexts; today the only path is to manually search YTM for the song. The Spotify/Songlink/YTM integration is already plumbed for ingest (sprint-10 T9); this is the consumer-side of the same data.

**Open questions.**

- Where does the YTM play button live visually relative to the Spotify button? Stacked, side-by-side, behind a menu? Probably side-by-side, with the unresolved state visually distinguished (faded or with a tiny resolve icon overlay).
- Do we want analytics on resolve attempts? (How many times "no YTM match" comes back per song would inform whether to surface that more prominently or hide the button entirely for un-resolvable songs.)
- The user mentioned this should work bidirectionally — Spotify-only songs should get YTM via resolve, and YTM-only songs should get Spotify via resolve. Confirm Songlink response shape supports both (likely yes — Songlink returns all platforms by default).
- Caching policy: how long is a Songlink result good for? Songlink URLs typically don't change, so persistent cache is fine; only invalidate if a song is re-resolved manually by an operator.

**Pairs with:** Sprint-10 T9 (YTM Songlink backend ingest path — already shipped, has the deferred debug bug; that debug informs the same code path this feature uses).

## Deferred from sprint-16 (2026-06-03)

- **Add-player capability on the standings section.** Extend `POST /api/digest/[roundId]/standings` with `action: 'add-player'` (backend: upsert a `competitors` row + create an `ml_submissions` row in the round + write gospel via `applyEdits` — there is no separate roster table; the submission row *is* season/league membership) plus an "add player" form in `EditableStandingsTable.svelte` (frontend). **Why deferred:** the sprint-16 importer parser fix resolved the missing-player bug (Lori + all 7 orphan rounds) systemically, so add-player is now only a general manual-correction tool, not a needed fix. Pull when a manual-add need actually arises. Full task specs + acceptance preserved in `docs/coordination/sprint-16.md` (tasks `add-player-endpoint`, `add-player-ui`).

## Cache chromium in a stable Docker layer (drafted 2026-06-04) — do-next candidate

**Source:** user, 2026-06-04, after watching a `--no-cache` deploy spend 15–25 min re-downloading chromium over wifi.

**Problem.** `CLAUDE.md`'s deploy command is `docker compose build --no-cache bot-ui`. `--no-cache` invalidates *every* layer, so `Dockerfile.ui`'s `apt-get install -y --no-install-recommends chromium fonts-liberation` (line 23) **re-fetches ~150 MB of chromium on every deploy**, even when only app code changed. chromium is required for the digest PNG export (`ui/src/lib/digest/export.ts` → `puppeteer-core` → `/usr/bin/chromium`, set via `PUPPETEER_EXECUTABLE_PATH`), so it can't be dropped. The user confirmed `--no-cache` is still wanted *at times* (clean rebuilds) — so the fix must keep chromium cached **without** forcing the operator to give up `--no-cache` on the app image.

**Direction (lane: backend / infra).**
1. **Split the image:** move the `apt-get install chromium fonts-liberation` step into a **separate stable base image** (e.g. `Dockerfile.base` → `music-league-bot-base:chromium`) that the app `Dockerfile.ui` then `FROM`s. The base rarely changes, so it's built once and reused.
2. **Adjust the deploy flow** so `--no-cache` rebuilds only the *app* layers (`docker compose build --no-cache bot-ui`) while the chromium base stays cached. Update `CLAUDE.md`'s deploy instruction to match (rebuild base only when the chromium/base layer actually changes).
3. **Verify:** a normal `--no-cache bot-ui` deploy no longer re-downloads chromium (build time drops from ~15–25 min to a couple of minutes); PNG export still works on prod (chromium present at `/usr/bin/chromium`).

**Why it matters.** Every deploy on this prod-first project currently pays the chromium-download tax; this is the single biggest deploy-latency win available. User wants `--no-cache` preserved for occasional clean rebuilds, so don't just drop the flag — restructure the layers.

**Open question.** Pin a chromium version in the base image (reproducible, but needs manual bumps) vs. `apt-get install chromium` unpinned (auto-updates, but the base must be periodically rebuilt)? Probably unpinned base + periodic rebuild.

## Mobile / Android PWA missing the digest-generation menu (drafted 2026-06-04) — fix needed

**Source:** user, 2026-06-04. On the **Android PWA** and at **mobile viewport sizes**, the menu items to **choose / start digest generation are absent** — so a mobile user can't initiate a digest the way a desktop user can. Desktop has the option; mobile does not.

**Problem.** The digest-generation entry point (the menu/nav action that opens digest generation — the `GenerateModal` flow) is not rendering (or not reachable) in the mobile/PWA layout. Needs investigation: is it a responsive nav that drops the item below a breakpoint, a hamburger/overflow menu that omits it, or a PWA-shell nav that was never wired? Confirm where the desktop entry point lives, then ensure an equivalent reachable affordance exists on mobile + PWA.

**Direction (lane: frontend).**
1. **Reproduce + locate:** find the desktop digest-generation menu entry point; check the responsive/mobile nav and the PWA shell for why it's missing (breakpoint hiding, overflow menu, or absent).
2. **Add a reachable mobile affordance:** surface the digest-generation action in the mobile nav / PWA menu (overflow menu, bottom sheet, or visible button — match the existing mobile nav pattern).
3. **Verify on a real mobile viewport + the installed Android PWA:** the user can reach digest generation and open the GenerateModal; the flow completes (web render + mobile-PNG export).

**Why it matters.** The digest is the project's flagship output and the user consumes/operates it from a phone (WhatsApp digest workflow). Not being able to *start* a digest from mobile/PWA is a real workflow gap, not polish. Pairs with the sprint-18 `integration-audit` (GenerateModal control-surface coverage) but is distinct — that audits the modal's *contents*; this is about *reaching* the modal at all on mobile.

## HTML share export — auto mobile + desktop friendly (drafted 2026-06-06) — sprint AFTER the History milestone

**Source:** user, 2026-06-06. The **`html` share export** (sprint-20, `digest.mattmariani.com`) is becoming the **main export for digests**, but it currently really only works/looks right on **desktop**. It must be **automatically responsive** — render well on **mobile AND desktop** from the same self-contained artifact (recipients open the link on phones).

**Direction (frontend/digest lane).** The html-share render packages the existing interactive digest page; make that artifact responsive so it reflows cleanly at phone widths (the digest content cards have a known ~390px horizontal-overflow nit — flagged in sprint-20 e2e-verify — fix that here). Verify on a real mobile viewport + desktop on the live `digest.mattmariani.com/d/<slug>/` artifact. Likely overlaps the digest's general mobile responsiveness (sprint-19 added mobile nav; the digest *content* still needs a mobile pass).

**Sequencing:** **after** the History research milestone (sprint-22+) lands. Pairs with the pre-existing "digest content-card ~390px overflow" nit.
