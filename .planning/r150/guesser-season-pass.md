# Boarz season — who guesses, manual pass

Method: ran the production matcher (`buildGuessMatcher`, via `getGuesserData`
with the per-league guesser override) over **every** Boarz vote comment by
**every** player, all rounds with comments (135, 145–150, 153). That surfaced 65
candidate resolutions. Then read all 65 by hand and threw out the ones that name
a player without guessing anything.

## Results

| player | genuine guesses | correct | rate | rounds active |
|---|---|---|---|---|
| **Conor** | 10 | 6 | **60.0%** | 145, 146, 149, 150, 153 |
| **Matt (Mashew)** | 38 | 18 | **47.4%** | 145, 146, 148, 149, 150, 153 |
| **Clements** | 2 | 1 | 50.0% | 135, 147 |
| **Steingart** | 1 | 1 | 100% | 153 |
| **Dave Jensen** | 13 | 2 | **15.4%** | 149, 150 |
| **Jon Black** | 2 | 0 | **0.0%** | 145, 149 |
| Shane, Grant, Paletz, Jimmy | 0 | — | — | never |

**The headline: Conor is out-shooting Matt by thirteen points.** The man who
appointed himself the Guesser, wrote the scorecard and published it is being
beaten by someone who guesses a quarter as often and never mentions doing it.
Small sample — 10 vs 38 — but it's real.

### Matt, per round
| round | correct/attempts |
|---|---|
| 145 | 0/1 |
| 146 | 0/1 |
| 148 | 3/9 |
| 149 | 3/9 |
| 150 | **5/9** (was 3/6 before the alias fix) |
| 153 | 7/9 |

R145 and R146 are single offhand guesses, not him playing the game. His real run
starts at R148: **18/36, exactly 50%.**

### Conor, per round
145 1/1 · 146 1/2 · 149 1/1 · 150 1/2 · 153 2/4

---

## The Jensen R149 ballot — better than remembered

He didn't guess Conor on every song. **He guessed Conor on every song in a
different spelling each time**, in play order:

| song by | pts | comment |
|---|---|---|
| Dave Steingart | 2 | `Conr?` |
| Jon Black | 0 | `Cooonerr?` |
| Jimmy | 3 | `Conner?` |
| **Conor Johnston** | **−1** | `Conor?` |
| Shane Farkas | −1 | `Cnr?` |
| Clements Johnson | 0 | `Cccccooooooonnnnnnooooooorrrrr?` |
| Matt Mariani | 2 | `Not Conor` |
| Darren Paletz | 1 | `Cronar?` |
| Grant Koziol | 0 | `C` |

Two things the tally can't express:

1. He got exactly one right — **and downvoted it.** The only song he correctly
   identified as Conor's is the one he gave −1.
2. `Not Conor` was also **correct**. It was Matt's. So on a strict reading he
   went 2-for-9 and the second one was a negation.

**The 1/∞ gag works, and here's the honest framing for it:** Conor submitted
exactly one song, so a ballot that says "Conor" nine times was *guaranteed* one
hit before a note was played. His accuracy isn't 11% — it's 100% of the only
outcome available to him, and 0% of anything that required knowing something.

⚠️ **The matcher can only see 3 of those 9.** `Conr`, `Cooonerr`, `Cnr`,
`Cccccooooooonnnnnnooooooorrrrr`, `Cronar` and `C` resolve to nobody. So R149
Jensen has to be **hand-authored** for any visual — the automated path will
report 1/3 and miss the entire joke.

Also worth knowing: **`Not Conor` scores as a wrong guess of Conor.** The matcher
has no notion of negation, so a correct exclusion is recorded as an error. One
occurrence so far; flagging rather than fixing.

---

## Excluded as false positives (read, judged, thrown out)

| player | round | comment | why |
|---|---|---|---|
| Jon Black | 146 | "Not very **boner jammy**, and a little too bleak…" | `jammy` fuzz-matches `Jimmy` at edit-distance 1. Not a guess — and a live matcher bug (pre-existing). |
| Jimmy | 153 | "Makes me want to play some **patty cakes**" | `patty` fuzz-matches the `Matty` alias. Same bug (pre-existing). |
| Steingart | 148 | "**I'm trying to beat steiny**" duly noted | He's quoting the submitter's note *about him*. |
| Jon Black | 147 | "Hoping for a category one day where **Conor** decides to stop trolling." | General complaint, no attribution. |
| Jon Black | 153 | "Way to not let **Jimmy's** last-second category change throw you." | Jimmy is the commissioner who changed the theme. |

### Three false positives I introduced, now fixed
Adding `Conie`, `Koshel` and `Stein` opened three collisions, because fuzzy
matching only refuses to reach words in the 10k common-word list and none of
these are in it:

- `Koshel` → **"kosher"**
- `Conie` → **"Con Te"** of Con Te Partirò — live in JB's R145 comment
- `Stein` → **"stain"**

Fixed by adding `exactOnly` to `GuessCandidate` and setting it on those three:
a hand-curated nickname resolves when it is written, not when something else is.
Tests in `guessResolver.test.ts`. The two pre-existing ones above (`jammy`,
`patty`) are the same class and are still live — `Jimmy` and `Matty` would both
need the same treatment, but `Jimmy` also arrives as an auto-derived competitor
name, so that one needs more than an alias flag.

---

## For the visual

A round × player grid, cell = guesses made and hit rate, empty where they didn't
play. What it would show:

- Matt: a solid block from R148 on, climbing 3→3→5→7.
- Conor: scattered, thin, and a better hit rate than the block.
- Jensen: two cells, one of which is R149 and needs its own treatment.
- Jon, Clements, Steingart: one or two cells each.
- Shane, Grant, Paletz, Jimmy: empty rows — four players who have never once
  guessed, which is its own finding.

R149/Jensen is the cell that should break the grid's format: **1/∞**, with the
nine spellings as the payload.
