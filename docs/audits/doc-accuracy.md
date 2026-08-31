# Documentation accuracy audit

**Audited:** 2026-08-13 · **Auditor:** Testerosa (agent) · **Method:** every claim checked
against the working tree, the live DB (`data/league.db`), running containers, and the live
site — never against memory. Where a claim could not be verified, it is recorded as
unverified rather than as a finding.

**Out of scope (owned by Codera 1, concurrently rewritten):** `README.md`,
`docs/README.md`, `docs/HIGH_LEVEL_DESIGN.md`. **Read-only (ACM-managed):** `CLAUDE.md` —
issues are flagged here, no edits proposed.

**Snapshot caveat.** Five agents were editing this repo during the audit.
`ui/src/lib/digest/StorylinesCast.svelte`, `ui/src/lib/db/roundInsights.ts`,
`ui/src/lib/digest/DigestInsights.svelte`, `ui/src/lib/db/guesserInsights.ts` and
`ui/src/lib/digest/SectionInlineEditor.svelte` were mid-rewrite. Findings that touch those
files are marked **[in flight]** and should be re-checked when the branch settles.

---

## Status summary

| Doc | Status | Headline |
|---|---|---|
| `PSI_INDEX.md` | **CURRENT** | All 24 indexed paths exist. One coverage gap: `AGENTS.md` is unindexed. |
| `AGENTS.md` | **STALE** | Mandates `base_ref: "main"`; this repo's default branch is `master`. Index counts are 18 commits behind. |
| `docs/agent-conventions.md` | **CURRENT** | Every operational claim verified, including the prod URL. |
| `docs/dev-loop-playbook.md` | **STALE** | Two dead cross-references to a `CLAUDE.md` section that no longer exists; one self-contradiction. |
| `docs/digest-sections.md` | **CURRENT** | Schema, paths and the audio-failure claim all verified. One shape drifted today. |
| `docs/regular-types.md` | **CURRENT** | 41 types / 5 groups verified. One label mismatch against `regularStyles.ts`. |
| `docs/unicard-phases.md` | **CURRENT** | All 8 commits and all 5 named components exist. |
| `docs/WAR-TABLE.md` | **OBSOLETE (process)** | Describes orc-tower as renderer and sole writer; orc-tower is retired. |
| `docs/Music League Stats Architecture Summary.md` | **SUPERSEDED / foreign** | Documents a different project (DuckDB + Streamlit). Zero artifacts in this repo. |
| `docs/ml-competitors.md` | **CURRENT** (as dated research) | Market research, no codebase claims to falsify. |
| `docs/grouprelay-android-build-brief.md` | **CURRENT** (external spec) | Spec for `~/Projects/grouprelay`, a separate repo. |
| `docs/whatsapp-group-capture-plan.md` | **SUPERSEDED BY** `grouprelay-android-build-brief.md` | Still describes the "notifAI Relay" that GroupRelay replaced. |
| `CLAUDE.md` | flagged, read-only | Carries the same `base_ref: "main"` error as `AGENTS.md`. |

---

## 1. `AGENTS.md` — STALE (priority: steers every agent)

**Finding 1.1 — dead branch reference.** `AGENTS.md:11` instructs
`detect_changes({scope: "compare", base_ref: "main"})`.

- Evidence: `git symbolic-ref --short HEAD` → `master`. `git branch -a --list "*main*"` →
  no matches, local or remote. There is no `main` branch in this repository.
- Consequence: every agent that follows the "MUST run `detect_changes()` before committing"
  rule literally issues a comparison against a ref that does not exist. The same string is
  duplicated in `CLAUDE.md:32`.

**Finding 1.2 — index statistics are accurate but 18 commits stale.** `AGENTS.md:4` states
"9074 symbols, 14710 relationships, 300 execution flows".

- Evidence: `.gitnexus/meta.json` → `stats: {files: 1030, nodes: 9074, edges: 14710,
  processes: 300}`. The numbers match exactly, so they were true when written.
- But `meta.json.lastCommit` is `81928f2` (*"docs(plan): Storylines cast section"*,
  2026-08-05 21:23), and `git log --since` counts **18 commits** between that and current
  `HEAD` (`fe3bb42`). `indexedAt` is 2026-08-05 21:25.
