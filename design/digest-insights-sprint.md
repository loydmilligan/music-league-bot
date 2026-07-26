# Digest insights sprint

## Goal

Add one additive, post-vote “insights” surface to the digest. It should explain
the round’s collective language, sonic shape, submission behavior, and artist
landscape without duplicating the existing podium, standings, villain,
consensus, quotes, or chat-moments sections.

## Scope

The visual surface contains four compact, deterministic modules:

1. **Language of the room** — a weighted tag/word cloud from vote comments and
   available chat text. Remove stopwords, URLs, names, song/artist boilerplate,
   and low-signal tokens. Hide when there is insufficient text.
2. **Sound profile** — median BPM, BPM range, key/scale distribution, average
   energy, and metadata coverage. Hide individual measures when coverage is too
   sparse; never imply a complete profile from a handful of tracks.
3. **Deadline behavior** — median hours-before-deadline, last-six-hour count,
   earliest/latest submission relative to the deadline, and a player-relative
   timing label where safe. Hide when the deadline or timestamps are missing.
4. **Artist landscape** — distinct artists, repeated-artist count, and a small
   ranked list of repeat artists. This is an interpretation of the existing
   artist-variety fact, not another “unique artists” tile.

## Explicit non-goals

- No new standalone momentum card; standings already exposes rank movement.
- No new controversy card; villain/consensus already cover it.
- No generic voter, song-count, participation, or votes-cast KPIs.
- No LLM call for the insights; all values are deterministic and testable.

## Availability and rendering

The entire surface is failure-isolated and self-hides if no module has usable
data. It renders in the existing digest export frame, so the same composition
works in browser, wide PNG, mobile PNG, PDF, and public HTML share artifacts.
The word cloud uses deterministic sizing and ordering so exports do not jitter.

## Acceptance criteria

- Existing digest sections remain unchanged and are not semantically duplicated.
- Missing audio/chat/deadline data degrades to the remaining modules.
- Word-frequency output is normalized, stopword-filtered, deterministic, and
  covered by unit tests.
- Audio/timing/artist calculations have fixture-backed unit tests.
- `svelte-check`, focused Vitest tests, and production build pass.
