# High-Level Design: Music League WhatsApp Playlist Bot

## 1. Purpose

This project is a private, non-commercial bot for a music league group chat. Friends can paste song links or song text into a WhatsApp group, and the bot will place those songs into Spotify and/or YouTube playlists based on configurable rules.

The bot is not intended to be a general-purpose chatbot. It should behave more like a small automation helper.

## 2. Goals

- Detect song submissions in a WhatsApp group chat.
- Support common inputs:
  - Spotify track links
  - YouTube links
  - YouTube Music links
  - Apple Music links, if implemented later
  - Plain text in the form `Artist - Song`
- Normalize submissions into a canonical track shape.
- Create or update Spotify playlists.
- Optionally create or update YouTube playlists.
- Apply user-defined playlist rules.
- Reply to the WhatsApp group with a concise confirmation.
- Avoid duplicate submissions.
- Keep an audit log of submissions.

## 3. Non-goals

- This is not a commercial WhatsApp bot.
- This is not a general AI assistant.
- This is not intended to run at high scale.
- This does not need a public web frontend for the first version.
- This does not need multi-tenant support.
- This does not need perfect cross-platform music matching at first.

## 4. Architecture Overview

```text
WhatsApp Group
    ↓
WhatsApp Adapter
    ↓
Message Parser
    ↓
Song Resolver
    ↓
Rules Engine
    ↓
Playlist Service
    ├── Spotify Adapter
    └── YouTube Adapter
    ↓
Storage / Audit Log
    ↓
WhatsApp Confirmation Reply
```

## 5. Components

### 5.1 WhatsApp Adapter

Responsible for connecting to WhatsApp and receiving group messages.

Likely implementation options:

- `whatsapp-web.js`
- Baileys

Expected responsibilities:

- Authenticate with a QR code or linked-device session.
- Listen for incoming messages.
- Filter messages by allowed group IDs.
- Ignore messages from the bot itself.
- Pass candidate messages to the parser.
- Send confirmation or error replies.

Risks:

- WhatsApp Web automation can disconnect.
- Sessions may need to be re-linked.
- Unofficial libraries can break when WhatsApp Web changes.
- Unofficial automation may carry account-risk, even for private use.

Recommended mitigation:

- Use a dedicated WhatsApp account for the bot.
- Keep message volume low.
- Only process explicit commands such as `!song`.
- Avoid spammy behavior.

### 5.2 Message Parser

Responsible for detecting whether a WhatsApp message is a music submission.

Suggested command patterns:

```text
!song https://open.spotify.com/track/...
!song https://music.youtube.com/watch?v=...
!song Sade - No Ordinary Love
!song The Beths - Expert in a Dying Field #week7
```

Parser output:

```json
{
  "rawText": "!song Sade - No Ordinary Love #week7",
  "sourceUrl": null,
  "artistHint": "Sade",
  "titleHint": "No Ordinary Love",
  "tags": ["week7"],
  "submittedBy": "Alice",
  "submittedAt": "2026-05-07T18:00:00.000Z",
  "groupId": "example-group-id"
}
```

### 5.3 Song Resolver

Responsible for turning links or text into a canonical track object.

Canonical track shape:

```json
{
  "title": "No Ordinary Love",
  "artist": "Sade",
  "album": "Love Deluxe",
  "durationMs": 447000,
  "spotifyTrackId": "example",
  "spotifyUri": "spotify:track:example",
  "youtubeVideoId": "example",
  "sourceUrl": "https://open.spotify.com/track/example",
  "confidence": 0.94
}
```

Resolution strategy:

1. If Spotify link:
   - Fetch track metadata from Spotify.
   - Use Spotify track as canonical.
   - Optionally search YouTube for equivalent video.
2. If YouTube link:
   - Fetch video metadata from YouTube.
   - Search Spotify using title/artist heuristics.
3. If plain text:
   - Search Spotify first.
   - Optionally search YouTube.
4. If confidence is low:
   - Reply asking the submitter to be more specific.
   - Or allow the submission but mark it as uncertain.

### 5.4 Rules Engine

Responsible for deciding which playlist or playlists receive a track.

Example rules:

```json
{
  "rules": [
    {
      "name": "Current week",
      "enabled": true,
      "when": {
        "command": "song"
      },
      "playlist": {
        "spotify": "Music League - Week {{weekNumber}}",
        "youtube": "Music League - Week {{weekNumber}}"
      }
    },
    {
      "name": "Per submitter",
      "enabled": false,
      "when": {
        "submittedBy": "*"
      },
      "playlist": {
        "spotify": "Music League - {{submittedBy}}"
      }
    },
    {
      "name": "Tagged summer playlist",
      "enabled": true,
      "when": {
        "tag": "summer"
      },
      "playlist": {
        "spotify": "Music League - Summer"
      }
    }
  ]
}
```

