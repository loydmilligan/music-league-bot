# Round Digest — Design Brief for Prototype

## App context

**Music League Bot** is a personal web app for managing Music League rounds (a Spotify-based music competition game played in WhatsApp groups). Built with SvelteKit + SQLite, dark-themed sidebar nav, card-based content areas.

The existing UI uses:
- Dark background (`#1a1a2e` / `#0f3460` range)
- Red accent (`#e94560`)
- Monospace / compact typography
- Rounded cards for songs
- Existing design system: Mash Co. token set (`--mash-pulp`, `--ink-*`, `--sky`, `--amber`, `--moss` etc.) — same tokens used by the Shortlist and Chat Watcher screens

---

## Feature: Round Digest Preview

A generated infographic that summarises a Music League round immediately after voting closes. The primary use is personal review; the secondary goal is a polished image ready to drop into the WhatsApp group chat.

The digest is triggered by a **"Generate Digest"** button on the round detail page, available once the voting deadline has passed. Clicking it opens a full-page preview at `/digest/[roundId]`. An **"Export as Image"** button on that page captures the infographic as a PNG.

---

## Data available

All data below is already in the SQLite DB at the time voting closes.

### Round
- Round name (e.g. "Must Be Love on the Brain") and season number
- Theme chooser name
- Submission deadline, voting deadline

### Submissions (`ml_submissions`)
- Song: title, artist, album, album art (via Spotify URI)
- Submitter name
- Submitter comment — the note they wrote when submitting (may be empty; when the round theme requires one it will always be present)
- Total points received
- Rank (1 = winner)

### Votes (`votes`)
- Voter name
- Song voted on (spotify_uri)
- Points awarded — **positive values are upvotes, negative values are the single downvote each player gets per round**
- Voter comment — short reaction text left alongside the vote (encouraged but optional)

### Chat mentions (round window)
- Songs dropped as links in WhatsApp during the round's voting window
- Raw message text of each mention + 3 messages of prior context
- Sender name, chat group name, timestamp

---

## Digest sections

### 1. Round header
Round name, season number, and theme chooser. Compact — this is context, not the story.

### 2. Winner podium
Top 3 songs: album art, title, artist, submitter, total points. Winner gets dominant visual treatment (larger art, gold accent). 2nd and 3rd are smaller. If only 1–2 songs, adapt gracefully.

### 3. The Villain (downvote highlight)
Every player casts exactly one downvote (negative points) per round. Show:
- The song that received the downvote (title, artist, submitter name)
- Who cast the downvote
- Points taken away
- Voter comment if one was left

Framing: presented with dark/ironic energy, not cruelty. "The Villain of Round 14."

### 4. Vote flow — who voted for who
A compact matrix or flow diagram showing which voter gave points to which submitter's song. Focus on patterns, not raw numbers:
- Did voters reward their own ally's songs?
- Did anyone vote across "enemy lines"?
- Were there mutual votes (A voted for B, B voted for A)?

This section is most interesting with relationship context (see below). In early digests, relationship context is provided manually; eventually it will be derived from historical data.

**Relationship context input (user-provided, passed into the LLM prompt):**
A short text block describing known relationships — e.g. "Matt and Kieran are rivals, Sam tends to vote for whoever has the most obscure pick, Alex always votes for 90s tracks." This primes the LLM to call out when vote behaviour matches or breaks the expected pattern.

### 5. Consensus vs. controversy
Two named songs:
- **Most agreed-upon**: the song where voters were closest in agreement on points (low variance)
- **Most contested**: the song where votes were most split (high variance — some gave max points, others downvoted)

Show the point spread visually for each (e.g. small bar or dot distribution).

### 6. Comment highlights (LLM-generated)
The LLM receives:
- All submission comments, labelled with song title + final rank
- All voter comments, labelled with song title + points awarded + voter name

It returns 3–5 short highlight callouts, e.g.:
- A submitter comment that unexpectedly fits (or hilariously misses) the round theme
- A voter comment that's especially passionate, funny, or out of character given their vote
- A case where a submitter's justification matches (or contradicts) how the group actually voted

Format: quoted text + one-line editorial gloss. Keep it punchy — 1–2 sentences per highlight.

### 7. Chat activity summary (LLM-generated)
The LLM receives raw WhatsApp chat messages from the round's voting window. It surfaces:

**Song guesses**: Players often speculate in chat about who submitted which song. The LLM identifies guess statements, checks them against the actual submitter data, and reports the result — "Three people guessed it was Matt's song. It was Kieran's."

