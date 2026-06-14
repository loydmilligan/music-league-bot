---
project: music-league-bot
type: backlog
created: 2026-05-20T00:00:00Z
updated: 2026-06-13T00:00:00Z
---

# music-league-bot — backlog

> Items deferred from active sprints. These are paused, not in flight. When ready to pull, move into `docs/coordination/sprint-N.md` under `## Active Sprint Plan`.

---

## ⭐ Next up (owner, updated 2026-06-13)

- **Likely next sprint: Producer Sprint 2 — submission predictor** ("what would they submit?"), pending owner final-confirm.
- The **chromium Docker-layer caching** infra item is **demoted to LOW priority** — the cached-deploy workflow (one `docker compose build bot-ui` *without* `--no-cache` per gate) sidesteps the chromium re-download tax, so the problem isn't being paid right now. Revive only if `--no-cache` deploys (and the 15–25 min tax) come back.

*(The "Music League Producer" milestone is the active throughline — see
`docs/superpowers/specs/2026-06-13-player-prediction-sprint1-design.md` and the
Producer follow-ons section below.)*

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

## Cache chromium in a stable Docker layer (drafted 2026-06-04) — ⬇️ LOW priority (demoted 2026-06-13; cached-deploy workflow sidesteps it)

**Source:** user, 2026-06-04, after watching a `--no-cache` deploy spend 15–25 min re-downloading chromium over wifi.

**Problem.** `CLAUDE.md`'s deploy command is `docker compose build --no-cache bot-ui`. `--no-cache` invalidates *every* layer, so `Dockerfile.ui`'s `apt-get install -y --no-install-recommends chromium fonts-liberation` (line 23) **re-fetches ~150 MB of chromium on every deploy**, even when only app code changed. chromium is required for the digest PNG export (`ui/src/lib/digest/export.ts` → `puppeteer-core` → `/usr/bin/chromium`, set via `PUPPETEER_EXECUTABLE_PATH`), so it can't be dropped. The user confirmed `--no-cache` is still wanted *at times* (clean rebuilds) — so the fix must keep chromium cached **without** forcing the operator to give up `--no-cache` on the app image.

**Direction (lane: backend / infra).**
1. **Split the image:** move the `apt-get install chromium fonts-liberation` step into a **separate stable base image** (e.g. `Dockerfile.base` → `music-league-bot-base:chromium`) that the app `Dockerfile.ui` then `FROM`s. The base rarely changes, so it's built once and reused.
2. **Adjust the deploy flow** so `--no-cache` rebuilds only the *app* layers (`docker compose build --no-cache bot-ui`) while the chromium base stays cached. Update `CLAUDE.md`'s deploy instruction to match (rebuild base only when the chromium/base layer actually changes).
3. **Verify:** a normal `--no-cache bot-ui` deploy no longer re-downloads chromium (build time drops from ~15–25 min to a couple of minutes); PNG export still works on prod (chromium present at `/usr/bin/chromium`).

**Why it matters.** Every deploy on this prod-first project currently pays the chromium-download tax; this is the single biggest deploy-latency win available. User wants `--no-cache` preserved for occasional clean rebuilds, so don't just drop the flag — restructure the layers.

**Open question.** Pin a chromium version in the base image (reproducible, but needs manual bumps) vs. `apt-get install chromium` unpinned (auto-updates, but the base must be periodically rebuilt)? Probably unpinned base + periodic rebuild.

## Mobile / Android PWA missing the digest-generation menu (drafted 2026-06-04) — ✅ COMPLETE (owner-confirmed 2026-06-13)

**Source:** user, 2026-06-04. On the **Android PWA** and at **mobile viewport sizes**, the menu items to **choose / start digest generation are absent** — so a mobile user can't initiate a digest the way a desktop user can. Desktop has the option; mobile does not.

**Problem.** The digest-generation entry point (the menu/nav action that opens digest generation — the `GenerateModal` flow) is not rendering (or not reachable) in the mobile/PWA layout. Needs investigation: is it a responsive nav that drops the item below a breakpoint, a hamburger/overflow menu that omits it, or a PWA-shell nav that was never wired? Confirm where the desktop entry point lives, then ensure an equivalent reachable affordance exists on mobile + PWA.

