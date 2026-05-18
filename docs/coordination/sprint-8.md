---
project: music-league-bot
sprint: sprint-8
status: active
created: 2026-05-18T00:00:00.000Z
updated: 2026-05-18T00:00:00.000Z
---

# music-league-bot — coordination doc (sprint-8)

> Strict template per Session O2=B / seed §12 Phase 8. Same conventions as
> sprint-1 through sprint-5.

## Plan Source

- Type: external
- Path: `docs/superpowers/plans/2026-05-17-chat-watcher.md`
- Active unit: sprint-8

## Sprint Goals

- Add `/chat` route showing songs auto-captured from WhatsApp group chats.
- Per-mention context (message + 3 prior messages), intent classification,
  smart round auto-assignment, manual assign/shortlist/dismiss actions.
- Bot-side ingestion buffers recent messages per chat and writes chat_songs/
  chat_mentions/chat_assignments to league.db on each URL capture.

## Active Initiatives

- _None — sprint-8 is execution of the chat watcher plan. See plan source._

## Active Sprint Plan

<!-- Wave structure derived from the implementation plan:

     Wave 1 (parallel):
       backend: Task 1 (DB schema) + Task 2 (DB module) + Task 3 (DB tests)
       frontend: Task 4 (CSS — copy from handoff reference, update shortlist.css + app.css)

     Wave 2 (frontend after Wave 1 schema; backend Tasks 10-13 also start in Wave 2):
       frontend: Task 5 (CwFilterBar) + Task 6 (CwRow) + Task 7 (chat page + loader)
                 + Task 8 (API routes) + Task 9 (AssignPopover updates + layout nav)
       backend: Task 10 (chatDb.ts) + Task 11 (intentClassifier.ts)
                + Task 12 (WhatsApp client buffer) + Task 13 (handler.ts integration)

     After each agent completes their tasks: push + docker compose build --no-cache bot-ui && docker compose up -d bot-ui

     Visual reference for all component work:
       docs/chatmention-proto/Mash Co. Design System (1)/chat-watcher-handoff/reference/Music League Bot - Chat Watcher.html
-->

- [x] {agent: backend, id: chat-db-schema} Task 1: Add chat_songs, chat_mentions, chat_assignments schema to `ui/src/lib/db/schema.ts`
  - **Acceptance:** Per plan Task 1. Vitest db tests still pass after schema change.

- [x] {agent: backend, id: chat-db-module} Task 2: Create `ui/src/lib/chat/chat.ts` DB module
  - **Acceptance:** Per plan Task 2. All exports from plan present.

- [x] {agent: backend, id: chat-db-tests} Task 3: Create `ui/src/lib/chat/chat.test.ts`
  - **Acceptance:** Per plan Task 3. All tests pass.

- [x] {agent: frontend, id: chat-css} Task 4: Copy chat CSS from handoff, update shortlist.css + app.css
  - **Acceptance:** Per plan Task 4.

- [x] {agent: frontend, id: chat-filter-bar} Task 5: Create CwFilterBar.svelte
  - **Acceptance:** Per plan Task 5.

- [x] {agent: frontend, id: chat-row} Task 6: Create CwRow.svelte
  - **Acceptance:** Per plan Task 6.

- [x] {agent: frontend, id: chat-page} Task 7: Create `/chat` page shell + loader
  - **Acceptance:** Per plan Task 7.

- [x] {agent: frontend, id: chat-api-routes} Task 8: Add API routes (GET /api/chat/songs, dismiss, shortlist, assign)
  - **Acceptance:** Per plan Task 8.

- [x] {agent: frontend, id: chat-assign-popover} Task 9: Update AssignPopover + layout nav
  - **Acceptance:** Per plan Task 9.

- [x] {agent: backend, id: chat-bot-storage} Task 10: Create `src/storage/chatDb.ts`
  - **Acceptance:** Per plan Task 10.