**Trash talk**: Memorable banter, complaints, or reactions about specific songs. Quoted with sender name.

**Buzz tracks**: Songs that got chatted about without being formally submitted — did any end up winning? Did the most-chatted song lose badly? Show the gap between chat hype and vote result.

Format: 3–5 callouts. Short. Punchy. Reads like a match report sidebar.

---

## Layout options

Three approaches for the infographic layout. All assume a **portrait orientation** (phone-friendly for WhatsApp) at ~800px wide.

### Option A: Broadsheet (recommended)
A single tall vertical strip divided into clear titled sections. Each section has a distinct visual weight — header and winner are bold and dominant, the analytical sections (vote flow, consensus/controversy) are more compact, the LLM callout sections use a quote-card style. Reads top-to-bottom like a newspaper sports summary. Exports as one tall PNG.

Best for: scanning the full story in one scroll, WhatsApp image sharing.

### Option B: Card grid
The digest is composed of modular stat cards arranged in a 2-column grid. Each card is self-contained (e.g. "Winner", "Villain", "Most Contested", "Quote of the Round"). The grid can be screenshotted as a whole or individual cards can be exported separately.

Best for: flexible sharing (send just the winner card, or the full grid), reusable card components.

### Option C: Vertical story stack
3–4 "scenes" stacked vertically, each taking up roughly a phone screen height. Scene 1: results. Scene 2: voting drama. Scene 3: the chat. Scene 4: quotes. Designed to be swiped through, and each scene can be shared individually.

Best for: Instagram Stories-style format, phased sharing.

**Recommendation: Option A.** It reads as a single coherent summary rather than disconnected cards, and exporting as one tall image is the simplest path to "drop in WhatsApp group."

---

## Key behaviours

- The "Generate Digest" button is only shown once `voting_deadline` has passed
- LLM analysis (sections 6 and 7) runs when the digest is first generated and is cached — re-opening the digest page does not re-call the LLM
- Relationship context is a text field the user can edit in the UI before generating (or skip; the LLM works without it)
- "Export as Image" uses Puppeteer (already in the project) to screenshot the digest page and save a PNG
- The digest page has no sidebar nav — full bleed, just the infographic content, optimised for screenshot

---

## What I need from you

A **visual prototype** (HTML/CSS, interactive where helpful) of the **Option A broadsheet layout**, showing all seven sections with realistic sample data.

Use this sample round:

**Round:** "Must Be Love on the Brain" · Season 3 · Theme chooser: Sam

**Results (top 3):**
1. "Wicked Game" — Chris Isaak · submitted by Kieran · 18 pts
2. "I Will Always Love You" — Whitney Houston · submitted by Matt · 14 pts
3. "Strange Fruit" — Billie Holiday · submitted by Alex · 9 pts

**Downvote:** "Lovefool" — The Cardigans · submitted by Jordan · received downvote from Sam (−3 pts) · Sam's comment: *"Sorry Jordan, felt like a cheap shot at the theme"*

**Vote flow (interesting patterns to show):**
- Kieran voted for Matt's song (historic rivals — first time)
- Sam voted for their own nemesis Alex's pick
- Matt and Alex gave each other max points (mutual)

**Consensus vs. controversy:**
- Most agreed: "I Will Always Love You" — everyone gave it 4–5 pts
- Most contested: "Strange Fruit" — half gave it 5, two gave it 1

**LLM comment highlights (simulate):**
- *"Kieran's submission note: 'I actually heard this at a funeral last year and sobbed. Felt right.' — Voted round winner."*
- *"Matt's vote on Strange Fruit: 'Brave choice. Too brave for me.' — Gave it 1 point."*
- *"Jordan's submission comment: 'It's Love Month. Sue me.' — Most downvoted."*

**Chat summary (simulate):**
- *"Five people guessed 'Wicked Game' was Matt's. It was Kieran's."*
- *"Kieran in chat: 'Whoever submitted Lovefool owes us an explanation.' — He later gave it 5 points."*
- *"'Strange Fruit' was the most-discussed song in chat, with three separate threads about whether it counts as a love song."*

---

Style: match the dark Mash Co. theme throughout. The infographic should feel like a sports results page — data-dense but visually structured, not chaotic. Use the red accent (`#e94560`) for winners and gold/amber for the winner podium. The Villain section should have a distinct darker/moodier treatment. Quote callouts should have a left-border accent style similar to the chat context blocks in the Chat Watcher prototype.

The "Export as Image" button and relationship context input field can be shown as UI chrome outside the infographic area — they won't appear in the exported PNG.
