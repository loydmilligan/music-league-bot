# Chat Watcher — Design Brief for Prototype

## App context

**Music League Bot** is a personal web app for managing Music League rounds (a Spotify-based music competition game played in WhatsApp groups). Built with SvelteKit + SQLite, dark-themed sidebar nav, card-based content areas.

The existing UI uses:
- Dark background (`#1a1a2e` / `#0f3460` range)
- Red accent (`#e94560`)
- Monospace / compact typography
- Rounded cards for songs
- Existing design system: Mash Co. token set (`--mash-pulp`, `--ink-*`, `--sky`, `--amber`, `--moss` etc.) — same tokens used by the Shortlist screen

## Feature to prototype: `/chat`

A feed of songs that have been mentioned in the WhatsApp group chats monitored by the bot. The bot already captures every Spotify/YouTube/Apple Music link dropped in chat and every `!song` command — this page is the UI surface for reviewing those captures, understanding the context they appeared in, and deciding what to do with them.

The mental model: **"things the group is talking about"** — not formal submissions, just songs that came up organically in conversation. This is the discovery layer before you decide to shortlist or submit something.

---

## Data available per mention

Each captured mention has:
- **Track info** — title, artist, album, album art URL, Spotify URI, duration
- **Who mentioned it** — WhatsApp display name (e.g. "Matt", "Kieran")
- **Which group chat** — display name of the WhatsApp group (e.g. "Hip Jammers", "The Lads")
- **When** — timestamp of the message
- **The message** — the raw text of the message that contained the link
- **Context** — the 3 messages immediately before the mention in that chat thread
- **Round assignment** — which round (if any) this song has been auto-assigned or manually assigned to (see below)

Note: every capture is a URL drop (Spotify/YouTube/Apple Music link). The `!song` command is not used by group members.

---

## Page structure

### Header / filter bar

Below the page title, a compact filter/sort bar:
- **Filter pills:** All · Unassigned · Assigned · by chat (one pill per group chat name)
- **Sort:** Most recent · Most mentioned
- **Song count** — e.g. "47 songs · 12 unassigned"

### Main: Song list

**One row per unique song** (deduplicated across multiple mentions of the same track). If a song was mentioned 3 times, show one row with a "mentioned 3×" indicator — not 3 separate rows.

#### Collapsed row (default state)

Left to right:
- **Album art** thumbnail (44×44)
- **Title + Artist** (bold title, muted artist below)
- **Chat source chip** — group chat name as a small colored pill (e.g. "Hip Jammers" in one color, "The Lads" in another)
- **Mention count** — "3×" if mentioned more than once; hidden if mentioned once
- **Time ago** — "2 days ago", "1 week ago"
- **Assignment indicator** — if assigned to one or more rounds, show a small round badge (e.g. "→ R14")
- **Action buttons** (always visible on the right):
  - **+ Shortlist** — bookmark icon; adds to shortlist (uses the same Bookmark component from the shortlist screen)
  - **⊕ Assign** — assign to an open round (same AssignPopover as shortlist)

#### Expanded row (click to open)

Opens below the collapsed row, showing:
- **Larger album art** (120×120) + full track metadata (album, year, duration)
- **Mention timeline** — if mentioned multiple times, a compact list of each mention: who, which chat, when
- **Message context block** for each mention:
  - The 3 prior messages (dimmed, labeled with sender name)
  - The mention message itself (highlighted, with the sender name bold)
  - Visual treatment: a vertical left-border "thread" style, like a chat excerpt
- **Action stack** (same as shortlist expanded row):
  - ▶ Play on Spotify
  - ⊕ Assign to round (with AssignPopover)
  - + Add to shortlist (if not already on it; shows "✓ On shortlist" if it is)
  - Mark as "not interested" (soft dismiss — grays out the row, filterable)

---

## Round assignment logic

Songs are assigned to rounds automatically on ingestion and can also be assigned manually from the UI. The rules:

### Auto-assignment (on ingestion)

The bot checks `captured_at` against open rounds to determine assignment:

| When the song was mentioned | Assignment |
|---|---|
| During **submission phase** (`round.created_at` → `submission_deadline`) | **Unassigned** — ambiguous; could relate to current or previous round |
| During **voting phase** (`submission_deadline` → `voting_deadline`) | **Auto-assign to that round** — voting is live, context is clear |
| During **gap between rounds** (`voting_deadline` passed, next round not yet created) | **Auto-assign to the round that just ended** — gap is typically under an hour |

If multiple leagues have rounds in voting simultaneously (v1 simplification): assign to the first matching round. A future release will add a `chat_group → season` mapping so each WhatsApp group resolves directly to its own league (three of the four leagues use WhatsApp; one does not and will never produce chat captures).

### Manual assignment (from the UI)

The ⊕ Assign button opens the AssignPopover (same component as the shortlist screen). Selecting a round writes to `chat_assignments` and mirrors the song into that round's `research_songs` table — the same outcome as assigning from the shortlist.

### What the UI shows

The collapsed row displays a "→ R-14" chip when a `chat_assignments` row exists. Unassigned songs show nothing in that slot. Songs that were auto-assigned show the chip immediately on load.

---

## Key behaviors

- Rows stay in the list after being assigned to a round — assignment is not removal
- "Not interested" is a soft flag, not a delete — filterable out but recoverable
- The sidebar nav count badge reflects **unassigned, not-dismissed** songs
- Songs that are already on the shortlist show the bookmark icon in its "active" state in the collapsed row
- Filter state persists across page navigations (stored in URL params)

---

## Relationship to other screens

- **Shortlist** — the "⊕ Assign" and "+ Shortlist" buttons here are the same components used there. Songs flow: Chat Watcher → Shortlist → assigned to round (or Chat Watcher → assigned to round directly).
- **Round detail / research tab** — assigning from here adds to the round's `research_songs`, same as assigning from the shortlist. The round detail chat mentions tab also shows songs by timestamp window — this is separate and continues to work as-is.

---

## What I need from you

A **visual prototype** (HTML/CSS, interactive where helpful) showing:

1. **Default list view** — 4–5 collapsed rows with a mix of: one song mentioned once (unassigned), one mentioned 3× from two different chats, one already assigned to a round, one already on the shortlist
2. **Expanded row** — one row open showing the message context block with 3 prior messages + the mention; the action stack visible on the right
3. **Filter bar interaction** — show the "Unassigned" filter pill active, with the list filtered down
4. **AssignPopover** open on one row (can reuse the shortlist prototype's popover design exactly)

Style to match the dark Mash Co. theme. Use realistic data — group chats named "Hip Jammers" and "The Lads", senders "Matt" / "Kieran" / "Sam", real song names like "Glycerine – Bush", "Black – Pearl Jam", "Paranoid Android – Radiohead".

The chat context block is the most novel UI element — give it the most visual attention. The rest can follow shortlist conventions closely.