Suggested rule fields:

- `name`
- `enabled`
- `when.command`
- `when.tag`
- `when.groupId`
- `when.submittedBy`
- `when.dateRange`
- `playlist.spotify`
- `playlist.youtube`

Template variables:

- `{{weekNumber}}`
- `{{year}}`
- `{{submittedBy}}`
- `{{groupName}}`
- `{{tag}}`

### 5.5 Playlist Service

Responsible for coordinating playlist writes.

Responsibilities:

- Find or create target playlist.
- Check whether track already exists.
- Add track to playlist.
- Return playlist URL.
- Log outcome.

Playlist service delegates platform-specific behavior to adapters.

### 5.6 Spotify Adapter

Responsible for Spotify API operations.

Needed capabilities:

- OAuth with playlist modification scopes.
- Search tracks.
- Fetch track metadata.
- Create playlists.
- Add tracks to playlists.
- Read playlist contents for duplicate prevention.

Recommended first implementation:

- One Spotify account owns the playlists.
- Use OAuth once, store refresh token securely.
- Keep token values in `.env` during local development.

### 5.7 YouTube Adapter

Responsible for YouTube playlist operations.

Needed capabilities:

- OAuth with YouTube Data API access.
- Search for videos.
- Create playlists.
- Add videos to playlists.

Caveats:

- YouTube Data API uses quota.
- YouTube Music does not have the same clean official public playlist API as Spotify.
- For first version, use normal YouTube playlists.

### 5.8 Storage

For a small private bot, SQLite is enough.

Suggested tables:

#### submissions

- `id`
- `group_id`
- `message_id`
- `submitted_by`
- `raw_text`
- `source_url`
- `canonical_artist`
- `canonical_title`
- `spotify_track_id`
- `youtube_video_id`
- `created_at`

#### playlist_additions

- `id`
- `submission_id`
- `platform`
- `playlist_name`
- `playlist_id`
- `item_id`
- `status`
- `created_at`

#### bot_events

- `id`
- `type`
- `payload_json`
- `created_at`

## 6. Configuration

### Environment variables

See `.env.example`.

Important variables:

- `WHATSAPP_ALLOWED_GROUP_IDS`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REDIRECT_URI`
- `SPOTIFY_REFRESH_TOKEN`
- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REFRESH_TOKEN`
- `DATABASE_URL`

### Rules file

Use `config/rules.json`, copied from `config/rules.example.json`.

## 7. Suggested MVP Scope

Version 0.1:

- WhatsApp Web connection.
- Only process messages starting with `!song`.
- Spotify links and plain text only.
- One weekly Spotify playlist.
- Duplicate detection.
- Confirmation replies.

Version 0.2:

- YouTube link parsing.
- YouTube playlist output.
- Tags such as `#summer`, `#week7`, `#finals`.

Version 0.3:

- Per-user playlists.
- Better fuzzy matching.
- Admin commands:
  - `!playlist`
  - `!rules`
  - `!undo`
  - `!help`

## 8. Error Handling

Common cases:

- Song not found.
- Multiple possible matches.
- Playlist API failure.
- Duplicate song.
- WhatsApp disconnected.
- OAuth token expired.

Example replies:

```text
I could not confidently match that song. Try: !song Artist - Title
```

```text
Already added: Sade — No Ordinary Love
Playlist: Music League - Week 7
```

```text
Added: Sade — No Ordinary Love
Spotify playlist: Music League - Week 7
```

## 9. Security Notes

- Do not commit `.env`.
- Store OAuth refresh tokens securely.
- Use a dedicated WhatsApp bot account.
- Restrict allowed WhatsApp groups.
- Consider limiting commands to group members.
- Keep logs, but avoid storing unnecessary private chat content.
- Do not send excessive automated messages.

## 10. Development Plan

1. Scaffold repo.
2. Implement config loading.
3. Implement message parser.
4. Implement rules engine.
5. Implement Spotify adapter.
6. Add SQLite storage.
7. Add WhatsApp adapter.
8. Add end-to-end local testing.
9. Add YouTube support.
10. Add deployment docs.

## 11. Open Questions

- Should playlist ownership belong to one shared Spotify account or one friend's account?
- Should the bot accept all messages with links or only explicit `!song` commands?
- Should duplicates be blocked globally, per week, or per playlist?
- Should the bot create playlists automatically or only use pre-created playlists?
- Should YouTube output be normal YouTube playlists, or should unofficial YouTube Music support be attempted later?
