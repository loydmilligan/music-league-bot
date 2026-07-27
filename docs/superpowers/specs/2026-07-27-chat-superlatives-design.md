# Chat Superlatives — "The Boarz Tape"

**Date:** 2026-07-27
**Status:** Approved, ready to build
**League:** Boarz II Men (league id 5, season id 10, season 1)

## Purpose

A digest section that mines the Boarz II Men WhatsApp group chat for
person-level superlatives — who talks most, who uses the biggest words, who
swears hardest, who reads at what grade level — and presents them as a mix of
single-winner awards and full-field charts so every member can find their own
rank.

First deliverable is a standalone shareable test page at
`digest.mattmariani.com/d/boarz-chat-superlatives/`, to be passed to group
members for reaction before the section is wired into the real digest pipeline.

## Data Sources

### Primary: the WhatsApp export

`data/boarz-ii-men/season-1/WhatsApp Chat with Boarz II Men - Music League.zip`
— 2,852 lines, 70 media files, covering group creation (2026-07-11) through
2026-07-27. This is the **entire** history of the group; it is 16 days old.

The export is parsed directly. It is **not** re-imported into `chat_messages`.

Rationale:

- **Clean identities.** The export has 10 sender names drawn from Matt's
  contacts. The `chat_messages` table has 21 sender strings for the same 10
  people (`~ Grant`, `~ JB`, `Conor J` vs `Conor Johnston`, `Dave Jensen` vs
  `David Jensen` vs `~ Dave`, plus two raw phone numbers).
- **Edit markers exist only here.** 55 lines carry
  `<This message was edited>`. `scripts/import_whatsapp_chat.py:44` strips that
  suffix before insert, and the live relay re-sends an edited message as an
  indistinguishable near-duplicate.
- **Re-importing would duplicate, not dedup.** `chat_messages` dedups on a hash
  that includes the sender string. Export rows carry different sender strings
  than relay rows for the same person, so every message would insert twice.

Accepted trade-off: **the page is only as fresh as the last export.** Refreshing
it means re-exporting from the phone. Acceptable for an all-time section.

### Secondary: `data/league.db`

Vote rows for the words-to-votes metric. Only round 135 (`I Heard It Through
the Napster`) has votes: 9 voters, 62 votes, 27 comments.

### Not available: reactions

Confirmed absent from both sources and therefore cut from the feature:

- `src/storage/chatMessagesDb.ts:95` filters relay events to
  `event_type === 'message'`; `chat_messages` contains 0 rows matching
  `%reacted%`.
- The export contains 0 reaction lines.
- Even un-dropping other relay event types would not help: WhatsApp only posts a
  notification for reactions to the relay phone's *own* messages, so capture
  would be one-sided, not group-wide.

Recovering reactions would require a `msgstore.db` pull off the phone (root or
Google Drive backup decrypt). Out of scope.

## Identity

Ten chat participants. Canonical names come from the **export**.

| Canonical | Export sender | `chat_messages` aliases |
|---|---|---|
| Grant Koziol | `+1 (786) 626-6895` | `~ Grant` |
| Matt Mariani | `Matt Mariani` | `Matt Mariani` |
| Jon Black | `Jon Black` | `Jon Black`, `~ JB` |
| Conor Johnston | `Conor Johnston` | `Conor Johnston`, `~ Conor J` |
| Dave Jensen | `Dave Jensen` | `Dave Jensen`, `David Jensen`, `~ Dave` |
| Clements Johnson | `Clements Johnson` | `Clements Johnson` |
| Shane Farkas | `Shane Farkas` | `Shane Farkas`, `~ Shane` |
| Jimmy | `Jimmy` | `~ Jimmy` |
| Darren Pallets | `Darren Pallets` | `~ Darren` |
| Dave Steingart | `Dave Steingart` | `Dave Steingart` |

Notes:

- **`players` row id 36 is misspelled** `Darren Paletz`. Correct spelling is
  `Darren Pallets`. This spec renders the correct spelling; fixing the DB row is
  a separate one-line change, deliberately not bundled here.
- **Jimmy is a rookie.** He has no `players` row, no `ml_competitor_id`, and did
  not participate in round 1. He is included in all chat-derived metrics with a
  `ROOKIE` badge, and **excluded** from the words-to-votes metric (his ratio
  would divide by zero). The exclusion is stated on the page, not silent.

The alias map lives beside the compute module so the DB and export can be
reconciled later without re-deriving it.

## Architecture

Pure compute module, two renderers.

```
export .txt ──> parseExport() ──> Message[]
                                     │
league.db votes ─────────────────────┤
                                     ▼
                         computeSuperlatives()
                                     │
                                     ▼
                        ChatSuperlatives (typed)
                             │              │
                    render script      Svelte section
                             │              │
                      static test page   real digest
```

### Units

| Unit | Path | Responsibility |
|---|---|---|
| `parseExport` | `ui/src/lib/digest/chatExport.ts` | WhatsApp `.txt` → `Message[]`. Owns line-format handling only. |
| `identity` | `ui/src/lib/digest/chatIdentity.ts` | Raw sender string → canonical person. Owns the alias map. |
| `computeSuperlatives` | `ui/src/lib/digest/chatSuperlatives.ts` | `Message[]` + vote rows → `ChatSuperlatives`. Pure; no I/O. |
| render script | `scripts/build-chat-superlatives.mjs` | `ChatSuperlatives` → self-contained HTML. |

`computeSuperlatives` is pure and synchronous so every metric is unit-testable
against fixture messages without touching the filesystem or DB.

