# MCP server for music-league-bot — Phase 1 design

Date: 2026-07-05
Status: approved, ready for implementation planning

## Context

We want an LLM assistant (starting with Claude Code, later possibly Claude.ai) to interact
directly with music-league-bot: managing a round's candidate song list, running head-to-head
song matchups, and driving digest generation. A separate, much larger feature — an assisted
voting workflow (metadata + taste-fingerprint-based vote prediction, per-round vote
configuration, notes/adjustment during voting) — was scoped in the same conversation but is
deliberately deferred to its own Phase 2 design, since it requires new domain concepts (round
vote configuration, prediction storage) rather than just exposing what already exists. Archive
generation tools are noted as a Phase 3+ backlog item, not designed here.

Research during brainstorming surfaced load-bearing facts that shaped this design:

- **`rounds.id` is the only stable round identifier.** `round_number` is a nullable, manually-
  curated display field added in sprint-25 specifically because id/created_at order isn't
  reliably chronological for at least one league — it is never safe to use for lookups.
- **A full H2H tournament already exists** (`ui/src/lib/db/headToHead.ts`, `research_songs` +
  `head_to_head_matches` tables) — but it's a deterministic "king of the hill" (current champion
  vs. the highest-scored untested challenger), not random pairing. It has its own tab in the app
  UI and existing UI surfaces already send songs into it. This project does not replace or
  redesign that mode — it adds a second, independent "random pairing" mode alongside it, sharing
  the same underlying song pool and match-history table.
- **Two other "bracket/tournament" surfaces exist in the wider workspace** (a standalone
  `song-tournament-bracket` app, and `/bracket/*` routes on the separate `api` service) — both are
  out of scope / not usable and are not part of this design.
- **Two parallel rated-candidate-pool tables exist:** `shortlist_songs` (global, append-only,
  "everything ever worth looking into," rows are never really removed) and `research_songs`
  (round-scoped, the active candidate pool H2H reads from). The relationship, per this project's
  explicit rule: adding a song to a round's research list always ensures it also exists on the
  shortlist; adding to the shortlist alone never touches any round.
- **There are 6 rating columns on `research_songs` today, only 4 of which are current.**
  `discovery_potential`, `theme_fit`, `quality`, `replayability` are the live 4-trait set.
  `nostalgia_potential` and `personal_rating` are a deprecated pair from an earlier scheme —
  still present in the schema (existing data untouched), but no new tool writes them. The
  existing H2H tab UI still displays the deprecated pair instead of quality/replayability; this
  project fixes that display bug as an incidental, directly-related change.
- **No existing MCP server in this codebase** — this is greenfield.
- **A bearer-token auth mechanism already exists and is barely used** (`ui/src/lib/auth/bearer.ts`,
  `api_tokens` table, a Settings → API tokens UI, `requireBearerToken()` helper) — currently
  enforced on exactly one route. This project reuses it rather than building new auth.
- **Digest generation already has clean contracts to wrap:** `runPrepChecks(db, roundId)` (via
  `POST /api/digest/:roundId/prepare`) and `GenParams` (via `POST /api/digest/:roundId/draft`) —
  no new backend logic needed for the digest tools, only MCP wrapping.

## Architecture

**New package:** `mcp-server/` at the monorepo root (Node/TypeScript, `@modelcontextprotocol/sdk`).

**Transport:** stdio only for Phase 1, wired to Claude Code's MCP config. Built so a second
transport can be added later without touching tool logic: a `createServer()` factory builds and
returns a fully-configured MCP `Server` (all tools/resources registered), and `index.ts` merely
picks a transport (`StdioServerTransport`) to connect it to. Adding HTTP/SSE later (for Claude.ai
or other remote use) means writing a new thin entrypoint that connects the same server object to
an `SSEServerTransport`/`StreamableHTTPServerTransport` — not a rewrite.

**Data access:** every tool is a thin wrapper that calls the SvelteKit app's existing (or newly
added) `/api/*` routes over HTTP against a configured `BOT_UI_BASE_URL` env var (e.g.
`http://localhost:3002`, or the LAN/docker-network address). No direct sqlite access, no
duplicated business logic — the MCP server never imports from `ui/src/lib` directly.

**Auth:** the MCP server sends `Authorization: Bearer <token>` on every request, using a token
generated through the existing Settings → API tokens UI (stored in the MCP server's own config/
env, not committed). Every **new** route this project adds calls `requireBearerToken()`.
Existing routes the MCP tools call (digest prepare/draft) are left exactly as they are today
(unauthenticated, LAN-only) — locking those down is explicitly out of scope for this project.

## Round identification

Every tool that takes a round parameter takes **`roundId: number`** (`rounds.id`) — never
`round_number`. A `resolve_round` tool takes `{ leagueSlug, seasonNumber, roundNumber?,
roundName? }` and returns the matching `id` (plus its `name`/`round_number`/`phase` for
confirmation), so a human or the LLM can reference a round by "Fam Jam season 3 round 5"
without needing to know the internal id. `round_number` and `name` are always included in tool
*responses* as display context; they are never accepted as the primary lookup key.

## Tool set 1 — Song list (shortlist + round research list)