**Direction (lane: frontend).**
1. **Reproduce + locate:** find the desktop digest-generation menu entry point; check the responsive/mobile nav and the PWA shell for why it's missing (breakpoint hiding, overflow menu, or absent).
2. **Add a reachable mobile affordance:** surface the digest-generation action in the mobile nav / PWA menu (overflow menu, bottom sheet, or visible button — match the existing mobile nav pattern).
3. **Verify on a real mobile viewport + the installed Android PWA:** the user can reach digest generation and open the GenerateModal; the flow completes (web render + mobile-PNG export).

**Why it matters.** The digest is the project's flagship output and the user consumes/operates it from a phone (WhatsApp digest workflow). Not being able to *start* a digest from mobile/PWA is a real workflow gap, not polish. Pairs with the sprint-18 `integration-audit` (GenerateModal control-surface coverage) but is distinct — that audits the modal's *contents*; this is about *reaching* the modal at all on mobile.

## HTML share export — auto mobile + desktop friendly (drafted 2026-06-06) — ✅ COMPLETE (sprint-23, `e2c0d9d`, user-confirmed live)

**Source:** user, 2026-06-06. The **`html` share export** (sprint-20, `digest.mattmariani.com`) is becoming the **main export for digests**, but it currently really only works/looks right on **desktop**. It must be **automatically responsive** — render well on **mobile AND desktop** from the same self-contained artifact (recipients open the link on phones).

**Direction (frontend/digest lane).** The html-share render packages the existing interactive digest page; make that artifact responsive so it reflows cleanly at phone widths (the digest content cards have a known ~390px horizontal-overflow nit — flagged in sprint-20 e2e-verify — fix that here). Verify on a real mobile viewport + desktop on the live `digest.mattmariani.com/d/<slug>/` artifact. Likely overlaps the digest's general mobile responsiveness (sprint-19 added mobile nav; the digest *content* still needs a mobile pass).

**Sequencing:** **after** the History research milestone (sprint-22+) lands. Pairs with the pre-existing "digest content-card ~390px overflow" nit.

## Digest page client-side 500 in dev — `llm.ts` imports `node:crypto` (flagged sprint-27) — bug

**Source:** frontend agent during sprint-27 collision re-verification (2026-06-13). While driving the dev UI for the C2/C3/C4 repros, the **digest page throws a client-side 500** because `llm.ts` imports `node:crypto`, which gets pulled into a client bundle. **Pre-existing since sprint-21** — NOT a sprint-27 regression (the sprint-27 fixes are unrelated DB/importer/derivation changes), so it did not block the gate; carried forward here.

**Problem.** A server-only module (`node:crypto` consumer in `llm.ts`) is reachable from the digest route's client graph, so SvelteKit tries to bundle `node:crypto` for the browser and the page 500s in dev. Needs investigation: is `llm.ts` imported (transitively) by a `+page.svelte` / `+page.ts` load that runs client-side, when it should be `+page.server.ts` / `$lib/server/` only?

**Direction (lane: frontend/backend).**
1. **Locate the leak:** trace what on the digest route imports `llm.ts` and why it lands in the client bundle (likely a shared import that should be server-only).
2. **Fix the boundary:** move the crypto-using code behind `$lib/server/` (SvelteKit server-only enforcement) or split `llm.ts` so the client graph never pulls `node:crypto`; if only a hash util is needed client-side, use a Web Crypto equivalent.
3. **Verify:** digest page loads with 0 console errors in dev at desktop + 412×892; prod unaffected (it already builds, so this is primarily a dev-bundle correctness fix — confirm).

**Why it matters.** It makes the digest page un-loadable in `npm run dev`, which is exactly where UI agents do hands-on verification — every digest-touching sprint pays a friction tax working around it. Low user-facing severity (prod builds), but it degrades the dev/verify loop. Also recorded as a known caveat in CHANGELOG `[1.0.5]`.

---

# Producer milestone — Sprint-1 follow-ons & adjacent ideas (drafted 2026-06-13, owner brainstorm)

## Player Research tab — section tooltips (drafted 2026-06-13) — S, ready

