# Music League email ingestion — design spec

**Date:** 2026-06-26
**Status:** approved (brainstorming), proceeding to implementation
**Author:** Claude + Matt

## Problem

mlbot has no reliable record of *when* a round was actually live. `rounds.created_at`
is mlbot's **import** time, not the real Music League timeline — for back-imported
leagues (e.g. Second Best) all rounds cluster on the import date, weeks after the real
activity. This breaks anything that windows on round time, most visibly the **chat
history** screen: Second Best has 813 ingested chat messages (May 6 – Jun 9) but they
fall before every round's `created_at` (Jun 12/23), so the screen shows nothing.

Music League emails `notifications@musicleague.com → mattmariani@gmail.com` on every
round lifecycle transition, with the **real event time in the `Date` header**. Ingesting
these gives us an authoritative round phase timeline (started → voting → ended).

## Goal

1. **Capture everything**: a complete local archive of all `notifications@musicleague.com`
   mail (lifecycle, submissions, vote receipts, reminders) — store all, act on three.
2. **Act on the 3 lifecycle emails** to build a real round phase model:
   - `Round Starting` → **round started** (submission phase opens)
   - `New Playlist` → **voting started** (playlist published) + capture playlist URL
   - `The Votes Are In` → **voting ended** (results in)
3. **Fix chat windowing** by windowing rounds on real `voting_started_at → voting_ended_at`.
4. **Backfill** the entire mailbox on first run so past rounds get real timestamps.

Non-goals (v1): acting on submission/vote/reminder emails; real-time (<1 min) latency.

## Email facts (from real samples in `docs/sample_email/`)

- **From:** `notifications@musicleague.com`; **To:** `mattmariani@gmail.com`; sent via
  Amazon SES. Real event time = the `Date:` header.
- **Subject pattern:** `{League} {Season}: {Round Theme} - {EventType}`
  - `Hip Jammers 3: its all hippening - New Playlist`
  - `Fam Jam IV: Uncharted Tracks - Round Starting`
  - `Fam Jam IV: Uncharted Tracks - The Votes Are In`
- **Round identity in body links** (wrapped in SES click-tracking redirects
  `https://….awstrack.me/L0/<url-encoded-real-url>/…` — unwrap by URL-decoding the
  segment after `/L0/`):
  - `Round Starting` body has `app.musicleague.com/l/{leagueId}/{roundId}/submit`
  - `The Votes Are In` body has `app.musicleague.com/l/{leagueId}/{roundId}`
  - The `{roundId}` is a 32-hex string that **matches `rounds.ml_round_id` exactly**
    (verified: email `12c30e07…` = mlbot round 121 "EDM 'em"; `1d4a9404…` = round 120
    "Pick Me Up", matching its body text "the votes are in for the round Pick Me Up!").
  - **`New Playlist` carries NO `/l/` round link** — only the Spotify playlist URL
    (`open.spotify.com/playlist/{id}`). It maps by **subject** (league name + round
    theme → round) and we also backfill `rounds.spotify_playlist_url` from it.

## Architecture

A poll loop in the **`api` service** (which already runs the `mlAuthHeartbeat`
`setInterval` poller and opens the shared `data/league.db` via `src/storage`). Three
clean, independently testable units:

```
┌─────────────────┐   ┌──────────────────┐   ┌─────────────────────┐
│ imapClient      │ → │ emailParser      │ → │ emailIngest         │
│ (imapflow)      │   │ (PURE function)  │   │ (DB writes + map)   │
│ fetch new UIDs  │   │ .eml → ParsedmL  │   │ archive + events    │
└─────────────────┘   └──────────────────┘   └─────────────────────┘
        ▲                                              │
        │ poll every 3 min (setInterval)               ▼
   emailPoller  ◄───────────────────────────  data/league.db
```

- **`imapClient`** (`src/email/imapClient.ts`) — thin wrapper over `imapflow`. Connects
  to `GMAIL_IMAP_HOST:PORT` (default `imap.gmail.com:993`, TLS) as `GMAIL_IMAP_USER`
  (default `mattmariani@gmail.com`) with `GMAIL_IMAP_APP_PASSWORD`. Fetches messages
  `FROM MUSICLEAGUE_FROM` with UID > last-seen, returns `{ uid, raw }`. UIDVALIDITY-aware.
- **`emailParser`** (`src/email/emailParser.ts`) — **pure**: `(rawEml) => ParsedEmail`.
  Uses `mailparser` to get headers + text/html, then derives:
  `{ messageId, subject, fromAddr, toAddr, sentAt, type, mlRoundId?, leagueName?,
  roundTheme?, playlistUrl? }` where `type ∈ {round_starting, new_playlist,
  votes_are_in, other}`. Includes the SES-redirect unwrapper. No I/O, no DB.
- **`emailIngest`** (`src/email/emailIngest.ts`) — orchestration. For each parsed email:
  1. Upsert into `email_messages` (idempotent on `message_id`).
  2. If a lifecycle type, resolve the `round_id`:
     - `round_starting` / `votes_are_in` → exact join on `rounds.ml_round_id = mlRoundId`.
     - `new_playlist` → match league (name→slug) + round theme (`rounds.name`); on match,
       also set `rounds.spotify_playlist_url` if empty.
  3. If resolved, upsert a `round_events` row and update the denormalized
     `rounds.{round_started_at,voting_started_at,voting_ended_at}` column for that phase.
  4. Unresolved lifecycle emails are stored with `round_id = NULL` and
     `parsed_type` set, so they're visible/auditable and retried on the next backfill.
