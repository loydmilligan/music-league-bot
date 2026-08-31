# Phase 1 — Source Audit

What historical material the repo *actually* has, as of 2026-08-30. Every "available"
claim below was checked against `data/league.db` by running a query, not by reading schema.

Re-run everything: `bash .planning/spikes/digest-comedy-media/evidence.sh`

---

## Corpus size

| Source | Rows | Notes |
|---|---|---|
| `leagues` | 6 | hip-jammers, fam-jam, second-best, nostalgia-pit, boarz-ii-men, sssc |
| `rounds` | 115 | 97 with votes |
| `ml_submissions` | 1,171 | includes free-text `comment` (submitter's own writeup) |
| `votes` | 10,543 | includes free-text `comment` per ballot line |
| `chat_messages` | 20,740 | WhatsApp + Google Chat, 2026-03-01 → 2026-08-31 |
| `player_profiles` | 40 | LLM taste fingerprint, avatar description, age |
| `player_relationships` | 94 | typed + free-text note |
| `relationship_contexts` | 4 | app-maintained running league narrative (one per league) |

### Chat depth by league

| Group | Messages | Senders | Span |
|---|---|---|---|
| Boarz II Men | 11,807 | 24 | 2026-07-11 → 08-31 |
| Second Best and Friends | 5,749 | 37 | 2026-05-07 → 08-31 |
| sssc | 2,428 | 28 | 2026-03-01 → 08-04 |
| Fam Jam | 304 | 11 | 2026-06-22 → 08-31 |
| Hip Jammers | 252 | 15 | 2026-05-11 → 08-10 |

Only three leagues have chat deep enough to support callback comedy. **Second Best** was
chosen as the primary corpus: it is the only one that pairs deep chat with dense *written
ballots* (50–62 commented votes per round in Season 2) and a hand-written lore document
(`design/second-best-player-dossier.md`).

---

## AVAILABLE — and better than expected

**Vote comments are the richest single source in the database and are currently
underused.** They are where players state doctrine, argue with each other across rounds,
and incriminate themselves. Every beat of Incident 01 except two lives in a vote comment.
Density in Second Best S2: 35–62 commented votes per round out of ~110 votes.

- **Round data** — theme name + full description, submission/voting deadlines, round
  number, `theme_submitted_by`. Complete.
- **Songs** — title, artists, album, album art, submitter (`competitor_id` → `players`),
  submitter's own comment. Complete.
- **Votes** — voter, points (incl. negatives), comment, timestamp. Complete.
- **Placement** — not stored; derived by `sum(points)` per `spotify_uri`. Cheap and exact.
- **Chat** — sender, text, timestamp, group. Sender names are stable enough to join to
  players by hand.
- **Popularity** — `song_popularity` (1,109 rows): Spotify popularity score + monthly
  listeners. This yields real jokes (see `music-specific.md`: a submission with **23**
  monthly listeners).
- **Audio features** — `song_audio_features` (748 rows): bpm, key, scale, energy,
  duration_s. Partial: R137 fully covered, R140 fully absent.
- **Existing lore** — `relationship_contexts` (app-maintained, LLM-written running
  narrative) plus `design/second-best-player-dossier.md`, `design/*-regulars-candidates.md`.
  These are the closest thing to a comedy memory that already exists.
- **Voice/persona hooks** — `player_profiles.taste_fingerprint` and `notes`, plus the
  dossier's per-player paragraphs, are enough to write performance directions without
  inventing a personality.

---

## MISSING — and it matters

1. **No genre data anywhere.** Not on `ml_submissions`, not in `song_popularity`, not in
   `song_audio_features`. This is the headline finding, because the strongest incident in
   the entire corpus is *a dispute about a genre*. The Ska Rule is legible only because a
   human wrote the word "ska" in a vote comment. A generator asked to find genre-based
   conflicts would have to find them lexically, in free text. It cannot ask the database
   "which submissions are ska."
2. **No reply / quote / reaction structure on chat.** `chat_messages` has no
   `reply_to_id`, no quoted-message column, no reactions. Threading has to be inferred
   from timestamp adjacency, which worked here (Sarah's two messages four minutes apart)
   but will fail on a busy day in the Boarz group.
3. **No chat↔round linkage.** No column ties a message to a round. Association is by time
   window against `rounds.voting_deadline`. Workable, imprecise.
4. **No media in chat.** Links and images survive only as the text WhatsApp exported
   ("📷 She seems nice", "🔗 …"). No local copies. Any "chat screenshot" video idea would
   need re-rendering from text, not real attachments.
5. **`round_notes` is empty (0 rows).** The obvious place to persist a named incident
   already exists and has never been written to.
6. **No lore/callback store.** Nothing records "this joke was used in a digest already."
   `digest_sections` (346 rows) holds the shipped text, so it is *searchable* for
   accidental repeats, but there is no canonical incident registry. The
   `relationship_contexts` blob is a prose summary, not addressable records.
7. **Placement/standing is recomputed everywhere.** Fine, but any comedy generator needs
   the same helper the digest uses; there is no single canonical "round result" view.

---

## Data-integrity finding (unrelated to comedy, worth fixing)

`design/second-best-player-dossier.md` **conflates the two Sarahs**. It credits *Sarah S*
with "Survived Springsteen/Blink/'Crazy Poway Kids' to rep San Diego." The database and
the chat log both say that was **Sarah Zucker**:

- `competitors.name='Sarah'` → `players.name='Sarah Zucker'` (submitted Buck-O-Nine "My Town", a San Diego ska band)
- `competitors.name='Sarah S'` → `players.name='Sarah Black'` (submitted "Rocky Road to Dublin")

The Poway/Springsteen/Blink-182 chat message is from sender `~ Sarah` = Zucker. Any
generator that trusted the dossier over the database would have attributed the central
incident of this spike to the wrong person. **Lore documents must be treated as leads, not
as sources.** Every claim in the candidate scripts here is anchored to a row, not to the
dossier. (Verify: `evidence.sh` query E11.)