**Source:** owner, 2026-06-13, after the sprint-28 panels shipped. Each section of the Player Research per-player panel should have an info tooltip (ⓘ / hover or tap) explaining what it is and how to read it. Copy is owner-approved below — implementing agent just drops these strings in.

**Tooltip copy (final):**
- **Songs Submitted:** "Every song this player has submitted across all leagues, ranked by the points it earned (shown on the right)."
- **Taste Overlap:** "How closely each other player's taste matches this one — scored on the songs they *both* gave points to (0–100%). Higher means more similar taste, so it's a quick read on whose votes tend to move together." — **NOTE:** revise this string when the Taste Overlap rework lands (see next item); the current copy describes the current global-Jaccard method.
- **Dossier:** "Your own notes on this player — freeform context plus taste tags, wild guesses welcome. It's yours: the AI fingerprint never overwrites it, and both feed the predictions."
- **Taste Fingerprint:** "An AI read of this player's taste — signature artists, genres, eras, and what they reward vs. punish — drafted from their full submission and voting history. Regenerate to refresh it (small LLM cost); it never overwrites your Dossier notes."
- **Vote Probe:** "Give it a song + a theme and it estimates how this player would react: a standalone affinity score (0–100), the points they'd likely give, and the reasoning — all grounded in their real history. It scores one song for one player, not a whole round."

**Direction (lane: frontend).** Add a consistent tooltip affordance per section header in `PlayerResearchTab.svelte` (match Mash Co. tokens; tap-friendly at 412×892). Coupled to the Taste Overlap rework for that one string.

## Taste Overlap — method rework (two honest metrics) (drafted 2026-06-13) — M, owner-approved approach

**Source:** owner, 2026-06-13. The current Taste Overlap is Jaccard over the *global* set of songs each player rewarded, so it measures **shared exposure, not shared taste**: players who never sat in the same rounds get a misleadingly low % (e.g. Jon Black, Second-Best-only, shows low overlap with everyone in Hip Jammers / Fam Jam simply because he couldn't vote on those songs — and even with Mara/Matt, who *are* in Second Best but also play two leagues Jon isn't in).

**Direction — split into two labeled metrics** (owner approved this shape):
1. **Vote Agreement (within shared rounds)** — the quick fix done right. Compare only songs *both players could actually vote on* (songs in rounds they both played); of those, how often did they agree (both reward / both pass). Players with zero shared rounds show **"no shared rounds"**, not a fake low %. Pure existing data. Strictly better than "same-league only" — also fixes the in-league-different-rounds skew.
2. **Taste Similarity (cross-league, content-based)** — compare players by the *attributes* of the music they reward, not the specific songs, so it works across leagues. **Now (cheap):** compare the AI taste fingerprints (shared signature artists / genres / rewards-punishes). **Later (richer):** taste vectors from song metadata (genre/bpm/audio features) + cosine — depends on the Theme Research metadata item below.

Render as two separate bars, not one blended number — they answer different questions ("whose votes move with mine here" vs. "whose taste is like mine anywhere").

## Head-to-Head — group SAS button (drafted 2026-06-13) — S–M

**Source:** owner, 2026-06-13. Add a button on the round **Head-to-Head** tab that runs SAS for **both candidate songs across all OTHER players in the round** (exclude the owner / submitter). **Purpose: help the owner decide which of their two candidate songs is the better submission for their league** — show a projected vote-total per song (e.g. "Song A ~12 vs Song B ~6") as a decision-useful stand-in for how the group would receive each. (Not a literal vote prediction, but a strong proxy — and effectively a 2-song round simulation, a stepping-stone toward the Sprint-3 whole-round predictor.)

**Direction (backend + frontend).** Reuse the sprint-28 `vote-probe` task. Cost discipline is the design constraint (~2 songs × N players):
- **Pin a cheap model** for this task (Haiku-tier) via the harness's per-task model override — keep it off the high-end model.
- **Use each player's cached *taste fingerprint* as the SAS context, not their full history** (the fingerprint is a ~200-token taste compression — the biggest token saving; auto-generate a missing fingerprint or fall back to slim history).
- **Cache** results by `(player, song, theme)` (already logged in `prediction_runs`) so re-opening a matchup is free.
- **Small-group batching (3–5 players/call)** is worthwhile *on top of* compact fingerprint-context (shares song+theme+system tokens), but NOT a 27-player mega-call (quality + all-or-nothing failure).
- Output: per-song aggregate (total/avg projected points across the group) → "Song A projected over Song B," with the per-player breakdown available.