- [x] {agent: backend, id: chat-intent-classifier} Task 11: Create `src/bot/intentClassifier.ts`
  - **Acceptance:** Per plan Task 11.

- [x] {agent: backend, id: chat-whatsapp-buffer} Task 12: Add per-chat message buffer to `src/whatsapp/client.ts`
  - **Acceptance:** Per plan Task 12.

- [x] {agent: backend, id: chat-handler-integration} Task 13: Wire `insertChatCapture()` in `src/bot/handler.ts`
  - **Acceptance:** Per plan Task 13.

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | `ui/src/lib/chat/chat.ts`, `ui/src/lib/chat/chat.test.ts`, `ui/src/lib/db/schema.ts`, `src/storage/chatDb.ts`, `src/bot/intentClassifier.ts`, `src/whatsapp/client.ts`, `src/bot/handler.ts` | `ui/src/routes/**/*.svelte`, `ui/src/lib/chat/CwFilterBar.svelte`, `ui/src/lib/chat/CwRow.svelte` |
| frontend | `ui/src/lib/chat/chat.css`, `ui/src/lib/chat/CwFilterBar.svelte`, `ui/src/lib/chat/CwRow.svelte`, `ui/src/routes/chat/**`, `ui/src/routes/api/chat/**`, `ui/src/lib/shortlist/AssignPopover.svelte`, `ui/src/lib/shortlist/ShortlistRow.svelte`, `ui/src/routes/+layout.svelte`, `ui/src/lib/shortlist/shortlist.css`, `ui/src/app.css` | `src/bot/**`, `src/storage/**`, `src/whatsapp/**` |

- **backend** — Tasks 1, 2, 3 (Wave 1 DB foundation) + Tasks 10-13 (Wave 2 bot-side).
- **frontend** — Task 4 (Wave 1 CSS) + Tasks 5-9 (Wave 2 UI components + API routes).

## Decision Log

- **D1**: Wave 1 backend (schema + DB module + tests) and Wave 1 frontend (CSS only) run in parallel; frontend UI work (Tasks 5-9) starts after schema lands so svelte-check can verify imports.
- **D2**: Bot-side work (Tasks 10-13) is independent of UI and runs in parallel with Wave 2 frontend.
- **D3**: All agents deploy to prod (mlb.mattmariani.com) via `docker compose build --no-cache bot-ui && docker compose up -d bot-ui` from `/home/loydmilligan/Projects/music-league-bot` after completing their task set.

## Blockers

_None at sprint start._

## Activity Log

### 2026-05-18 — orc — sprint kick-off
- Sprint-8 activated. Chat watcher feature. Plan source: `docs/superpowers/plans/2026-05-17-chat-watcher.md`.
- Backend agent (pane 1.3): Wave 1 — Tasks 1+2+3.
- Frontend agent (pane 1.4): Wave 1 — Task 4 (CSS). Then Wave 2 — Tasks 5-9.
- Backend agent Wave 2 (Tasks 10-13) starts after schema lands (after Task 1 committed).

### 2026-05-18 — backend — Wave 1 + Wave 2 complete
- Task 1: schema for chat_songs/chat_mentions/chat_assignments added (b7b8e02).
- Task 2: `ui/src/lib/chat/chat.ts` DB module (84674bb).
- Task 3: `ui/src/lib/chat/chat.test.ts` — 10/10 tests pass (3ea2376).
- Task 11: `src/bot/intentClassifier.ts` (4da3044).
- Task 10: `src/storage/chatDb.ts` with auto-assign + intent (55f3215).
- Task 12: WhatsApp message buffer + chatName/capturedAt/priorMessages on WhatsAppMessage (3879232). Updated tests/handler.test.ts mock to include new fields.
- Task 13: `insertChatCapture()` wired into both Songlink + Spotify branches of `handleAutoCapture` (dead2ff). Note: ResolvedTrack lacks albumArtUrl/year so both are passed as null until those fields are added upstream.
- tsc --noEmit clean. Ready to deploy bot-ui.
