# Music League Ecosystem — Related Repos & Tools

> Map of the repos and apps that make up the Music League ecosystem around
> `music-league-bot`. This is the checked-in twin of the tela page
> **"Ecosystem — Related Repos & Tools"** (space *Music League*). Keep the two
> in sync when a repo is added, retired, or materially changes.
>
> Last surveyed: **2026-09-28**. Ports/URLs are what each repo's own README
> declares — verify against `.env` / the Cloudflare tunnel before trusting them
> (the prod bot subdomain in particular rotates).

All repos live under `~/Projects/`.

## Hub

### `music-league-bot` — the platform
The core app and the thing everything else feeds or extends. WhatsApp bot,
the digest pipeline (SvelteKit `bot-ui`), the `mcp-server`, YTM auto-drop,
the Guesser game, chat ingestion/relay, the Boarz stats explorer + player
fingerprint, and animated player cards. Prod is served at a rotating subdomain
(e.g. `mlb13.mattmariani.com` — read `.env` `PUBLIC_APP_BASE_URL`, don't trust a
remembered value). Recent additions: Boarz stats explorer, player fingerprint
comparison, animated digest player cards, S2 recap slideshow pipeline.

## Planning / pre-season tools

| Repo | What it is | Where it runs | Status |
|---|---|---|---|
| `boarz-season-2-survey` | "Music League Surveys" — Express app collecting per-league planning input (BOARZ S2, Second Best S3). Players auth via six-digit ntfy login codes; signed 30-day cookie. Admin dashboard summarizes completion, theme votes, candidate rankings, write-ins, comments, and ballots, with a review drawer that promotes themes into a persistent **Draft Season** workspace. | Docker, host port **18474**; `https://mlsurvey.mattmariani.com/boarz/season-2/` and `/second-best/season-3/` via Cloudflare tunnel | **Active** (2026-09-28) — this is the "survey workflow" |
| `theme-gen-for-ml` | Theme generation tool. OpenRouter LLM engine with a **rating flywheel**: 👍 graduates a theme into the Library, which is fed back as few-shot examples so generations lean toward what you liked. Per-league YAML profiles. SQLite. | Vite dev (~`5175`), API `PORT` default `3017` | 2026-06 |
| `boarz-theme-picker` (+ `boarz-theme-picker-mara` variant) | Dependency-free collaborative theme picker for two commissioners (Matt/JB): each builds a list of 9, then the app surfaces agreed vs. solo themes and sets round order. Styled to match the bot app. | `node server.js`; two docker-compose instances | 2026-07 |
| `music-league-admin` | Not an app — planning scratch. Holds BOARZ theme-idea CSVs. | — | 2026-07 (dormant) |

## Analysis / stats

| Repo | What it is | Where it runs | Status |
|---|---|---|---|
| `music-league-stats` | "Music League Stats" — upload a Music League `export.zip`, get a dark MLStats-style dashboard: round-by-round scores, leaderboard position by round, eagerness, contrarian score, voter generosity, vote reciprocity/spread, taste twins, superfan & nemesis, per-player summaries. Fuzzy CSV column matching + a `/api/debug` endpoint for export-version drift. Python. | port **18741** (`./run.sh`) | 2026-09-25 — the "mlstats" app |
| `boarz-jev-lab` | Probabilistic voter/song forecast lab. Runs the experimental **Jev** model (via OpenRouter) to produce expected points, simulated intervals, first/top-three probabilities, and downvote risk for candidate songs, enforcing the observed Boarz ballot budget. Includes a no-leak Round 151 replay for backtesting. TypeScript / pnpm. | dev `3432`, API `3431` | 2026-09-20 |

## Bracket / decision tools

| Repo | What it is | Where it runs | Status |
|---|---|---|---|
| `song-tournament-bracket` | March-Madness-style song bracket: import songs from CSV/JSON, auto-assign byes, go head-to-head one matchup at a time, crown a winner. For narrowing a big song list into one pick. | Vite web app | Active (working dir) |
| `ml-madness` | Earlier bracket experiment. **Currently an empty scaffold** — git repo with no code. | — | 2026-05 (empty) |
| `bracket-challenge-me` | **Empty stub** — no files. | — | placeholder |

## Recap & video production

| Repo | What it is | Status |
|---|---|---|
| `boarz-season-1-cinematic` | Production-control repo (not a polished app) for the Boarz S1 end-of-season piece: a hero superhero-ensemble shot, a recap of results/stats/awards/jokes, and a post-credit S2 tease. Built for parallel human + AI-agent work — brief/status/tasks/decisions files, a per-player folder layout, an experiment log, and a **Remotion baseball-card studio**. Generation via OpenRouter / Runway / fal.ai. | 2026-09-22 |
| _(in-hub)_ | The **Second Best S2 recap slideshow** pipeline lives inside `music-league-bot`, not a separate repo — noted here so it isn't looked for elsewhere. | — |

## Notes

- **Empties are real signal, not omissions:** `ml-madness` and
  `bracket-challenge-me` are intentionally listed as empty so future surveys
  don't hunt for code that isn't there.
- **Digest redesign (someday):** the goal of making the digest more visual,
  interactive, and live — theme voting, live chat analysis, a shared listening
  room — is flagged but **not yet started**. Several tools above are natural
  inputs to it (the survey app for theme voting, `music-league-stats` for live
  data, the bracket tool for head-to-heads).