## Screen / feature inventory + diagram (Obsidian doc) (drafted 2026-06-13) — S–M, NOT-NOW (doc task)

**Source:** owner, 2026-06-13. Navigation/screen naming has drifted — most glaringly a separate **Setup** AND **Settings** screen, which is confusing. Before any redesign, produce an accurate **inventory of features by screen** plus a **visible diagram (mermaid or similar)** of the current menu items and each screen's layout.

**Direction (lane: docs/research).** Create an md note in the **Obsidian project dir** (vault `~/.config/taw/wiki/`, project-note frontmatter per house convention) containing: (1) a feature-by-screen inventory (every screen, its sections, what each does, which API/data it reads), (2) a mermaid diagram of the current nav tree + per-screen layout. **Purpose: hand this to Claude design as the basis for proposing how to rename / combine / reorder screens (esp. Setup vs Settings).** This item is just the inventory+diagram; the redesign is a separate later effort.

## Universal Share button (drafted 2026-06-13) — L, needs own spec

**Source:** owner, 2026-06-13. A reusable share control on as many elements as possible. Motivation: sharing a screenshot once leaked the internal mlb app URL — owner wants every share to go out under **`digest.mattmariani.com`**, never the app's own subdomain.

**Shape (owner-specified).** A share-arrow icon button → modal/slideout with a **two-stage picker: format first, then destination.**
- **Formats:** HTML (hosted on `digest.mattmariani.com` via the existing digest exporter / sprint-20 render pipeline), PNG, PDF.
- **Destinations:** Download, WhatsApp, Copy link. For HTML → host + copy the public link; for PNG/PDF → render, upload to `digest.mattmariani.com` to host the file, copy the link. **Toast/popup** confirms when the link/clipboard is ready.
- Hosting under `digest.mattmariani.com` for ALL formats is the load-bearing requirement (hide the app URL). Reuses the existing exporter/host plumbing — mostly generalizing it to arbitrary elements.

**Placement.** Every digest section; history sections; the Player Research panels (Songs Submitted, Taste Overlap, Dossier, Taste Fingerprint, Vote Probe); Theme Research theme cards; "+ wherever else makes sense."

**Open questions (resolve in spec):**
- WhatsApp destination: generic share (wa.me link handoff) vs. post into a specific group via mlb's existing WhatsApp integration ("specific conversation options")? Pick the v1 scope.
- **Expiring links** — nice-to-have, NOT required for v1 (owner flagged). Decide whether to bake an expiry concept into the hosted-file model now or later.
- A clean "shareable element" abstraction so the button can wrap any section without bespoke export code per spot.

## Theme Research — song-metadata analysis (drafted 2026-06-13) — L, needs research + own spec

**Source:** owner, 2026-06-13. New analysis on **Theme Research**, available **only once a theme's playlist is populated**. Purpose: gather as much per-song metadata as possible to model player preferences far more richly (also feeds Taste Similarity above and the broader Producer engine).

**Candidate metadata per song:** title, artist, album, release date, **genre (multi-tag)**, **bpm**, singer gender (M/F), **key**, length, **lyrics** (likely its own category — see below), **listener/popularity counts** (already captured for the digest tastemaker section — reuse).

**Lyrics sub-properties (probably break out into its own category):** word count, unique-word count, meaning/themes, rhyme scheme, chorus-specific analysis. Note: owner's other project already resolves lyrics via **lrclib.net** (or transcribes from audio when not found) — reuse that approach/source here.

**Direction (lane: research → backend).**
1. **Research the data sources** — which APIs/tools yield genre/bpm/key/gender/audio-features (Spotify audio-features deprecation status?, MusicBrainz, AcousticBrainz, GetSongBPM, etc.) and at what cost/coverage. Lyrics via lrclib.net + transcription fallback.
2. Define a `song_metadata` store and a populate-on-demand flow per theme playlist.
3. Surface the analysis in Theme Research; feed taste vectors (Taste Similarity) + future predictors.

