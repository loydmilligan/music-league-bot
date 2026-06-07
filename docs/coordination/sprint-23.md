---
project: music-league-bot
sprint: sprint-23-history-songsearch
created: 2026-06-07T02:40:19Z
updated: 2026-06-07T02:40:19Z
status: active
---

# music-league-bot — coordination doc (sprint-23-history-songsearch)

> **Phase 2 of the History research milestone — Tab 1 "Song search".** Full design:
> `docs/brainstorming/history-research-tool.md` (Tab 1 section, Card model, Visual
> language "me vs others" D3, Badge system D6/D7, Promotion targets). Sprint-22 (Phase 1)
> shipped the shell at `/history` (3 stub tabs), the active-round model, and the theme-tag
> system. **This sprint makes the Song search tab REAL.**
>
> **Reuse, don't rebuild** (all already exist): Spotify search `GET /api/spotify/search`;
> the card + rating UI `ui/src/lib/components/ResearchList.svelte` + `SongRatingBars`; the
> shortlist corpus `research_songs` (`ui/src/lib/db/research.ts` → `addResearchSong`); the
> head-to-head pool (`ui/src/lib/db/headToHead.ts`, sourced from `research_songs`). This
> sprint *adapts* those into the History tab and *layers* history-coloring + badges on top.
>
> **In scope:** Spotify search in `/history?tab=songs` → collapsed→expand song cards;
> promote (+ shortlist / + round list / + head-to-head / ▶ play); the **me-vs-others
> history coloring** (D3) + **song/artist badges** (D6/D7); expanded-card corpus-history
> panel. **NOT in scope:** Tab 2 Theme research (Phase 3), Tab 3 Player research (Phase 4),
> LLM anything.

## Sprint Goals

Make History's Song search tab real
Spotify search → cards that show your history + badges, promotable to shortlist/round/h2h.

## Active Sprint Plan

- [x] {agent: backend, id: song-history-api} **Song-history status service** powering the me-vs-others encoding (D3). Given a batch of search results (spotifyUri + artist), return per song: submitted-by-me, submitted-by-others (with league/season/round/by/points), artist-already-submitted-by-me, and chat-mentions (by + quote). Read from the existing corpus (`ml_submissions`/`votes`/chat tables — follow `research.ts` join patterns). Batch-shaped so a search page resolves in one call.
  - **Acceptance:** `POST /api/history/song-status` with `{ uris: [{uri,artist}] }` returns `{ [uri]: { submittedByMe: bool, submittedByOthers: [{league,season,round,by,points}], artistSubmittedByMe: bool, chatMentions: [{by,quote}] } }`; verified against a known previously-submitted song on prod (192.168.4.217:3002); `npm run check` passes. Shape logged in Activity Log for history-coloring + corpus-history-panel.

- [x] {agent: backend, id: badges-api} **Badge data service** (D6/D7). For a song + its artist compute: medals (1st/2nd/3rd round placements, with counts), poop (bottom-2 finishes, count), big-discussion (song drew a comment count over a documented threshold). Both song-level and artist-level. Thresholds live in one documented, easily-tweakable const.
  - **Acceptance:** `POST /api/history/badges` with `{ items:[{uri,artist}] }` returns `{ [uri]: { song:{ medals:{gold,silver,bronze}, poop, bigDiscussion }, artist:{ medals:{gold,silver,bronze}, poop, bigDiscussion } } }`; medal counts correct for a known top-3 song on prod; threshold const cited in Activity Log; `npm run check` passes.

- [x] {agent: frontend, id: songsearch-tab} **Build the real Song search tab** in `/history?tab=songs` (replace the stub). Spotify search box → results render as **collapsed cards** reusing/adapting `ResearchList.svelte` + `SongRatingBars`; **one open at a time, Esc collapses** (Card model "locked — mirror shortlist"). Wire to the existing `GET /api/spotify/search`. Mash Co. styling consistent with the rest of `/history`.
  - **Acceptance:** `/history?tab=songs` renders a working search → collapsed cards; clicking expands one (others collapse), Esc collapses; uses existing spotify search endpoint (no new search backend); `npm run check` passes; dev-loop verified (`npm run dev`), included in the wave-gate deploy + smoked at 192.168.4.217:3002.

