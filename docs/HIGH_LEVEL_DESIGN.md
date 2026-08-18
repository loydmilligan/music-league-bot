# High-Level Design

How the system is actually built, as of August 2026. Written from the code; if a statement
here disagrees with the code, the code wins and this document is wrong.

For a one-read orientation see the repo [README.md](../README.md). For setup, see
[QUICKSTART.md](../QUICKSTART.md).

## 1. What this is

A private companion system for a friend group's [Music League](https://musicleague.app/)
games. It does three things:

1. **Keeps a copy of the game.** Rounds, submissions, votes, competitors, and the group's
   chat around them, for six leagues across multiple seasons, in one SQLite file.
2. **Produces the digest.** A per-round recap page — part deterministic statistics, part
   LLM-written prose — that a human reviews and approves, then gets exported to PNG/PDF and
   posted back into the group chat with a public share link.
3. **Runs the group-chat side.** A WhatsApp client that posts digests, answers a small set
   of commands, and captures the conversation that later becomes digest material.

Explicitly **not**: multi-tenant, commercial, high-scale, or a general chatbot. One operator,
one server, one WhatsApp session.

## 2. Runtime topology

Four Docker services (`docker-compose.yml`), all on one host:

| Service | Process | Exposed | Responsibility |
|---|---|---|---|
| `bot` | `tsx src/index.ts` | — | WhatsApp client, digest poller, control server (:3003 in-container) |
| `api` | `tsx src/api/server.ts` | :3001 | REST API, IMAP poller, `POST /webhooks/relay` |
| `bot-ui` | SvelteKit (adapter-node) | :3002 | The operator app and everything the digest pipeline does |
| `digest-static` | Caddy 2 | :8088 | Read-only static serving of `digests/` |

`bot` and `api` build from `Dockerfile`, which is `FROM music-league-bot-base:chromium` —
a stable base carrying Chromium and fonts so app rebuilds don't re-download them.
`bot-ui` builds from `Dockerfile.ui` (multi-stage; the runtime stage also carries Chromium
for Puppeteer export).

Shared volumes: `./data` (SQLite + per-league exports) is mounted into `bot`, `api`, and
`bot-ui`; `./digests` is written by `bot-ui` and served read-only by `digest-static`.

