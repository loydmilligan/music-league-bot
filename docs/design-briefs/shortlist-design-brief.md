# Shortlist Feature — Design Brief for Prototype

## App context

**Music League Bot** is a personal web app for managing Music League rounds (a Spotify-based music competition game played in a WhatsApp group). The app is built with SvelteKit + SQLite, styled with Tailwind. It has a dark-themed sidebar nav and card-based content areas.

The existing UI uses:
- Dark background (`#1a1a2e` / `#0f3460` range)
- Red accent (`#e94560`)
- Monospace / compact typography
- Rounded cards for songs

## Feature to prototype: `/shortlist`

A personal "songs to consider for a future Music League round" list. Think of it like a music wishlist — songs I've heard anywhere (another league, WhatsApp chat, random listening session) that I want to remember for potential future submissions.

## Page structure

### Top: Search bar
- Full-width Spotify search input at the top of the page
- Typing searches Spotify; results appear as a dropdown below the input
- Each result has: album art thumbnail · title · artist · year · **"+ Add to Shortlist"** button
- Adding closes the dropdown and inserts the song at the top of the list

### Main: Song list
Each song card shows:
- **Album art** (small thumbnail, left side)
- **Title + Artist** (bold title, muted artist)
- **4 rating dimensions** — each 1–5 stars, labeled: Discovery Potential · Theme Fit · Nostalgia · Personal Rating
- **Notes** — a short freetext field (auto-saves on blur)
- **3 action buttons:**
  - 🎵 **Play on Spotify** — opens Spotify URI
  - ⊕ **Assign to round** — dropdown of open rounds (rounds where submission deadline hasn't passed); selecting one adds the song to that round's head-to-head research list without removing it from the shortlist
  - ✕ **Remove** — removes from shortlist (with a brief confirmation / undo toast)

### "Add to shortlist" button on other pages
Anywhere a song appears in the app (ML playlist tab, chat mentions tab, round submission lists), there should be a small bookmark/+ icon that adds that song to the shortlist with one tap.

## Key behaviors

- Songs persist on the shortlist even after being assigned to a round — you may want the same song for a different league later
- Ratings and notes are global to the song (not round-specific)
- The list is sorted by date added (newest first) by default; a sort control for "by score" would be nice but is secondary
- The count badge in the sidebar nav ("11") reflects the current shortlist size

## Visual style reference

Match the existing round research tab style — the app already has a research tab per round that shows songs with the same 4-dimension rating system. The shortlist is essentially that same card, but global (not tied to a round) and with the "assign to round" action replacing "mark as submitted."

## What I need from you

A **visual prototype** (HTML/CSS, interactive where helpful) showing:
1. The `/shortlist` page with the search bar at top and 3–4 example song cards
2. The search results dropdown (Spotify results state)
3. The "assign to round" dropdown interaction
4. The small "+ shortlist" action button as it would appear on a song row in another part of the app (just a single example row is fine)

Style it to match the dark theme described above. Real song data is fine to use — e.g. "Glycerine – Bush", "Everlong – Foo Fighters", "Black – Pearl Jam".