- Consequence: the prose reads as a present-tense description of the tree. It describes the
  tree as of eight days ago — including none of the Guesser/Storylines work. The doc's own
  staleness remedy (`node .gitnexus/run.cjs analyze`) is valid: `.gitnexus/run.cjs` exists.

**Finding 1.3 — undocumented skills.** `AGENTS.md:35-42` tabulates six gitnexus skill files.
All six exist under `.claude/skills/gitnexus/`. Three further gitnexus skills are available
in-session but appear in no table: `gitnexus-pdg-query`, `gitnexus-taint-analysis`,
`gitnexus-pr-review`. Present-but-undocumented; low severity.

**Finding 1.4 — not a defect, but worth recording.** The gitnexus MCP server that
`AGENTS.md` depends on is **not** in the repo's `.mcp.json` (which registers `github`,
`context7`, `playwright`, `music-league`). It is registered at user scope in
`~/.claude.json` alongside `deal-desk` and `tela`. So the mandate is satisfiable, but only
on a machine with that user-level config — the dependency is machine-local and invisible to
anyone cloning the repo. `PSI_INDEX.md` does not record it. I checked this before writing it
up precisely because "the tool is missing" would have been the wrong conclusion.

**Finding 1.5 — file is untracked.** `AGENTS.md` appears under `??` in `git status`. A file
whose entire purpose is to steer agents is not under version control, so its rules cannot be
reviewed in a diff.

---

## 2. `PSI_INDEX.md` — CURRENT (clean result)

Every one of the 24 indexed paths exists on disk. Verified individually:
`.claude/skills/musicleague-cli`, `docs/agent-conventions.md`, `docs/dev-loop-playbook.md`,
`mcp-server`, `my-agent`, `tools`, `musicleague/agent-harness`, `.env`, `README.md`,
`QUICKSTART.md`, `roadmap.md`, `.orc-tower`, `.claude/worktrees`, `.superpowers`,
`.remember`, `.design-sync`, `.playwright-cli`, `.acm/overlay/.mcp.json`, plus the deploy
surface named in the Notes (`.mcp.json`, `.claude/settings.json`, `.claude/skills/drawio/`,
`.claude/agents/example-reviewer.md`).

**Finding 2.1 — self-described cleanup still pending, and the doc is honest about it.**
`PSI_INDEX.md:19` marks `.orc-tower` SUPERFLUOUS/"Pending removal" and `:30` says the dead
orc-tower Stop hook in `settings.local.json` should be removed "when convenient". Both are
still there: the directory exists, and `.claude/settings.local.json:41` still runs
`$HOME/.orc-tower/hooks/agent-stopped.sh music-league-bot planner`. This is an accurate doc
describing un-actioned work, not an inaccurate doc.

**Finding 2.2 — coverage gap.** `AGENTS.md` is a root-level, project-scoped, agent-steering
file and has no PSI row. Given the index's stated rule ("Every row MUST state why the item is
necessary"), an unindexed steering file is the gap most likely to propagate: nothing explains
why it exists, and §1 shows it is wrong in at least one instruction.

**Finding 2.3 — minor.** `.design-sync` is indexed and present, but an untracked
`.design-sync-archive/` also exists at the root with no row. Cosmetic.

---

## 3. `docs/agent-conventions.md` — CURRENT (clean result, one correction to folklore)

Verified claim by claim:

| Claim | Line | Evidence |
|---|---|---|
| `docker compose build bot-ui` names a real service | 49 | `docker-compose.yml` services: `bot`, `api`, `bot-ui`, `digest-static` |
| Smoke `mlb37.mattmariani.com` (→ `192.168.4.217:3002`) | 51 | `curl` → **HTTP 200**, `<title>Mash League · music-league-bot</title>`; `192.168.4.217:3002` → 200 |
| `npm run check` exists | 39 | `ui/package.json` → `"check": "svelte-kit sync && svelte-check …"` |
| App images `FROM music-league-bot-base:chromium` | 88 | `Dockerfile:3` and `Dockerfile.ui:35` (runtime stage) both do. `Dockerfile.ui:2` builder stage is `node:22-bookworm-slim` — the claim is about final images and holds |
| Base image exists | 92 | `docker images` → `music-league-bot-base:chromium` present |
| Push threshold 10 | 10 | Operative; local is currently **8** ahead of `origin/master`, i.e. below the threshold |

