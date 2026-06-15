# Operator App (`ui/`)

SvelteKit 2 + Svelte 5 dashboard for Music League Bot. Runs as the `bot-ui` Docker service on port 3002 in production, and as a Vite dev server on port 5173 in development.

## Screens

| Route | What it does |
|---|---|
| `/` | Dashboard home / league overview |
| `/shortlist` | Queue of tracks to submit to the next round |
| `/history` | Round history; drill into per-round scores and submissions |
| `/content` | **Content screen** — Digest tab (generate/refine/finalize) + Archive tab (publish/update b-side sites) |
| `/league` | League and member management |
| `/settings` | API tokens, Spotify auth, WhatsApp group config |
| `/chat` | WhatsApp chat log |
| `/setup` | First-run setup wizard |

The `/digest` route redirects to `/content` (the Digest tab is now embedded in Content).

## Content screen

The heart of the operator workflow for campaign **the b-side** (v1.1.x):

**Digest tab** — the existing generate → refine → finalize pipeline. Produces a shareable per-round HTML digest artifact served by `digest-static`.

**Archive tab** — manages each league's b-side site. Shows all leagues with three states:

- **Update-ready** — a finalized round exists that isn't yet in the league's `archived_rounds`; a pending-update badge shows in the sidebar.
- **Up-to-date** — all finalized rounds are reflected in the published read-model.
- **Not published** — no b-side site yet; offers "Publish b-side →".

The **archive-update modal** exposes:
- Per-section refresh / hold / lock controls (superlatives, stats/KPIs, fingerprints, moments, overlap).
- Required new-archive-entry row for the round being added.
- Quick-steer chips and free-text field for LLM guidance.
- Announce strip (controls whether the update posts to WhatsApp).
- Cost estimate before committing.

Updates always rewrite the read-model in place on the same slug. Locked sections are never regenerated.

## Development

```bash
cd ui
npm install
npm run dev          # Vite dev server → http://localhost:5173
```

The dev server reads `../data/` (the same SQLite the prod container mounts). For read-heavy iteration this is fine. If your task writes to the DB, copy `data/` first to avoid mutating prod data.

Type-check:
```bash
npm run check          # one-shot
npm run check:watch    # continuous
```

Run tests:
```bash
npx vitest run
```

## Build

```bash
npm run build
```

Output goes to `ui/build/`. The Dockerfile (`Dockerfile.ui`) runs this during the Docker build step.

## Key internals

```
ui/src/
├── lib/
│   ├── dashboard/      # Read-model generator (buildReadModel.ts, publish.ts, slug.ts)
│   ├── content/        # Content screen logic and API route handlers
│   ├── digest/         # Digest generation, refinement, finalization
│   ├── db/             # Database helpers (better-sqlite3)
│   ├── spotify/        # Spotify API client
│   ├── predict/        # Player scoring and prediction harness
│   └── components/     # Shared Svelte components
└── routes/
    ├── api/            # SvelteKit server routes (+server.ts files)
    └── (app routes)    # Page routes
```

The operator app is also the API server — SvelteKit's `adapter-node` build runs everything in one process. The `/api/*` routes handle the WhatsApp bot, the browser extension, the digest pipeline, and the b-side publish/update flow.

## Tech stack

- SvelteKit 2, Svelte 5 (runes: `$state`, `$derived`, `$effect`)
- Tailwind CSS 4
- better-sqlite3 (direct, no ORM)
- Puppeteer (Chromium, for digest PNG export)
- Zod 4 for schema validation
- Vitest for tests
