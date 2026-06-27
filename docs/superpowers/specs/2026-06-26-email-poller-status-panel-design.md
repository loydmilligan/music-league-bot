# Email poller status panel — design spec

**Date:** 2026-06-26
**Status:** approved (brainstorming), proceeding to spec review
**Author:** Claude + Matt

## Problem

The Music League email poller (`src/email`, runs in the `api` service) ingests
~1100 emails and drives the round phase timeline, but it's invisible: it logs to
console and persists no status. There's no way to confirm from the app that the
last poll connected, how much it pulled, or whether the lifecycle actions
(record round phase, capture playlist URL) actually succeeded — which matters
because `new_playlist` emails map fuzzily (only ~24/67 mapped in the backfill).

## Goal

A panel on the **App Settings** screen (`/settings`), inserted **after
`<SettingsTabs />` and directly above the "Song metadata queue" section**, that
shows:

1. **A large status indicator** — whether the most recent poll connected, with
   results (message count + timestamp), or a red failure with the error.
2. **A log of the ~10 most recent ingested emails** — time, type, subject, and
   the action that was triggered plus whether it succeeded, including:
   - explicit **playlist-capture confirmation** for `new_playlist` emails, and
   - **hard failures** (parse/ingest errors) shown as failed rows.

Liveness: **load on page open + a manual refresh button** (no background poll).

Non-goals (v1): historical poll charts/trends; a "poll now" server trigger;
acting on vote/submission emails.

## Architecture (Approach A — DB-backed)

The poller and the UI already share `data/league.db`. Use it as the channel:
the poller writes status + per-email outcomes; the UI reads them.

### 1. Poll status (`src/email/emailPoller.ts`)

`runEmailIngestPass` writes a single `settings` row on **every** pass — success
and failure — so the indicator can go red:

```
settings['email_poll_status'] = JSON.stringify({
  checkedAt: <ISO>,      // when this pass ran
  ok: boolean,           // did the IMAP fetch connect/succeed
  fetched: number,       // messages pulled this pass
  events: number,        // lifecycle round events recorded this pass
  error: string | null,  // connection/auth error message when !ok
})
```

The IMAP fetch is wrapped so a thrown connection/auth error is caught, recorded
as `{ ok:false, error }`, and does not crash the loop. When dormant (no app
password) the status records `ok:false, error:'no app password configured'`.

### 2. Per-email action outcome (`src/email/emailIngest.ts`)

