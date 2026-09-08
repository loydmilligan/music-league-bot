# Review — CD handoff packet "YouTube Playlist WhatsApp Design"

**Reviewed by:** CC · **Date:** 2026-09-08
**Packet:** `design/YouTube Playlist WhatsApp Design.zip` → `design_handoff_mlb_playlist/`
**Against:** `design/mlb-playlist-brief.md`

Contents: `README.md`, `MLB Playlist Share.dc.html` (the canvas — share + page + states),
`MtvThumb.dc.html` (the share component, 5 variants, `grunge3` shipped).

The `.dc.html` files reference a `support.js` runtime and a `_ds/` bundle that are **not in the
zip**, so they don't open standalone. That's per the README ("ignore the DC wrapper/runtime").
To review the designs rather than their description I extracted the `grunge3` block and wrote a
small shim for `sc-for` / `sc-if` / `{{ }}`, then rendered both against our real tokens
(`music-league/colors_and_type.css`) and the live font bundle.

---

## Verdict

**Accept the direction; do not build the share as specified yet.** The page design is strong and
close to buildable. The share image is the best thing in the packet visually and has one
structural problem that has to be settled first (F1).

CD answered all five decision points with reasons, covered every state from §7 of the brief, and
respected the hard technical constraints (cqw scaling for tiny legibility, deterministic
no-image textures, inline-everything). The prose is honest about prototype-vs-production.

---

## Findings

### F1 — BLOCKING: the share is designed for one round, and has no degradation rule

The locked concept is a torn xerox flyer reading **I WANT MY MTV**. Both halves of that are
R143-specific:

- **The copy** — "I WANT MY ___" is the joke in R143's round name. It is not a frame that other
  rounds fill; it's that round's title.
- **The type** — "MTV" is set at a fixed `44cqw` with `letter-spacing:-.08em`, tuned so exactly
  three characters fill the sheet. The README says as much: *"Sized so all three letters sit
  inside the sheet."*

Rendered with R141's real round name ("Captain Jack Sparrow") the word overflows the sheet on
both axes and is unreadable; the second line is cut off entirely. "More Cowbell" fails the same
way, less severely.

This matters because the brief frames the share as a **weekly recurring asset** (§6 Idea A: *"a
weekly recurring asset and deserves range"*; D1: *"it appears weekly in a chat"*). The precedent
brief for the audio cover made degradation a hard requirement — *"Concepts must state how they
degrade: … very long round titles (up to ~45 chars seen)"* — and this packet contains no such
rule.

**Needs a decision, and it is Matt's:**
- **(a) R143 one-off.** Ship this exactly as designed for the MTV round, and keep the current
  generic video cover for every other round. Cheapest, and the concept is at its best when the
  round name is short and iconic.
- **(b) Weekly template.** Keep the xerox treatment and make the word round-agnostic: auto-fit
  type to the sheet (measure and scale, 1–3 lines), and replace "I WANT MY" with a fixed kicker
  that works every week ("THE VIDEOS", "SIDE B", the league name). Loses the specific joke,
  gains a series.
- **(c) Both.** Template for the weekly case, with a per-round override when a title earns one.

Until this is settled, building the share means building something that works for exactly one
round and breaks silently on the next.

### F2 — BLOCKING for the page: the data model in the README isn't ours

README states `VideoPick { id, song, artist, source, score, youtubeId, up, down, winner }`.
The real one (`ui/src/lib/ytm/videoReview.ts`) is:

```
VideoPick { title, artists, spotifyUri, source: 'comment'|'search'|null, score, band,
            candidates: VideoCandidate[], chosen: string[], included, decided, reason }
```

Two real consequences:

1. **`chosen` is a list, not a `youtubeId`.** A song can carry **more than one video** — added
   deliberately, at Matt's request, along with paste-a-link and search-it-yourself. The design
   has exactly one thumbnail per row and no provision for a song contributing two videos.
   *Needs a design answer:* second row indented under the first? a stacked pair in one row? a
   "+1 more" affordance?
2. **`up`, `down`, `winner` do not exist anywhere** — no columns, no table, no endpoint. That's
   consistent with the README's "write API not built yet", but it means votes need storage
   designed too, not just a UI.

Also minor: CD's `source` union includes `'manual'`; in our model `manual` is a flag on the
*candidate*, not the pick. Easy mapping, but the chip logic in the prototype keys off
`source === 'manual'` and would never fire as written.

### F3 — The vote controls fail the accessibility bar the brief set

The brief set hit targets ≥44px. The prototype's vote chips are `font-size:10px` with
`padding:2px 7px` — roughly 14px tall — and `SAY` is similar. On the primary interaction of the
page, on a phone, one-handed. Needs bigger targets or a larger tap area around small glyphs.

### F4 — "120 MIN" reads as data but isn't

The flyer carries a boxed `120 MIN` stamp. It's a VHS-tape joke, not the playlist's runtime —
but it is a number, in a box, on an artefact about videos, and it will be read as runtime. We
*do* have real total runtime available. Either make it real or make it obviously not a
measurement.

### F5 — The packet has no rendered reference for the thing it calls high-fidelity

Fidelity for the share is "high — it ships as pixels, match it closely", but there is no PNG in
the bundle to match against, and the source doesn't open without the missing runtime. I
reconstructed it; the next person shouldn't have to. Ask CD for a 640×640 PNG (and the ~46px
crop) as part of the packet.

