# Backlog

> Triaged 2026-07-16 against the actual source. Every item below was checked
> against code, git history, or the live DB — not carried forward on faith.
> Items that shipped or were overtaken have been deleted; see the triage report
> in that session for what was removed and why.

## What this project is

It started as a passive music-capture layer for a WhatsApp group. It is now four
surfaces, and the backlog should be read against all of them:

- **WhatsApp bot** (`src/`, container `bot`) — still live. Auto-captures music
  URLs from the group into `chat_songs` + the master Spotify playlist. `!song`
  is the only command it has ever parsed (`src/parser/parseMessage.ts:12`).
- **Chat relay** (`POST /webhooks/relay` → `chat_messages`) — Android relay
  feeds WhatsApp + Google Chat history. Separate pipeline from the bot.
- **Dashboard** (`ui/`) — the operator surface: research, history, digest,
  settings. Where most new work lands.
- **MCP server** (`mcp-server/`) — agent-facing tools over the same data.

The old "zero friction, no commands" framing is obsolete: the command surface was
never built beyond `!song`, and the product moved to the dashboard and MCP. Do
not add `!command` items without deciding that question first.

---

## Ranked

### 1. Live submission / vote counts

Who has and hasn't submitted or voted in the current round. This is the want
behind the old "email ingestion via n8n" item, which is deleted — but the want
itself was never met, so it is restated here rather than lost.

**The email channel provably cannot supply this.** `src/email/emailParser.ts:26`
classifies exactly four types (`round_starting | new_playlist | votes_are_in |
other`) and `ParsedEmail` carries no count fields. ML's "votes are in" email
announces that the phase ended; it carries no tally. Any implementation needs a
different source.

