# docs/

Index of everything under `docs/`. One line per item: what it is and when you'd read it.
Project overview and setup live outside this directory — see the repo
[README.md](../README.md) and [QUICKSTART.md](../QUICKSTART.md).

## Architecture & operations

| Doc | Read it when |
|---|---|
| [HIGH_LEVEL_DESIGN.md](HIGH_LEVEL_DESIGN.md) | You need the system architecture in depth — data flow, components, the digest job state machine, storage. |
| [dev-loop-playbook.md](dev-loop-playbook.md) | Deploying, or deciding whether a change needs a container rebuild. Inner vs outer loop, the one-shared-image rule, post-deploy verification. |
| [agent-conventions.md](agent-conventions.md) | Working as (or with) an agent in this repo — git workflow and deploy rules preserved from the pre-ACM `CLAUDE.md`. |
| [how-to/end-of-round-process.md](how-to/end-of-round-process.md) | Actually ending a round: transition, digest generation, send. The operational walkthrough. |

## The digest

| Doc | Read it when |
|---|---|
| [digest-sections.md](digest-sections.md) | Naming or adding a digest section — what each of the seven LLM kinds and the deterministic blocks contain. Written against round 147. |
| [regular-types.md](regular-types.md) | Working on "The Regulars" / storylines — the taxonomy of recurring-character types and what evidence proves each one. |
| [plans/](plans/) | The style-shelf build (per-entry `style:` layouts for the Regulars section): plan and review checklist. |
| [workflows/](workflows/) | Digest automation brainstorm + the magic-wand / generation flow diagrams (`.drawio`). |

## Chat capture

| Doc | Read it when |
|---|---|
| [whatsapp-group-capture-plan.md](whatsapp-group-capture-plan.md) | Understanding how group chat gets into the database — the three feeds (live relay, historical export backfill, Discord/Google Chat) and the export tool. |
| [grouprelay-android-build-brief.md](grouprelay-android-build-brief.md) | Working on the phone-side capture app. Self-contained build spec for GroupRelay, which POSTs notification-stream messages to `/webhooks/relay`. |
| [chatmention-proto/](chatmention-proto/) | Prototype for chat-mention handling. |

## Design

| Path | Read it when |
|---|---|
| [design-briefs/](design-briefs/) | Starting UI work on a feature that already has a brief — metadata queue, universal songcard, chat watcher, digest preview, discoverability, shortlist, song metadata. |
| [design/](design/) | You need the Claude/Mash Co. design handoff material — component fixtures, tokens, implementation prompts. |
| [prototype/](prototype/) · [racecard/](racecard/) · [racecard-mobile/](racecard-mobile/) · [shortlist-proto/](shortlist-proto/) | Looking for the standalone HTML prototype behind a shipped screen. |
| [design_handoff_sonic_signature/](design_handoff_sonic_signature/) · [design_handoff_universal_songcard/](design_handoff_universal_songcard/) · [song-metadata-handoff/](song-metadata-handoff/) · [mashco-design-handoff-digest/](mashco-design-handoff-digest/) · [league-research-handoff/](league-research-handoff/) | Implementing that specific handoff. |
| [screenshots/](screenshots/) | Checking what a screen looked like at the time of a change — provenance for visual work. |
| [unicard-phases.md](unicard-phases.md) | Tracking the universal-songcard migration phases. |

## Planning & process

| Path | Read it when |
|---|---|
| [WAR-TABLE.md](WAR-TABLE.md) | You need to know which planning file is authoritative (roadmap vs campaigns vs sprint history) and the rules that keep them honest. |
| [campaigns/](campaigns/) · [coordination/](coordination/) | Reconstructing why something was built — per-campaign notes and the sprint coordination logs (process history, not product docs). |
| [superpowers/specs/](superpowers/specs/) · [superpowers/plans/](superpowers/plans/) | Reading the design spec or implementation plan for a recent feature (voting-phase lab, chat superlatives, the Guesser, storylines, SSSC ingestion, section pipeline). |
| [sessions/](sessions/) | VSM working notes — issues, principles, process improvements. |

## Reference & research

| Path | Read it when |
|---|---|
| [ml-competitors.md](ml-competitors.md) | Evaluating other music-league-style platforms (Mixtape Hero, BandJam, YapZap, CutClub). Research dated July 2026. |
| [Music League Stats Architecture Summary.md](Music%20League%20Stats%20Architecture%20Summary.md) | Looking at the prior-art DuckDB/Streamlit stats pipeline this project's ingestion learned from. |
| `hip-jammers-s3-rounds.csv` · `regulars-verbal-tic.png` · `ml-players-second-best-league.png` | You need that specific piece of reference data or a captured screen. |
| [sample_email/](sample_email/) | Working on the IMAP ingestion — real Music League notification mail. |
| [archive/](archive/) | **Historical only.** Planning, brainstorming, and early-sprint artifacts kept for provenance; see [archive/README.md](archive/README.md). Not current. |

## Notes

- Several items in this directory are `.zip` design bundles and one-off exports (PDFs,
  images). They are provenance, not documentation — treat anything not listed above as an
  artifact rather than a source of truth.
- `CLAUDE.md` at the repo root is ACM-managed and is not edited in this repo; project-scoped
  items are indexed in [PSI_INDEX.md](../PSI_INDEX.md).
