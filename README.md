# Music League Bot

A private, self-hosted companion for a group of friends playing
[Music League](https://musicleague.app/). It ingests each league's rounds, keeps a WhatsApp
bot in the group chat, and — the centre of gravity — generates a **digest**: a designed,
per-round recap page that is reviewed by a human, exported to PNG/PDF, and shared back into
the chat.

Six leagues run through it today: `boarz-ii-men`, `sssc`, `second-best`, `fam-jam`,
`hip-jammers`, `nostalgia-pit`. Each has seasons; each season has rounds.

Not affiliated with Music League. Not multi-tenant, not a product — one operator, one server.

## Architecture at a glance

```
Music League export (zip/CSV)  ─┐
WhatsApp group chat ────────────┤
  via GroupRelay (phone) ───────┤
Spotify · Last.fm · lrclib ─────┤
                                ▼
                         data/league.db  (SQLite, one file, all leagues)
                                │
                                ▼
                    bot-ui  (SvelteKit operator app, :3002)
                     ├── round history, shortlist, player research
                     ├── digest pipeline: capture → LLM draft → human
                     │   review → finalize → render
                     └── Puppeteer export → digests/  ──► digest-static (:8088)
                                │                          public share URLs
                                ▼  (HTTP, polled)
                       bot  (whatsapp-web.js, holds the session)
                                ▼
                          the group chat
```

**Docker services** (`docker-compose.yml`):

| Service | Build | Port | Role |
|---|---|---|---|
| `bot` | `Dockerfile` | — | WhatsApp client (`whatsapp-web.js`), digest poller, control server (:3003 in-container) |
| `api` | `Dockerfile` | 3001 | REST API, email/IMAP poller, `POST /webhooks/relay` chat ingestion |
| `bot-ui` | `Dockerfile.ui` | 3002 | SvelteKit operator app — the thing you actually use |
| `digest-static` | `caddy:2-alpine` | 8088 | Read-only static server for `digests/` (`/d/<slug>/`, `/_media/`, b-side slugs) |

`bot` and `api` share one image built from `Dockerfile`, which is `FROM
music-league-bot-base:chromium` — a stable base carrying Chromium and fonts so app rebuilds
don't re-download it. Rebuild the base only when `Dockerfile.base` changes:
`docker build -f Dockerfile.base -t music-league-bot-base:chromium .`

`digest-static` sits behind a separate public Cloudflare tunnel → `digest.mattmariani.com`;
everything else is private.

**Not everything is a container.** Four scheduled jobs run on the host as systemd *user*
units, not in Docker — the ML auth heartbeat, the round-end lede autorun (`mlb-hil-ledes`,
which owns round-end today), the YouTube-Music playlist drop, and the rollout host executor
(built, not enabled). The units and their install steps are in
[deploy/README.md](deploy/README.md). If something scheduled did not happen, read
`journalctl --user -u <unit>` — a failed oneshot leaves no trace in the timer list.

## Repo layout

```
src/               # bot + api (Node/TypeScript, run with tsx)
  bot/             #   message handler, intent classifier, URL detection
  whatsapp/        #   whatsapp-web.js client + send guard
  digest/          #   poller → autoPost/manualSend: posts finished digests
  control/         #   local control server (:3003) — /send etc.
  email/           #   IMAP poller (Music League notification mail)
  api/             #   REST server, Last.fm, ML auth heartbeat
  spotify/ resolver/ rules/ parser/ storage/ config/
ui/                # SvelteKit operator app — most of the product lives here
  src/lib/digest/  #   the digest pipeline (see below)
  src/lib/db/      #   read models over league.db
  src/routes/api/  #   ~34 endpoint groups the UI and MCP server call
bside/             # Svelte SPA for the public per-league site ("The Boarz Tape")
mcp-server/        # stdio MCP server over the bot-ui API (round + digest tools)
extension/         # Chrome MV3 extension — one-click song ingest, no build step
scripts/           # one-off + operational scripts (ML rebuild, imports, auth)
  digest-qa/       #   Python verification suite (facts, dupes, mentions, participation)
  ytm-drop/        #   YouTube-Music playlist mirror + cover, posted on voting_started
  ytm-cover/ cover-gen/ rollout/
deploy/            # systemd user units for the host-scheduled jobs — see deploy/README.md
design/            # design briefs + hand-authored round content (Regulars/Coinage YAML)
docs/              # see docs/README.md
data/              # SQLite + per-league exports (gitignored)
digests/           # rendered digest artifacts, served by digest-static (gitignored)
```

## Running it

**Prerequisites:** Node 22, npm, Docker + Docker Compose. Setup and env vars are in
[QUICKSTART.md](QUICKSTART.md).

```bash
npm install                     # root (bot + api)
cd ui && npm install            # operator app
```

Development:

| What | Command | Notes |
|---|---|---|
| Operator app | `cd ui && npm run dev` | Vite dev server on :5173 — **but see the digest gotcha below** |
| Bot | `npm run dev` | `tsx src/index.ts`; needs a WhatsApp session and `OWNER_PHONE_NUMBER` |
| API | `npm run api` | :3001 |
| b-side site | `cd bside && npm run dev` | :5190 |

Tests and checks:

```bash
npm test                        # root vitest
cd ui && npm test               # operator-app vitest (the bulk of the suite)
cd ui && npm run check          # svelte-check
```

Deploy (see [docs/dev-loop-playbook.md](docs/dev-loop-playbook.md) for the full rules):

```bash
docker compose build bot-ui && docker compose up -d --force-recreate bot-ui
```

## The digest pipeline

The operator flow lives in `ui/src/lib/digest/`:

- `capture.ts` — freeze the round's data (votes, submissions, chat) for the draft
- `pipeline.ts` — declarative run order for LLM sections; parallel "EPs" split by skips,
  adjacent same-model sections merged into one call
- `llm.ts` — the OpenRouter call, section schemas, and `SECTION_KINDS`
- `runner.ts` / `runnerLoop.ts` / `jobs.ts` — the job state machine (capture → generate →
  render → approval → finalize)
- `DigestSection.svelte` + the per-kind visual components — the rendered page
- `export.ts` — Puppeteer screenshots the `.dg-export` element at 800px (desktop) and
  430px (mobile), writes to `digests/`
- `approvals.ts` / `ntfy.ts` — the human approval gate; approve via ntfy, not a button

There are exactly **seven LLM section kinds** — `podium`, `villain`, `flow`, `consensus`,
`quotes`, `chat`, `storylines` — and the set is CHECK-constrained in the schema. New section
ideas ride on an existing kind rather than adding one.
[docs/digest-sections.md](docs/digest-sections.md) is the section-by-section tour.

## Gotchas that will bite immediately

- **The digest page crashes on hydration under `npm run dev`.**
  `ui/src/routes/digest/[roundId]/+page.svelte` imports `SECTION_KINDS` from
  `$lib/digest/llm.js`, and `llm.ts` imports `node:crypto` at module scope. Vite's dev
  bundling pulls that into the client. Verify digest UI against a **production build**
  (`npm run build` + a copy of `data/league.db`), never the dev server.
- **`rounds.phase` is dead data.** The column exists and is CHECK-constrained, but of 115
  rows it holds only `complete`, `not-started`, and NULL — there has never been a `voting`
  row. Derive phase from the deadlines via `ui/src/lib/lifecycle.ts` instead.
- **`.dockerignore` must keep excluding `ui/node_modules`.** It does now (`**/node_modules`).
  When it didn't, the image silently baked stale compiled server code and deploys appeared
  to succeed while changing nothing. After any deploy, assert the thing you shipped is
  actually live.
- **One WhatsApp session, in the `bot` container.** Only one process can hold the LocalAuth
  session, which is why `bot` polls bot-ui over HTTP instead of importing `$lib`. If the
  session logs out, the control server never binds and digest sends fail with
  `fetch failed` — re-authenticate rather than requeueing the job.
- **The bot's own SQLite is separate.** `src/index.ts` opens `data/submissions.db`; the
  league/digest data everything else reads is `data/league.db`.
- **The Rollout entity is built but has never run.** `ui/src/lib/rollout/`, the Rollouts
  tab and `scripts/rollout/host_executor.py` are complete, but `rollout_configs` and
  `rollout_runs` are both empty and `mlb-rollout-host.timer` is disabled. Round-end is
  still owned by `mlb-hil-ledes.timer`. Do not read rollout code as a description of what
  production does; cutover is a deliberate task ([docs/how-to/rollouts.md](docs/how-to/rollouts.md)).

## Docs

| Doc | Read it when |
|---|---|
| [QUICKSTART.md](QUICKSTART.md) | Setting the project up from scratch |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Tests, branch conventions, where docs go |
| [docs/README.md](docs/README.md) | Looking for any other document |
| [deploy/README.md](deploy/README.md) | A scheduled job (ledes, YTM drop, auth probe) misbehaved, or you're installing them |
| [docs/HIGH_LEVEL_DESIGN.md](docs/HIGH_LEVEL_DESIGN.md) | You need the architecture in depth |
| [ui/README.md](ui/README.md) · [bside/README.md](bside/README.md) · [extension/README.md](extension/README.md) · [mcp-server/README.md](mcp-server/README.md) | Working inside that subproject |
| [CHANGELOG.md](CHANGELOG.md) | "When did this change?" |

## Tech stack

Node 22 · TypeScript · SvelteKit 2 / Svelte 5 / Tailwind 4 (adapter-node) ·
SQLite via better-sqlite3 · whatsapp-web.js · Puppeteer (puppeteer-core + system Chromium) ·
Caddy 2 · OpenRouter (`anthropic/claude-sonnet-4-5` by default) · Chrome MV3 extension.

## License

MIT. Private friend-group project.
