# Survey → bot round sync (interim) — design

Date: 2026-10-05 · Status: approved by Matt in chat ("spec and plan — green to build")

## Why

Seasons and rounds for Boarz S2 and Second Best S3 are authored in the mlsurvey admin
(`~/Projects/boarz-season-2-survey`), which pushes them to Music League. The bot never
reads that admin: its "Leagues & Seasons" and "Round management" panels only show the
bot's own `seasons`/`rounds` rows, which arrive from the ML export *after* a round
completes. New seasons therefore have zero rounds in the bot during round 1, and
theme credit / comment rules are retyped by hand or never present.

This is the **interim** fix. The true fix — folding mlsurvey into mlbot — is a separate
later project (portal piece 4). Season setup happens about once a year per league, so
this stays deliberately small.

## Decisions (from Matt)

- One-way sync, survey admin → bot. Bot never edits survey-managed fields (read-only).
- Unrevealed rounds keep their **teaser** title/description in the bot until reveal.
- Rosters stay out of scope (players still come from ML export/standings).
- Approach A: bot-ui reads the survey's `data/` dir via a read-only bind mount.

## Source data (read-only, survey's `data/`)

Per league (mirrors `LEAGUES` in the survey's `scripts/ml-sync-worker.mjs`):

| survey prefix | bot slug | files |
| --- | --- | --- |
| `""` | `boarz-ii-men` | `ml-link.json`, `ml-sync-state.json`, `draft-season.json`, `published-season.json`, `submissions.json` |
| `second-best-` | `second-best` | same with prefix; submissions = `second-best-season-3-submissions.json` |

- `*ml-link.json` → `leagueId` (ML league id). Missing/null leagueId → skip league.
- `*draft-season.json` → `season` (season number). Rounds = published rounds if any, else draft (same rule as the survey's `sourceRounds`).
- `*ml-sync-state.json` → `lastRounds[]`: the ML `rounds themes` snapshot written by the worker: `{league_id, id, number, name, description, submissions_due_utc, votes_due_utc, status}`. This is what ML *shows*, so unrevealed rounds carry teasers. `league_id` must equal the link's `leagueId`, else the snapshot is for another league → skip.
- Submissions → theme credit: a round's `links[].themeId` map to a submission's `voterName` via the survey's `themeId()` hash (`sha256(submission.id||voterName | index | title | description||themeSuggestions)`, first 20 hex). `mlbot` → Admins (no player).

## What the sync writes

**Season** (`seasons`): upsert `(league_id, season_number)`; set `source_competition_id` = ML league id, `managed_by='survey'`. Never changes `status`.

**Round** (`rounds`), keyed by `ml_round_id` = snapshot `id`:
- Always (from ML snapshot): `season_id`, `round_number`, `name`, `description`, `submission_deadline`, `voting_deadline`, `managed_by='survey'`. `created_at` only on insert.
- Only when the matched survey round (by `position == number`) is **revealed** (`reveal` null or `reveal.at <= now`):
  - `theme_submitted_by` = first credited name that matches a bot player (case/whitespace-insensitive against `players.name`, then `player_identities.identifier`). Admins/unmatched → NULL; unmatched names reported as warnings.
  - `comment_level` (`none|suggested|required`), `comment_visibility`, `comment_prompt` from `commentRequirement`.
- Unrevealed: credit and comment fields are left NULL (never leak).
- Never deletes rounds; rounds missing from a snapshot are left alone.
- One transaction per league.

**Status**: last run per league (time, rounds synced, warnings, error) in `settings` key `survey_sync_status` (JSON).

## Schema additions (client.ts migrations, idempotent)

- `rounds.managed_by TEXT`, `rounds.comment_level TEXT`, `rounds.comment_visibility TEXT`, `rounds.comment_prompt TEXT`
- `seasons.managed_by TEXT`

## Guards

- `upsertRound` (export importer) does not overwrite `name`/`description` when `managed_by IS NOT NULL` — the survey/ML copy wins.
- `PATCH /api/rounds/[roundId]` returns 409 for `name`, `theme`, `submission_deadline`, `voting_deadline`, `round_number`, `theme_submitted_by` on a managed round. `tag`, `playlist_url` and `video_playlist_config` stay editable.

## Runtime

- `startSurveySync()` from `hooks.server.ts` next to the other loops; runs at startup and every 5 min; no-op unless `SURVEY_DATA_DIR` is set; not started on the share instance.
- Settings → "Sync now" form action on `/settings/setup`.
- Missing dir or bad JSON → that league is skipped with an error in status; last good data stays.
- Worker `heartbeatAt` older than 24h → snapshot is still applied (it is still what ML last showed) but a warning says the survey worker looks down.

## UI

- Leagues & Seasons: managed season shows a "SURVEY ADMIN" chip + ML league id + last sync time / warnings.
- Round management: managed rounds render number, theme, Submitted by as read-only text, plus a comment-rule line; tag + video playlist stay editable. Panel header has "Sync now".

## Deploy

- `docker-compose.yml` bot-ui: `- ../boarz-season-2-survey/data:/app/survey-data:ro`; env `SURVEY_DATA_DIR=/app/survey-data`.
- Rebuild bot-ui per `docs/dev-loop-playbook.md`; verify both seasons show 12 / 10 rounds matching ML.
- The read file layout becomes a contract with the survey app; the survey session is told about it.

## Tests

- Parser: real-file fixtures copied from survey data; teaser round (snapshot name ≠ real title) never yields the real title or credit; multi-name credit; `mlbot` → Admins; league-id mismatch skipped.
- Applier: in-memory DB; idempotent second run; credit only after reveal; importer `upsertRound` doesn't clobber managed name; PATCH 409 on managed fields, tag still OK.
- One run against a copy of `data/league.db`.

## Out of scope

Rosters, writing back to the survey, merging the apps, the hard-coded pins in `ml-rebuild.mjs`/`ml-reconcile.mjs`.