**Why it matters.** Audio/lyric attributes turn taste from "which songs" into "what *kind* of music," which is what makes cross-league comparison and stronger prediction possible. High-leverage but research-heavy — own spec.

## Obscurity / Discovery score (orc-proposed 2026-06-13) — S

For any candidate song, score how obscure it is **for this group** — reusing the listener/popularity counts already captured for the digest tastemaker section. High obscurity = likely to do well on the many themes that explicitly reward unfamiliar picks ("familiar songs should receive the least votes — Discovery points rule this season"). A direct picking aid, nearly free from existing data. Pairs with the Theme Research metadata item.

## Comment-required detector (+ later, a drafter) (orc-proposed 2026-06-13) — S now / M later

Auto-detect themes that **require** a comment to earn votes ("REQUIRED: explain your reasoning in the comment… make sure 'Show comment to others' is checked") and flag them in the UI so a required comment is never forgotten. Later: draft a comment in the player's voice. Connects to the broader comment-style / Producer line (the deferred ⑦ from the sprint-28 brainstorm).

## Orange-box / collision predictor (orc-proposed 2026-06-13) — M

Before committing a pick, predict likely **"orange-box" collisions** — an artist someone else is likely to submit for this theme — based on which artists tend to get submitted for similar themes historically. Helps avoid the familiar "someone already took my artist" surprise. Likely wants the historical submission patterns + possibly the song metadata.

## Shareable League Dashboard — public read-only league site (drafted 2026-06-13) — XL, needs own spec

**Source:** owner, 2026-06-13. A small **no-auth, read-only public website per league** —
hosted on the existing `digest.mattmariani.com` infra (same reason as the share button: a
shareable surface that never exposes the internal mlb app URL). It surfaces a curated,
read-only slice of what mlb already generates, for league members to browse. This is a
*consumer-facing* sibling to the operator app — distinct audience, distinct surface.

**Five content pillars:**
1. **Digest archive** — browsable history of past digests for the league, so members can
   re-read old ones. (Reuses the sprint-20 HTML digest render pipeline / `digest.mattmariani.com`.)
2. **Player profiles** — one per league member: taste fingerprint (sprint-28), **Player
   Overlap v2.0** (the two-metric rework — Vote Agreement + cross-league Taste Similarity —
   already in this backlog; this is a consumer of that fix), plus *fun* social content:
   - **Superlatives** — high-school-yearbook-style awards per player (e.g. biggest fan of X,
     biggest hater, most obscure taste, most consistent, etc.). Design the award set to be
     funny + flattering-enough; see strife note below.
   - **Biggest Fan / Biggest Hater** — the asymmetric vote relationships (who rewards vs.
     buries this player) — same data as the "Rival/Champion map" idea.
3. **League-wide KPIs** (and possibly **cross-league / all-league KPIs**) — stats about the
   league. **DESIGN CAREFULLY to avoid inter-family strife / annoyance** (owner flagged: these
   are family leagues — avoid metrics that read as ranking people as "worse," or that stoke
   rivalry in a bad way). Lean celebratory/quirky over leaderboard-brutal.
4. **Historical league results** — past seasons/rounds/standings, read-only.
5. **Recommendations + optional Discovery playlist** — from each player's taste fingerprint +
   past songs, recommend other artists/songs; optionally a generated **Discovery playlist**.
   If we do the playlist: **discuss how to make it funny / interesting / useful as a gentle
   nudge** — e.g. steer leagues toward certain behaviors, surface delightful finds — not just a
   flat recommender. Worth a dedicated design conversation.

**Why it matters.** Turns mlb's internal analysis into a shareable, social, members-facing
artifact — increases engagement, gives the leagues something to enjoy between rounds, and
showcases the prediction/taste work. It is also the natural public home for several other
backlog items (overlap v2.0, superlatives/rival map, share button).

**Open questions / dependencies (resolve in spec — this is XL, decompose into sub-projects):**
- Hosting/auth model: static-generated per league on `digest.mattmariani.com`? regenerated
  when? truly no-auth (public link) vs. unguessable slug?
