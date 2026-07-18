# Notifications Settings Panel — Design Spec

**Date:** 2026-07-18
**Status:** approved (design)
**Builds on:** the Phase 2 digest approval gate (`docs/superpowers/specs/2026-07-17-digest-approval-gate-design.md`, merged `6784224`) — which introduced the ntfy module + failure/approval notifications, currently configured via `.env` only.

## Goal

Give the app a **Notifications settings panel** that turns today's env-hardcoded,
ntfy-only alerts into a **UI-configured, multi-channel** system: pick which alert
types go to which channels via a checkbox grid, configure each channel in-app, and
fire a per-channel test send. Phase 1 ships **ntfy** (alert + approval) and
**WhatsApp** (alert) channels; **Twilio SMS is Phase 2**, and the channel
abstraction is built so adding it is one adapter + one config card + one grid
column — no rearchitecting.

## Scope

**In (Phase 1):**
- A `settings/notifications` panel: per-channel config cards (ntfy, WhatsApp) each
  with a **Send test** button, plus a **routing grid** (alert types × channels).
- A **channel abstraction** — small adapters implementing a common interface and
  declaring capabilities (`alert` / `approval`), so a channel can be made
  approval-capable later without a rewrite.
- A single **dispatch service** `notify(alertType, payload)` in bot-ui that reads
  the grid and fans out to each checked + configured channel, never throwing.
- **Cross-process wiring:** ntfy sent directly from bot-ui; WhatsApp routed through
  a new bot control `/notify` route (only the bot owns the WhatsApp client); a new
  bot-ui `/api/notify` endpoint so the `bot` can raise alerts through the same
  routing brain.
- **Rewiring** the existing alert call-sites (runner failure, ML-auth-expired,
  digest-ready, digest-sent) to go through `notify()`.
- Config stored in the `settings` key-value table under key `notifications`, ntfy
  values **seeded from `.env`** on first load.

**Out (deferred):**
- **Twilio SMS channel** — Phase 2 (adapter + config card + grid column + creds).
- **Making WhatsApp/Twilio approval-capable** — the interactive Approve/Deny gate
  stays ntfy-only; the abstraction leaves room (`sendApproval` + capability flag).
- Per-recipient / multiple-destination routing (one owner destination per channel).
- Encrypting secrets at rest (kept plaintext in the local DB, consistent with the
  existing `settings` / api-tokens storage; masked in the UI).

## Alert types (grid rows)

| id | when it fires | today |
|----|---------------|-------|
| `pipeline_failure` | capture/generate/render/send step failed (runner fail path) | fired (generic) |
| `ml_auth_expired` | ML auth/cookie invalid — a human must re-auth | folded into failure; split out here |
| `digest_ready` | a round's digest is ready for the human decision | fired as ntfy approval |
| `digest_sent` | a digest successfully posted to a league | not fired yet |

## Channels (grid columns, Phase 1)

| id | capabilities | transport | config fields |
|----|-------------|-----------|---------------|
| `ntfy` | `alert`, `approval` | HTTP from bot-ui | `url`, `topic`, `token` |
| `whatsapp` | `alert` | bot control `/notify` (bot DMs owner) | `ownerNumber` (seeds from `OWNER_PHONE_NUMBER`) |

`digest_ready` on ntfy renders the **interactive Approve/Deny** notification (the
existing gate); on WhatsApp it's a **text heads-up with the review link**. The grid
disables a cell whose channel can't service that row (none in Phase 1, but the
mechanism exists for future approval-only rows).

## Data model

`settings` row, key `notifications`, JSON blob:

```json
{
  "channels": {
    "ntfy":     { "url": "https://ntfy.mattmariani.com", "topic": "mlb-digest", "token": "<secret>" },
    "whatsapp": { "ownerNumber": "16617476822@c.us" }
  },
  "routing": {
    "pipeline_failure": { "ntfy": true,  "whatsapp": false },
    "ml_auth_expired":  { "ntfy": true,  "whatsapp": false },
    "digest_ready":     { "ntfy": true,  "whatsapp": false },
    "digest_sent":      { "ntfy": false, "whatsapp": false }
  }
}
```

- **Load:** `getNotificationsConfig(db)` returns the blob, filling any missing
  channel/routing key from defaults; ntfy channel defaults seed from
  `NTFY_URL`/`NTFY_TOPIC`/`NTFY_TOKEN`, whatsapp from `OWNER_PHONE_NUMBER`.