- **`emailPoller`** (`src/email/emailPoller.ts`) — `start()` runs one ingest pass
  immediately (initial backfill on an empty `email_messages`), then `setInterval` every
  `EMAIL_POLL_MS` (default 180_000). Mirrors `mlAuthHeartbeat` lifecycle; started from
  `src/api/server.ts`. A pass that throws is logged and retried next tick.

## Data model (all in `data/league.db`, created `IF NOT EXISTS` by `emailIngest`)

```sql
CREATE TABLE IF NOT EXISTS email_messages (
  message_id   TEXT PRIMARY KEY,         -- RFC Message-Id (idempotency key)
  uid          INTEGER,                  -- IMAP UID (per UIDVALIDITY)
  uidvalidity  INTEGER,
  from_addr    TEXT NOT NULL,
  to_addr      TEXT,
  subject      TEXT,
  sent_at      TEXT NOT NULL,            -- Date header, ISO (the real event time)
  parsed_type  TEXT NOT NULL,            -- round_starting|new_playlist|votes_are_in|other
  round_id     INTEGER REFERENCES rounds(id),  -- nullable; set when mapped
  raw          TEXT NOT NULL,            -- full raw .eml (the archive)
  captured_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_email_type ON email_messages(parsed_type);
CREATE INDEX IF NOT EXISTS idx_email_round ON email_messages(round_id);

CREATE TABLE IF NOT EXISTS round_events (
  id            INTEGER PRIMARY KEY,
  round_id      INTEGER NOT NULL REFERENCES rounds(id),
  event_type    TEXT NOT NULL,           -- round_started|voting_started|voting_ended
  occurred_at   TEXT NOT NULL,           -- = source email sent_at
  playlist_url  TEXT,                    -- set on voting_started
  source_message_id TEXT REFERENCES email_messages(message_id),
  UNIQUE(round_id, event_type)           -- one canonical time per phase; upsert
);

-- denormalized convenience columns on rounds (added IF NOT EXISTS via PRAGMA check)
ALTER TABLE rounds ADD COLUMN round_started_at  TEXT;   -- guarded
ALTER TABLE rounds ADD COLUMN voting_started_at TEXT;   -- guarded
ALTER TABLE rounds ADD COLUMN voting_ended_at   TEXT;   -- guarded
```

`event_type` maps from email `type`: `round_starting→round_started`,
`new_playlist→voting_started`, `votes_are_in→voting_ended`.

## Chat windowing change

`ui/src/routes/chat/+page.server.ts` builds each round's window from the best available
real boundary, in priority order:
1. `voting_started_at → voting_ended_at` (from this work)
2. else `submission_deadline → voting_deadline` (already in DB)
3. else `created_at → next.created_at` (today's behavior)

Rounds are ordered chronologically by that same resolved start. This makes Second Best's
chat populate without any manual fixup.

## Backfill

On first run `email_messages` is empty → the ingest pass fetches **all** matching mail
(no UID floor), archiving everything and replaying lifecycle events. Idempotent on
`message_id`, so re-runs are safe. Subsequent passes only fetch UID > last-seen.

## Secrets / config (env, in top-level `.env`, loaded by the `api` service)

| Var | Secret | Default |
|---|---|---|
| `GMAIL_IMAP_APP_PASSWORD` | **yes** | — (set) |
| `GMAIL_IMAP_USER` | no | `mattmariani@gmail.com` |
| `GMAIL_IMAP_HOST` | no | `imap.gmail.com` |
| `GMAIL_IMAP_PORT` | no | `993` |
| `MUSICLEAGUE_FROM` | no | `notifications@musicleague.com` |
| `EMAIL_POLL_MS` | no | `180000` |

If `GMAIL_IMAP_APP_PASSWORD` is unset, the poller logs once and stays dormant (no crash).

## Error handling

- Connection / fetch errors: logged, pass aborts, retried next tick (no crash loop).
- Parse failure on a single message: that message is archived as `parsed_type='other'`;
  never blocks the batch.
- DB write: WAL mode + `busy_timeout` (matches existing multi-service access to
  `league.db`); idempotent upserts so a crash mid-batch is safe to replay.
- Unmapped lifecycle email (e.g. round not yet imported): archived with `round_id=NULL`;
  re-resolved on a later backfill once the round exists.

## Testing

- **`emailParser` (pure) — primary coverage.** Unit tests against the three committed
  `.eml` fixtures in `docs/sample_email/` + a synthetic "other" email: assert `type`,
  extracted `mlRoundId` (round_starting/votes_are_in), `leagueName`+`roundTheme`
  (new_playlist), `playlistUrl`, and `sentAt`. Plus a focused test of the SES-redirect
  unwrapper.
- **`emailIngest`** — against an in-memory DB seeded with the known rounds: assert exact
  `ml_round_id` mapping, subject-based new_playlist mapping, `round_events` upsert
  (idempotent), denormalized column updates, and unmapped → `round_id NULL`.
- **Chat windowing** — extract the boundary-resolution into a pure helper and unit-test
  the priority order (voting timestamps > deadlines > created_at).
- `imapClient` / `emailPoller` stay thin; covered by manual smoke against the live
  mailbox at deploy.

## Dependencies

Add to the **root** `package.json` (the `api`/`bot` service): `imapflow`, `mailparser`.

## Rollout

1. Land code + migrations (tables self-create on first DB open).
2. Add `GMAIL_IMAP_APP_PASSWORD` to `.env` (done).
3. Deploy: rebuild + `--force-recreate api` (to load the new env) and `bot-ui` (chat
   windowing). First poll backfills the archive + phase timestamps.
4. Verify: `email_messages` populated, `round_events` for known rounds, Second Best chat
   history populates.
```
