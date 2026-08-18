# The digest, section by section

What the round digest is made of, so a new section can be named without
colliding with an existing one. Written 2026-08-13 against round 147 (Boarz II
Men). Section *kinds* are fixed in the schema; section *titles* are written
fresh every round, so the titles below are examples, not constants.

## The seven LLM sections

These are the only values allowed by the `digest_sections.kind` CHECK
constraint. Adding an eighth is a schema migration plus a full regen — see
"Adding a section" at the bottom.

| Kind | UI label (fixed) | What it does | Titles used so far |
| --- | --- | --- | --- |
| `podium` | A-side · final ranking | Top three with cover art, points, and a line on each; body carries the round's lede. | The Podium · The Hate Rankings |
| `villain` | B-side · the downvote | The bottom of the board — who got buried and by whom. | The Villain · Repeat Offender · The Humiliation Index |
| `flow` | Credits · notable votes | The round's shape: where the points went, the fault lines, the arcs. The longest prose block. | How It Was Spent · The Rules of Engorgement · The Architecture of Contempt |
| `consensus` | Consensus & controversy | Songs the room agreed on, in either direction, with the ballots that prove it. | Points of Agreement · Consensus, Such As It Is · The Overlaps |
| `quotes` | Liner quotes | Verbatim submission notes and vote comments. No commentary. | The Record · The Words · The Venom, Unfiltered |
| `chat` | Back cover · chat notes | Labelled "ministories" from the group chat during the round window. Deterministic chat pull, LLM-written moments. | The Chat · The Off-Mic Machinery |
| `storylines` | The Regulars | Recurring cast — the people whose habits showed up again this round. See below. | The Regulars |

## The deterministic block

Rendered by `DigestInsights.svelte`, labelled **Round intelligence · "What this
round sounded like"**, tagged *deterministic · no LLM gloss*. Its cards:

- **Sound profile** — BPM centre, energy, key/scale. *Currently dark: the
  `sintel` audio jobs have failed since 2026-08-01.*
- **Submission race** — median lead time, share of entries in the final six hours.
- **Language of the room** — the twelve most frequent words in the round's
  comments and chat. Weak by construction: frequency finds common words, not
  interesting ones.
- **Round signals** — a mixed tile grid used when no single card wins.
- **Season callbacks** — artists returning from an earlier season. Empty in a
  first season.
- **Phrase of the round** — new, see below.

Other fixtures around the sections: the standings chart, the stat strip, the
next-round teaser, the Tastemaker block, and (SSSC only) the Guesser leaderboard.

## Names already used

Avoid repeats of: The Podium · The Hate Rankings · The Villain · Repeat Offender
· The Humiliation Index · How It Was Spent · The Rules of Engorgement · The
Architecture of Contempt · Points of Agreement · Consensus, Such As It Is · The
Overlaps · The Record · The Words · The Venom, Unfiltered · The Chat · The
Off-Mic Machinery · The Regulars · Phrase of the round · Language of the room ·
Sound profile · Submission race · Round signals · Season callbacks · Round
intelligence.

---

# The two new sections

Both were added by hand during the round-147 punch-up. Neither is generated yet;
`BACKLOG.md` item 0 is the work to make them automatic.

## Phrase of the round

**What it is.** One term the group coined or adopted inside this round's chat
window, set large with a short history and the usage that proves it. Round 147's
was *chopped unc* — coined by Steiny about Jensen on August 9, used seven times
by four people inside 36 hours, absent from every prior round.

**Where it lives.** Not an LLM section — it hangs off the deterministic block's
editable content (`digest_drafts.stats_content_json`, key `phrase`), rendered by
`DigestInsights.svelte` in the same card grammar as *Language of the room*.

**Shape** (`PhraseOfRound` in `ui/src/lib/db/roundInsights.ts`):

```json
{
  "term": "chopped unc",
  "meta": "coined 8/9 · 4 speakers · 36 hours",
  "gloss": "two or three sentences: who coined it, what it means, what the group did with it",
  "metrics": [{ "value": "7", "label": "uses" }],
  "quotes": [{ "speaker": "Steiny", "text": "..." }],
  "media": { "src": "https://digest.mattmariani.com/_media/x.mp4", "poster": "…jpg", "alt": "…", "caption": "30 Rock, 2012" }
}
```

**Rules that matter.**

- Gloss stays at two or three sentences. It is a card, not an essay.
- Media lives in `digests/_media/`, never under `digests/d/<slug>/` — a
  re-render rewrites that directory. Served by the `handle /_media/*` block in
  `Caddyfile.digest`. Absolute URLs only.
- A `poster` is mandatory alongside any `src`: the PNG/PDF export screenshots
  the page and video never captures, so `?export=1` prints the still instead.
- The intended detector (BACKLOG 0b): a term absent from all prior rounds' chat,
  used 3+ times, by 3+ distinct speakers. Novelty and spread, not frequency —
  which is exactly where *Language of the room* falls down.

## The Regulars (verbal tics)

**What it is.** The `storylines` section, reframed. Each entry is one person's
recognizable *form* — how they type — proven with quotes from this round. Round
147 ran two: Mashew's apostrophe-free typing, Conor's one-word rulings.

**The naming question.** "Verbal tic" is the internal term for the raw signal.
"The Regulars" is the section. If you want a name for an individual entry,
**a tell** is the better word than a tic — it implies a habit that gives the
person away, which is the joke, and it survives being said out loud at the
group ("JB's tell is that he can't spell anyone's name").

**Shape** (`StorylineCastMember` in `StorylinesCast.svelte`):

```json
{
  "name": "Conor",
  "motif": "minimum viable profundity",
  "headline": "two or three sentences on the behaviour",
  "spotlight": { "text": "Is", "caption": "his entire reply · august 5" },
  "evidence": ["setup: the quote"],
  "highlight": ["Correct", "Gay", "Damnit"]
}
```

- `motif` is the short label on the pill — the tic named in three words or less.
- `highlight` marks the tic inside its own quote (amber). Matched as whole
  words, case-insensitive, split into runs — never injected as HTML.
- `spotlight` sets one short utterance at display size, for when the message
  *is* the tic. Use at most one per section or it stops being special.
- Panels render open when the cast is three or fewer.

**Rules that matter.**

- Form over topic. "Asks about the rules again" describes a role; "calls Paletz
  'Palletz' and Koziol 'Kozh'" describes a person. If it can't be proven with a
  string, it isn't a tell.
- Evidence must come from the round being written up. A tell that didn't fire
  this week gets dropped, however good it is — Paletz was cut from 147 for
  exactly this.
- Two or three entries. This section is designed sparse-first and looks
  intentional at n=1.
- Candidates come from `~/Projects/sssc-chat-regulars/scripts/mine_verbal_tics.py`
  (log-odds against the rest of the group, flavored by nickname / misspelling /
  coinage / laugh). It emits leads; a human still picks.

---

## Adding a section

`digest_sections.kind` is CHECK-constrained to the seven kinds above, and a new
kind will not appear on an existing draft via "regenerate all" — it needs a
`force: true` full regen, which discards hand edits. That is why both new
sections were built onto existing carriers (`storylines`, and the deterministic
block's editable content) rather than as new kinds.