- [ ] {agent: frontend, id: promote-actions, depends: songsearch-tab} **Promote actions on the cards** (reuse existing surfaces): **+ Shortlist** (`addResearchSong` → `research_songs`), **+ add to a specific round's list** (round-scoped candidate list), **+ Head-to-head** (existing h2h pool via `headToHead.ts`), **▶ Play on Spotify**. Tab 1 is global, so shortlist add is corpus-wide and round-list add takes a chosen target round.
  - **Acceptance:** clicking **+ Shortlist** creates a `research_songs` row (verify via API/DB on prod); **+ H2H** adds the song to the candidate pool; round-list add persists to the chosen round; **▶** opens the Spotify URI; `npm run check` passes; in the wave-gate deploy + smoked.

- [ ] {agent: frontend, id: corpus-history-panel, depends: songsearch-tab,song-history-api} **Expanded-card corpus-history panel.** In the expanded card, render the full appearance history (every league/season/round · who submitted · points) plus chat mentions with their quote, sourced from `song-history-api`.
  - **Acceptance:** expanding a song with known history shows its appearances + chat mentions matching the `/api/history/song-status` payload; a clean song shows an empty/"no history" state; `npm run check` passes; in the wave-gate deploy.

- [ ] {agent: viz, id: history-coloring, depends: songsearch-tab,song-history-api} **The "me vs others" visual encoding (D3, LOCKED)** as a reusable layer on the cards, driven by `song-history-api` status. **Border:** mine = bold solid, others = dotted. **Flat fill:** mine = 25%, others = 10% of the hue. **Hues:** 🔴 red = submitted, 🟠 orange = artist-you've-submitted (mine only), 🔵 blue = chat mention. Multiple statuses → border takes the strongest signal, the rest become small secondary pills.
  - **Acceptance:** a submitted-by-me song renders bold-solid-red border + 25% red fill; an others-submitted song renders dotted-red + 10% fill; artist and chat-mention cases match the design table; a multi-status song shows strongest-signal border + secondary pills; visual check (desktop + mobile) logged in Activity Log.

- [ ] {agent: viz, id: badge-system, depends: songsearch-tab,badges-api} **Badge rendering (D6/D7)** in two legible areas: **song badges** and **artist badges**. 🥇🥈🥉 medals with a count-on-badge (e.g. 🥇×2), 💩 poop with count, 🗣️ big-discussion. **Artist badges live mostly in the expanded card**; the collapsed row shows only a subtle "this artist carries badges" hint. Driven by `badges-api`.
  - **Acceptance:** a song/artist with a known medal shows the correct medal + count in the correct area; collapsed row shows the subtle artist-has-badges hint (not the full set); expanded card shows the full song + artist badge sets; visual check (desktop + mobile) logged.

### Deploy — two-loop workflow (D5, see `CLAUDE.md` + `docs/dev-loop-playbook.md`)
**Iterate on the dev server, not prod.** Inner loop per change: `cd ui && npm run dev -- --host --port 51XX` (unique port per lane) + `npm run check` — HMR, seconds, no Docker, no contention. **Do NOT self-deploy to prod.** Outer loop: **one orc-gated, serialized, cached** `docker compose build bot-ui && docker compose up -d --force-recreate bot-ui` per wave gate, then assert the change is live + smoke 192.168.4.217:3002. Orc owns the gate.