### Parser contract

Four line shapes in the export:

1. **Message:** `M/D/YY, H:MM AM - Sender: text` — note WhatsApp uses a narrow
   no-break space (U+202F) before AM/PM in this export.
2. **Continuation:** any line not matching a timestamp prefix appends to the
   previous message.
3. **System:** timestamp prefix with no `Sender:` (15 lines — group created,
   icon changed, encryption notice). Dropped.
4. **Media:** `Filename.ext (file attached)` as the entire text. Counted as a
   message and as a media share, but contributes **no words** to any text
   metric.

Two suffixes are extracted, not discarded:

- `<This message was edited>` → `edited: true`
- Mention markers U+2068/U+2069 around `@Name` → stripped from text, recorded as
  a mention.

## Metrics

Every metric is presented as an **award** (one hero winner) **and** a
**full-field chart** (everyone ranked), per the requirement that each member can
locate themselves.

| # | Award | Full-field viz | Definition |
|---|---|---|---|
| 1 | **Motormouth** | Grouped bar, 3 bars/person | messages, words, characters. Each series scaled to its own max so characters don't dwarf messages; raw values labelled. |
| 2 | **The Lurker** | same chart, opposite end | Fewest messages. Currently Dave Steingart (37). |
| 3 | **Biggest Vocabulary** | Ranked bar | Standardized type-token ratio at a fixed 1,500-token sample, averaged over 10 random draws. Raw unique-word count is rejected: it is a proxy for volume and would trivially hand the award to the highest-volume poster. Anyone under the 1,500-token floor shows "insufficient sample", not a fabricated number. |
| 4 | **THE BIGGEST WORD** | Top-10 longest-words table | Longest token that appears in `/usr/share/dict/words`, ≥3 distinct letters. Filters out URLs, filenames, and elongations (`aaaaahhhh`). Hero treatment: the word at display scale, the author, and the full original message as a quote. |
| 5 | **Reading Level** | Horizontal grade strip, all plotted | Flesch-Kincaid grade level over each person's full corpus. Labelled honestly on the page as a bit: FK on chat text is a blunt instrument, everyone will land grade 2–6, and the ordering is largely noise. That is the joke. |
| 6 | **The Perfectionist** | Ranked bar | Count of `<This message was edited>`. 55 total. Export-only; will not update from the live relay. |
| 7 | **Most Explicit** | Ranked bar, rate per 1,000 words | Curated profanity list. Shows each person's most-used swear alongside the rate. |
| 8 | **All Talk, No Ballot** | Scatter: chat words vs. vote-comment words | Chat words typed ÷ words written in vote comments. **Marked PRELIMINARY on the page** — one round, 27 comments, small and noisy. Jimmy excluded. |
| 9–13 | Night Owl · Longest Message · Most Links · Most Emoji · Fastest Responder | Compact stat-tile row | Fastest Responder = median gap to the previous message, counting only replies within 10 minutes. |

## Interactive Elements

### The Mixing Board (primary)

One leaderboard with two controls:

- **Metric:** messages · words · characters · vocabulary · reading level ·
  edits · swears · emoji · links
- **Normalize by:** Total · Per message · Per 1,000 words

Bars animate and re-sort on change. This is analytical, not decorative: the
normalization axis changes who wins. Raw volume belongs to the highest-message
poster; "per message" surfaces whoever writes long, and "per 1,000 words"
completely reorders the swear ranking. Three real readings of the same ten
people.

Invalid metric × normalization pairs (e.g. reading level "per message") are
disabled in the UI rather than rendering a meaningless number.

### Activity heatmap (secondary)

Day-of-week × hour-of-day grid with a person filter (All / each individual).
Exposes the group's rhythm and each person's posting fingerprint, turning Night
Owl from a claim into something visible.

## Visual Design

Built on the existing Mash Co. tokens (`ui/src/lib/shortlist/colors_and_type.css`)
so the test page previews how the section will look inside the real digest:

- `--mash-pulp` `#ff5b2e` accent on `--ink-0` `#07090c`
- Bricolage Grotesque display, Inter Tight body, JetBrains Mono for figures
- ~800px broadsheet column, mobile-responsive

Chart specs follow the `dataviz` skill; the finish pass follows `impeccable`.

Output is a **single self-contained HTML file** — inlined CSS, JS, and data, no
build step at view time, no external requests beyond webfonts.

## Delivery

Written to `digests/d/boarz-chat-superlatives/index.html`, served at
`digest.mattmariani.com/d/boarz-chat-superlatives/`. The existing `/d/*` Caddy
handle (`Caddyfile.digest`) serves arbitrary static files under that prefix, so
this needs no config change and no auth. The link is shareable as-is.

## Testing

- `chatExport.test.ts` — all four line shapes, the U+202F AM/PM space,
  multi-line continuation, edit-suffix extraction, media lines contributing zero
  words.
- `chatIdentity.test.ts` — every alias in the table resolves; an unknown sender
  fails loudly rather than silently creating an eleventh person.
- `chatSuperlatives.test.ts` — each metric against hand-built fixtures with
  known answers; the vocabulary floor produces "insufficient sample"; Jimmy is
  absent from the words-to-votes output.

Verification of the built page: it renders, all ten people appear in every
full-field chart, the Mixing Board changes the ordering across all three
normalizations, and the numbers on the page match what the module returns.

## Out of Scope

- Reaction capture (data does not exist).
- Fixing the `Darren Paletz` typo in `players`.
- Wiring into the digest approval/regeneration pipeline.
- Backfilling `chat_messages` from the export.