- Depends on **Player Overlap v2.0** (backlog) for the profile overlap section.
- KPI selection needs an explicit "no-strife" design pass with the owner.
- Discovery playlist needs its own "make it fun/nudgey" design conversation.
- This is a big multi-pillar build — spec it as a milestone and decompose (archive, profiles,
  KPIs, history, recommendations are largely independent slices).

## Predict how a predicted pick will fare (orc+owner 2026-06-13) — S (once submission-predictor lands)

**Source:** owner, during the Sprint-2 submission-predictor spec. Take the **final predicted pick** from the submission predictor and run it through the **Vote Probe / H2H group SAS** to project how that song would *fare* in the group — closing the loop from "what will they submit" → "and how will it do." The Sprint-2 output schema is deliberately built so `prediction.{title, artist, spotify_url}` pipes straight into the SAS tasks; this item just wires that hand-off (a button on the predicted-pick card, or auto-run). Effectively a per-player mini round-prediction. Could live as part of the submission-predictor panel or alongside the H2H tool.

---

# Player Research cleanup + Producer enhancements (owner batch, 2026-06-13)

Ten items from owner review after sprint-29 shipped. Several are UX cleanup of the
Player Research tab; several deepen the prediction tools. Loosely ordered; can be
grouped into a "Player Research polish" sprint (1,2,5) + prediction-quality items.

## PR-1 — Collapsible Player Research sections, default collapsed (S)
Make each section of the per-player panel collapsible, **defaulting to collapsed** (the panel is very tall — sprint-28/29 stacked Songs, Taste Overlap, Dossier, Taste Fingerprint, Vote Probe, Submission Predictor). User opens what they want. Pairs with PR-5 (header redesign).

