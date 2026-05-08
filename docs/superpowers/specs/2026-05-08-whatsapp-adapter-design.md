# WhatsApp Adapter Design

**Date:** 2026-05-08
**Status:** Approved

## Goal

Wire the existing parser, resolver, rules engine, and Spotify adapter together into a working bot: receive WhatsApp group messages, process `!song` submissions, add tracks to Spotify playlists, persist each submission to SQLite, and reply to the group.

## Architecture

Four new units that compose into a working bot:

| File | Responsibility |
|------|----------------|
| `src/storage/db.ts` | SQLite connection + schema init |
| `src/storage/submissions.ts` | Insert/query submissions |
| `src/whatsapp/client.ts` | whatsapp-web.js client, QR auth, session persistence |
| `src/bot/handler.ts` | Full pipeline: parse → resolve → rules → Spotify → store → reply |
| `src/config/types.ts` | Add `successReply` to `notificationsSchema` |
| `src/index.ts` | Wire everything: config, DB, WhatsApp client, handler |

## Pipeline

```
WhatsApp message received
  → ignore if group not in WHATSAPP_ALLOWED_GROUP_IDS
  → ignore if message sent by the bot itself
  → parseMessage() → ignore if not a !song command
  → resolveTrack(submission, spotifyAdapter, config.notifications?.confidenceThreshold ?? 0.9)
      → not-found: notify per config, store status='not-found', stop
      → low-confidence: notify per config, store status='low-confidence', continue with track
  → applyRules(config, submission, { weekNumber, year })
      → no matching rules: store status='no-rule', stop silently
  → for each matched playlist:
      → findOrCreatePlaylist(playlistName)
      → isTrackInPlaylist(playlistId, track.spotifyUri)
          → true: reply duplicate message, store status='duplicate'
          → false: addTrackToPlaylist(playlistId, track.spotifyUri)
                   reply success, store status='added'
```

Low-confidence tracks are still added to playlists (the bot flags it but doesn't block). Only `not-found` stops the pipeline.

## SQLite Schema

One table. Sync (better-sqlite3) for simplicity — no async needed in a low-volume private bot.

```sql
CREATE TABLE IF NOT EXISTS submissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  submitter_id  TEXT    NOT NULL,
  submitter_name TEXT   NOT NULL,
  raw_text      TEXT    NOT NULL,
  track_title   TEXT,
  track_artist  TEXT,
  spotify_uri   TEXT,
  playlist_id   TEXT,
  playlist_name TEXT,
  status        TEXT    NOT NULL,
  created_at    INTEGER NOT NULL
);
```

`status` values: `'added' | 'duplicate' | 'not-found' | 'low-confidence' | 'no-rule'`

`created_at` is Unix epoch milliseconds (`Date.now()`).

## Config Extension

Add `successReply` to `notificationsSchema` in `src/config/types.ts`:

```typescript
successReply: z.enum(['simple', 'rich', 'none']).default('simple'),
```

Updated `notificationsSchema`:
```typescript
export const notificationsSchema = z.object({
  onFailure: z.boolean().default(true),
  onLowConfidence: z.boolean().default(true),
  confidenceThreshold: z.number().min(0).max(1).default(0.9),
  recipients: z.enum(['me', 'submitter', 'me-and-submitter']).default('me'),
  successReply: z.enum(['simple', 'rich', 'none']).default('simple'),
});
```

## Reply Messages

All replies are sent to the group chat where the submission was made.

**Success — simple:**
```
✅ Added "No Ordinary Love" by Sade to Music League - Week 19
```

**Success — rich:**
```
✅ Added "No Ordinary Love" by Sade · Love Deluxe · 4:50 → Music League - Week 19
https://open.spotify.com/track/...
```

**Success — none:** no reply

**Duplicate:**
```
⚠️ "No Ordinary Love" by Sade is already in Music League - Week 19 — not added
```

**Not found:**
```
❌ Couldn't find a track for: Sade - No Ordinary Love
```

**Low confidence** (still added, but flagged):
```
⚠️ Added "No Ordinary Love" by Sade to Music League - Week 19 — but I wasn't sure this was the right track. Check it looks right.
```

## Notification Routing

Failure and low-confidence notifications are sent based on `notifications.recipients`:

- `me` — WhatsApp DM to `OWNER_PHONE_NUMBER` (env var, format: `12125551234@c.us`)
- `submitter` — WhatsApp DM to the person who submitted
- `me-and-submitter` — both

Success replies always go to the group regardless of `recipients`.

`onFailure` gates not-found notifications. `onLowConfidence` gates low-confidence notifications. If both are false, the bot is silent on failures.

## WhatsApp Authentication

- Library: `whatsapp-web.js` with `LocalAuth` strategy
- Session stored in `.wwebjs_auth/` (add to `.gitignore`)
- First run: QR code printed to terminal — scan with phone to authenticate
- Subsequent runs: reconnects silently using stored session
- Chrome/Chromium required (present on dev machine; needs install on headless servers)

## Environment Variables

Add to `.env` and `.env.example`:

```
# WhatsApp
WHATSAPP_ALLOWED_GROUP_IDS=BmCQHGE3k0a0ST5ZDPFmqW
OWNER_PHONE_NUMBER=16617476822
```

`WHATSAPP_ALLOWED_GROUP_IDS` is comma-separated to support multiple groups.

## Dependencies

```bash
npm install whatsapp-web.js qrcode-terminal better-sqlite3
npm install --save-dev @types/better-sqlite3
```

## Testing

- `src/storage/db.ts` and `submissions.ts`: unit tested with an in-memory SQLite DB (`:memory:`)
- `src/bot/handler.ts`: unit tested with mocked WhatsApp message, mocked SpotifyAdapter, mocked storage
- `src/whatsapp/client.ts`: no unit tests — verified manually by running the bot and scanning QR
- `src/index.ts`: no unit tests — integration verified by running the bot end-to-end

## Error Handling

- Spotify API errors in the pipeline: catch, log, send `❌ Something went wrong — try again` to group
- WhatsApp disconnects: whatsapp-web.js fires `disconnected` event — log and exit (process supervisor restarts)
- DB write errors: log, do not crash the bot (submission is lost but the track is still added)

## Out of Scope

- Rounds/themes system (next sprint)
- URL detection without `!song` command (next sprint)
- "All mentioned songs" tracking (next sprint)
- Admin commands (next sprint)
- YouTube adapter (future milestone)
- Deduplication across multiple playlists in a single submission (edge case — current behavior: adds to whichever playlists it's not already in)