**Finding 3.1 — the prod URL in the docs is right; the folklore is wrong.** Three in-scope
docs say the prod host is `mlb37.mattmariani.com` (`agent-conventions.md:51`,
`dev-loop-playbook.md:110`, `unicard-phases.md:53`). Several *coordination* docs say
`mlbot2.mattmariani.com` (`docs/coordination/sprint-29.md:87`, `sprint-30.md:86`,
`sprint-35.md:77`). Live check settles it:

```
mlb37.mattmariani.com  → 200
mlbot2.mattmariani.com → 000 (no response)
mlb.mattmariani.com    → 000 (no response)
```

`.env:36` also sets `PUBLIC_APP_BASE_URL=mlb37.mattmariani.com`, with a comment declaring
that env var the single place to change the subdomain. **The in-scope docs are accurate.**
The `mlbot2` references are historical sprint logs; anything (or anyone) currently asserting
`mlbot2` is prod is wrong. Flagging explicitly because this contradicted a stored assumption
I held going in, and the live check — not the doc count — is what decided it.

---

## 4. `docs/dev-loop-playbook.md` — STALE

**Finding 4.1 — dead cross-reference, twice.** `dev-loop-playbook.md:5` — "Canonical
operational summary lives in `CLAUDE.md` → Deploy" — and `:121` — "Drop `--no-cache` (done —
see CLAUDE.md)".

- Evidence: `CLAUDE.md` headings are `# CLAUDE.md`, `## Project-Scoped Items`,
  `## Working Conventions`, `# GitNexus — Code Intelligence`, `## Always Do`, `## Never Do`,
  `## Resources`, `## CLI`. **There is no Deploy section**, and no deploy content at all —
  ACM adoption moved it into `docs/agent-conventions.md` (which `PSI_INDEX.md:8` confirms was
  the point of that file).
- Consequence: the playbook points at `CLAUDE.md` as canonical for deploy; the actual
  canonical text is `docs/agent-conventions.md`, i.e. the reader is sent to the wrong file.

**Finding 4.2 — internal contradiction.** `dev-loop-playbook.md:8-11` announces orc-tower is
retired and lanes self-coordinate. `:140`, the last line of the doc, still describes "one
orc-gated wave-gate deploy". `:118` also assigns follow-up work to "owner: viz", a lane role
from the orc-tower era.

**Finding 4.3 — accurate.** The inner/outer loop recipes, the `DATA_DIR` copy-the-DB rule,
the bundle-grep post-deploy assertion, and the smoke URL are all consistent with
`agent-conventions.md` and with the running system.

---

## 5. `docs/WAR-TABLE.md` — OBSOLETE as process, useful as history

**Finding 5.1 — the doc's central mechanism is retired.** `WAR-TABLE.md:3` — "live in **repo
files** that orc-tower parses and renders" — and `:50` — "**Orc only** writes the war table".