### F6 — The worked data hides the ugly case

The prototype's placeholder round is 9 of 12 `THEIR PICK` — R143's expected shape, and a
flattering one. The brief supplied R141's real data specifically as the stress test (one
submitter pick among eleven guesses, a 10%-confidence pick sitting at #10). The states panel
covers "video removed" and "nobody voted", but not "this round is mostly machine guesses", which
is what every round that *isn't* R143 will look like.

---

## What's good, and worth keeping

- **The xerox share is genuinely excellent** and solves the risk I flagged in §10: it is
  unmistakably a different object from the audio drop cover in the same chat. The
  misregistered pulp ghost behind the black type is a real 1990s printing artefact, not a
  filter, and it earns the "swing for the fences" ask.
- **D4 (provenance → words, hide the raw %)** is the right call and better than my framing of
  it. `THEIR PICK` / `WE FOUND THIS` / `BEST GUESS` / `A GUESS` is honest without being
  clinical, keeps colour as reinforcement rather than the sole encoding, and keeps the numeric
  score for Matt.
- **D3 settling the winner at a cutoff rather than live** avoids leaderboard whiplash and
  removes a live-update requirement we have no infrastructure for.
- **D2's persistent identity chip** is the least intrusive of the three options and, unlike the
  gate, costs a passive reader nothing.
- **The states panel** answers §7 of the brief directly — the TBD stamp, the `⏳ WITH MATT`
  pending chip, the removed-video placeholder.
- **The cqw scaling technique** is the right answer to the tiny-preview constraint and I'd
  keep it even if the render pipeline only ever emits 640.

---

## Change request — the Second Best stamp is progressive, not a single award

*(Matt, 2026-09-08, after the packet was reviewed. This supersedes part of D3.)*

The stamp is not one crown on the #1 video awarded at a cutoff. It appears on **any** video the
moment a league member thumbs it up, and **builds** as more members do — the stamp itself is the
vote count, rendered as ink quality rather than a number.

| Upvotes | Stamp |
|---|---|
| 0 | no stamp |
| 1 | faint, barely visible — **lines missing**, like a stamp running out of ink |
| 2 | fairly visible, **starting to turn green** |
| 3 | **fully formed**, green and blue |
| 4+ | **full colour** — more colours, more detail |

Matt's words: *"after 1 its faint and barely visible - maybe some lines missing … after 3 its
fully formed with green and blue and with all 4 it should be fully color stamp with more colors
and detail."*

**This conflicts with the packet as delivered.** CD locked D3 as *"winner settled at the cutoff,
not live (no leaderboard whiplash)"*, with one hand-circled pulp marker stamp on `#1` and a
dashed `SECOND BEST / TBD` placeholder until the cutoff. The new direction is the opposite on
three counts:

1. **Many stamps, not one.** Every video with ≥1 up carries one; it is not a ranking device.
2. **Live, not settled.** The stamp changes as votes arrive — which is exactly the
   whiplash D3 was avoiding, but here it is the point: watching the ink fill in *is* the reward.
3. **The `TBD` placeholder loses its job.** A video with no upvotes simply has no stamp. The
   "nobody voted yet" state becomes "the page is just clean", which is arguably better.

Consequences worth deciding with it:

- **Does anything still mark #1?** If every liked video gets a stamp, the round has no single
  winner. Either the top-voted video gets something *additional*, or the concept of a winner
  goes away. *(Matt has not said — this needs an answer before build.)*
- **What is the ceiling?** "All 4" reads as a 4-step ladder capping at 4 upvotes, but the league
  has **13 players**. Is 4 the cap (a 5th vote adds nothing visible), or should the ladder
  stretch across the roster? *(Ambiguous as stated — needs confirming.)*
- **Colour has meaning here.** Green and blue arriving as the stamp matures is a departure from
  the one-accent pulp palette, and `--moss` is already the up-vote colour. Worth CD reconciling
  deliberately rather than picking new greens.
- **It must survive the accessibility bar.** Ink-density-as-quantity is colour-and-texture-only
  encoding of a number. It needs a text equivalent (the existing `▲ 34` count probably does the
  job, but say so).
- **The down-vote's role is now unclear.** If the stamp only ever grows with ups, what does a
  down-vote do — nothing visible? subtract? *(Needs an answer.)*

This is a genuinely better idea than a single crown: it turns the page's main interaction into
something that visibly rewards participation, and it fits the product's existing rubber-stamp
vocabulary. But it is a **new design**, not a tweak, and the five ink states have to be drawn.

---

## Recommended next step

One short CD follow-up, not a re-do. Ask for:

1. **The progressive stamp** (change request above) — five ink states drawn, plus answers on
   the ceiling, whether #1 still gets something, and what a down-vote does.
2. **F1 resolved** — a degradation rule and round-agnostic copy, or an explicit "R143 one-off"
   with the generic cover retained for other rounds.
3. **F2** — how a song with two videos renders.
4. **F3** — vote controls at ≥44px.
5. **F5** — PNG exports of the share at 640 and ~46px.
6. Optionally **F6** — the page shown once with R141's guess-heavy data.

Everything else can be resolved in implementation.
