# Design: "The Guesser" section + SSSC Discord chat

**Date:** 2026-08-05
**League:** `sssc` (SouthSide Secret Club — Mara's league; owner is not a player)
**Status:** approved shape, pending spec review

## Goal

SSSC is a low-round / high-player league (S5: 28 players / 6 rounds, S6: 20 / 4).
One player, **Boonie Dogsweat** (Discord "Dogsweat 🚂"), leaves a guess at who
submitted nearly every song in his Music League vote comments — a running,
increasingly-drunk ritual. We want:

1. A new **"The Guesser"** digest section that scores his guessing and mines the
   recurring patterns, computed **deterministically** and cached so a digest
   **regen reuses** it.
2. The SSSC **Discord chat** ingested into the historical chat DB, like every
   other league's chat (WhatsApp / Google Chat → now Discord), so the normal
   chat section and chat-driven storylines work for SSSC.

## Key facts established during discovery

- **His guesses are in ML vote comments, not Discord #general.** He left 217
  comments in SSSC. Nearly every one names a guessed submitter ("a Bagimation
  pull", "Lexaprole!", "I'm gonna guess this one is Poetry in Noise") and
  references drinking ("I'm still quite drunk", "another glass of absence").
- **The submitter roster names match his guess vocabulary** after normalization:
  `bagimation`↔"Bagimation", `Lexa Prole`↔"Lexaprole", `PoetryinNoise`↔"Poetry in
  Noise", `antigravpjs`↔"Antigrav PJs", `sparklepants13`↔"Sparkle Pants",
  `KarBen`↔"Karben", `TekniKali.Mo`↔"TEKNIKALI MO". A minority need an alias map
  (e.g. "Generous Giragge"→`jirafa`/`lithogiraffe`, "Zewskers", "Mollie").
- **Play order is exactly reconstructable.** Music League Spotify playlists are
  ordered **alphabetically by Spotify track id**, and voting shows the same order.
  So play/vote position = submissions sorted `ORDER BY spotify_uri` (1..N).
  Verified against Dogsweat's own cues in R154: `spotify_uri`-sorted position 1 =
  "First one is always the hardest", position 13 = "I have lost all semblance of
  coherence", last position = "Final song … my final pick". This makes the
  "drunker by the end" arc an **exact** position metric, not an inference.
- **Chat DB shape:** `chat_messages(platform, group_name, group_key, sender,
  text, ts, msg_hash, sender_handle)`, dedup on `msg_hash` UNIQUE and natural key
  `(group_name, sender, ts, text)`. Chat scopes to a league via the
  `leagueGroupMap[slug] → group_name` setting; the digest windows chat per round
  by round deadlines (`chatSection.ts`). Roster resolution uses `player_identities`
  scoped by `league_id` + `group_name`.
- **Chat section is per-league opt-in** (`chat_section_leagues` setting; off by
  default). "The Guesser" follows the same opt-in, **off by default**.

## Components (built in order; each independently useful)

### 1. Discord chat ingestion (deterministic)

New parser for the log format `[MM/DD/YYYY, HH:MM AM/PM UTC] Display Name: text`.

- **Input:** the two `.txt` logs (S5+S6 span, ~3,835 messages total).
- **Output:** `chat_messages` rows with `platform='discord'`, `group_name='sssc'`.
- **Quirks handled:** collapse consecutive duplicate lines (the export repeats
  messages); strip trailing `(edited)…<weekday date time>` markers; preserve
  `@mentions` in text; parse the `UTC` timestamp to ISO; skip the 3-line header.
- **Idempotent:** relies on existing `msg_hash` + natural-key unique indexes, so
  re-ingesting the same file inserts nothing new. (Mirror the WhatsApp importer's
  hashing so dedup is consistent.)
- **Wiring:** add `leagueGroupMap['sssc'] = 'sssc'` (or the chosen group_name);
  the digest's chat loader keys on `group_name`.
- **Unlocks:** the standard chat section for SSSC once the roster is linked.

### 2. SSSC identity roster (shared backbone)

One canonical person map: **ML competitor** ↔ **Discord sender** ↔ **Dogsweat's
nickname variants**, persisted to `player_identities`.

- **Schema change:** extend `player_identities.identity_type` CHECK to include
  `'discord'` (currently `whatsapp|google-chat|music-league`).
- **Auto-match:** normalize (lowercase, strip spaces/punctuation/emoji) and match
  ML competitor names ↔ Discord senders ↔ names Dogsweat uses. ~80% resolve.
- **Gap list (human step):** present the ~5-10 ambiguous nickname→player pairs to
  the owner to confirm/correct once (decision: "confirm a short gap list").
- Serves BOTH guess-scoring (component 3) and chat-section people resolution.

### 3. "The Guesser" section (deterministic records over a cached extraction)

**New digest section kind `guesser`**, off by default (per-league opt-in, same
mechanism as the chat section). Schema: add `'guesser'` to the `digest_sections.kind`
CHECK.

**Extraction pass (cached, regen-safe).** Convert each of his vote comments into a
structured row in a new table, e.g. `guesser_guesses`:

```
guesser_guesses(
  id, round_id, song_uri,
  actual_submitter_player_id,     -- from ml_submissions
  guessed_player_id,              -- resolved via roster; NULL if no guess found
  correct,                        -- guessed == actual
  confidence,                     -- match confidence 0..1
  drink_refs,                     -- count of drink-word hits in the comment
  play_position,                  -- 1..N, submissions sorted by spotify_uri
  play_count,                     -- N songs in the round (for position/N)
  extracted_at
)
```

- **Extraction = deterministic fuzzy-match** of named nicknames in the comment
  against the roster + alias map. LLM only as a **fallback** for genuinely
  ambiguous prose (kept out of the default path to preserve reproducibility).
- **Cached:** keyed by `(round_id, song_uri)`; never re-derived on regen. This is
  the "reuse content on regen" requirement.

**Deterministic outputs (plain queries over `guesser_guesses`):**
- **Weekly record** — his hit rate for the round being digested.
- **"Eludes him" leaderboard** — season-cumulative: submitters he most often gets
  *wrong* (min sample threshold to qualify).
- **"Always nails" award** — submitter(s) he's never/rarely missed (min sample).
- **"Littermates"** — the ordered pair (A,B) he most often swaps: he guesses B on
  A's songs and vice-versa. Symmetric confusion count.
- **Drunk-by-the-end** — accuracy and drink-word density as a function of exact
  `play_position` (spotify_uri order), surfacing the "gets worse as the night
  goes on" arc. E.g. hit rate in the first third of the playlist vs the last
  third, and the position where his coherence visibly breaks.

### 4. Recurring cast & storylines (curated seeds + deterministic evidence)

A "cast of regulars" block: recurring character bits the league knows, written up
each round with **real quotes pulled from that round's data**. Not free LLM
discovery — a **curated seed list** the owner maintains, so the characters are
intentional and the output is reproducible.

- **Seed config** (`storyline_seeds`, per league): each entry = `{player,
  motif label, keyword/phrase patterns, sources}`. Sources can be `chat`,
  `vote_comments`, or both.
- **Deterministic evidence pass:** for each seed, search the round's chat window
  and/or the player's vote comments for the motif patterns → collect matching
  quotes with timestamps. A seed with no hits this round is silently dropped.
- **LLM write-up (thin):** given the evidence quotes, the LLM writes a short,
  factual blurb per active storyline. It only phrases what the evidence shows —
  no invented threads. Cached like other section content for regen.

**Initial SSSC seeds (from the owner):**
| Player | Motif | Sources |
| --- | --- | --- |
| PoetryInNoise | cats; "big butts" | vote_comments + chat |
| Timmywhatup (timmyg) | "rapity rap rap" rap obsession; **Friday** new-release deep-dives; weed | chat |
| bagimation + missmara | relitigating the songs they *didn't* pick | chat |

Ships after the deterministic Guesser work; the seed mechanism is small and the
value is high, so it is **in scope**, not optional. New seeds are a config edit,
not code.

## Persistence & regen

- Extracted guesses cached in `guesser_guesses` (stable key) → regen reuses.
- Rendered section content persisted in `digest_sections` (kind `guesser`) like
  every other section, so approve/send/regen behave consistently.
- Section off by default; enabled per-league via the existing opt-in setting.

## Constraints / risks

- **Roster gaps** can misattribute guesses; low-confidence matches are excluded
  from awards rather than scored wrong.
- **`identity_type` CHECK change** and **`digest_sections.kind` CHECK change** are
  additive migrations (guarded, idempotent) consistent with existing `client.ts`
  migration style.

## Testing

- Parser: fixture of the log's quirk cases (dup lines, edited trailer, mentions,
  header) → expected `chat_messages` rows; idempotency (re-run inserts 0).
- Extraction: fixture of representative Dogsweat comments → expected
  `(guessed_player, correct, drink_refs)`; includes clear-match, alias-match,
  and no-guess cases.
- Records: seeded `guesser_guesses` → asserted weekly record, eludes-him,
  always-nails, littermates.

## Out of scope (YAGNI)

- Generalizing "The Guesser" beyond SSSC's opt-in (the kind is reusable, but no
  other league is wired now).
- Live/auto Discord ingestion — this is a manual file drop + parse, matching how
  Mara hand-exports ML data.