**Schema change**, `research_songs` gains three columns:
- `removed_reason TEXT` — `NULL` (still active) | `'user_removed'` | `'h2h_loss'`
- `removed_by_song_id INTEGER REFERENCES research_songs(id)` — set only when
  `removed_reason = 'h2h_loss'`, pointing at the winning song
- `removed_at TEXT` — timestamp of removal

This replaces the current *implicit* retirement logic (a song is only inferred "out" by scanning
`head_to_head_matches` for it as a loser) with an explicit, queryable state: a song is "in" a
round's active list iff `removed_reason IS NULL`. `buildH2HState`'s existing derivation stays for
the king-of-the-hill mode's own bookkeeping; the new column is additive, not a replacement of
existing behavior for that mode.

Ratings: only the 4 live traits — **discovery_potential, theme_fit, quality, replayability** —
are ever written by new tools. `nostalgia_potential`/`personal_rating` remain in the schema
untouched but are not exposed for writing.

**Tools:**

| Tool | Params | Behavior |
|---|---|---|
| `add_song_to_round` | `roundId, spotifyUri, title, artist, album?, notes?, ratings? {discovery?, themeFit?, quality?, replayability?}` | Upserts into `shortlist_songs` (creating it if new) **and** `research_songs` for that round. |
| `add_song_to_shortlist` | same minus `roundId` | Shortlist only — no round association created. |
| `update_song` | `researchSongId, notes?, ratings?` | Patches notes/ratings on an existing round research entry. |
| `remove_song_from_round` | `researchSongId, reason: 'user_removed'` | Sets `removed_reason`/`removed_at`. (H2H-loss removals are set internally by the H2H tools, not this one.) |
| `list_round_songs` | `roundId, includeRemoved?: boolean` | Research-songs rows for the round, joined with shortlist data, ratings, and removal info. |

## Tool set 2 — H2H matchups (new random mode, alongside existing king-of-the-hill)

**New table** `h2h_pending_matchup`: `{ roundId (unique), songAId, songBId, mode: 'random',
createdAt }` — the currently-proposed pairing for a round's random mode. King-of-the-hill mode
needs no equivalent state since it's fully re-derivable from match history on every read; a
random pairing is arbitrary and can't be reconstructed after the fact, so it must be persisted.

**Tools:**

| Tool | Params | Behavior |
|---|---|---|
| `start_random_matchup` | `roundId` | Picks 2 random active songs (`removed_reason IS NULL`) from the round's research list, writes them to `h2h_pending_matchup`, returns both (title/artist/spotify_uri — the Spotify URI is returned so playback can be triggered externally; this project does not control playback itself). |
| `reshuffle_random_matchup` | `roundId` | Same as above, excluding whichever 2 songs are currently pending — guarantees 2 different songs. |
| `select_h2h_winner` | `roundId, winnerSongId` | Looks up the pending pair, inserts a `head_to_head_matches` row (existing table, reused as-is), sets the loser's `removed_reason='h2h_loss'` + `removed_by_song_id=winnerId` + `removed_at`, then auto-advances: picks one new random active song to challenge the winner and updates `h2h_pending_matchup` to `{songA: winnerId, songB: newChallengerId}`. Returns the new pairing. |
| `get_current_matchup` | `roundId` | Returns whatever's currently pending for the round, or null if random mode hasn't been started. |

Existing king-of-the-hill mode and its app-UI tab are untouched. The two modes share only the
underlying `research_songs` pool and `head_to_head_matches` history table.

**Incidental fix:** the existing H2H tab UI currently displays `nostalgia`/`personal` ratings
instead of the current `quality`/`replayability` pair — fixed as part of this project since it's
directly tied to formalizing "the 4 traits" above.

## Tool set 3 — Digest generation

No new backend routes — these wrap existing endpoints directly.

| Tool | Params | Behavior |
|---|---|---|
| `check_digest_readiness` | `roundId` | Wraps `runPrepChecks` via `POST /api/digest/:roundId/prepare`; returns each check's name/status/count. |
| `generate_digest` | `roundId, sections?, pastedChat?, recap?` | Wraps `POST /api/digest/:roundId/draft` with the existing `GenParams` shape. Omitting everything but `roundId` uses defaults / returns the cached draft if one exists. |

Deliberately minimal — finalize/export/regenerate are not included in Phase 1; they'd be
straightforward additions later if wanted.

## Implementation-planning notes (not design decisions — flagged for the planning pass)

- Audit whether `research_songs`/`shortlist_songs` already have CRUD API routes from the
  existing Theme Research UI before adding new ones — extend/reuse rather than duplicate if so.
- Confirm whether a "list rounds for a league/season" endpoint already exists to build
  `resolve_round` on top of, versus needing a small new resolver endpoint.
- Both new tables (`research_songs` column additions, `h2h_pending_matchup`) need migration
  entries in `ui/src/lib/db/client.ts` (the existing `ALTER TABLE ... ADD COLUMN` pattern used for
  prior additive schema changes) or `schema.ts`, whichever this codebase's existing migration
  convention actually is — confirm at planning time.
- `start_random_matchup`/`reshuffle_random_matchup` always pick 2 *distinct* active songs (never
  the same song for both slots). If fewer than 2 active songs remain in the round (0 or 1), the
  tool returns a clear "not enough active songs" error rather than a partial/invalid pairing —
  exact error shape to be defined at planning time.