- Contradicted by `PSI_INDEX.md:19` ("orc-tower retired (P10 sunset)… Pending removal") and
  `docs/agent-conventions.md:15` ("orc-tower is retired — ignore the 'orc gates the deploy' /
  coord-doc language below") and `docs/dev-loop-playbook.md:8`.
- Consequence: an agent reading `WAR-TABLE.md` is told not to write `roadmap.md` /
  `campaigns.md` because Orc owns them. Orc no longer exists, so those files now have **no**
  writer. That is the mechanism behind 5.2.

**Finding 5.2 — the war table is unreconciled, exactly as 5.1 predicts.**

- `WAR-TABLE.md:64`: "the next sprint number = highest existing `docs/coordination/sprint-*.md`
  + 1 (currently → 39+)". Actual highest coord-doc is **sprint-46**
  (`sprint-40-cost-dashboard` … `sprint-46-archive-pipeline` all exist).
- `campaigns.md` was last committed **2026-06-19** (`9d44411`), while sprints 40–46 ran
  after it. Its rule at `:73-74` ("every closed coord-doc's sprint id must appear in exactly
  one campaign's `sprints[]`"; "every campaign whose sprints all shipped must be
  `signedOff: true`") has therefore not been applied for ~2 months.
- `roadmap.md` stage counts today: 32 `idea`, 17 `analyzed`, 5 `planned`, 16 `shipped`.
- `WAR-TABLE.md:5` honestly dates itself "Last full reconciliation: **2026-06-17**", so the
  doc is not lying — it is describing a process that stopped.

**Finding 5.3 — its own rule is violated in `campaigns.md`.** `WAR-TABLE.md:65-68` says a
proposed sprint must carry a non-numbered placeholder id until it executes. `campaigns.md:298-301`
lists `sprint-43-pipeline-core`, `sprint-44-covers-ab-review`, `sprint-45-pipeline-config-ui`,
`sprint-46-archive-pipeline` as numbered ids. Those sprints did subsequently run, so the
outcome was fine — but the ids were numbered ahead of execution, which is the exact failure
mode the rule exists to prevent.

**Recommendation:** keep as history, retitle to mark the process defunct, or rewrite around
whoever now owns `roadmap.md`. Do not leave it reading as live process.

---

## 6. `docs/digest-sections.md` — CURRENT (strongest doc audited)

Every falsifiable claim checked out:

| Claim | Line | Evidence |
|---|---|---|
| Seven kinds are the whole CHECK constraint | 10-12 | `CHECK(kind IN ('podium','villain','flow','consensus','quotes','chat','storylines'))` — exactly 7, and `select kind, count(*)` returns only those |
| Phrase hangs off `digest_drafts.stats_content_json` | 68 | Column exists in `pragma_table_info('digest_drafts')` |
| Media served by `handle /_media/*` in `Caddyfile.digest` | 88-89 | `Caddyfile.digest:44` |
| Miner lives at `~/Projects/sssc-chat-regulars/scripts/mine_verbal_tics.py` | 138 | File exists |
| `PhraseOfRound` in `ui/src/lib/db/roundInsights.ts` | 71 | Type exists **[in flight]** — Repaula is rewriting this file for the Coinage redesign |
| *"the `sintel` audio jobs have failed since 2026-08-01"* | 29-30 | **Verified precisely.** `song_metadata_queue`: `audio\|done\|725` with last success `2026-08-01T00:54:18Z`; `audio\|failed\|44`, most recent `2026-08-13T06:40:28Z`. Last `song_audio_features.analyzed_at` is also `2026-08-01T00:54:18Z` |

**Finding 6.1 — one shape drifted today. [in flight]** `digest-sections.md:113` documents
`StorylineCastMember` with a `"headline"` field. As of this afternoon,
`ui/src/lib/digest/regularStyles.ts:199` normalizes to `note: str(m.note) || str(m.headline)`
— `note` is the field, `headline` survives only as a backwards-compatibility fallback for
pre-redesign rows. The doc should say `note`, and mention the fallback.

**Finding 6.2 — unverifiable right now. [in flight]** `digest-sections.md:126` — "Panels
render open when the cast is three or fewer." `StorylinesCast.svelte` currently has
`const n = $derived(cast.length)` (line 73) but no `<= 3` open logic; the file is being
rewritten by Codera 1 around the style shelf. Re-check after the rewrite lands rather than
treating this as a defect now.

---

## 7. `docs/regular-types.md` — CURRENT, with one concrete mismatch

Verified: 41 types across 5 groups (46 table rows minus 5 header rows), matching the doc's
own framing. Both cited sources exist —
`~/Projects/sssc-chat-regulars/scripts/mine_verbal_tics.py` and
`ui/src/lib/digest/storylineSeeds.ts`.

**Finding 7.1 — label mismatch that silently degrades a layout.** `regular-types.md:29` names
the type **"Phonetic/cutesy speller"**. `ui/src/lib/digest/regularStyles.ts:36` keys the
style map on **`'phonetic speller'`** (no `/cutesy`). `resolveStyle()` looks up
`TYPE_TO_STYLE[e.type.trim().toLowerCase()]`, an exact-string match.

- Failure: a generator or human that copies the taxonomy label verbatim gets no hit, and the
  entry silently renders as `quote-led` instead of `roster-map`. No error, no warning — the
  same silent-degradation class as the `headline` regression Reviewella caught.
- Fix is one string in either file; they must agree.

**Finding 7.2 — three documented types have no style mapping.** `Coiner` (`:23`), `Formatter`
(`:27`) and `Punster` (`:30`) are absent from `TYPE_TO_STYLE`. For `Formatter`/`Punster` that
is by design (the handoff's "everything else → `quote-led`"). `Coiner` is different: the
design routes it to `style: dictionary` in the **Coinage** section, which is not part of the
Regulars registry — so a `type: Coiner` cast entry resolves to `quote-led`. Worth one line in
the doc so nobody reads the omission as a bug.

---

## 8. `docs/unicard-phases.md` — CURRENT (clean result)

All 8 referenced commits resolve (`git cat-file -t`): `3ed3017`, `314b9de`, `e2df06d`,
`2061656`, `3647862`, `e9d3496`, `19994f5`, `1108b4e`. All 5 named components exist:
`ui/src/lib/song/{SongCard,SongList,SongSheet,SongCompare,Rating}.svelte`. `bside/` exists,
as the deferred Phase 4-B-side row assumes. Smoke URL (`:53`) verified live.

**Finding 8.1 — imprecise path (cosmetic).** `SongSearchCard` (`:26`) lives at
`ui/src/lib/components/SongSearchCard.svelte`, not under `ui/src/lib/song/` where the doc's
other components sit. The doc never states a path, so this is a reader-inference hazard only.

---

## 9. `docs/Music League Stats Architecture Summary.md` — foreign document

This 161-line doc describes a **different project**: DuckDB + Streamlit + `uv` + pandas +
seaborn, ingesting `export.zip` CSVs into `bwi.duckdb` ("🎵Brian Wilson Invitational Stats").

- Evidence of non-membership: none of `builddb.py`, `main.py`, `leaderboard.py`,
  `builddb.sh`, `streamlit.sh` exist anywhere in the repo. `grep -rl duckdb` over all
  `.ts`/`.py`/`.json` → **zero hits**. `grep -rl streamlit` over the whole repo → **one hit:
  this document itself.** This codebase is TypeScript/SvelteKit on sqlite.
- Its §"Prompting Guide for an AI Agent" (`:133-162`) instructs an agent to build with
  DuckDB/Streamlit/uv and to follow a CSV-derived schema
  (`competitors(ID, Name)`, `votes(Voter ID, …)`) that is not this project's schema.
- Risk: an agent that reads `docs/` broadly could take that prompting guide as house style.
  It is the only doc in scope that could actively mislead an agent into writing wrong-stack code.
- **Recommendation:** move to `docs/archive/` or add a one-line header stating it documents
  an external reference project. Do not delete blind — it reads like deliberately captured
  prior art.

---

## 10. `docs/whatsapp-group-capture-plan.md` — SUPERSEDED (partially)

The doc is built around the "**notifAI** Relay" and "notifAI backend" (7 occurrences, incl.
`:1-14` architecture and the `onNotificationPosted` / `_process_relay_notification` diffs it
offers). The relay that actually runs is **GroupRelay**, a standalone app specified by
`docs/grouprelay-android-build-brief.md` (2026-06-20, one day after this plan) and living in
its own repo at `~/Projects/grouprelay`. The brief's own framing at `:3` — "a **new,
standalone Android app**. Do not assume or reuse any other project" — is an explicit break
from notifAI.

- Still accurate and valuable: the watcher-account rationale (§1), the export-format
  requirements, the historical-backfill approach (§9), and the Google Chat API-vs-relay
  comparison (§10, `:594-607`).
- Still accurate in this repo: the webhook endpoint. `src/api/server.ts:193` handles
  `POST /webhooks/relay`, and `docker-compose.yml` publishes `3001:3001` for `api` — matching
  the documented `…:3001/webhooks/relay`.
- **Recommendation:** header note — "the relay implementation described here (notifAI) was
  superseded by GroupRelay; see `grouprelay-android-build-brief.md`. The capture strategy
  below still stands."

---

## 11. `docs/grouprelay-android-build-brief.md` — CURRENT (external spec)

A self-contained build spec for a separate Android repo; nothing in it asserts anything about
*this* codebase, so there is little to falsify from here. `~/Projects/grouprelay` exists,
consistent with the brief having been executed. Its one integration point with this repo —
POSTing to the relay webhook — is live (`src/api/server.ts:193`). Keep as-is.

---

## 12. `docs/ml-competitors.md` — CURRENT (as dated research)

1,693 lines of competitive research, self-dated "**Research date:** July 19, 2026"
(`:3`), covering Music League, Mixtape Hero, BandJam, YapZap, CutClub. It makes claims about
third-party products, not about this codebase, so there is nothing here to verify against the
tree. Properly dated, which is what makes it safe to keep. No findings.

---

## 13. `CLAUDE.md` — flagged, read-only (ACM-managed)

Not edited, per instruction. Two things for whoever owns the golden set:

- **13.1** — `CLAUDE.md:32` carries the same `base_ref: "main"` error as `AGENTS.md:11`; the
  default branch is `master`. Since this text is deployed from the ACM golden set, the fix
  belongs there, and it will be wrong in every project whose default branch is `master`.
- **13.2** — `CLAUDE.md:21-52` and `AGENTS.md:1-44` are the **same GitNexus block**,
  duplicated verbatim in two files with different owners (ACM vs. untracked local). They will
  drift. Pick one home.

---

## Cross-document contradictions

| # | Subject | Side A | Side B | Resolution |
|---|---|---|---|---|
| C1 | Is orc-tower live? | `WAR-TABLE.md:3,50` — orc parses/renders and is the sole writer | `PSI_INDEX.md:19`, `agent-conventions.md:15`, `dev-loop-playbook.md:8` — retired | **B.** `.orc-tower/` survives only as a machine-local leftover with a dead Stop hook |
| C2 | Where is deploy canonical? | `dev-loop-playbook.md:5` — `CLAUDE.md` → Deploy | `PSI_INDEX.md:8` — `docs/agent-conventions.md` holds the deploy rules | **B.** `CLAUDE.md` has no Deploy section |
| C3 | Prod hostname | `agent-conventions.md:51`, `dev-loop-playbook.md:110`, `unicard-phases.md:53` — `mlb37` | `docs/coordination/sprint-{29,30,35}` — `mlbot2` | **A.** `mlb37` → 200 live; `mlbot2` does not resolve |
| C4 | Taxonomy label | `regular-types.md:29` — "Phonetic/cutesy speller" | `regularStyles.ts:36` — `'phonetic speller'` | Unresolved — they must be made to agree |
| C5 | Cast entry field | `digest-sections.md:113` — `headline` | `regularStyles.ts:199` — `note`, headline as fallback | **B**, as of today |
| C6 | Relay implementation | `whatsapp-group-capture-plan.md` — notifAI Relay | `grouprelay-android-build-brief.md:3` — standalone GroupRelay, reuse nothing | **B** |

---

## Documented-but-absent / present-but-undocumented

**Documented but absent:** nothing material. Every file, table, column, script, container,
npm script and route named in the in-scope docs exists, with the single exception of the
foreign DuckDB/Streamlit stack in §9 — which was never meant to be here.

**Present but undocumented:**

- `AGENTS.md` — steers agents, indexed nowhere, untracked (§1.5, §2.2).
- `bside/` — exists at the root; referenced only as future work in `unicard-phases.md:40-43`.
- `extension/` — a browser extension with its own README and manifest pointing at
  `mlb37.mattmariani.com`; no doc in scope mentions it.
- `docs/audits/` — created by this audit.
- Three gitnexus skills present but not in the CLI table (§1.3).

---

## The `rounds.phase` question — checked, and it is not in my scope

The brief cited `rounds.phase` being described as meaningful while actually dead. I checked
and could not reproduce that in any in-scope doc: `grep -n "phase"` across
`agent-conventions.md`, `dev-loop-playbook.md`, `digest-sections.md`, `WAR-TABLE.md`,
`unicard-phases.md`, `PSI_INDEX.md` and `AGENTS.md` returns exactly one hit —
`WAR-TABLE.md:34`, which merely names a roadmap card (`round-phase-model-and-action-center`)
as an example of `shippedNote:` usage. That is not a claim about the column.
`docs/HIGH_LEVEL_DESIGN.md` (Codera 1's) contains **no** occurrences of "phase" either.

The underlying facts, for whoever does own the doc that says it:

- `select phase, count(*) from rounds` → `NULL: 31`, `complete: 73`, `not-started: 11`.
  **Zero** `voting` rows and zero `submission` rows.
- The write path is live regardless: `ui/src/lib/db/rounds.ts` exports `endSubmissionPhase` /
  `endVotingPhase`, and `ui/src/routes/api/rounds/[roundId]/end-submission/+server.ts:8`
  documents "Transitions stored phase: submission → voting" — a transition whose output value
  appears nowhere in the table.
- The read path is derived: `ui/src/lib/lifecycle.ts:44` `getRoundPhase()`, itself marked
  `@deprecated` in favour of `getRoundPhasesForSeason` (`:68`) because per-round evaluation
  makes every future-deadline round read as `submission` at once.

So the column is written-but-never-observed, and the honest description is "derived at read
time from the deadline window; the stored column is vestigial."

---

## Method and limits

- Paths verified with `test -e`; commits with `git cat-file -t`; schema with
  `sqlite3 data/league.db`; containers with `docker images` / `docker-compose.yml`; the live
  site with `curl` against the public host and `192.168.4.217:3002`.
- **Not verified:** the interior of `docs/ml-competitors.md` (third-party product claims,
  unfalsifiable from here) and the Android internals of the GroupRelay brief (separate repo).
- **Not audited:** `README.md`, `docs/README.md`, `docs/HIGH_LEVEL_DESIGN.md` (Codera 1), and
  the `docs/` subdirectories (`coordination/`, `design/`, `superpowers/`, `campaigns/`,
  `how-to/`, `workflows/`, `archive/`, and the handoff folders), which were outside the named
  scope. `docs/coordination/` is cited above only as evidence, not audited as docs.
- Nothing was edited or committed. This file is the only artifact.

---

## Follow-up — 2026-08-30 sanitization pass

Only the findings actually acted on are listed. Everything else in this audit stands as
written and is still unverified against the tree as of today.

| Finding | Status |
|---|---|
| 1.1 `AGENTS.md` dead branch reference (`base_ref: "main"`) | **FIXED** in `AGENTS.md` → `master`. `git branch -a --list "*main*"` still returns nothing. GitNexus regenerates the block with `"main"` (it is the tool's template default, not a local edit), so this will regress on the next block sync — a note to that effect now sits inline. |
| 1.x `AGENTS.md` stale index counts | **FIXED** — 17517/35728/1014 → 17802/36183/1015, from `analyze --index-only` at commit `f3382c7`. |
| `PSI_INDEX.md` coverage gap: `AGENTS.md` unindexed | **FIXED** — `AGENTS.md` now has a PSI row, along with `deploy/`, `design/` and `.planning/spikes/`. |
| `CLAUDE.md` carries the same two defects | **NOT FIXED — deliberately.** `CLAUDE.md` is ACM-managed and says so in its own first line; the fix belongs in the ACM golden set, not here. See the ownership conflict below. |

**Unresolved: two systems both claim `CLAUDE.md`.** ACM's golden set manages the file
(`PSI_INDEX.md` deploy-surface note), while GitNexus injects and regenerates a
`<!-- gitnexus:start -->` block *inside* it — which is how the `base_ref: "main"` error got
in and why commit `5206f71` had to hand-sync the block in both files. Until one owner wins,
`CLAUDE.md` will keep drifting from `AGENTS.md`. Worth deciding, not worth patching around.

**New finding — the GitNexus MCP server is unusable, and the mandate depends on it.**
Every `mcp__gitnexus__*` call fails with `Database file version: 43, Current build storage
version: 42`. Cause: two different npx caches. The analyzer behind `.gitnexus/run.cjs` is
**1.6.10** (`_npx/e46929201c1128dd`, writes storage v43); the running MCP server process is
**1.6.9** (`_npx/5e786f48223a616c`, reads v42).

**Correction:** an earlier revision of this note said restarting the MCP server or Claude
Code would clear it. **It will not.** `~/.claude.json` pins the server to an absolute path
inside the 1.6.9 npx cache:

```json
"gitnexus": { "command": "~/.npm/_npx/5e786f48223a616c/node_modules/.bin/gitnexus", "args": ["mcp"] }
```

so every restart relaunches the same 1.6.9 binary. The pin is the bug, not the uptime. The
fix is to repoint that `command`. Note that both candidates today are npx cache directories,
which npm garbage-collects — pinning to one is why this broke. `gitnexus` is on neither PATH
nor the global npm root, so a stable install (`npm i -g gitnexus`, already the documented
workaround for the npm 11 npx crash, #1939) is the durable target.

Until then the CLI fallback documented in `AGENTS.md` is the only working path — it is what
the impact and detect-changes analysis in this pass actually ran on.

**Related, and the reason this surfaced:** GitNexus runs constantly. `~/.claude/settings.json`
wires the hook to `PreToolUse` on `Grep|Glob|Bash` and `PostToolUse` on `Bash`, and the
PreToolUse path spawns a `gitnexus augment` child process per matching call. Separately,
each Claude session starts its own MCP server and none are reaped: 8 were alive at the time
of writing, the oldest up 4 days, ~290 MB RSS combined — all of them non-functional against
a v43 index.
