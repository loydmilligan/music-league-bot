# `src/` — Bot and API server

Node.js + TypeScript backend. Entry point: `src/index.ts` (the WhatsApp bot). The REST API runs separately via `src/api/server.ts`.

## Module map

| Directory | Role |
|---|---|
| `bot/` | WhatsApp message handler — routes incoming messages to commands |
| `api/` | REST API server (port 3001) — exposes endpoints consumed by the operator app and the Chrome extension |
| `music/` | Music League round ingestion — parses export ZIPs, imports rounds and submissions |
| `parser/` | `!song` command parser — extracts Spotify/YouTube URLs and command variants from WhatsApp messages |
| `resolver/` | Track resolver — normalizes Spotify/YouTube URLs via Songlink |
| `rules/` | Rules engine — evaluates configurable per-group rules against parsed commands |
| `spotify/` | Spotify Web API adapter + OAuth flow (`npm run spotify-auth`) |
| `storage/` | SQLite database helpers (better-sqlite3) — shared with the operator app via the `data/` volume |
| `whatsapp/` | whatsapp-web.js client setup and QR auth |
| `utils/` | Shared utilities |
| `config/` | Config loader (reads `config/rules.json`) |

## Running

```bash
npm run dev    # WhatsApp bot (src/index.ts)
npm run api    # REST API server only (src/api/server.ts)
```

The operator app (`ui/`) also runs API routes via SvelteKit server routes — those are separate from this `src/api/` server. The Docker `api` service runs `src/api/server.ts`; the `bot-ui` service runs the SvelteKit app.
