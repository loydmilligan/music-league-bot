# Backlog

Items are roughly prioritized top-to-bottom within each section.

---

## Privacy / Infrastructure

- **Message filtering scope** — `message_create` fires for ALL WhatsApp chats, so personal conversations appear in the terminal log. Fix: move the debug log line inside the group-ID filter, or switch from `message_create` back to `message` for non-owner senders and only use `message_create` for the owner's own submissions. Longer-term: investigate whether whatsapp-web.js supports subscribing to specific group events only.

---

## Commands

- **`!song help`** — Reply to the group with a usage summary: supported commands, format, examples.

- **`!playlist list`** — List all Spotify playlists the bot has access to (or just the ones in `rules.json`).

- **`!playlist songs <name>`** — List the tracks currently in a named playlist.

---

## Mention List (owner-only, private)

A personal song queue the owner can build up over time and flush to a playlist in one go. All interactions are private (DM to owner only — no group replies).

- **Add to list** — Owner sends one or more song URLs (Spotify, YouTube, Apple Music, etc.) in a message; bot detects URLs and appends them to the mention list in the DB. No `!song` prefix needed — URL detection only.

- **`!mention list`** — Bot DMs owner the current contents of the mention list (title + artist + source URL for each entry).

- **`!mention process`** — Bot resolves every item on the mention list via Spotify, adds them all to a designated "mega mention playlist" (configured in rules.json or env), clears the list, and DMs owner a summary. No group notification.

- **`!mention create`** — Create / name a new mention list (if multiple lists are desired later).

---

## Future / Larger Scope

- Rounds/themes system (named rounds with date ranges)
- Admin commands (remove track, list submissions for a round)
- YouTube adapter
- Apple Music / other service URL resolution
- Deduplication across multiple playlists in a single submission
