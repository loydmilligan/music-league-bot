# Project-Scoped Items Index (PSI)

This file indexes items unique to THIS project. Every row MUST state why the item is necessary. An item with no reason to exist is a candidate for removal.

| Item | Path | Why it's necessary |
| --- | --- | --- |
| musicleague-cli skill | .claude/skills/musicleague-cli | Custom skill wrapping the musicleague CLI the agents drive (P3). Under gitignored .claude/ — machine-local. |
| Agent conventions | docs/agent-conventions.md | Git-workflow + deploy two-loop rules preserved verbatim from the pre-ACM CLAUDE.md (P3/P7). |
| Deploy playbook | docs/dev-loop-playbook.md | Prod deploy playbook: inner/outer loop, ONE shared image, post-deploy bundle assertion (P3/P7). |
| music-league MCP server | mcp-server | Project stdio MCP server (bot-ui API); launch config = .acm/overlay/.mcp.json, ${VAR} secrets (P2/P3). |
| Launch-your-agent kit | my-agent | CMA build: agent.json, LAUNCH.md, launch.sh, evals/ (P3). |
| Theme-rating tool | tools | Bespoke theme-rating web tool + README (P3). |
| Agent eval harness | musicleague/agent-harness | musicleague eval/CLI agent harness incl. its own skills (P3). |
| Env / secrets | .env | BOT_UI_*/Spotify etc. Value stays local, never committed; overlay uses ${VAR} only (P8). |
| Agent instructions (non-Claude) | AGENTS.md | Sibling to the ACM-managed CLAUDE.md for agents that read AGENTS.md. Carries the tool-injected GitNexus block (P3). |
| Host scheduler units | deploy | systemd **user** units for the four host-scheduled jobs (auth probe, HiL ledes, YTM drop, rollout host). Prod scheduling lives here, not in docker-compose (P3/P7). |
| Feasibility spikes | .planning/spikes | Time-boxed spikes with recorded verdicts (YTM 001a/002a/002c/003) + MANIFEST. An INVALIDATED spike is a recorded dead end (P3). |
| Design surface | design | Live CD briefs, the digest-flavor guide, player dossiers, and hand-authored per-round Regulars/Coinage YAML the digest reads (P3). |
| Project README | README.md | Project overview + setup entry point (P3). |
| Quickstart | QUICKSTART.md | Getting-started guide (P3). |
| Roadmap | roadmap.md | Project roadmap (P3). |
| agent-bus participation | agent-bus:music-league-bot | Coordinates via agent-bus (handle music-league-bot). Awareness routed here per P10, not inline CLAUDE.md. |
| orc-tower artifacts | .orc-tower | Machine-local. The in-repo dir is empty, but the Stop hook it feeds is **live, not retired** — see the note below before removing anything. |
| Agent worktrees (transient) | .claude/worktrees | Ephemeral agent worktree checkouts (machine-local, gitignored) — transient/superfluous. |
| superpowers runtime | .superpowers | superpowers skills/session state (machine-local, gitignored) — reference-only (P8/P10). |
| remember memory | .remember | Local session memory (machine-local, ephemeral) (P8). |
| design-sync runtime | .design-sync | Design-sync tool state (machine-local) (P8/P10). |
| playwright-cli runtime | .playwright-cli | cli-anything-web playwright-cli state (machine-local) (P8/P10). |

## Notes

- **Deploy surface:** ACM golden manages only `CLAUDE.md`, `.claude/settings.json`, `.mcp.json` (+ opted-in feature files: `.claude/skills/drawio/`, `.claude/agents/example-reviewer.md`). Everything else above is untouched by deploy.
- **Machine-local caveat:** items under `.claude/` (incl. the `musicleague-cli` skill), `.orc-tower/`, `.superpowers/`, `.remember/`, `.env` are gitignored — durable only on this machine, independent of ACM.
- **settings.local.json:** per-repo permissions + additionalDirectories stay local (P8). It also carries a `Stop` hook running `$HOME/.orc-tower/hooks/agent-stopped.sh`.
  **Correction (2026-08-30):** this index previously called that hook dead and marked it for removal. It is not dead. `~/.orc-tower/hooks-enabled` contains `1`, `~/.orc-tower/hook-mode` is `mailbox`, and both `hooks.log` (4.4 MB) and `hook-inbox.log` were being written the moment this was checked. It fires on every Stop in this project. Do not delete it as cleanup. If it *should* go, the kill switch is `echo 0 > ~/.orc-tower/hooks-enabled` — which disables it globally, for every project, not just this one.
