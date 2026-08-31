# Backlog

> Triaged 2026-07-16 against the actual source. Every item below was checked
> against code, git history, or the live DB — not carried forward on faith.
> Items that shipped or were overtaken have been deleted; see the triage report
> in that session for what was removed and why.
>
> **Re-triaged 2026-08-30.** Items 0 and 2 were rewritten — both were partly
> overtaken and would have sent someone to build a thing that exists. Ranks are
> unchanged otherwise; nothing else was verified in this pass, so treat items
> 1 and 3–12 as carrying their 2026-07-16 evidence, not fresh evidence.

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

### 0. Regulars: mine verbal tics, not topics  (added 2026-08-13)

The Regulars/storylines generator and the chat section both select on *topic*,
so they surface "asks about league rules" instead of the things the group would
actually recognize. Two pieces of work, proven by hand on round 147:

**(a) Verbal-tic mining in the regulars generator.** Port the approach in
`~/Projects/sssc-chat-regulars/scripts/mine_verbal_tics.py` — log-odds with an
informative Dirichlet prior against the rest of the group, over 1–4-grams,
openers, laugh spellings, elongations, ALL-CAPS and punctuation habits, tagged
by flavor (nickname / misspelling / coinage / laugh) so a nickname habit outranks
a frequent phrase. Bar: 3+ uses across 2+ dates, mostly unused by others. It
found, in one pass: JB renaming everyone (Palletz 13x/8 dates, Kozh, Kozoil,
cjwookie, Mashew), Matt's apostrophe-free typing, Jensen's "rember", Grant's
"ahah", Clements spelling Conor "Connor", Conor's one-word verdicts. Feed
candidates to the storylines seeds instead of hand-curating
`STORYLINE_SEEDS` per league.

**(b) "Phrase of the round" detection in the chat section.** A term that (i)
does not appear in any earlier round's chat, (ii) appears 3+ times in this
round's window, and (iii) is used by 3+ distinct speakers. Round 147's was
"chopped unc" — coined by Steiny about Jensen, 7 uses across 4 speakers inside
36 hours. Deterministic and cheap; the LLM only writes the explanation.

**Status 2026-08-30 — half of this shipped, and not the half described.** The
*output* side is built: the style shelf (2026-08-13) renders The Regulars in
seven layouts and The Coinage as a full Urban-Dictionary card, both authored as
YAML with a Fields ⇄ YAML toggle in the section inline editor. Adding one no
longer costs a manual INSERT — see `design/rNNN-regulars-coinage.yaml` for
R140/R141/R147/R148, all hand-authored this way.

**What is still open is the *mining*, i.e. both (a) and (b) as written above.**
Every shipped Regular and every Coinage to date was picked by a human reading
chat. (a) verbal-tic mining and (b) deterministic phrase-of-round detection would
feed the YAML instead of a person doing it; the value is now "stop hand-curating
every week", not "make it renderable". `docs/regular-types.md` is the taxonomy
the candidates should be tagged against.


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

### 2. YTM links never reach the digest — *the want is met elsewhere; decide if this survives*