Add two columns to `email_messages` (guarded ALTER, kept in sync between
`ensureEmailSchema` and the UI's `client.ts` migration, like the phase columns):

```
action_status TEXT   -- 'recorded' | 'unmapped' | 'archived' | 'error'
action_detail TEXT   -- human-readable outcome line
```

`ingestParsedEmail` sets them:
- **recorded** — lifecycle email mapped to a round and phase event written.
  - `round_starting` → `"recorded round_started · round \"<name>\""`
  - `votes_are_in`  → `"recorded voting_ended · round \"<name>\""`
  - `new_playlist`  → `"recorded voting_started · round \"<name>\" · playlist captured"`
    or `"… · playlist already set"` when the round already had a playlist URL.
- **unmapped** — lifecycle email, no matching round.
  - `new_playlist` → `"no matching round — playlist NOT captured"`
  - others → `"no matching round (round not imported yet?)"`
- **archived** — `other` type → `"archived (no action)"`.
- **error** — set by the poller's catch (below).

The return type gains `actionStatus`/`actionDetail` (already returns
`roundId`/`eventType`).

### 3. Hard-failure capture (`src/email/emailPoller.ts`)

The per-message loop's `catch` currently only `console.error`s. It will instead
write a minimal failure row so the email is visible in the log:

```
email_messages (message_id?, uid, from_addr='', sent_at=<nowOrHeader>,
  parsed_type='error', raw, action_status='error',
  action_detail='parse/ingest failed: ' + err.message)
```

(Best-effort: if even the message_id is unknown, key on `uid|uidvalidity`.)

### 4. Read API — `GET /api/email-poller/status`

`ui/src/routes/api/email-poller/status/+server.ts` returns:

```
{
  poll: { checkedAt, ok, fetched, events, error } | null,   // from settings row
  recent: [ { sentAt, subject, type, actionStatus, actionDetail } ]  // 10 newest by captured_at
}
```

The settings page's existing SSR `load` (`settings/+page.server.ts`) also reads
the same two things so the panel renders populated on first open. The refresh
button re-calls the endpoint (a re-read, not a server-side poll).

### 5. Panel UI — `ui/src/lib/email/EmailPollerPanel.svelte`

Inserted in `settings/+page.svelte` after `<SettingsTabs />`, above the metadata
`<section>`, matching its card styling (`bg-surface border rounded-xl p-6`,
left accent border).

- **Header:** SectionLabel "Notifications" + `<h2>Email ingestion</h2>` + a small
  "↻ Refresh" button.
- **Status indicator (large):** a colored dot + line:
  - ok → green: `Connected · {fetched} message(s) · {relativeTime(checkedAt)}`
    (with `{events} round event(s)` when > 0).
  - !ok → red: `Last poll failed · {error} · {relativeTime(checkedAt)}`.
  - no status yet → muted: `No poll recorded yet`.
- **Recent log (≤10 rows):** each row = time · type chip
  (`round-starting`/`new-playlist`/`votes-are-in`/`other`/`error`, monotone
  colors reusing existing chip tones) · subject (truncated) · outcome line with
  a leading glyph (`✓` recorded, `⚠` unmapped, `·` archived, `✕` error).

A small pure helper module (`emailPollerView.ts`) formats the status line and the
per-row outcome glyph/label from the raw fields — unit-tested.

## Data flow

```
api service (every ~3 min)
  runEmailIngestPass → IMAP fetch
    success → ingestParsedEmail sets action_status/detail per email
            → settings['email_poll_status'] = {ok:true, fetched, events, checkedAt}
    fetch error → settings['email_poll_status'] = {ok:false, error, checkedAt}
    per-email throw → failure row (action_status='error')
        ↓ (shared league.db)
bot-ui: settings load + GET /api/email-poller/status → EmailPollerPanel
        (renders on open; ↻ Refresh re-reads)
```

## Error handling

- Poll connection/auth failure: recorded as `ok:false` with the error; panel goes
  red; loop continues next tick.
- Endpoint when the status row / columns don't exist yet (fresh DB before first
  poll): return `poll:null, recent:[]`; panel shows "No poll recorded yet".
- Failure-row write is best-effort and never throws out of the loop.

## Testing

- **`emailPollerView.ts` (pure):** status-line formatting (ok / failed / none) and
  per-row outcome glyph+label, including the `new_playlist` "playlist captured"
  vs "playlist NOT captured" wording. Vitest.
- **`emailIngest`:** extend existing tests to assert `action_status`/`action_detail`
  for each type (recorded round_started/voting_ended; new_playlist captured vs
  already-set vs unmapped-not-captured; archived no-action; error rows).
- **`GET /api/email-poller/status`:** in-memory DB seeded with a status row +
  email rows → asserts the `{poll, recent}` shape and ordering.
- Panel itself stays thin; verified by smoke at deploy.

## Files

New: `ui/src/lib/email/EmailPollerPanel.svelte`, `ui/src/lib/email/emailPollerView.ts`
(+ `.test.ts`), `ui/src/routes/api/email-poller/status/+server.ts`.
Changed: `src/email/emailPoller.ts` (status write + failure rows),
`src/email/emailIngest.ts` (action columns + outcome), `ui/src/lib/db/client.ts`
(guarded ALTER for the two columns), `ui/src/routes/settings/+page.server.ts`
(load), `ui/src/routes/settings/+page.svelte` (mount the panel).

## Rollout

Code + migrations (columns self-add). Deploy `api` (poller writes status/outcomes)
+ `bot-ui` (panel). First poll after deploy populates the panel; existing rows
backfill `action_status` lazily as they're re-touched — or a one-time pass can
set them (optional; not required for v1 since the log shows the newest 10, which
will be freshly ingested with outcomes).

## Related roadmap

A sibling panel for the **group-relay chat ingestion** (same shape: last-relay
status + recent messages + per-message outcome) is captured in
`docs/coordination/backlog.md`.
