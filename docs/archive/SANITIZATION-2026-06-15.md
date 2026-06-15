# Repo Sanitization — 2026-06-15

Performed during a one-off hygiene spike to make the repo look like a professionally-maintained open-source project. No functional code was changed.

## What moved to docs/archive/

| Source | Reason |
|--------|--------|
| `docs/backlog.md` | Process planning artifact (superseded by `docs/coordination/backlog.md`) |
| `docs/brainstorming/history-research-tool.md` | Historical brainstorm, no code references |
| `docs/planning/famjam-s3-c-e-scatter-recommendation.html` | Historical UX exploration |
| `docs/planning/famjam-s3-concept-c-mobile.html` | Historical UX exploration |
| `docs/planning/sprint-5.md` | Pre-coordination sprint plan (superseded by `docs/coordination/sprint-5.md`) |
| `docs/tracking/sprint-5-tracking.md` | Historical sprint tracking artifact |
| `docs/superpowers/plans/2026-05-07-milestone-1-core-modules.md` | Old harness plan, milestone 1 shipped |
| `docs/superpowers/plans/2026-05-07-song-resolver.md` | Old harness plan |
| `docs/superpowers/plans/2026-05-07-spotify-adapter.md` | Old harness plan |
| `docs/superpowers/plans/2026-05-08-whatsapp-adapter.md` | Old harness plan |
| `docs/superpowers/plans/2026-05-14-music-league-web-ui.md` | Old harness plan |
| `docs/superpowers/plans/2026-05-17-chat-watcher.md` | Old harness plan |
| `docs/superpowers/plans/2026-05-17-shortlist.md` | Old harness plan |
| `docs/superpowers/specs/2026-05-07-song-resolver-design.md` | Old spec, feature shipped |
| `docs/superpowers/specs/2026-05-07-spotify-adapter-design.md` | Old spec, feature shipped |
| `docs/superpowers/specs/2026-05-08-whatsapp-adapter-design.md` | Old spec, feature shipped |
| `docs/superpowers/specs/2026-05-14-music-league-web-ui-design.md` | Old spec, feature shipped |
| `docs/music_league_bot_songlink_feature_brief.md` | Feature brief, superseded/shipped |
| `docs/popularity_proxy_nodejs_agent_brief.md` | Feature brief, historical |
| `docs/whatsapp-capture-integration-brief.md` | Feature brief, historical |
| `docs/whatsapp-feature-map.md` | Historical feature map, no code references |
| `issues.md` (root) | Process scratch file |

## What moved to tools/

| Source | Reason |
|--------|--------|
| `theme-rating-tool.html` (root) | Root-level scratch tool; moved to `tools/` |

## Untracked (already gitignored, no action needed)

- `late-90s-bracket.csv` — already in `.gitignore` (`/late-90s-bracket.csv`), never tracked

## Load-bearing files left untouched

| File/Dir | Why kept |
|----------|---------|
| `docs/coordination/` | Active sprint substrate — orc-tower reads these every session |
| `docs/superpowers/specs/2026-06-13-player-prediction-sprint1-design.md` | Referenced by `docs/coordination/sprint-28.md` and `docs/coordination/backlog.md` |
| `docs/superpowers/specs/2026-06-13-submission-predictor-sprint2-design.md` | Referenced by `docs/coordination/sprint-29.md` |
| `docs/superpowers/specs/2026-06-14-bside-campaign-design.md` | Referenced by `docs/coordination/sprint-31.md` and `sprint-32.md` |
| `docs/dev-loop-playbook.md` | Referenced directly in `CLAUDE.md` |
| `docs/design/` | Referenced in `docs/coordination/sprint-31.md` as canonical read-model and handoff |
| `docs/design-briefs/` | Current feature design references |
| `docs/HIGH_LEVEL_DESIGN.md` | Architecture overview |
| `docs/screenshots/` | Referenced in 10+ sprint coordination docs as visual verification record |
| `docs/hip-jammers-s3-rounds.csv` | Data reference file; not clearly historical |
| `roadmap.md`, `campaigns.md` | Read by warren/orc-tower — do not touch |
| `BACKLOG.md` (root) | Product backlog — keep at root |
| `CLAUDE.md`, `CHANGELOG.md`, `LICENSE` | Standard root files |

## CHANGELOG note

`CHANGELOG.md` top version is `1.1.1`, matching `ui/package.json` `"version": "1.1.1"`. Sprints through sprint-33 appear in the changelog. No gaps detected.

## Flags for owner

- `docs/screenshots/` — 29 PNGs tracked (~referenced in sprint coordination docs). If these become a repo size concern, consider adding to `.gitignore` after migration; they're not needed for code. Left tracked intentionally per task guidance (referenced).
- `docs/prototype/` — gitignored via `.gitignore` (`docs/prototype/`). Files exist on disk but not tracked. No action taken.
- `docs/*.zip` files — gitignored. Not tracked. No action taken.