## PR-2 — Move the song list to the end (S)
Put **Songs Submitted at the bottom** of the per-player panel (it's the longest section — 60+ rows — and currently sits near the top, burying the prediction tools). Combine with PR-1 so it's collapsed by default.

## PR-3 — Ensure predictors use theme TITLE + DESCRIPTION (S) — partly already done; verify the UI path
**Current state (verified 2026-06-13):** both `voteProbe.ts` and `submissionPredict.ts` templates already emit `Name:` AND `Description:` for the theme. **The likely real gap is the UI/API path:** the theme dropdown carries the theme *string* (name) — confirm the frontend actually sends a real `description` (not an empty string) for real themes, and that freeform lets the user enter both. Fix: when a real theme is picked, look up + pass its stored description; for freeform, expose a description field. Acceptance: a probe/predict for a real theme shows the description reaching the model (log/inspect the prompt).

## PR-4 — Cache LLM-generated content (esp. costly calls) (M) — map below
Cache + persist LLM outputs so repeat views don't re-pay. **Wherever cached, ALWAYS track + display generation provenance: timestamp, model, cost, and call params.** (The Taste Fingerprint already does exactly this — use it as the template.)

**Map of LLM-generated areas and cacheability:**
| Area | Today | Cacheable? | Notes / problems |
|---|---|---|---|
| **Taste Fingerprint** | persisted to `player_profiles` + provenance; explicit Regenerate | ✅ already done | This is the reference pattern. |
| **Vote Probe / SAS** | logged to `prediction_runs`, but re-run = new call | ✅ yes | Cache key = (player_id, song, theme). **Staleness problem:** a player's history grows → a cached SAS can go stale. Mitigate: include a context/history fingerprint in the key (or accept staleness with the visible "generated at" stamp + Regenerate). |
| **Submission Predictor** | logged to `prediction_runs`, re-run = new call | ✅ yes (highest value — costliest) | Same key/staleness as SAS, keyed on (player_id, theme). |
| **Digest sections** | already cached (draft cached, explicit regen) | ✅ already done | Confirm parity of the provenance display. |
| **H2H group SAS** (future) | n/a yet | ✅ build it cached from day 1 | N players × 2 songs — caching is essential here. |
| **Taste Similarity / overlap v2 LLM bits** (future) | n/a | ✅ | Same staleness considerations. |

**Approach:** generalize the fingerprint pattern — on request, look up the latest matching `prediction_runs` row (by cache key) and return it with its provenance + a Regenerate button, instead of calling the model; only call on cache-miss or explicit regen. `prediction_runs` already stores input/output/model/cost — add the cache-key lookup + a staleness policy (data-version in the key, or time-based, or user-driven regen).

## PR-5 — Player picker redesign: player cards / carousel + rich header (M–L)
Replace the flat player-button list with a **card grid (desktop) / card carousel (mobile)**, where each card IS a rich player header:
- **slim by default, expandable**; expanded shows tags + a link to edit Dossier.
- **Badges:** which leagues the player is in; ever-on-the-podium (any season); currently top-3 in an active season; last place in a historical season; last place currently in an active season.
- **Uploadable / editable avatar** per player, managed right in the card.
The selected card's header sits atop the per-player panel. (Pairs with PR-1/PR-2 cleanup.)

## PR-6 — Submission Predictor: same-artist recency penalty (M)
Players almost never re-submit an artist they've already used **in the same league** — strongest within the same season, decaying over later seasons. Add an explicit penalty factor that multiplies the predicted likelihood of an already-used artist:
- **Same artist, same season:** factor ≈ **0.01** (e.g. a raw 50% → ~0.5%).
- **Following season:** ≈ **0.1**, then easing each subsequent year: ~**0.15 → 0.25 → 0.50 → 0.80**, **stalling at 0.80**.
(Numbers are owner ballpark — tune later.) Scope is **per-league** (the same artist in a *different* league isn't penalized). Implement either as prompt guidance with the player's already-used-artists-by-season list, or as a post-LLM re-weighting of candidate likelihoods (likely cleaner + more controllable as post-processing). Relates to PR-7 (the exclude checkbox is the hard version of this soft penalty).

## PR-7 — Submission Predictor: "exclude already-submitted artists" checkbox (S–M)
A checkbox to **exclude artists the player has already submitted** (in that league). Sub-option: **only exclude when the artist was the PRIMARY artist** — e.g. "Mona Lisa" by Lil Wayne feat. Kendrick should NOT count as a Kendrick submission for this filter. Needs primary-vs-featured artist resolution (from existing submission data / Spotify metadata). The hard-filter complement to PR-6's soft penalty.

## PR-8 — Player Research analysis: comments + WhatsApp chat toggles (M)
**Current state (verified 2026-06-13):** the player context ALREADY includes submission comments + vote comments. WhatsApp **chat mentions are NOT** included (they live in digest round data only).
- For the data already used (comments): add a **runtime checkbox to include/exclude** it from the analysis.
- For chat mentions (not yet used): add the **ability to fold WhatsApp chat data into the player-research LLM analysis**, behind an optional runtime checkbox. (Chat is where songs get discussed — rich signal.)

## PR-9 — Voting-weight dials for the prediction tools (M)
Add a set of **dials** (like the current settings-screen weighting) — percentages that must sum to 1 — that scale how songs are rated in the LLM prediction tools, **separate from** the existing settings-screen weighting. **Three factors** (in priority order, which matters):
1. **Appeal** *(owner's "Goodness" — orc suggests "Appeal" or "Crowd Appeal": do YOU like it and will others like it)* — most important.
2. **Discovery/Nostalgia** (is it new to people / likely new to the group) — note: owner is **combining nostalgia INTO discovery** (in practice they're related); do NOT keep nostalgia as a separate dial.
3. **Theme fit** (least important — owner treats it mostly as binary "does it fit → can score it," occasionally a bit more weight for a perfect-example song).
These feed the SAS / submission / H2H tools. **Naming help wanted on factor 1** ("Goodness" → Appeal? Crowd Appeal? Likeability?).

## PR-10 — Judge each player's own voting-weight profile (L, research-y)
Per-player, *estimate the weighting* each player actually uses when voting (their personal version of the PR-9 dials) — because it strongly drives how they vote. May need **more than the owner's 3 factors** (some players weight by weird/idiosyncratic factors). Capture for now; don't over-engineer. This is high-leverage for the whole prediction engine (knowing a player's weighting makes SAS far more accurate) — likely its own spec, and a natural input to the future whole-round predictor.
