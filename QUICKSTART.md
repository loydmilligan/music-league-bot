# Quick Start

## Prerequisites

- **Node.js 22** (matches `FROM node:22-bookworm-slim` in `Dockerfile.ui`)
- **npm** (bundled with Node)
- **Docker + Docker Compose** (for production)
- A Spotify developer app if you want the Spotify integration
- An OpenRouter API key if you want the AI digest pipeline

## 1. Clone

```bash
git clone <repo-url>
cd music-league-bot
```

## 2. Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in the keys you need:

| Variable | Required | Notes |
|---|---|---|
| `OWNER_PHONE_NUMBER` | Yes (bot) | Your WhatsApp number, e.g. `16617476822` |
| `WHATSAPP_ALLOWED_GROUP_IDS` | Yes (bot) | Comma-separated WhatsApp group IDs |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Yes (Spotify) | From developer.spotify.com |
| `SPOTIFY_REFRESH_TOKEN` | Yes (Spotify) | Generated via `npm run spotify-auth` (see below) |
| `OPENROUTER_API_KEY` | Yes (digests) | From openrouter.ai |
| `MY_COMPETITOR_ID` | Recommended | Your Music League competitor ID; marks your submissions in the UI |
| `DATA_DIR` | Optional | Defaults to `./data`; set to `/app/data` inside Docker |

For the operator app's dev server, only `OPENROUTER_API_KEY` and `MY_COMPETITOR_ID` are needed for most features.

## 3. Install dependencies

Root-level (bot + API):
```bash
npm install
```

Operator app:
```bash
cd ui && npm install && cd ..
```

b-side site (only needed if working on the public site):
```bash
cd bside && npm install && cd ..
```

## 4. Spotify one-time setup

Only needed if running the WhatsApp bot with Spotify integration:

```bash
npm run spotify-auth
```

Open the printed URL in your browser, authorise, copy the printed `SPOTIFY_REFRESH_TOKEN` into `.env`. One-time only.

## 5. Development — operator app

The fastest iteration loop is the SvelteKit dev server (HMR, no Docker needed):

```bash
cd ui
npm run dev
```

Visit `http://localhost:5173`. The dev server reads `../data/` (the same SQLite the prod container mounts), so you see real data. If a task writes to the DB, copy it first so you don't mutate production data.

Type-check while developing:
```bash
npm run check          # one-shot
npm run check:watch    # continuous
```

## 6. Running tests

Root-level unit tests (parser, rules engine, Spotify adapter):
```bash
npm test
```

Operator app tests (scoring, deadlines, lifecycle, digest, dashboard):
```bash
cd ui && npx vitest run
```

Spotify integration tests (requires real tokens in `.env`):
```bash
npm run test:integration
```

## 7. Development — bot / API

Run the WhatsApp bot (scans a QR code on first launch):
```bash
npm run dev
```

Run just the REST API:
```bash
npm run api
```

## 8. Production — Docker

Build the base image first (only when `Dockerfile.base` changes):
```bash
docker build -f Dockerfile.base -t music-league-bot-base:chromium .
```

Start all services:
```bash
docker compose up -d
```

Or build and start just the operator app:
```bash
docker compose build bot-ui && docker compose up -d --force-recreate bot-ui
```

The operator app is available at `http://localhost:3002`. Digest artifacts and b-side sites are served by `digest-static` at port `8088`.

After deploying, verify the change actually landed:
```bash
# Example: check a known string is in the running container's bundle
curl -s http://localhost:3002 | grep -q "expected-string" && echo "OK"
```

## 9. b-side site build

The public per-league site is a standalone Svelte SPA. Build it once at deploy time:

```bash
cd bside && npm run build
```

Then copy the output to the digests volume so Caddy can serve it:
```bash
cp -r bside/dist/* digests/_bside/
```

Each league's `index.html` and `read_model.json` are written to `digests/{slug}/` by the operator's Content screen (or by `POST /api/content/:leagueId/publish`).

## Where to go next

- [README.md](README.md) — architecture overview and feature list
- [CONTRIBUTING.md](CONTRIBUTING.md) — branch conventions, code style, where docs live
- [ui/README.md](ui/README.md) — operator app details
- [bside/README.md](bside/README.md) — public site details
- [extension/README.md](extension/README.md) — Chrome extension setup