**Status 2026-08-30 — overtaken, but not by this.** The underlying want ("YouTube
Music listeners get left out of the weekly playlist") was closed on 2026-08-29 by
the **YTM drop**: a `voting_started` email triggers `scripts/ytm-drop/run.mjs`,
which mirrors the round's Spotify playlist into a real YTM playlist, generates a
cover, and posts both into the group chat. It runs on the host as
`mlb-ytm-drop.timer`, and is **Boarz-only by SQL scope**.

So the remaining question is narrower than the item below suggests, and there are
two of them:

1. **Do the other five leagues get the drop?** The scoping is deliberate, not an
   oversight — but nobody has decided it is permanent.
2. **Does the digest still need per-song YTM links at all**, now that the
   playlist arrives by a different route? The gate, the cache and
   `attachYtmLinks()` all still exist unused, described below. If the answer is
   no, delete the prepChecks entry rather than leaving a passing check that gates
   on data nothing reads.

The original item, unchanged, for the second question:


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

### 6b. `master` is red — 13 failing tests  (added 2026-08-30)

Found in the sanitization pass. All 13 pre-date it (verified by running both
suites at `2d02377` in a clean worktree — the failure sets are identical), so
these have been red for a while with nobody looking. Two suites:

**Root (`npm test`) — 1 failure.**

- `tests/handler.test.ts > processes !song messages sent by the bot account
  (fromMe)` — `spotify.searchTrack` is never called. This matters more than it
  did: since 2026-07-18 the bot sends as its *own* dedicated WhatsApp account, so
  `fromMe` is now a normal case, not an edge case. **Decide whether the test or
  the handler is wrong before touching either.**
- *(`tests/emailParser.test.ts` also failed, but only because `mailparser` was
  missing from the local `node_modules` despite being a declared dependency.
  `npm install` fixed it; it is not a code defect.)*

**UI (`cd ui && npm test`) — 12 failures, mostly stale expectations.**

- `src/lib/db/leagues.test.ts` (×2) — asserts the SEED produces 5 leagues; it
  produces 6. `nostalgia-pit` was added and the test was not. Trivially stale.
- `src/routes/api/model-vars/sections/server.test.ts` — asserts exactly 16
  section keys; there are 17. Same shape of staleness.
- `src/routes/api/content/server.test.ts` (×5) — the route answers `202` where
  the test expects `200`, and the other four assertions cascade from that one.
  **Checked: the 202 is deliberate**, not a silent failure. The update endpoint
  was made fire-and-forget — it returns `{jobId}` immediately and the caller
  polls `GET /update-status/:jobId` (`+server.ts:75,147,266`). The test simply
  never followed. Stale.
- `src/routes/api/leagues/leagues.test.ts` — expects 4 leagues, gets 6. Same
  drift as above. Stale.

**Triage: 9 of the 12 are stale expectations** (the two league counts, the
section-key count, the five `202`s, and the API league count) — mechanical
fixes, no behavior question to answer.

**Three need an actual decision** about whether the test or the code is wrong,
and should not be swept in with the rest:

- `src/lib/queueWorker.test.ts > calls fetchTags and marks done` — `fetchTags`
  is called **zero** times. Either the lastfm_tags path stopped firing or the
  worker was rewired.
- `src/lib/song/adapters.test.ts > fromChat > sets intent` — `intent` comes back
  `undefined`, expected `'ALT'`.
- `src/lib/db/metadataQueue.test.ts > ytm: ok=true only when 100% of
  submissions have a ytm_link_cache row` — expected 1, got 0. This is the same
  readiness check item 2 is about, so resolve them together.

**Do this before the next feature, not after.** A red suite is why the four
stale-expectation failures above went unnoticed long enough to become archaeology,
and it is why nobody caught the `202`.

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

### 11. Digest auto-pipeline follow-ups

Four items surfaced by the `feat/digest-auto-pipeline` work (Plan 1 = spine →
auto-send). The first three are the whole-branch review's Minor findings (logged
in `.superpowers/sdd/progress.md`); the fourth is a behavior the live smoke
exposed. None block the pipeline — all fail closed — but revisit before relying on
it unattended at scale. Several fold naturally into Plan 2 (the ntfy approval gate).

**Status 2026-08-30 — still open, and do not close them against the Rollout.**
The Rollout entity (2026-08-26) was built to supersede this orchestration, and it
addresses several of these by design (leases, claims, parking, resume). But it
has **never run** — `rollout_configs` and `rollout_runs` are empty and
`mlb-rollout-host.timer` is disabled, so every item below is still live against
the pipeline that actually executes. Revisit at cutover, not before.

- **Failed jobs are terminal — no retry.** `digest_jobs.round_id` is PK and
  enqueue is `INSERT OR IGNORE` (`ui/src/lib/digest/jobs.ts`), so a transient
  capture/LLM failure parks the row at `failed` and re-ingesting the same
  `voting_ended` email will not retry it. Recovery today is a manual row delete.
  Fail-closed but silent — wants a retry/backoff, or at minimum an alert plus a
  "requeue" path.

