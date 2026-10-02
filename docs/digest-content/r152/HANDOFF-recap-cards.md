# HANDOFF — Boarz S1 recap digest + baseball cards (from Claude pane pA)

Written 2026-09-25 ~12:13 PDT because the Claude pane is running low on usage. You (a codex pane) are taking over as continuer/orchestrator. Everything below is current state.

## Context / targets
- Repo: `music-league-bot`. Recap draft: **`draft-152-bf0a1beb`** (round **152**, season_id **10** = Boarz II Men). DB: `data/league.db` (backups: `league.db.bak-boarz-recap-edit-20260924-162909`).
- Digest served by the **bot-ui** docker container (adapter-node :3002), viewed at **https://mlb13.mattmariani.com/digest/152**. Card media (mp4/png) served from `digests/_media/boarz-s1-cards/` via the `digest-static` Caddy container (`digest.mattmariani.com/_media/...`).
- Roster (slug · name · hero · points · **weeks**): all weeks=10 except Jimmy=9.
  matt-mariani-mashew·Matt·Slopulist·80 / jon-black-jb·Jon/JB·Cat Man·77 / jimmy-troy·Jimmy·Bystander·65 / clements-johnson-clem·Clements·City Bumpkin·64 / dave-jensen-jensen·Jensen·Concussionist·59 / darren-paletz-dp·Darren·Transient·56 / shane-farkas-uncle-shane·Shane·Southern Stan·43 / dave-steingart-steiny·Steiny·Steiny Gump·38 / grant-koziol-koz·Grant/Koz·Ex-Expat·31 / conor-johnston-cj-wookie·Conor·Twinkler·8.

## DONE (deployed)
1. Top-of-digest sections edited on the draft (DB `digest_sections`): podium→"The Songs at the Top" (top-8 songs), villain→"Least-Loved" (rule-correct), flow→"The Season Arc — A Bit for Everyone" (per-person + next-season button), consensus **excluded**, quotes/chat kept. DON'T re-touch these.
2. Fixed Codex's broken card wiring: wrote `listBoarzPlayerCards` in `ui/src/lib/digest/playerCardRoster.ts`, fixed the import in `ui/src/routes/digest/[roundId]/+page.server.ts`. Built + deployed bot-ui. Cards render.
3. Removed the **standalone autoplay "The Roster"** section (deleted its insertion + deriveds + import in `+page.svelte`). Kept the **Regulars** click-to-play `PlayerCards` grid. Built + deployed. Verified live (0 errors).

## IN-FLIGHT (other panes, started ~12:10)
- **pG (codex, mlb)** → top comments for Matt, JB, Jimmy, Clements, Jensen → writing `docs/digest-content/r152/top-comments-codex.md`.
- **pP (grok, mlb)** → top comments for Darren, Shane, Steiny, Grant, Conor → writing `docs/digest-content/r152/top-comments-grok.md`.
  (Brief both follow: `docs/digest-content/r152/top-comments-BRIEF.md` — 3 WhatsApp candidates + ★top pick, plus top voting comment, per player, verbatim.)
- **pM (codex, cinematic)** → `boarz-season-1-cinematic/CARD-UPDATES-BRIEF.md`: re-render card BACKS (points+weeks+top comments), front-video assignments (Twinkler=rolls clip; Slopulist=ambiguous, flag), Jensen mute-after-gong.
- **pH (claude, cinematic)** → Steiny "Run Steiny Run" female VO just after the rock hit → renders `dave-steingart-steiny.mp4`.

## PENDING — your job
1. **NOT STARTED: the click-to-enlarge modal.** Matt wants: click a card in the Regulars `PlayerCards` grid → it opens **bigger in a centered modal/lightbox** and plays (Esc / click-outside to close; works on desktop + mobile). Implement in `ui/src/lib/digest/PlayerCards.svelte` (currently plays inline via `playCard()`; add an overlay that mounts the enlarged `<video>`). Then rebuild+redeploy bot-ui and verify at :3002.
2. When `top-comments-codex.md` + `top-comments-grok.md` are done, that's the source of truth for the card-back comments the cinematic panes need — make sure pM has them.
3. When cinematic panes drop new mp4s into `digests/_media/boarz-s1-cards/`, **bump `CARD_MEDIA_VERSION`** in `ui/src/lib/digest/playerCardRoster.ts` (currently `'4'`) to bust cache, then rebuild+redeploy.