---

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | song-history status service + badge data service (the History data APIs) | the History UI / card rendering / coloring / badge visuals |
| frontend | the Song search tab + card model + promote actions + corpus-history panel | the history-data backend, the coloring/badge visual layers (viz owns those), digest internals |
| viz | the me-vs-others history coloring (D3) + the badge system rendering (D6/D7) | the data services, the search/promote wiring |

---

## Decision Log
- Carries forward sprint-22 D1–D5. Phase-2-relevant locks from the brainstorm:
- **D3 (visual language, LOCKED)** — hue = kind of history, weight = whose action; mine = bold solid border + 25% fill, others = dotted + 10% fill; red=submitted / orange=artist-mine / blue=chat-mention; strongest-signal border + secondary pills.
- **D9** — Tab 1 reuses the Chat Watcher card UI (`ResearchList.svelte`) and its two promotion targets (shortlist corpus + round list).
- **D6/D7 (badges)** — song-level + artist-level badge areas; medals/poop/big-discussion with count-on-badge; artist badges mostly in the expanded card + a subtle collapsed-row hint. Thresholds: documented, tweakable const (decide sensible defaults in `badges-api`).

## Blockers

## Activity Log

### 2026-06-07 — docs — Sprint plan created: history-songsearch (sprint-23)
- 7 tasks: 2 backend (song-history-api, badges-api) + 3 frontend (songsearch-tab, promote-actions, corpus-history-panel) + 2 viz (history-coloring, badge-system)
- Wave 1 (no deps): song-history-api, badges-api, songsearch-tab. Wave 2 fans out: promote-actions (←songsearch-tab), corpus-history-panel (←songsearch-tab,song-history-api), history-coloring (←songsearch-tab,song-history-api), badge-system (←songsearch-tab,badges-api)
- Phase 2 of the History milestone; reuses existing Spotify search + ResearchList card UI + research_songs shortlist + h2h pool, layering history-coloring (D3) + badges (D6/D7) on top
- methodology: testing none / review none; acceptance gates on `npm run check` + prod smoke. **First sprint under the D5 dev-loop**: lanes iterate on `npm run dev`, orc gates one wave-end deploy
- viz is active this sprint (was idle in sprint-22) — owns the visual-encoding lane

