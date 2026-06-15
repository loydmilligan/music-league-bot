# Music League Bot

A self-hosted toolkit for [Music League](https://musicleague.app/) obsessives. It ingests rounds, generates AI-written digests, publishes per-league public "b-side" sites, and keeps a WhatsApp group bot in the loop — all from a single operator app.

## Features

### Operator app (`ui/`)
SvelteKit dashboard (v1.1.1) for league management. Runs as the `bot-ui` Docker service on port 3002.

- **Rounds & history** — browse every round, see scores, and drill into submissions.
- **Shortlist** — a queue of Spotify/YouTube tracks to submit to the next round.
- **Digest pipeline** — generate → refine → finalize an AI-written round recap. Uses OpenRouter (Claude Sonnet by default).
- **Content screen** — publish and update each league's b-side site without touching the command line. Shows per-league state (update-ready / up-to-date / not-published) and surfaces an archive-update modal with section-level refresh / hold / lock controls and steerable rewrites.
- **Player Research** — per-player stats and taste fingerprints used to seed LLM prompts.
- **Settings** — API tokens, Spotify auth, WhatsApp group config.

### Public b-side site (`bside/`)
A per-league, no-login, static micro-site — think Spotify Wrapped meets a music-nerd yearbook. Each league gets a private URL at `digest.mattmariani.com/{slug}` (slugs are 22-char random base64url strings; no enumeration). Three routes:

- **League Home** — hero KPIs, superlative reel, member grid, season moments.
- **Player Profile** — signature superlative, Taste Fingerprint (artist/genre/era chips + spectrum sliders), Biggest Fan / Friendly Hater, "Your People" (Vote Together + Taste Twins), discovery playlist.
- **Digest Archive** — past rounds by season, deep-linking to full digest artifacts.

### Digest pipeline
The `digest-static` Caddy service (`port 8088`) serves both per-round HTML digest artifacts (`/d/<slug>/`) and the b-side SPA bundle (`/_bside/`). The pipeline: export a round → LLM draft → operator refine → finalize → share link.

### WhatsApp bridge (`src/bot/`)
Connects via `whatsapp-web.js`. Watches allowed group IDs, parses `!song` commands, resolves Spotify/YouTube links, and manages a per-group shortlist. Can DM the league owner with status updates.

### Browser extension (`extension/`)
Chrome Manifest V3 extension. One-click ingest of Spotify tracks/albums/playlists and YouTube Music tracks/playlists/albums into the shortlist. Reads the active tab, detects the resource type, and POSTs to `/api/ingest/songs`. No build step required.

## Architecture

```
music-league-bot/
├── src/            # Bot + API server (Node.js / TypeScript)
│   ├── bot/        # WhatsApp message handler
│   ├── api/        # REST API server (port 3001)
│   ├── music/      # Music League round ingestion
│   ├── rules/      # Rules engine
│   ├── spotify/    # Spotify adapter + OAuth
│   ├── storage/    # SQLite (better-sqlite3)
│   ├── whatsapp/   # whatsapp-web.js client
│   └── utils/
├── ui/             # SvelteKit operator app (port 3002 in prod)
├── bside/          # Svelte SPA — public per-league site (no SSR)
├── extension/      # Chrome extension (no build step)
├── data/           # SQLite databases + season exports (gitignored)
└── digests/        # Rendered digest artifacts + b-side bundles (gitignored)
```

**Docker services** (`docker-compose.yml`):

| Service | Image | Port | Role |
|---|---|---|---|
| `bot` | `music-league-bot-base:chromium` | — | WhatsApp bot process |
| `api` | `music-league-bot-base:chromium` | 3001 | REST API |
| `bot-ui` | `Dockerfile.ui` | 3002 | Operator SvelteKit app |
| `digest-static` | `caddy:2-alpine` | 8088 | Static file server for digests + b-side |

All app images share a base image (`music-league-bot-base:chromium`) that bundles Chromium and fonts for Puppeteer-driven digest PNG export. Rebuild the base only when `Dockerfile.base` changes.

## Quick start

See [QUICKSTART.md](QUICKSTART.md).

## Docs

| Doc | What it covers |
|---|---|
| [QUICKSTART.md](QUICKSTART.md) | Prerequisites, clone, env, dev server, prod deploy |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, tests, branch conventions, where docs live |
| [ui/README.md](ui/README.md) | Operator app dev details |
| [bside/README.md](bside/README.md) | Public b-side site — build + serve |
| [extension/README.md](extension/README.md) | Chrome extension install + use |
| [docs/](docs/) | Design docs, design briefs, sprint coordination |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

## Tech stack

- **Runtime:** Node.js 22, TypeScript
- **Operator app:** SvelteKit 2, Svelte 5, Tailwind CSS 4, adapter-node
- **Public site:** Svelte 5 SPA (Vite, no SSR)
- **Storage:** SQLite via better-sqlite3
- **WhatsApp:** whatsapp-web.js
- **Digest screenshots:** Puppeteer (Chromium)
- **Static serving:** Caddy 2
- **LLM:** OpenRouter (Claude Sonnet default)
- **Extension:** Chrome Manifest V3, vanilla JS

## License

MIT. Private friend-group project — not affiliated with Music League.
