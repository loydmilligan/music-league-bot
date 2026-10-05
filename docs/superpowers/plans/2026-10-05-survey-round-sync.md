# Survey → bot round sync — implementation plan

Spec: `docs/superpowers/specs/2026-10-05-survey-round-sync-design.md`
Execution: inline in a worktree off master (`feat/survey-round-sync`), TDD per task.

## Task 1 — Schema
- `ui/src/lib/db/client.ts`: idempotent `ALTER TABLE` for `rounds.managed_by`, `comment_level`, `comment_visibility`, `comment_prompt`; `seasons.managed_by`.
- `ui/src/lib/types.ts`: `Round` gains `managedBy?`, `commentLevel?`, `commentVisibility?`, `commentPrompt?`; `Season` gains `managedBy?`.
- `rounds.ts baseRow` + `leagues.ts getSeasonsForLeague` map them.
- Test: open `:memory:` DB twice → columns exist, no error.

## Task 2 — Parser (`ui/src/lib/surveySync/parse.ts`)
- `readSurveyLeague(dir, def, nowMs)` → `{ slug, mlLeagueId, seasonNumber, heartbeatAt, rounds: [{ mlRoundId, number, name, description, submissionDue, votesDue, revealed, credits: string[], comment: {level, visibility, prompt} | null }], warnings }` or `{ error }`.
- `LEAGUE_DEFS` table (prefix → slug, submissions filename).
- `themeId()` port of survey `theme-ids.js`; `mlbot` → dropped (Admins).
- Tests with fixtures in `ui/src/lib/surveySync/fixtures/` (trimmed real files): teaser round has no credits/comment; real title never appears; league-id mismatch → error; multi-credit.

## Task 3 — Applier (`ui/src/lib/surveySync/apply.ts`)
- `applySurveyLeague(db, parsed)` in one transaction: season upsert (managed_by), round upsert by `ml_round_id`, player match (players.name, then player_identities), returns `{ rounds, warnings }`.
- Tests: insert 2 rounds; rerun → no changes; reveal flips → credit/comment appear; unmatched credit → warning + NULL.

## Task 4 — Guards
- `upsertRound`: `name`/`description` keep existing when `rounds.managed_by IS NOT NULL`.
- `routes/api/rounds/[roundId]/+server.ts`: 409 on managed-field edits for managed rounds.
- Tests: importer upsert doesn't clobber; PATCH tag ok / name 409 (call the handler with a mocked db via existing test patterns, or unit-test an exported `managedFieldViolation(body)` helper).

## Task 5 — Runner + wiring
- `ui/src/lib/surveySync/runner.ts`: `runSurveySync(db, dir, now)` over all LEAGUE_DEFS, writes `settings.survey_sync_status`; `startSurveySync()` (startup + 5 min interval, env-gated).
- `hooks.server.ts`: call alongside other loops.
- `/settings/setup` `+page.server.ts`: action `surveySync`; load returns `surveySyncStatus`.

## Task 6 — UI
- Leagues & Seasons: SURVEY ADMIN chip, ML league id, last sync/warnings, "Sync now" button.
- Round management (desktop + mobile): managed rounds read-only (number, theme, submitted-by name) + comment-rule line; tag/video editable.

## Task 7 — Verify + deploy
- `npm test` (surveySync + rounds + api tests), `npm run check`.
- Dry run against a copy of `data/league.db` with real survey dir: expect boarz-ii-men S2 = 12 rounds, second-best S3 = 10, teasers for SB R6/R10.
- docker-compose mount + env, rebuild bot-ui per playbook, confirm in prod DB + page.
- Notify survey session (peer) that its data-file layout is now read by the bot.
