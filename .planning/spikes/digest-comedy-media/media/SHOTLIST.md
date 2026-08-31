# Shot list — illustrated court cut

**Budget discipline:** generated video is **$0.63/shot** (kling-v3.0-std, 5s, 1920×1080).
First frames are **$0.04** (gemini-2.5-flash-image). So each shot is ~**$0.67**.

The cut is 2:07 with 19 beats. **We buy four shots, not nineteen.** Everything else stays
a text or quote card — which is not a compromise: the quote cards are the evidence, and
you have to *read* those, so motion behind them would actively hurt. Motion is spent only
where a body doing something is the point.

Pipeline per shot: `draw.mjs` (first frame) → `film.mjs --image` (animate) → colour match.

---

## The four shots

| # | Shot | Duration | Used at | Reuses |
|---|---|---|---|---|
| 1 | **Witness wilting** — ✅ already generated (`assets/mo-witness.mp4`) | 5s | all three “Yes… sir” beats | ×3 |
| 2 | **Counsel pressing** — holds up a page, leans in | 5s | the three cross-examination questions | ×3 |
| 3 | **Judge / gavel** — raises it, brings it down | 5s | the verdict, cutting to GUILTY | ×1 |
| 4 | **Empty courtroom** — cold, still, no people | 5s | opening title + the standings beat | ×2 |

**Nine placements from four shots.** That is the whole cost lever. Each reuse uses a
different 2–4s window of the same 5s clip (different in/out points), so it reads as
coverage rather than repetition — exactly how a real edit reuses a reverse.

### Total: 4 × $0.67 = **$2.68**

Shot 1 is already paid for, so the outstanding spend is **3 × $0.67 = $2.01**.

---

## Prompts

Shared style block for every first frame — consistency across shots depends on this being
identical each time:

> Classic American courtroom sketch: loose pastel and charcoal on buff paper, visible
> paper tooth, confident sketchy linework, muted browns ochre and dull red, plenty of
> unfinished paper at the edges. No text, no lettering, no signage anywhere. Generic
> invented features, not a portrait of any real person. 16:9 composition.

| # | First frame (append to style block) | Motion prompt |
|---|---|---|
| 1 | *(done)* nervous middle-aged man alone in a wooden witness box, hunched, eyes down | shifts uncomfortably, swallows, blinks, lowers his eyes further; locked-off camera, very slow push in |
| 2 | a prosecuting barrister standing at a lectern, holding a single sheet of paper up toward an unseen witness, calm and faintly enjoying himself | lowers the page slightly and leans in a fraction; small confident head tilt; locked-off camera |
| 3 | a weary judge on the bench in dark robes, gavel raised, mid-air, about to fall | the gavel comes down once, decisively, and the judge’s hand stays flat on the block; locked-off camera |
| 4 | an empty courtroom seen from the back of the gallery — bench, flag, empty witness box, no people at all | dust drifting in a shaft of light; almost imperceptible slow push in; nothing else moves |

Every motion prompt must also carry: *“keep it a hand-drawn pastel and charcoal
illustration on buff paper — the drawn style, paper texture and muted palette must be
preserved exactly, do NOT make it photorealistic. Subtle motion only. No text appears.”*

---

## Known issue: style drift

Shot 1 came back noticeably **desaturated** — the warm ochre/red of the source sketch
went grey-beige, and it simplified some set detail. Two options, in order of preference:

1. **Correct in ffmpeg** (free, deterministic) — push warmth back with
   `colorbalance=rm=0.06:gm=0.02:bm=-0.06,eq=saturation=1.25`, matched against the source
   PNG. Do this before spending on more shots so the correction is proven once.
2. Regenerate first frames already in the greyer palette so the drift has nowhere to go.

**Do #1 on shot 1 and eyeball it before buying shots 2–4.** If the correction holds, the
remaining three are safe to generate in one batch.

---

## What we are deliberately NOT buying

- **Any shot of a person who represents a real player, in photoreal.** The sketch look is
  the whole reason this is showable inside the league. See `incident-04-tequila.md`.
- **A shot per beat.** Nineteen shots is $12.70 and would make the piece worse — the
  quote cards need to be read, not watched.
- **Talking/lip-synced characters** (`heygen/avatar-iv` exists on the same endpoint). The
  VO is already carrying performance; mouths moving in a pastel sketch would break it.

---

## Cheaper models worth one test each

Pricing is not exposed in the catalogue — it comes back in the job's `usage.cost`. Only
kling-v3.0-std has been measured ($0.63). Before a bigger run it is worth burning one
generation each on `alibaba/wan-2.6`, `bytedance/seedance-2.0-fast` and
`google/veo-3.1-lite` **from the same first frame**, to compare price and style retention
head to head. That is ~$2 of probing that could halve the cost of every future cut.
