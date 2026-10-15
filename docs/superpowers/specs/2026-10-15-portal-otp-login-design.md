# Portal WhatsApp OTP login — design

Date: 2026-10-15 · Status: approved in chat (Matt), build started

## Goal

Players log into the b-side portal with a 6-digit code DMed by the bot to the
phone number already in `league.db` `player_identities`. Players are never asked
for their number. Sessions last 30 days (existing signed cookie).

Hard constraint: **no real player is messaged during build or test.** Matt must
be able to log in as any player (e.g. Shane, Jensen) end-to-end.

## Modes (per league setting `loginCode`)

| Mode | "Send code" tapped | Admin ntfy |
|---|---|---|
| `off` | today's name-pick login (`/auth/select`) unchanged | — |
| `notify` | code minted + DMed immediately | "Shane requested a login code — sent ✓" |
| `approve` | request pending; player sees "Waiting for approval…" | Activate / Deny buttons. Activate → code minted, DMed, then "Code sent to Shane ✓". Deny → request fails. |

- In `approve`, the 10-min code TTL starts at activation. Unactivated requests
  lapse after 30 min.
- DM failure (no number, bot down): admin ntfy includes the code so Matt can
  relay it; player sees "Couldn't send — Matt's been notified."
- When `loginCode` ≠ `off`, `/auth/select` no longer issues sessions.
- Initial rollout: Boarz = `approve`, everyone else `off`, redirect ON.

## Components

### 1. Bot — `POST /login-code` (control server, loopback only)

Body `{ league, name, code }`. Response `{ sent: true }` or
`{ sent: false, reason: "unknown_player" | "no_number" | "rate_limited" | "send_failed" }`.
Never returns the phone number.

- Resolve `name` → `players` row by case/whitespace-insensitive exact name,
  then a small alias map (`Jimmy Troy → Jimmy`).
- Pick that player's `identity_type='whatsapp'` row whose identifier
  normalizes to E.164 (strip spaces, parens, dashes: `+1 (786) 626-6895` →
  `+17866266895`). Name-only identifiers (gchat notify names) are ignored.
- Text: `Your Music League portal code is 123456. It expires in 10 minutes.`
- Bypasses the survey opt-in guard (the player asked for it); own limit of
  3 codes / player / hour (in memory).
- **`LOGIN_CODE_REDIRECT=+E164`**: when set, every DM goes to that number,
  prefixed `[TEST → <player name>] `. With it set, this endpoint cannot send to
  any other number. Ships set to Matt's number.
- Group ids still refused (existing dmGuard).

### 2. Survey app — per-league routes

- `POST ${apiPrefix}/auth/request-code {name}` → mints via `mintSwitchCode`,
  stores only a sha256 of the code in memory (`kind: "login"` request shape
  alongside existing `switch`), 10-min TTL, 5 wrong attempts max. `notify`:
  call bot, then ntfy. `approve`: ntfy with Activate/Deny via
  `portal-auth-notify.js`; on Activate mint+DM+confirm ntfy.
- `GET ${apiPrefix}/auth/request-code/:id` → status poll
  (`pending | sent | denied | failed | expired`) for the waiting screen.
- `POST ${apiPrefix}/auth/verify-code {name, code}` → on match sets the existing
  30-day session cookie; reuses `name-lock.js` per-IP failure limits.
- `AUTH_SECRET` must be set in the deployed env (sessions currently reset on
  restart when unset).

### 3. Portal — `bside/src/routes/LoginScreen.svelte`

Pick name → "Send code" → (approve: waiting state, polls status) → 6-digit
input → session. Messages for `no_number` ("No number on file — ask Matt") and
denied/failed.

### 4. Verification

- `scripts/login-code-coverage` lists each survey roster name → resolves to a
  usable number or not (JP expected missing).
- Unit tests: normalization, name+alias resolve, redirect (fixture where
  redirect target ≠ player number; test must fail if the real number would be
  used), rate limit, TTL, wrong-code lockout, approve-mode TTL-from-activation.
- E2E in test mode: Matt logs in as Shane; DM arrives on Matt's phone; no other
  number contacted (bot log check).

## Out of scope

Self-registration, changing numbers from the portal, admin UI pages.
