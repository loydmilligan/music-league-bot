# NOTES-AMA.md — OpenCode AMA redesign + favorite-answer poll

## Design

Reddit-inspired AMA section (`ui/src/lib/digest2/AmaSection.svelte`):

- **Orange-red header band**: linear-gradient (red → orange → amber) with white title and subtitle
- **AMA threads**: each prompt rendered as a Reddit-style card with:
  - Red flair badge ("AMA") + metadata (askedBy · when)
  - Gold question heading
  - Answer list with colored initial avatars (hash-based color from name), answer body, and upvote buttons
- **Favorite-answer poll**: integrated into each answer row as an upvote arrow button with live count
- **Dark theme**: uses the existing design system tokens where possible, with hardcoded dark fallbacks
- **390px responsive**: tested at mobile viewport; flexbox layout adapts naturally

## Files

| File | Change |
|---|---|
| `ui/src/lib/digest2/AmaSection.svelte` | Full redesign: Reddit-style cards, upvote buttons, live tally |
| `ui/src/lib/digest2/amaVote.test.ts` | **New.** 4 tests: insert, uniqueness, multi-prompt, round filtering |
| `ui/src/routes/api/digest2/[roundId]/ama-vote/+server.ts` | **New.** GET (tally) + POST (cast/change vote) |
| `ui/src/lib/db/client.ts` | Added `ama_votes` table migration (lines 710-722) |
| `ui/src/routes/digest2/[roundId]/+page.svelte` | Pass `snapshot` + `roundId` props to AmaSection |

## Storage (ama_votes)

- **Table**: `ama_votes(id, round_id, prompt_index, answer_index, voter_id, voted_at)`
- **Uniqueness**: `UNIQUE(round_id, prompt_index, voter_id)` — one vote per reader per prompt
- **Upsert**: `ON CONFLICT DO UPDATE` allows changing your vote without double-counting
- **Migration**: additive `CREATE TABLE IF NOT EXISTS` in `client.ts:openLeagueDb()`, follows existing PRAGMA/ALTER pattern

## Endpoint

**`/api/digest2/[roundId]/ama-vote`**

- **GET** `?voter_id=xxx` → `{ myVotes, results }`
  - `myVotes`: `{ prompt_index → answer_index }` for the requesting reader
  - `results`: `{ prompt_index → { answer_index → count } }` for tallies
- **POST** `{ voter_id, prompt_index, answer_index }` → `{ myVote, results, voter_id }`
  - Auto-generates UUID if voter_id is short (new reader)
  - Returns the stable voter_id for the client to persist

## Identity

**Per-device token (localStorage)** — no PII, no accounts, no cookies:

1. On first visit, `crypto.randomUUID()` generates a token
2. Stored in `localStorage` key `ama_voter_id`
3. Sent with every vote request as `voter_id`
4. Server treats short IDs as "generate new"; long UUIDs are stored as-is

The /d2/ share identity system does not exist in this codebase, so per-device token is the right approach.

## Live vs tallied

**Live** — each vote POST returns the updated tally for that prompt, and the client updates the UI immediately. No polling needed. A GET `/ama-vote?voter_id=xxx` on page load fetches the initial state.

## Privacy + abuse

- **Stored**: round_id, prompt_index, answer_index, voter_id (random UUID), voted_at (timestamp). No IP, no name, no email, no PII.
- **Rate limiting**: None built-in. A determined cheater could generate multiple UUIDs and vote multiple times. For production, add: IP-based rate limiting, cookie validation, or a server-side nonce challenge. The current design is adequate for a private group digest shared with ~12 people.
- **No deletion**: Votes are never deleted, only updated. No "remove vote" flow (you can change it, not erase it).

## How to test

```bash
# Start preview (leave running)
cd ui && DATA_DIR=$HOME/.local/state/boarz-lanes/preview/ama-data \
  npx vite dev --config $HOME/.local/state/boarz-lanes/preview/vite.ama.config.mts \
  --host 100.124.57.61 --port 8797 --strictPort

# Unit tests
cd ui && npx vitest run src/lib/digest2/amaVote.test.ts

# Manual vote test
curl -X POST http://100.124.57.61:8797/api/digest2/168/ama-vote \
  -H 'Content-Type: application/json' \
  -d '{"voter_id":"test","prompt_index":0,"answer_index":2}'
curl "http://100.124.57.61:8797/api/digest2/168/ama-vote?voter_id=test"
```

## Screenshot

~/share/docs/dogbelly-status/boarz-r168-lanes/previews/ama-8797-mobile.png (390px viewport, 60KB)