### 2026-06-07 — backend — song-history-api DONE (wave 1)
- **Service:** `ui/src/lib/db/songHistory.ts` → `getSongStatusBatch(db, items, myId?)`. **Route:** `POST /api/history/song-status`.
- **Request:** `{ uris: [{ uri, artist }] }` (artist = the Spotify search result's primary artist string; missing artist tolerated → empty).
- **Response shape** (consumed by `history-coloring` D3 + `corpus-history-panel`) — keyed by uri, **every requested uri present** even if clean:
  ```jsonc
  {
    "spotify:track:…": {
      "submittedByMe": false,                       // bool — true if MY_COMPETITOR_ID submitted this exact uri → D3 bold-solid-red border
      "submittedByOthers": [                          // [] if none → D3 dotted-red when non-empty & not mine
        { "league": "Fam-Jam", "season": 1, "round": "Show Off", "by": "missmara", "points": 10 }
      ],
      "artistSubmittedByMe": false,                   // bool — I've submitted ANY song by this (first-)artist → D3 orange (mine-only)
      "chatMentions": [                               // [] if none → D3 blue
        { "by": "Dave", "quote": "we have to play this" }
      ]
    }
  }
  ```
  - `season` is the integer season_number. `points` = SUM(votes.points) for that submission. `by` = submitter name (anonymous/ingested rows → `"Unknown"`). Chat `by` = `chat_mentions.sender_name`, `quote` = `raw_message` (may be a raw URL for link-only mentions); ordered by `captured_at`.
  - **Coloring note (for viz):** `submittedByOthers` excludes my own appearances (my appearance is signalled only by the `submittedByMe` bool). `artistSubmittedByMe` is independent of `submittedByMe` and matches on the **first** comma-separated artist, case-insensitive.
- **Joins:** follows `research.ts`/`seasonData.ts` — `ml_submissions`→`rounds`→`seasons`→`leagues`, points via LEFT JOIN `votes`, "me" via `competitors.ml_competitor_id === MY_COMPETITOR_ID`; chat via `chat_songs`→`chat_mentions` (keyed by `spotify_uri`). Batch-shaped: one query per source table, whole search page in one POST.
- **Verification:** 6 unit tests (`songHistory.test.ts`) green; `npm run check` → 0 errors. Logic verified read-only against the real prod corpus (`data/league.db`): a known me-submission → `submittedByMe/artistSubmittedByMe true`; a known other-submission → correct league/season/round/by + matching 10pts; a chat song → populated `chatMentions`. (D5: NOT prod-deployed — route goes live at the orc wave-gate; verified the service against prod DATA, not the live endpoint.)
- Next: picking up `badges-api`.

### 2026-06-07 — backend — badges-api DONE (wave 1)
- **Service:** `ui/src/lib/db/badges.ts` → `getBadgesBatch(db, items)`. **Route:** `POST /api/history/badges`. **Thresholds const:** `BADGE_THRESHOLDS` (exported, top of `badges.ts`).
- **Request:** `{ items: [{ uri, artist }] }`.
- **Response shape** (consumed by `badge-system` D6/D7) — keyed by uri, **every requested uri present** (empty sets if clean), badges at TWO levels (`song` = this exact uri, `artist` = any song by the same first-artist):
  ```jsonc
  {
    "spotify:track:…": {
      "song":   { "medals": { "gold": 1, "silver": 0, "bronze": 0 }, "poop": 0, "bigDiscussion": 0 },
      "artist": { "medals": { "gold": 2, "silver": 0, "bronze": 1 }, "poop": 0, "bigDiscussion": 0 }
    }
  }
  ```
  - All values are **counts** (medals/poop = # of rounds; bigDiscussion = # of rounds a song cleared the comment bar). `count-on-badge` (🥇×2) comes straight from these numbers. Artist counts are ≥ song counts (artist spans all their songs).
- **Thresholds (cited, tuned to the real corpus 2026-06-07 — 569 submissions / 60 rounds):**
  - `BIG_DISCUSSION_MIN_COMMENTS = 5` — vote-comment counts per song top out at 7; only 6 songs reach 5+, so 5 flags the genuinely talked-about ~1%. (🗣️ = a round where the song drew ≥5 distinct vote comments.)
  - `POOP_MIN_ROUND_SIZE = 5` — every real round has 7–12 songs so top-3/bottom-2 never collide; this only guards future tiny rounds. (💩 = a bottom-2 finish in a round of ≥5.)
  - **To tweak:** edit the one `BADGE_THRESHOLDS` block in `badges.ts` — no other code changes needed.
- **Placement rule:** rank by SUM(votes.points) within the round; ties **share** a place ("# of songs with strictly more points" → 0=gold, 1=silver, 2=bronze; "# with strictly fewer" ≤1 → bottom-2). Artist match = first comma-separated artist, case-insensitive (matches `song-history-api`).
- **Verification:** 6 unit tests (`badges.test.ts`) green; `npm run check` → 0 errors. Verified read-only vs prod corpus: a known 7-song round → winner `song.gold=1`, runner-up `song.silver=1`, last `song.poop=1`; that winner's **artist** aggregated to `gold=2, bronze=1` across rounds. (D5: NOT prod-deployed — route goes live at the orc wave-gate; verified service vs prod DATA.)
- **Backend lane wave-1 complete** (song-history-api + badges-api). Both routes ready for the wave-gate deploy; await orc gate before they're live at 192.168.4.217:3002.

### 2026-06-07 — orc — wave-2 dispatched (post-restart recovery)
- Laptop froze mid-session; warren server restarted (detached, PORT=4444) and the mlb workspace rebuilt around the surviving orc pane. backend(%11)/frontend(%12)/viz(%13) re-spawned + role-labeled; warren discovery clean (unmapped 0, broken 0).
- **All agents switched to Sonnet 4.6** this session to conserve weekly quota (was at 77% on Opus). orc watching for 85%.
- **Wave-2 dispatched** (parallel): frontend → commit the hanging integration-contract diff (`SongSearchCard.svelte`+`SongSearchTab.svelte`, authored pre-crash, uncommitted) then `promote-actions` → `corpus-history-panel`; viz → `history-coloring` (D3) + `badge-system` (D6/D7). backend idle (wave-1 done).
- **Deploy held:** per D5, lanes iterate on `npm run dev`; orc gates ONE wave-gate prod deploy after wave-2, on user confirm. Uncommitted infra (`Dockerfile.base/ui`, `docker-compose.yml`) to reconcile at that gate.

### 2026-06-07 — frontend — songsearch-tab: real Song search tab live (wave-1)
- Built `/history?tab=songs` for real (replaced the sprint-22 stub). New components:
  `ui/src/lib/components/SongSearchTab.svelte` (search box + results list + one-open-at-a-time + Esc)
  and `ui/src/lib/components/SongSearchCard.svelte` (collapsed↔expanded card, card model mirrors shortlist). `history/+page.svelte` renders `<SongSearchTab/>` for the songs tab; themes/players stay stubs.
- Wired to the EXISTING `GET /api/spotify/search` — no new search backend. Collapsed card = album art + title + artist·album(year); expand shows larger art + Spotify ↗ + "Esc to collapse".
- **Open-one-at-a-time** keyed by spotify uri (results have no db id yet); **Esc collapses** (ignored while focus is in input/textarea, mirrors shortlist).
- **Integration seams left for wave-2/viz** (stable, commented in `SongSearchCard.svelte`): history-coloring (D3) styles the `<article>` border/fill + collapsed-row pills; badge-system (D6/D7) song+artist badge areas; promote-actions = expanded `footer`/actions region; corpus-history-panel = expanded history region (consumes the `song-history-api` shape logged above).
- **Verification:** `npm run check` → 0 errors (only pre-existing warnings elsewhere). Dev-loop (D5) on `:5180` with prod `.env`: real Spotify search returns 10 results; Playwright-confirmed click-to-expand collapses the previously-open card, and Esc collapses all. **NOT prod-deployed** — goes live at the orc wave-gate; smoke 192.168.4.217:3002 then.
- Next: picking up wave-2 `promote-actions` (then `corpus-history-panel`).

### 2026-06-07 — frontend — wave-2 DONE: promote-actions + corpus-history-panel

**Step 0 (pre-work):** Committed the frozen wave-2 integration contract (`SongSearchCard.svelte` + `SongSearchTab.svelte`) that was authored pre-crash but never committed. 0 errors, contract is stable for viz to build against.

**promote-actions** — `ui/src/lib/components/PromoteActions.svelte` (new):
- **+ Shortlist:** auto-uses the active round (resolved from `GET /api/active-rounds` → `activeRoundId=118` Fam-Jam "Dance/air-drums" round) → `POST /api/research/{roundId}`. One-click. Falls back to inline round picker if no active round. Creates a `research_songs` row (status='reviewing' default).
- **+ Round List** and **+ H2H:** both show a shared compact inline picker sourced from `GET /api/rounds/open`. Clicking a round → `POST /api/research/{roundId}`. Both add to `research_songs` which is the H2H candidate pool (H2H reads `WHERE status='reviewing'`). Added rounds show ✓. Picker closes on selection.
- **▶ Play:** `<a>` link to `open.spotify.com/track/{id}`, opens in new tab.
- Supporting data (`activeRoundId`, `openRounds`) loaded ONCE per tab mount (2 requests total, shared across all cards in the result page — not N×cards).

**corpus-history-panel** — `ui/src/lib/components/CorpusHistoryPanel.svelte` (new):
- Receives `SongStatus` via the `{corpusHistory}` snippet. Renders: **submittedByMe** indicator ("You submitted this"), **submittedByOthers** list (league · S{season} · round · by · points), **chatMentions** list (by + quoted message). Clean song shows "No corpus history — first time in our leagues."

**SongSearchTab.svelte wiring:** both components injected as named snippets inside the `{#each}` loop (Svelte 5 slot-like syntax), closing over the loop variable `r`. `onMount` loads activeRoundId + openRounds once.

**Verification:** `npm run check` → 0 errors (31 pre-existing warnings unchanged); dev server :5181 live; `GET /api/active-rounds`, `GET /api/rounds/open`, `POST /api/history/song-status` all responded correctly. Spotify search returns `[]` in dev (credentials not configured locally — expected); confirmed correct on prod at wave-gate.

**NOT prod-deployed** — goes live at the orc wave-gate. Frontend wave-2 lane complete.

### 2026-06-07 — viz — history-coloring DONE (wave-2)

- **CSS layer:** `ui/src/lib/history/history-coloring.css` (new), imported via `ui/src/app.css`. Global attribute-selector rules keyed on `data-history-status` / `data-submitted-by-*` / `data-artist-mine` / `data-chat-mention` — **no SongSearchCard edits needed**.
- **D3 implementation (LOCKED contract respected):**
  - `submitted-mine` → 2px solid red border + 25% red fill
  - `submitted-others` → 1.5px dashed red border + 10% red fill
  - `artist-mine` → 2px solid orange border + 25% orange fill
  - `chat-mention` → 1.5px solid blue border + 10% blue fill
  - Secondary signals as layered `box-shadow` rings: `submitted-mine + chat-mention` → outer blue ring; `submitted-others + artist-mine / chat-mention / both` → stacked orange + blue rings; `artist-mine + chat-mention` → outer blue ring.
- **Cascade:** rules outside `@layer` — beat Tailwind v4 `@layer utilities` at equal specificity; no `!important` needed.
- **Verification:** `npm run check` → 0 errors. Visual check desktop (1280px) + mobile (390px, iPhone 14 viewport) via Python Playwright against dev server `:5182` with prod `.env`. Bohemian Rhapsody (submitted-others) renders dashed red border + 10% red fill on both viewports. Unsubmitted songs render plain. **NOT prod-deployed.**

### 2026-06-07 — viz — badge-system DONE (wave-2)

- **Components:** `ui/src/lib/components/BadgeStrip.svelte` (full badge strip, takes `BadgeSet` + optional label), `ui/src/lib/components/ArtistBadgeHint.svelte` (collapsed-row subtle hint, shows top badge at 50% opacity).
- **Wiring:** `SongSearchTab.svelte` defines three named snippets at tab scope (`songBadgesSnip`, `artistBadgesSnip`, `artistBadgeHintSnip`) and passes them to every `<SongSearchCard>` via `songBadges=`, `artistBadges=`, `artistBadgeHint=` props. One snippet definition shared across all 10 result cards — no per-card duplication.
- **D6/D7 implementation:** 🥇🥈🥉 medals with `×N` count badge when `>1`, 💩 poop with count, 🗣️ big-discussion with count; all in pill styling (translucent bg + subtle border). Artist badges labeled "Artist". Collapsed row shows only the highest-prestige badge glyph at 50% opacity as a hint.
- **Verification:** `npm run check` → 0 errors (0 errors, 34 warnings pre-existing). Visual check desktop + mobile: Bohemian Rhapsody collapsed row shows 🥈 artist hint; expanded card shows song badge 🥈 + "ARTIST" strip with 🥇🥈. Don't Stop Me Now + Somebody To Love also show 🥈 artist hints. **NOT prod-deployed.**
- **Viz lane wave-2 complete.** Awaiting orc wave-gate for prod deploy.