- **Runner auto-finalizes rounds the poller will deliberately HOLD.** `runOneJob`
  (`ui/src/lib/digest/runner.ts`) finalizes any auto-mode round without consulting
  `resolveScheduledDigest`, so a season-final round (or one with no description /
  no votes) still gets finalized — spending the rel-context LLM call and stamping
  `finalized_at` — even though the poller then holds it and never posts. Harmless
  but wasteful and surprising. Gate the runner's finalize on resolver eligibility;
  belongs with Plan 2's approval gate.

- **No overlap guard on the runner interval.** The runner is a 60s `setInterval`
  (`ui/src/lib/digest/runnerLoop.ts`). Same-job double-processing is prevented
  (claim only takes `pending`), but two *different* rounds ending close together
  could run concurrent ML CLI exports racing on the shared `export.zip` path. Low
  likelihood; a simple "one job in flight" guard closes it.

- **Auto-generate reuses a cached draft instead of regenerating.** Found in the
  live smoke: the runner's generate step POSTs `/draft` with the empty default
  `GenParams`, which `parseGenParams` treats as "no params" → returns the existing
  cached draft if one exists (no LLM call). So a round already drafted (e.g.
  hand-started) is reused, not regenerated. Fine if intended, but decide
  explicitly — if the auto-pipeline should always produce a fresh draft, the
  generate step must force regeneration.

### 12. Notifications panel follow-ups

Surfaced by the notifications settings panel work (multi-channel dispatch;
ntfy + WhatsApp shipped, merged 53e27f4).

- **Separate ntfy topic for non-approval alerts.** Today all ntfy notifications
  publish to `mlb-digest`. Add an optional `alertTopic` to the ntfy channel config
  (falls back to `topic` when blank), seeded from an env var; the ntfy adapter
  publishes interactive approval/review notifications to `topic` and plain alerts
  (`pipeline_failure`, `ml_auth_expired`, `digest_sent`) to `alertTopic`. One `if`
  on `payload.approval` presence + a panel field + tests. ~30-45 min.
  DESIRED NAME: `mlb-alerts` — but that is OUTSIDE the token's `mlb-digest*` wildcard
  ACL, so it needs a token/ACL update (or use an `mlb-digest-*` name). Likely folds
  into the v2 / Twilio sprint (timing TBD).

- **Twilio SMS channel (Phase 2).** The channel abstraction is Twilio-ready: add a
  `twilio.ts` adapter (SMS via the REST API), a config card, and a grid column.
  Adapter `capabilities: ['alert']`; creds (accountSid/authToken/from/to) in the
  notifications blob.

- **Dead `opts.notifyOwner` wiring.** `src/digest/poller.ts` `makeDeps` now overrides
  `notifyOwner` with `raise()` (→ bot-ui `/api/notify`), so the `opts.notifyOwner`
  field in `PollerOpts` + its wiring in `src/index.ts` is unused. Remove it.

- **App-wide auth for bot-ui (Cloudflare Access + service tokens).** bot-ui
  (mlb37.mattmariani.com) is publicly reachable with NO auth; `/api/notify`,
  `/api/notifications`, `/api/digest/*`, and all `/settings/*` endpoints rely on the
  tunnel only. Put bot-ui behind CF Access: machine callers (bot) use a service
  token (client id + secret, no reauth); the browser gets a long-lived CF session.
  HARD CONSTRAINT: `digest.mattmariani.com` (the `digest-static` container, its own
  tunnel, accessed by many league members) stays TOTALLY outside auth. Nuance:
  approve/deny + `/api/notify` callbacks can't interactive-login → service-token
  headers or a bypass path. Separate hardening project; Matt owns CF config.

- **Phase 2 leftovers (from the approval gate).** Wire an ntfy failure alert into
  the approve endpoint's background-completion `.catch` (today it only marks the job
  failed + logs); consider a dedicated callback secret instead of reusing
  `NTFY_TOKEN` as the approve/deny Bearer.