## Deploy recipe (verified)
```
docker compose build bot-ui && docker compose up -d bot-ui
# verify (must show cards, 0 errors):
curl -s localhost:3002/digest/152 -o /tmp/d.html -w "%{http_code}\n"
grep -oc 'sveltekit:error\|status: 500' /tmp/d.html   # want 0
grep -o 'boarz-s1-cards/[a-z0-9-]*\.mp4' /tmp/d.html | sort -u | wc -l  # want 10
```
Build is hermetic (Dockerfile.ui builds from source; .dockerignore excludes node_modules/.svelte-kit).

## HOW TO ADD THE QUOTES TO THE CARDS (two paths — pick per Matt)
The quote text comes from `docs/digest-content/r152/top-comments-{codex,grok}.md` (★ top WhatsApp pick + top voting comment per player). There are two ways to put them on the cards:

**Path A — digest-side text (fast, editable, NO re-render). RECOMMENDED, pairs with the modal.**
1. Add `topWhatsapp` + `topVote` (strings) to each `RosterEntry`/`PlayerCardMedia` in `ui/src/lib/digest/playerCardRoster.ts` (and carry them through `listBoarzPlayerCards`).
2. Render them in `ui/src/lib/digest/PlayerCards.svelte` — in the enlarged **modal** (best) and/or the `<figcaption>` — as pull-quotes under the video.
3. Rebuild + redeploy bot-ui (recipe below). No cinematic dependency, no cache-tag bump needed.
- This is the quickest correct path and keeps quotes editable in code/DB instead of baked into video.

**Path B — baked onto the flip-back of the mp4 (cinematic).**
- pM's card-studio render reads the same top-comments files and prints the quote on the card back, re-exports the mp4 → `digests/_media/boarz-s1-cards/`. Then bump `CARD_MEDIA_VERSION` + redeploy. Slower, not editable without a re-render. Only do this if Matt wants the quote literally on the animated back.

Default to **Path A** unless Matt says he wants them baked into the video.

## DEPLOY WHEN DONE (do this after each batch of changes)
Any change under `ui/` (the modal, Path-A quotes, a cache-tag bump) only goes live after a bot-ui rebuild — the container serves a baked build, NOT the source tree, and the stray `vite preview :5173` / grok's `:5185` are throwaway and do NOT reflect prod.
```
cd /home/loydmilligan/Projects/music-league-bot
docker compose build bot-ui && docker compose up -d bot-ui   # ~1.5 min, hermetic
sleep 6
curl -s localhost:3002/digest/152 -o /tmp/d.html -w "HTTP %{http_code}\n"
grep -oc 'sveltekit:error\|status: 500' /tmp/d.html            # MUST be 0
grep -o 'boarz-s1-cards/[a-z0-9-]*\.mp4' /tmp/d.html | sort -u | wc -l   # MUST be 10
```
Then Matt views https://mlb13.mattmariani.com/digest/152 . New card mp4s from cinematic: drop into `digests/_media/boarz-s1-cards/`, bump `CARD_MEDIA_VERSION` in `playerCardRoster.ts`, THEN run the deploy above (the `?v<N>` query busts the browser/CDN cache). **Never git push.**

## Guardrails
- **Do NOT git push** (commit ok, but ask first for anything outward). Working tree has lots uncommitted (Codex's guesser/coinage/regulars + my card fixes) — none committed yet.
- Voting rules (for any numbers): 8 up / 2 down per player, all must be spent; a **0-point vote row = comment, not a vote** (don't count as voter); max 4 on one song; no-vote penalty voids the submitter's upvotes (see `ui/src/lib/db/scoring.ts SCORED_POINTS_SQL`).
- `digest_sections.kind` CHECK = podium/villain/flow/consensus/quotes/chat/storylines only. Guesser/stats/reel/playerCards are draft-row/synthetic, not section rows.

## OPEN QUESTION for Matt (surface this)
The **Slopulist (Matt) front-video** instruction — "the video where the [goat?] carries me, then the WhatsApp message as the video for that card" — is ambiguous. pM was told to identify candidate clips and confirm before rendering. Get Matt to clarify which clip + whether a WhatsApp screenshot/message becomes the front.