Network boundary: `digest-static` is the only public surface. It sits behind its own
Cloudflare tunnel → `digest.mattmariani.com` with no app, no database, and (unlike the
operator app's tunnel) no Cloudflare Access — a dumb file server, which is what makes the
share links safe to paste into a group chat.

### Why the bot is a separate process

Only one process may hold the `whatsapp-web.js` LocalAuth session, and that process needs a
browser. So `bot` owns the session and learns everything else over HTTP from `bot-ui`
(`src/digest/poller.ts`) rather than importing `$lib` or opening the same database. The
practical consequence: if the WhatsApp session logs out, the control server never binds, and
digest sends fail with `fetch failed` — the fix is re-authentication, not requeueing.

## 3. Data

### 3.1 `data/league.db` — the system of record

One SQLite file (better-sqlite3), 56 tables as of this writing, created by the `SCHEMA`
statements in `ui/src/lib/db/schema.ts`. The important groups:

- **Game:** `leagues` → `seasons` → `rounds` → `ml_submissions`, `votes`, `competitors`.
  A `league` row spans many Music League seasons; there is no `ml_league_id`, so league
  identity is matched by name against the *current* season.
- **People:** `players`, `player_identities` (chat handle ↔ competitor), `season_players`,
  `player_profiles`, `player_relationships`, `player_avatars`.
- **Chat:** `chat_messages`, `chat_assignments`, `chat_mentions`, `chat_songs`.
- **Digest:** `digest_drafts`, `digest_sections`, `digest_jobs`, `digest_sends`,
  `digest_shares`, `digest_regenerations`.
- **Enrichment:** `song_metadata_queue`, `song_audio_features`, `song_popularity`,
  `song_lyrics_metrics`, `ytm_link_cache`, `ytm_resolution_queue`.
- **LLM bookkeeping:** `llm_calls`, `llm_cost_log`, `llm_health_event`, `llm_preference`,
  `ai_models`, `llm_delight`.
- **Operator:** `settings`, `api_tokens`, `theme_briefs`, `theme_tags`, `shortlist_songs`,
  `voting_lab_*`, `prediction_runs`.

`data/submissions.db` is a **separate, smaller** database opened by the bot process
(`src/index.ts`) for its own submission log and prompt tables. It is not the league data.

### 3.2 Derived state, and one trap

`rounds.phase` exists and is CHECK-constrained to
`not-started | submission | voting | complete`, but it is **not maintained** — the live data
holds only `complete`, `not-started`, and NULL, and has never contained a `voting` row.
The canonical derivation is `ui/src/lib/lifecycle.ts`, which computes
`upcoming | submission | voting | archive` from the submission and voting deadlines. Anything
that keys off `rounds.phase` is a latent bug.

## 4. Getting data in

| Source | Path | Notes |
|---|---|---|
| Music League export (zip/CSV) | `ui/src/lib/import/zipParser.ts` → `importer.ts`, `scripts/ml-rebuild.mjs` | The bulk import. An export ships **completed** rounds only, not the in-progress one. |
| Music League notification email | `src/email/` (IMAP via `imapflow`) → `api` | Round events; drives some deadline data. |
| WhatsApp / Google Chat, live | GroupRelay (Android, phone-side) → `POST /webhooks/relay` on `api` | Notification-stream capture; see `docs/whatsapp-group-capture-plan.md`. |
| WhatsApp, historical | native `Export chat` `.txt` parsed by `scripts/import_whatsapp_chat.py` | Backfills the period before the relay existed. |
| Discord | `ui/src/lib/import/discordChat.ts`, `scripts/import-discord-chat.ts` | Used for the SSSC league. |
| Spotify / Last.fm / lrclib | `src/spotify/`, `ui/src/lib/lastfm.ts`, `ui/src/lib/lrclib.ts` | Track metadata, popularity, audio features, lyric metrics — queued through `song_metadata_queue`. |
| Operator + extension | `POST /api/ingest/songs` | Chrome MV3 extension pushes Spotify/YouTube Music links into the shortlist. |

The chat feeds are the reason the digest can quote the group: `chat_messages` is what the
`chat` and `storylines` sections are built from.

## 5. The digest

The digest is the product. Everything in `ui/src/lib/digest/`.

### 5.1 Anatomy

A digest is a sequence of **sections**. Two kinds of section exist:

- **LLM sections** — exactly seven kinds, fixed in `SECTION_KINDS` (`llm.ts`) and
  CHECK-constrained in the schema: `podium`, `villain`, `flow`, `consensus`, `quotes`,
  `chat`, `storylines`. Adding an eighth means a schema migration and a full regeneration,
  so new ideas ride an existing kind instead.
- **Deterministic blocks** — statistics, standings, the round-intelligence panel, the
  Guesser, computed from the database with no LLM in the loop.

Each section can render `textual`, `visual`, or `both`; visual components implement the
slot interface in `ui/src/lib/digest/variants.ts`.
[digest-sections.md](digest-sections.md) walks the sections one by one.

### 5.2 Generation pipeline

`pipeline.ts` treats generation as **config, not code**. Its vocabulary:

- **Track** — one section (or archive task) to generate.
- **EP** — a parallel phase: all the tracks between two skips.
- **Skip** — a serialization barrier; tracks after it read the output of prior EPs.
- **Merge** — adjacent same-model tracks collapse into a single OpenRouter call.
- **Cover** — the same track re-run in a later EP on a different model, with prior context.

Model selection is per section (`modelFor.ts`, `ai_models`, `llm_preference`), defaulting to
`anthropic/claude-sonnet-4-5` via OpenRouter. Every call is cost-logged.

### 5.3 Job state machine

`runner.ts` (`runOneJob`), driven by `runnerLoop.ts` over the `digest_jobs` table. One job
per round, claimed atomically:

```
pending → capturing → generating → rendered ─┬─ mode=off      → held
                                             ├─ structural    → awaiting_review → held
                                             │  review fails
                                             ├─ mode=hil      → awaiting_approval → held
                                             └─ mode=auto     → finalizing → done
```

Any throw sends the job to `failed` with the error recorded; retries reset it to `pending`.
Per-league mode (`auto` / `hil` / `off`) comes from `leagueDigestConfig.ts`. Approval is a
tokenized link handled by `approvals.ts` and delivered by ntfy (`ntfy.ts`) — approval happens
from the notification, not from a button in the app.

### 5.4 Render, export, share

`export.ts` drives Puppeteer (`puppeteer-core` + the image's Chromium) against the digest
page with `?export=1`, screenshotting the `.dg-export` element:

- **Wide:** 800px viewport — the desktop broadsheet PNG.
- **Mobile:** the `.dg-export--mobile` class narrows the card to 430px, rendered in a 520px
  viewport so the page's own padding can't clip the element shot.
- **PDF:** a phone-portrait page box, paginated by Chromium.

Because the export is the deliverable, components must render everything in export mode —
nothing hover-only, nothing behind an accordion — and every `{#each}` needs a stable unique
key, since one duplicate key is a fatal hydration error that takes down the whole capture.

Rendered artifacts are written to `digests/` and served by `digest-static`:
`/d/<slug>/` for a round digest, `/_media/` for assets that must survive a re-render, and
`/<leagueSlug>/` for the b-side site. Slugs are 22-char base64url strings, so the public host
cannot be enumerated.

### 5.5 Sending

`bot-ui` never sends. `src/digest/poller.ts` polls bot-ui hourly, `autoPost.ts` decides
whether a finished digest is due, and the send goes through `whatsapp/sendGuard.ts`
(allow-listed targets). `manualSend.ts` and the control server (`src/control/`) provide the
manual path.

## 6. The operator app

SvelteKit 2 / Svelte 5 / Tailwind 4 on adapter-node, port 3002. Routes:
`/` dashboard, `/history` rounds and scores, `/shortlist`, `/content` (digest generate →
refine → finalize, plus b-side archive publishing), `/league`, `/chat`, `/settings`,
`/setup`, `/theme-brief`. `/digest` redirects to `/content`; `/digest/[roundId]` is the
digest page itself and is also what the export path loads.

`src/routes/api/` holds ~34 endpoint groups. They serve the UI, the Chrome extension, the
bot's poller, and the MCP server. API tokens (`api_tokens`, bearer) gate the machine callers.

**Development trap:** the digest page crashes on hydration under `vite dev`.
`/digest/[roundId]/+page.svelte` imports `SECTION_KINDS` from `$lib/digest/llm.js`, and
`llm.ts` imports `node:crypto` at module scope, which the dev bundler pulls into the client.
Verify digest UI against a production build with a copy of `data/league.db`.

## 7. Other surfaces

- **b-side** (`bside/`) — a Svelte SPA, no SSR, one bundle shared by every league. Serves a
  public per-league micro-site (league home, player profiles, digest archive) from a
  pre-computed `read_model.json` written next to it. No API, no database at runtime.
- **MCP server** (`mcp-server/`) — a stdio MCP server that exposes round song-list
  management, head-to-head matchups, and digest generation to an LLM assistant. It is a thin
  client over the bot-ui REST API using a bearer token; it holds no state.
- **Chrome extension** (`extension/`) — Manifest V3, no build step. Detects Spotify and
  YouTube Music resources in the active tab and POSTs them to the shortlist.
- **Scripts** (`scripts/`) — operational one-offs: `ml-rebuild.mjs`, `ml-reconcile.mjs`,
  import scripts, Spotify OAuth, roster and theme-tag seeding, cover generation.

## 8. Constraints and invariants

These are load-bearing; breaking one produces a silent failure rather than an error.

- **Seven section kinds**, CHECK-constrained. A new kind requires a forced full regeneration
  that discards hand edits.
- **`rounds.phase` is not a source of truth** — derive from deadlines (§3.2).
- **One WhatsApp session**, in the `bot` container (§2).
- **`.dockerignore` must exclude `ui/node_modules`** (it does, via `**/node_modules`).
  Without it the image bakes stale compiled server code and a deploy silently changes
  nothing — always verify a deploy actually landed.
- **The export is the deliverable** — no hover-only content, no unkeyed `{#each}` (§5.4).
- **Verify LLM prose against the database.** Generated sections have fabricated vote counts
  before; the numbers in a digest must be checked against `data/league.db`.

## 9. Security and privacy

- `.env` is never committed; OAuth refresh tokens and API keys live there.
- Only `digest-static` is publicly served. Its slugs are unguessable (16 bytes of entropy),
  a slug with no directory on disk 404s without revealing that others exist, dotfiles and
  `_*` are hidden, and the b-side league routes send `X-Robots-Tag: noindex, nofollow`.
- WhatsApp automation runs on a **dedicated** bot account, restricted to allow-listed groups,
  with a send guard on every outbound message.
- Chat capture stores the group's real conversation. Exports and the public b-side site are
  privacy-filtered; treat `data/` and `digests/` as containing personal data.