**Cheap now:** `cli-web-musicleague` already covers exactly this ("who has/hasn't
submitted, who has/hasn't voted, vote totals"). The capability exists and is not
wired into the dashboard. This is plumbing, not research.

### 2. YTM links never reach the digest

`ui/src/lib/digest/prepChecks.ts:170` defines an optional readiness check named
**"YTM playlist links"**, which passes only when 100% of a round's submissions
have a `ytm_link_cache` row (`prepChecks.ts:92`). But no digest section renders
`ytmUrl` — grep for `ytm` across `ui/src/lib/digest/` hits only `prepChecks.ts`.

So the gate exists, the cache is populated, and `attachYtmLinks()`
(`ui/src/lib/db/ytmLinks.ts:42`) already batch-enriches song payloads — the links
just never surface in the output. This is the surviving kernel of the deleted
"Spotify → YouTube converter" item: YouTube-Music listeners still get left out of
the weekly playlist. Nearly built; needs a render.

Decide first whether the check name reflects abandoned intent or a dropped wire.

### 3. Chat-capture health signal

There is no signal anywhere for "is chat capture still working." The watcher
widget exposes the email poller's `lastPollAt`, `uptimeMs`, `dbSizeBytes`
(`ui/src/lib/db/layout.ts:168-170`) and nothing for the relay.

This has now bitten twice. The relay outage where `docker ps` reported "Up N
hours" while the process was a zombie; and the 2026-07-16 window bug, where a
brand-new league captured 27 messages that were silently invisible for hours.
Both were found by hand, late.

**Cheap:** `chat_messages.captured_at` already exists, and the watcher widget is
already there to hang a per-group "last captured" on. The live-round exemption
shipped 2026-07-16 makes an empty live round *visible* on the Chat Content page,
but only to someone who looks — this is the push version.

### 4. `new_playlist` emails mostly fail to map to a round

46 `new_playlist` rows sit at `unmapped` vs 27 mapped — roughly **63% of playlist
emails drop their Spotify playlist URL on the floor**. Unlike the other two email
types, `new_playlist` carries no ML round id, so it falls back to name matching
(`src/email/emailIngest.ts:80-95`) and usually misses.

Data loss, not a feature gap. Worth a look before building anything on top of the
email pipeline.

### 5. My-standing query

`My place: —` and `Finished: —/N` have rendered as literal em-dashes on the home
cards since sprint-4 (`ui/src/routes/+page.svelte:249,318`, TODO still at `:247`).
`getMyStanding` does not exist anywhere.

`MY_COMPETITOR_ID` is already wired and live (`.env.example:38`, set in prod), so
the dependency is satisfied — this is the standings aggregation plus wiring. It is
the first thing on the landing page, and it has been visibly broken for two
months. Keep the loader server-side; sprint-24 deliberately dropped `$env` from
client paths.

### 6. Show the theme submitter on the round detail page

The set-UI shipped: two "submitted by" dropdowns write `rounds.theme_submitted_by`
via `PATCH /api/rounds/:roundId` (`ui/src/routes/settings/setup/+page.svelte:883,961`),
and 10 of 85 rounds are populated. The round detail page never displays it.

Small, and half the work is already done.

**Note the column:** the old backlog named `theme_chooser_id`. That column is dead
— 0 of 85 rows, referenced only by its own migration and a one-way backfill *out*
of it (`ui/src/lib/db/client.ts:316-322`). `theme_submitted_by` (FK → `players`)
superseded it. Dropping `theme_chooser_id` is a cleanup worth folding in here.

### 7. Small cleanups

- **`--color-rating-voting` token** — voting-phase rating dots still use stock
  Tailwind blue inline (`round/[roundId]/+page.svelte:477,539`) while every
  neighbouring branch uses project tokens. Promote it in `ui/src/app.css`.
  *Latent conflict:* `DotIndicator.svelte:15` maps its own `voting` status to
  `bg-warn` (amber) — same word, different colour. Decide whether the token
  unifies these or stays scoped to rating dots.
- **Per-platform stats** — "most links this week came from YouTube (8) vs
  Spotify (4)". `source_platform` is captured on every submission
  (`src/bot/handler.ts:235`) and shown per-row, but no aggregate query exists.
  Data is there; only the rollup is missing.
- **League-scope the theme-submitter dropdown** — it iterates the global
  `data.players` list (`settings/setup/+page.svelte:889,966`) rather than the
  league's members. This is the piece that would actually need item 9.

### 8. Research upsert by `spotify_uri`

Consolidate the POST-then-PATCH dance into one atomic call.

**The old item's diagnosis was wrong** and should not be trusted by whoever picks
this up: POST already keys by `spotify_uri` (`INSERT OR IGNORE` against
`UNIQUE(round_id, spotify_uri)`, `ui/src/lib/db/research.ts:45-50`). The real
problem is that it upserts *identity only* — ratings are discarded on conflict —
so callers POST to get an id, then PATCH ratings by that id
(`round/[roundId]/+page.svelte:206-223`, whose own comments narrate the
workaround). Two round-trips, non-atomic.

Precedent exists: `POST /api/rounds/[roundId]/research-songs` accepts `ratings` in
one shot, but it is bearer-auth'd for MCP and unused by these UI surfaces.

### 9. League ↔ competitor linkage

`competitors` is still flat (`id, ml_competitor_id, name, player_id`); no
`league_id`, no join table.

**The live data settles the design question the old item left open: a `league_id`
column would be wrong.** The same `ml_competitor_id` appears across multiple
leagues — Mashew and missmara in 3 each, Sarah in 2. ML ids are global. It needs
a `league_competitors` join table.

`player_identities` does *not* supersede this: it has the right shape but **zero
rows** with `identity_type='music-league'` (24 whatsapp, 11 google-chat). It is a
chat-identity store in practice.

**Priority caveat:** league scoping is already derivable via
`competitors → ml_submissions → rounds → seasons → leagues`. This is a
denormalisation for convenience, not a capability unlock — which is why it sits
here rather than higher.

### 10. Bigger / unscoped

- **CRUD UI for league + season metadata** — round editing shipped; league and
  season did not. More than a UI gap: season PATCH hard-rejects anything but
  `status` (`api/leagues/[leagueId]/seasons/[seasonId]/+server.ts:20-22`), and
  league PATCH is limited to `/active` and `/rel-context`. Needs API work first.
- **Historical card fun facts** — total songs, players, genre breakdown,
  "biggest procrastinator" on the archive cards (`ui/src/routes/+page.svelte:290-325`).
  *Not* covered by the League Research tab, which is a different route, component,
  and intent (analyst deep-dive vs. glanceable garnish). `3c8607b` did build genre
  aggregation, so part of the query work may be reusable.
- **BIG LIST overview** — unified Spotify playlist across all leagues;
  landing-page-as-career-overview. Its stated blocker is gone: `createPlaylist`
  exists (`src/spotify/adapter.ts:98`) and is already wired. Still a big feature.
- **Manual submit/vote entry** — no UI path; `submitted_by_me` is derived
  read-only (`ui/src/lib/db/research.ts:34-39`). **Re-scope after item 1** — if
  ML data can be read directly, most of this want may evaporate.
