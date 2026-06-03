# Task: wire digest page to real DB

The digest page at `/digest/[roundId]` renders fixture data for all rounds.
Wire it to the real backend.

## +page.server.ts

Import the db client directly. On load:
1. Look up the round by id — if missing, throw error(404)
2. Check `digest_drafts` for an existing draft for this `round_id`
3. Draft exists → query `digest_sections` ordered by `position`. Return `{ roundId, draft, sections, stage: 'refine' }`
4. No draft → run prepare checks (same logic as `POST /api/digest/:roundId/prepare`, call it via internal fetch or import the logic). Return `{ roundId, checks, stage: 'prepare' }`

## +page.svelte

Remove all fixture imports. Drive everything from `data`.

Pipeline stage from `data.stage`:
- `prepare` → step 1 active: render 6 check rows (name, ok bool as ✓/!, src string). "Generate Draft" button appears when all checks pass — calls `POST /api/digest/:roundId/draft`, then `invalidateAll()`.
- `refine` → step 3 active: render `data.sections` via `DigestSection.svelte`. Keep all existing chrome (exclude/lock/regen/kebab) and `RegenModal` — replace fixture content with real `section.content_json`.
- `finalize` → step 4 active (when `draft.finalized_at` is set).

## Done criteria

`npm run check` passes. Then:
```
git add ui/src/routes/digest/ ui/src/lib/digest/
git commit -m "feat(digest): wire digest page to real DB + API (stage-driven pipeline)"
docker compose build --no-cache bot-ui && docker compose up -d bot-ui
```
Update `docs/coordination/sprint-9.md` activity log.
