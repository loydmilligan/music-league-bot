# War Table — source of record & the process that keeps it trustworthy

This project's roadmap, campaigns, and sprint history live in **repo files** that orc-tower
parses and renders. This doc defines what each file means and the rules that keep them
matching reality. Last full reconciliation: **2026-06-17**.

## The three surfaces (and what's authoritative)

| File | Holds | Authoritative for |
|---|---|---|
| `roadmap.md` | One YAML doc per **roadmap card** (a unit of work) | What's pending vs done |
| `campaigns.md` | One YAML doc per **campaign**, each listing its executed `sprints[]` | Which sprints ran, under which theme |
| `docs/coordination/sprint-*.md` | The **coord-doc** = a sprint's plan + execution log | What a sprint actually did (ground truth) |

- **Source of record = these repo files.** The Obsidian vault
  (`~/.config/taw/wiki/Projects/music-league-bot/war-table/`) is a **one-way mirror**
  (repo → vault). Editing vault notes does NOT change the war table — always edit the repo files.
- **Coord-docs are ground truth** for what shipped. `campaigns.md` and `roadmap.md` must be kept
  consistent with them.

## Card stages (roadmap.md)

`idea → analyzed → planned` are the **active board** — real pending work, visible in the UI.
Any other stage (**`shipped`**) is **parked**: the parser drops it from the active board. That is
how done work is marked done — it stays in the file (for the record) but leaves the live roadmap.

A shipped card carries evidence so the record is trustable:
```
stage: shipped
shippedIn: <sprint-id> (<version>)        # e.g. sprint-38-ai-model-management (v1.5.0)
```
Consolidated/duplicate cards: park the subsumed one with `consolidatedInto: <surviving-card-id>`.
Partially-shipped work: keep the card **active** (the remaining half is real pending work) and add a
`shippedNote:` recording what already shipped (see `round-phase-model-and-action-center`).

## The lifecycle — when to write (do it in the moment, never batch at session end)

1. **Sprint kicks off** → ensure the owning campaign exists in `campaigns.md`; add the sprint id to
   its `sprints[]`; create the coord-doc `docs/coordination/sprint-NN-<slug>.md`. If it's a new theme,
   create a new campaign (don't dump it in a catch-all).
2. **Work is decided / in-flight** → there should be a roadmap card for it (`planned` once it's
   sprint-bound). Set `campaign:` and `sprint:` on the card.
3. **Sprint ships** → for each card the sprint delivered: `stage: shipped` + `shippedIn:`. When **all**
   of a campaign's sprints have shipped, set the campaign `signedOff: true` + `status: complete` +
   `completed: <date>`.
4. **Duplicates** → when two cards cover the same work, park the loser (`stage: shipped` or remove)
   with `consolidatedInto:`.

## Who writes
**Orc only** writes the war table (`roadmap.md`, `campaigns.md`). Project agents update their
**coord-doc** (Activity Log, checkboxes) — never the war table. Orc reads coord-docs and reconciles.

## File quirks — REQUIRED when writing (a violation silently corrupts the board)
- **No trailing `---`** at end of file — crashes the parser.
- **Quote any inline value containing `:`** (e.g. titles) or use a `>-` block scalar — an unquoted
  colon silently DROPS the whole card.
- **Stages**: only `idea | analyzed | planned` render; anything else parks the card.
- **Validate after every write**: parse with `yaml.parseAllDocuments`, confirm the card count is what
  you expect and there are **zero** errors, before trusting it. (orc-tower has the `yaml` dep:
  `node -e "const Y=require('yaml');...parseAllDocuments(fs.readFileSync(f,'utf8'))..."`.)

## Sprint numbering (avoid the drift we just cleaned up)
- The **coord-doc sequence is the real sprint-number authority.** The next sprint number = highest
  existing `docs/coordination/sprint-*.md` + 1 (currently → 39+).
- A campaign's `sprintPlan` is a **proposal**. Until a proposed sprint actually executes, give it a
  **non-numbered placeholder id** (e.g. `bsp-superlatives-voice`), NOT a `sprint-NN-*` label — a real
  number assigned before execution becomes a false claim if other work takes that slot. Only add a
  numbered sprint id to `sprints[]` when it actually runs.

## Periodic reconciliation (the trust audit)
At each **campaign close** (and any time the board feels off), run the cross-check:
1. List every coord-doc (`sprint-* → status → version`).
2. Every closed/shipped coord-doc's sprint id must appear in exactly one campaign's `sprints[]`.
3. Every campaign whose sprints all shipped must be `signedOff: true` + `status: complete`.
4. Every roadmap card whose work shipped must be `stage: shipped` + `shippedIn:` (cross-ref CHANGELOG
   + coord-doc — only park with **hard evidence**; prefer leaving a card active over a wrong "shipped").
5. No card may reference a dead campaign or claim a sprint/campaign that didn't deliver it.
6. Validate both files parse with zero errors.

A reconciliation that finds drift is a process miss — fix the lifecycle step that let it through, not
just the symptom.

## Known open loose ends (as of 2026-06-17)
- **sprint-13** (ytm-play-button) is `paused` (Odesli blocker) and intentionally in no campaign; the
  `ytm-resolution` card (`analyzed`) tracks the blocked work. Resolve or formally abandon when revisited.
- **sprint-6 / sprint-7**: no coord-docs exist and no CHANGELOG bridges sprint-5→sprint-8 — assumed
  never ran (numbering gap only).
- **Kindred Spirits** vault stubs (`war-table/sprints/sprint-3{6,7}-kindred-spirits-*.md`,
  `status: unplanned`) reference a `kindred-spirits-winner-dna-playlists` card that is **not** in
  `roadmap.md` — vault-only planning, invisible to the real war table. Promote to a real card or delete.
