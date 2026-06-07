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

- [ ] {agent: backend, id: badges-api} **Badge data service** (D6/D7). For a song + its artist compute: medals (1st/2nd/3rd round placements, with counts), poop (bottom-2 finishes, count), big-discussion (song drew a comment count over a documented threshold). Both song-level and artist-level. Thresholds live in one documented, easily-tweakable const.
  - **Acceptance:** `POST /api/history/badges` with `{ items:[{uri,artist}] }` returns `{ [uri]: { song:{ medals:{gold,silver,bronze}, poop, bigDiscussion }, artist:{ medals:{gold,silver,bronze}, poop, bigDiscussion } } }`; medal counts correct for a known top-3 song on prod; threshold const cited in Activity Log; `npm run check` passes.

- [ ] {agent: frontend, id: songsearch-tab} **Build the real Song search tab** in `/history?tab=songs` (replace the stub). Spotify search box → results render as **collapsed cards** reusing/adapting `ResearchList.svelte` + `SongRatingBars`; **one open at a time, Esc collapses** (Card model "locked — mirror shortlist"). Wire to the existing `GET /api/spotify/search`. Mash Co. styling consistent with the rest of `/history`.
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
