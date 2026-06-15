# the b-side

A public, per-league static site — think Spotify Wrapped meets a music-nerd yearbook. Each Music League gets its own URL at `digest.mattmariani.com/{slug}` with no login, no app, and no enumeration.

## What it is

Three client-side routes, all reading from a single precomputed `read_model.json`:

- **League Home** (`/`) — hero, KPI ribbon, superlative reel, member grid, season moments, latest-round teaser.
- **Player Profile** (`/p/{memberId}`) — signature superlative, Taste Fingerprint (artist/genre/era chips + spectrum sliders + rewards/punishes), more superlatives, Biggest Fan / Friendly Hater, "Your People" (Vote Together + Taste Twins), discovery playlist. Lite-tier members degrade gracefully.
- **Digest Archive** (`/archive`) — past rounds by season, each deep-linking to the existing full digest artifact at `/d/{digestSlug}/`.

Every award has a share card: a screenshot-ready overlay safe to drop in any chat.

## Architecture

This is a standalone Svelte 5 SPA built with Vite. No SvelteKit, no SSR, no server — just a static `index.html` and a JS bundle.

```
bside/
├── src/
│   ├── App.svelte         # Root; client-side router
│   ├── routes/
│   │   ├── HomeScreen.svelte
│   │   ├── ProfileScreen.svelte
│   │   └── ArchiveScreen.svelte
│   └── lib/
│       ├── types.ts       # ReadModel type definitions
│       ├── accents.ts     # League accent color helpers
│       ├── icons.ts       # Icon registry
│       └── atoms/         # Shared components (share overlay, etc.)
└── public/                # Static assets
```

**Data flow:** the operator's Content screen (or `POST /api/content/:leagueId/publish`) calls `publishSite` in `ui/src/lib/dashboard/publish.ts`, which:
1. Runs `buildReadModel` to assemble the full read-model from the database.
2. Writes `digests/{slug}/read_model.json`.
3. Writes `digests/{slug}/index.html` (the SPA shell, sets `data-league-slug` on `<body>`).

The b-side bundle at `/_bside/` is shared across all leagues — each `index.html` boots the same JS but reads its own `read_model.json` at `/{slug}/read_model.json`.

## Serving

The `digest-static` Docker service (Caddy 2, `Caddyfile.digest`) serves everything under `digests/`:

- `/_bside/*` — shared SPA bundle (built once at deploy)
- `/{slug}/` — SPA shell (`index.html`)
- `/{slug}/read_model.json` — direct JSON file
- `/{slug}/p/{id}` and `/{slug}/archive` — SPA fallback to `/{slug}/index.html`
- Bad slug — 404 (no enumeration)

The service is `noindex` by default. It's fronted by a public Cloudflare tunnel pointing at host port `8088`.

## Build

```bash
cd bside
npm install   # first time only
npm run build
```

Output goes to `bside/dist/`. After building, copy to the digests volume:

```bash
cp -r bside/dist/* digests/_bside/
```

This only needs to happen when the b-side source changes. League content (`index.html` + `read_model.json` per slug) is managed by the operator app, not this build step.

## Development

```bash
cd bside
npm run dev   # Vite dev server on port 5190
```

Visit `http://localhost:5190`. You'll need a `read_model.json` in the right place — the dev server reads files relative to the project root. For quick iteration, drop a real `read_model.json` into `public/` and adjust the fetch path in `App.svelte` temporarily.

Type-check:
```bash
npm run check
```

## Content management

The b-side content is generated and updated entirely from the operator app's **Content → Archive** tab:

- **First publish** — mints the slug, runs `buildReadModel`, writes artifacts to `digests/`.
- **Update** — section-wise recompute with refresh / hold / lock controls per section (superlatives, stats/KPIs, fingerprints, moments, overlap). Locked sections are never regenerated. Always rewrites in place on the same slug, so the URL never changes.

The read-model generator lives in `ui/src/lib/dashboard/buildReadModel.ts`. See that file for the data model and which database tables feed each section.
