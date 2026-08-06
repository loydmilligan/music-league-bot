# Brainstorm prompt — "The Guesser" & "Storylines" digest sections

*Paste this prompt into any LLM along with the attached data file (`dogsweat-guesser-data.json`). Its job is to surface **interesting possibilities** — angles, metrics, visualizations, and jokes — not to write code.*

---

## The setup

A group of friends plays **Music League**: each round everyone submits one song to a theme, then everyone anonymously votes on all the songs and leaves comments. We generate a weekly **digest** (a shareable image/zine) recapping the round.

One player — **Boonie Dogsweat** — has a ritual. In his vote **comments**, he guesses **who submitted each song**. It started small (early in the first season he guessed ~5 songs' submitters; one was "missmara"). After he did it again, missmara said his guesses had become **as exciting as the actual vote reveal**. A tradition was born. Now he guesses **the submitter of every song, every round** — and he does it **while getting progressively drunker** as he works down the playlist (a rule he added himself). His comments are full of it: *"I'm still quite drunk," "came back from a bathroom break," "I have lost all semblance of coherence,"* naming a guess for each song.

We built two digest sections and want your ideas to make them great.

### Section 1 — "The Guesser"
A **deterministic** ledger of Dogsweat's guessing. From the data we compute:
- **Weekly record**: how many he got right / how many he guessed (he guesses ~all ~16–21 songs; he's usually right on only **2–6**).
- **Play order = the order songs appear** (we can reconstruct it exactly), so we can track how he does as the night — and his drunkenness — progresses.
- **Season leaderboards**: who he's **worst** at identifying ("eludes him"), who he **always nails**, and his **"littermates"** — the pair of players he most often mixes up for each other.

### Section 2 — "Storylines" ("The Regulars")
A cast of **recurring bits** for the league's characters, written from real evidence quotes (e.g. one player's obsession with cats & Sir Mix-a-Lot; another's Friday new-music deep-dives + weed). Cast size varies per round.

## The data (attached: `dogsweat-guesser-data.json`)
- `meta` — who the guesser is, the tradition.
- `seasonLeaderboards` — eludesHim / alwaysNails / littermates.
- `perRound[]` — for all 11 rounds: his weekly attempts/correct/rate, `drunkByThird` (accuracy in first/middle/last third of the playlist), and **`guesses[]`** — every song with its play `pos`, the **actual** submitter, his **guessed** submitter, whether he was `correct`, the points he gave, and **his full `comment`** (this is the gold — it's where the drunkenness, reasoning, and personality live).

## What we want from you

Read the data (especially the comments) and propose **interesting possibilities**. We're explicitly unsure and want divergent ideas. Consider:

1. **Metrics / KPIs worth surfacing.** He's only right ~15% of the time, so raw accuracy is thin. What's *actually* interesting? (Confusion pairs? Confidence vs. correctness? "Curse" streaks? Who he's never once gotten? First-guess vs. late-guess accuracy?)
2. **Visualizations.** Especially for the **drunkenness-over-play-order** arc — a line graph? an annotated "night" timeline with his real quotes pinned to positions? a decay curve? What reads best as a **static shared image** on a phone?
3. **Anecdotal / qualitative angles.** Since the numbers are sparse, what *patterns in his comments and misses* are funny or telling? ("This week he had unusual trouble with X." "He always whiffs on Y." "He can't tell A from B.") Derive these from the data where you can.
4. **The origin legend.** How would you tell the abbreviated origin story inside the section without crowding it?
5. **Storylines format ideas** — how should a recurring "cast of characters" section feel? Cards? A who's-who? Margin notes?
6. **Anything we're missing** — surprising correlations, running gags, one-off gems in the comments worth immortalizing.

Ground every suggestion in the attached data — quote the specific comments/rows that inspire each idea. Prioritize a handful of *strong, specific* ideas over an exhaustive list. Tone: this is a fun, private, wry zine for friends — not a corporate dashboard.
