# music-league-mcp-server

An MCP server exposing music-league-bot's round song-list management, H2H
random-matchup mode, and digest generation to an LLM assistant.

## Setup

1. Install dependencies: `npm install`
2. Mint a bearer token: in the bot-ui app, go to **Settings → API tokens**,
   create one (any label), and copy the plaintext token shown once.
3. Copy `.env.example` to `.env` and fill in:
   - `BOT_UI_BASE_URL` — where bot-ui is running (e.g. `http://localhost:3002`)
   - `BOT_UI_API_TOKEN` — the token from step 2
4. Build: `npm run build`

## Running with Claude Code

Add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "music-league": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {
        "BOT_UI_BASE_URL": "http://localhost:3002",
        "BOT_UI_API_TOKEN": "<your token>"
      }
    }
  }
}
```

## Tools

| Tool | Purpose |
|---|---|
| `list_leagues` | List every league (slug + name) |
| `list_rounds` | Browse a league's rounds by id/name/round number/phase |
| `get_active_rounds` | Get each active league's currently-active round + season rounds |
| `resolve_round` | Look up a round's id by league/season/round number or name |
| `search_spotify` | Search Spotify's catalog for a track (returns a uri to use with add_song_to_round) |
| `add_song_to_round` | Add a song to a round's research list (cascades to the global shortlist) |
| `add_song_to_shortlist` | Add a song to the global shortlist only |
| `update_song` | Update a round research entry's notes/ratings |
| `remove_song_from_round` | Soft-remove a song from a round's research list |
| `list_round_songs` | List a round's research songs |
| `start_random_matchup` | Start a random H2H pairing for a round |
| `reshuffle_random_matchup` | Replace the current pairing with 2 different songs |
| `select_h2h_winner` | Record a matchup winner; loser is removed, a new challenger is picked |
| `get_current_matchup` | Get the currently-pending pairing |
| `check_digest_readiness` | Check a round's digest generation prerequisites |
| `import_round_data` | Trigger a host-side CLI import of submissions/votes/vote-comments |
| `generate_digest` | Generate (or fetch cached) a round's digest draft |

## Architecture

Every tool is a thin HTTP client call (`src/httpClient.ts`) against bot-ui's
existing (and a few new) `/api/*` routes — this package never touches
sqlite or imports from `ui/src/lib` directly. Transport is stdio only for
now (`src/index.ts`); `src/server.ts`'s `createServer()` factory is
transport-agnostic, so adding HTTP/SSE later is a new entrypoint, not a
rewrite.

## Development

- `npm run dev` — run via `tsx` (no build step)
- `npm test` — run the vitest suite (HTTP calls are mocked; no live bot-ui needed)
- `npm run typecheck` — `tsc --noEmit`