- **Save:** `setNotificationsConfig(db, blob)` upserts the row. A blank secret field
  in the UI means "unchanged" (don't overwrite a stored token with empty).
- **Source of truth:** the DB once saved; env is the seed + fallback so nothing
  breaks before the first save.

## Channel abstraction

`ui/src/lib/notifications/channels/` — one module per channel implementing:

```ts
export interface AlertPayload {
  alertType: 'pipeline_failure' | 'ml_auth_expired' | 'digest_ready' | 'digest_sent';
  title: string;
  message: string;
  link?: string;                 // review/digest URL where relevant
  approval?: {                   // present only for digest_ready
    token: string; approveUrl: string; denyUrl: string; editUrl: string; bearer?: string;
  };
}

export interface Channel {
  id: 'ntfy' | 'whatsapp';
  capabilities: Array<'alert' | 'approval'>;
  isConfigured(cfg: unknown): boolean;
  sendAlert(cfg: unknown, p: AlertPayload, deps: ChannelDeps): Promise<{ ok: boolean; error?: string }>;
}
```

- **ntfy adapter** wraps the existing `ntfy.ts` `publish()` + builders. For
  `digest_ready` with an `approval` payload and the `approval` capability, it emits
  the interactive Approve/Deny notification; otherwise a plain notification.
- **whatsapp adapter** `sendAlert` POSTs the bot control `/notify` (via `deps` so
  it's testable); text = `title` + `message` + `link`.
- `ChannelDeps` carries injected transports (`fetchFn`, control URL) so adapters are
  unit-tested with fakes.

New channels (Twilio) drop a module here, add a config card + grid column, and
declare their capabilities. Approval-enabling a channel = add `sendApproval` to the
interface + implement it + add `approval` to that channel's capabilities.

## Dispatch service

`ui/src/lib/notifications/dispatch.ts`:

```ts
export async function notify(db, alertType, payload, deps): Promise<void>;
```

1. Load the config blob.
2. For each channel where `routing[alertType][channel]` is true AND the channel
   `isConfigured`: call `sendAlert`, collecting `{channel, ok, error}`.
3. Never throw; log per-channel failures (`console.error`). A single channel error
   never blocks the others.

This replaces the current direct `publish()` calls in `runnerLoop.ts`.

## Cross-process wiring

```
 bot-ui                                   bot
 ──────                                   ───
 runner fail / awaitApproval / awaitReview
   → notify(db, alertType, payload)
       ├─ ntfy      → publish() (HTTP)  ─────────────▶ ntfy.mattmariani.com
       └─ whatsapp  → POST bot /notify ──────────────▶ control server → DM owner
 /api/notify {alertType, payload}  ◀── bot raises digest_sent / send-failure
   → notify(...)   (same routing brain)
```

- **New bot control route** `POST /notify { text }` → `makeSendDm(client)(ownerPhone, text)`.
  Reuses the container-local (now compose-network) control server + `router.ts`.
- **New bot-ui endpoint** `POST /api/notify { alertType, payload }` → `notify(...)`.
  Lets the `bot` (which posts digests and detects send failures) raise alerts
  through the one routing brain instead of its own hardcoded owner-DM.
- The bot's existing `notifyOwner` failure DM is **replaced** by a call to bot-ui
  `/api/notify` (`pipeline_failure` / `digest_sent`), so all alerts obey the grid.
  (If bot-ui is unreachable, the bot logs — the send itself is unaffected.)

## The UI panel (`settings/notifications`)

- `settings/notifications/+page.svelte` + `+page.server.ts`, linked from the
  `settings/` landing page (matches `api-tokens` / `models` / `chat` pattern).
- **Per-channel config cards** (ntfy, WhatsApp): fields bound to the blob; secret
  fields masked (show `••••`, blank = unchanged); a **Send test** button per card
  → `POST /api/notifications/test { channel }` → sends a canned test alert through
  just that channel and reports ok/error inline.
- **Routing grid**: rows = alert types, columns = configured channels, checkboxes
  bound to `routing`; a column greyed when its channel isn't configured; a cell
  greyed when the channel lacks the capability the row needs (future).
- **Save** → `POST /api/notifications` persists the blob.

Endpoints: `GET/POST /api/notifications` (load/save blob), `POST /api/notifications/test`.

## Rewiring existing call-sites

- `runnerLoop.ts` `fail` dep → `notify(getDb(), 'pipeline_failure', {title, message})`.
- Capture step ML-auth-expired branch → `notify(..., 'ml_auth_expired', ...)`.
- `awaitApproval`/`awaitReview` → `notify(..., 'digest_ready', { link: reviewUrl,
  approval: {token, approveUrl, denyUrl, editUrl, bearer} })`. The ntfy adapter
  turns the `approval` payload into the interactive notification (identical to
  today); other channels get the text heads-up.
- Bot poller successful post → `POST bot-ui /api/notify {alertType:'digest_sent', …}`.
- The approve/deny callback Bearer reads the ntfy token from the notifications
  config (env fallback), unifying where the token comes from.

## Testing

- **Adapters (unit, fakes):** ntfy adapter emits interactive vs plain by payload;
  whatsapp adapter POSTs the control `/notify` with the composed text; both report
  `{ok}`/`{ok:false,error}` and never throw.
- **Dispatch (unit):** fan-out to checked+configured channels only; unconfigured or
  unchecked channels skipped; one channel throwing/failing doesn't block others;
  unknown alertType is a no-op.
- **Config (unit):** load fills defaults + seeds ntfy from env; save round-trips;
  blank-secret-means-unchanged.
- **Router (unit):** bot control `/notify` parses `{text}` and rejects malformed.
- **Live (manual):** the per-channel Send test buttons — ntfy push arrives; WhatsApp
  DM arrives — plus one real `pipeline_failure` fan-out with both channels checked.

## Build order

1. **Config model** — `notifications` blob load/save + defaults/env-seed (settings table).
2. **Channel abstraction + ntfy adapter** — interface + ntfy wrapping existing publish.
3. **WhatsApp adapter + bot control `/notify`** — bot DM route + adapter over it.
4. **Dispatch service** — `notify()` fan-out over the grid.
5. **Rewire call-sites** — runner fail / ml-auth / digest_ready via dispatch; bot-ui
   `/api/notify`; bot poller digest_sent + failure through it.
6. **UI panel** — config cards, routing grid, save, per-channel test send.

Steps 1–5 deliver the working multi-channel dispatch behind the existing behavior;
step 6 is the panel. Twilio (Phase 2) appends an adapter + card + column.
