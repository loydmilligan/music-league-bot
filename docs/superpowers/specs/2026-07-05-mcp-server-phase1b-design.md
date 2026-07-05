# MCP Server Phase 1b — Discovery Tools Design

## Context

Phase 1 (docs/superpowers/specs/2026-07-05-mcp-server-phase1-design.md) shipped the
core MCP server: round song-list management, H2H random-pairing mode, and digest
generation, all talking to bot-ui exclusively via HTTP.

Live use surfaced a real gap: every workflow assumed the caller already knew a
`roundId`, a `spotifyUri`, and that a round's prerequisite data (submissions/votes)
was already imported. In practice an LLM assistant starts a session knowing none
of that. This phase adds the discovery/lookup layer Phase 1 was missing.

## Problems found in live use

1. `resolve_round`'s round-name match is case-sensitive exact-match SQL
   (`WHERE r.name = ?`). "Listen to this..." failed to resolve against the real
   round named "Listen To This..." — forced a manual DB query to find the right
   id.
2. `add_song_to_round` requires a real `spotifyUri`, but no MCP tool can look one
   up — the app already has a working `GET /api/spotify/search` route (Spotify
   client-credentials search), never wired into the MCP server. Assistant had to
   `curl` it directly.
3. There's no way to discover league slugs, round ids, or "what's currently
   active" without already knowing them or querying sqlite directly. The app
   already computes exactly this (`GET /api/active-rounds`), also never wired in.
4. When `check_digest_readiness` reports Submissions/Votes/Vote-comments failing,
   the only fix today is a manual UI button ("Import from CLI") that POSTs
   `/api/digest/:roundId/import-export-zip`. No MCP path to trigger it.

## Decisions

- **Round lookup: list-then-pick, not fuzzy matching.** Mirrors the standard MCP
  pattern (Slack's `list_channels`, GitHub's `list_repos`) — the assistant sees
  real options and picks correctly, rather than a fuzzy match silently picking
  the wrong round. `resolve_round` also gets a cheap, free case-insensitivity fix
  for the case where an exact name is already known, but list-then-pick is now
  the primary path for exploration.
- **New routes needed, not extensions of existing ones.** No existing GET route
  lists leagues by slug or rounds by slug+season — `/api/leagues/[leagueId]/rounds`
  is POST-only (create), keyed by numeric `leagueId`, and does something entirely
  different.
- **Retrofit auth onto every pre-existing route this phase makes MCP-reachable.**
  `/api/spotify/search`, `/api/active-rounds`, and
  `/api/digest/:roundId/import-export-zip` all predate this project and have no
  `requireBearerToken` check. Now that the MCP server is a real (potentially
  remote) consumer of them, they get the same bearer-token gate every other
  MCP-facing route in this project has. This is a deliberate, scoped behavior
  change to existing routes — noted explicitly since Phase 1's plan called out
  the opposite convention (reused routes NOT touched for auth); that convention
  was for routes with pre-existing, established call sites (the digest
  prepare/draft flow, shortlist, research). These three routes have no other
  established caller pattern this would break — they're UI-only, same-origin
  today.
- **`import_round_data` triggers a host-side CLI shell-out.** This is more
  consequential than a read (it runs an external process and writes DB rows),
  but it's the exact same action the existing "Import from CLI" button already
  performs today, with no additional side effects beyond what that button does.

## New UI routes (all `ui/`)

### `GET /api/leagues`
Bearer-token protected. No params. Returns:
```json
[{ "slug": "hip-jammers", "name": "Hip Jammers" }, ...]
```

### `GET /api/rounds/list?leagueSlug=&seasonNumber=`
Bearer-token protected. `leagueSlug` required, `seasonNumber` optional (omit to
list every round across every season for that league). Returns:
```json
[{ "id": 117, "name": "Listen To This...", "roundNumber": null, "phase": "not-started", "seasonNumber": 3 }, ...]
```
Ordered by season, then round id.

### Auth added to `GET /api/spotify/search?q=`
No response shape change — adds `requireBearerToken(request, db)` as the first
line, matching every other MCP-facing route.

### Auth added to `GET /api/active-rounds`
No response shape change — adds `requireBearerToken(request, db)` as the first
line.

### Auth added to `POST /api/digest/:roundId/import-export-zip`
No response shape change — adds `requireBearerToken(request, db)` as the first
line.

## Query change

`ui/src/routes/api/rounds/resolve/+server.ts`'s `roundName` branch changes from
`WHERE ... AND r.name = ?` to `WHERE ... AND LOWER(r.name) = LOWER(?)`. No other
behavior changes; `roundNumber` matching is untouched (already exact-value, no
case concept).

## New MCP tools (`mcp-server/`)

All five follow the existing pattern: a plain exported async function (calls
`botUiFetch`) plus a thin `server.tool(...)` registration, added to the module
that best fits (`rounds.ts` or `songs.ts` or a new `digest.ts` addition).

| Tool | Module | Wraps | Input | Output |
|---|---|---|---|---|
| `list_leagues` | `rounds.ts` | `GET /api/leagues` | none | `[{slug, name}]` |
| `list_rounds` | `rounds.ts` | `GET /api/rounds/list` | `{leagueSlug, seasonNumber?}` | `[{id, name, roundNumber, phase, seasonNumber}]` |
| `get_active_rounds` | `rounds.ts` | `GET /api/active-rounds` | none | passthrough of the route's `{leagues: [...]}` shape |
| `search_spotify` | `songs.ts` | `GET /api/spotify/search?q=` | `{query: string}` | `[{uri, name, artists, album, year, imageUrl}]` |
| `import_round_data` | `digest.ts` | `POST /api/digest/:roundId/import-export-zip` | `{roundId}` | passthrough of the route's `{ok, imported}` / `{ok: false, reason, stage}` shape |

`search_spotify`'s tool description should note it's backed by Spotify's public
catalog search (client-credentials), not this league's own submission data —
same caveat the existing UI search box implies but doesn't say explicitly.

`import_round_data`'s tool description should note this shells out to a
host-side CLI process and can take longer than other tools, and that a `stage:
'auth'` failure means Music League auth expired and needs manual re-login (per
the existing UI's exact error copy) — the tool can't self-heal that case.

## Data flow (the original ask, going forward)

`list_leagues` → `list_rounds(slug)` → pick round id directly (no more
`resolve_round` guessing) → `search_spotify(query)` → pick the real URI →
`add_song_to_round`.

Or, for "what should I work on": `get_active_rounds` → pick a round directly.

If `check_digest_readiness` shows Submissions/Votes/Vote-comments failing:
`import_round_data(roundId)` → re-check.

## Out of scope (logged to roadmap.md, not built here)

- Auto-fetching WhatsApp chat (via GroupRelay) during CLI import, removing the
  manual paste-chat step in digest generation. Logged as roadmap item
  `cli-import-chat-autofetch`. Surfaced during this phase's design but is a
  separate, larger change to the import pipeline and chat-ingestion plumbing.
- Global shortlist browsing independent of a round, voting/results data — Phase
  2 (voting assistant) territory per the original Phase 1 spec, not needed by
  today's workflows.
