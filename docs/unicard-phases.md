# Universal Songcard — Phase Tracker

Canonical plan for the unicard migration. Mobile design ref: `docs/racecard-mobile/`.

---

## Completed

| Phase | Commit | What |
|---|---|---|
| **0** | 3ed3017 | Canonical types, adapters, Rating.svelte, SongCard.svelte, SongList.svelte |
| **1** | 314b9de | DB rating migrations, dual weights panel, type field renames |
| **2-A** | e2df06d | Shortlist → SongCard (accordion list, analyze wired to real endpoint) |
| **2-B** | 2061656 | ResearchList → SongCard (density="expanded", adapters.fromResearch) |
| **3-A** | 3647862 | Mobile surface: SongSheet.svelte (bottom sheet), mcm-* CSS, responsive SongCard |
| **3-B** | e9d3496 | Mobile responsive audit: ResearchList + _examples mobile config |
| **3-C** | 19994f5 | SongCompare.svelte — mobile H2H/KOTH stacked-card surface; wired into ShortlistH2HPanel |
| **4-Chat** | 1108b4e | CwRow → SongCard wrapper (adapters.fromChat fixed, chat layer, AssignPopover via onAction) |
| **4-History** | 1108b4e | SongSearchCard: flex-wrap footer for mobile PromoteActions |

---

## Deferred / Future Sprints

### Phase 4-History (full migration) — DEFERRED

`SongSearchCard` has a sprint-23 frozen snippet API (badges, corpus history, promote
actions). Full migration to SongCard would require adding snippet props to SongCard or
losing those features. Not worth the churn while the search tab is working well.

When to revisit: after the badge system (D6/D7) is implemented — at that point the
snippet contract will be settled and a clean SongCard extension can be designed.

### Phase 4-Digest — DEFERRED

Digest section songs are read-only text items rendered in a narrative block format
(`dgC-track-title`, `dgC-track-artist`). They are not interactive cards and don't
benefit from SongCard's action model. Skip.

### Phase 4-B-side — NOT STARTED

Public-facing b-side archive site needs its own light skin. Separate sprint when
the b-side site gets designed. Build in `bside/`.

---

## Wave-gate deploy

All committed phases are inner-loop only. Wave-gate when user signals ready:
```
docker compose build bot-ui && docker compose up -d --force-recreate bot-ui
```
Then assert change is in running container. Smoke: mlbot2.mattmariani.com.
