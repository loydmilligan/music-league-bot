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
| `ui/src/lib/digest2/AmaSection.svelte` | Full redesign: Reddit-style cards, upvote buttons, live tally, cookie-first fallback |
| `ui/src/lib/digest2/amaVote.test.ts` | **New.** 9 tests: insert, uniqueness, multi-prompt, round filtering, cookie resolution |
| `ui/src/routes/api/digest2/[roundId]/ama-vote/+server.ts` | **New.** GET (tally) + POST (cast/change vote) with HttpOnly cookie |
| `ui/src/lib/db/client.ts` | Added `ama_votes` table migration |
| `ui/src/routes/digest2/[roundId]/+page.svelte` | Pass `snapshot` + `roundId` props to AmaSection |

## Storage (ama_votes)

- **Table**: `ama_votes(id, round_id, prompt_index, answer_index, voter_id, voted_at)`
- **Uniqueness**: `UNIQUE(round_id, prompt_index, voter_id)` — one vote per reader per prompt
- **Upsert**: `ON CONFLICT DO UPDATE` allows changing your vote without double-counting
- **Migration**: additive `CREATE TABLE IF NOT EXISTS` in `client.ts:openLeagueDb()`, follows existing PRAGMA/ALTER pattern

## Endpoint

**`/api/digest2/[roundId]/ama-vote`**

- **GET** `?voter_id=xxx` → `{ myVotes, results, voter_id }`
  - `myVotes`: `{ prompt_index → answer_index }` for the requesting reader
  - `results`: `{ prompt_index → { answer_index → count } }` for tallies
  - `voter_id`: the resolved UUID (from cookie or fallback)
  - Sets `Set-Cookie: ama_voter_id=<uuid>` on every response
- **POST** `{ prompt_index, answer_index, voter_id? }` → `{ myVote, results, voter_id }`
  - Sets `Set-Cookie: ama_voter_id=<uuid>` on every response
  - `voter_id` body field is optional — only used as fallback when cookie is absent

## Identity — HttpOnly cookie (primary) + localStorage (fallback)

**Server (cookie-first):**
1. On every GET or POST, reads the `ama_voter_id` HttpOnly cookie
2. If cookie absent → checks `voter_id` query param / body field (localStorage fallback)
3. If neither exists → generates a new `crypto.randomUUID()`
4. Always sets the cookie on the response: `ama_voter_id=<uuid>; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000` (+ Secure over HTTPS)

**Client (localStorage fallback):**
1. Sends requests without `voter_id` (the server reads the cookie)
2. The server echoes back the resolved `voter_id` in every response
3. Client stores it in `localStorage` key `ama_voter_id`
4. On subsequent requests, sends `?voter_id=<stored>` as a query param — the server only uses this if the cookie is somehow absent

This means: a reader who clears cookies gets the same identity restored from localStorage (same UUID, same vote history). A reader who clears both cookies and localStorage gets a new identity (can re-vote).

## Live vs tallied

**Live** — each vote POST returns the updated tally for that prompt, and the client updates the UI immediately. No polling needed. A GET on page load fetches the initial state (with cookie).

## Privacy + abuse

- **Stored**: round_id, prompt_index, answer_index, voter_id (random UUID), voted_at (timestamp). No IP, no name, no email, no PII.
- **Rate limiting**: None built-in. A determined cheater could clear cookies + localStorage and vote multiple times. For production, add IP-based rate limiting. The current design is adequate for a private group digest shared with ~12 people.
- **No deletion**: Votes are never deleted, only updated. No "remove vote" flow (you can change it, not erase it).

## How to test

```bash
# Start preview (leave running)
cd ui && DATA_DIR=$HOME/.local/state/boarz-lanes/preview/ama-data \
  npx vite dev --config $HOME/.local/state/boarz-lanes/preview/vite.ama.config.mts \
  --host 100.124.57.61 --port 8797 --strictPort

# Unit tests
cd ui && npx vitest run src/lib/digest2/amaVote.test.ts

# Cookie test (set-cookie header visible)
curl -sI http://100.124.57.61:8797/api/digest2/168/ama-vote | grep set-cookie

# Vote with cookie persistence
curl -s -H 'Cookie: ama_voter_id=test-123' \
  -X POST http://100.124.57.61:8797/api/digest2/168/ama-vote \
  -H 'Content-Type: application/json' \
  -d '{"prompt_index":0,"answer_index":3}'
```

## Screenshot

~/share/docs/dogbelly-status/boarz-r168-lanes/previews/ama-8797-mobile.png (390px viewport, refreshed with cookie changes)

---

## Bringing it live (plan — do NOT run now)

This plan assumes the lane branch `lane/opencode-r168-ama` is to be merged into `master` by Mashew or Herdwick. The baton currently lives with the Grok lane / Claude window.

### 1. Merge

The worktree branches from `snap/boarz-r168-pre-grok` (tag `7db48a2`). Since then, commits on `master` from other lanes may have landed. The files changed by this branch are:

- `ui/src/lib/db/client.ts` — migration addition near the bottom (lines ~709-722). Low conflict risk unless another lane also added a migration in the same location.
- `ui/src/lib/digest2/AmaSection.svelte` — complete rewrite. No other lane touches this file (it's an AMA-specific component). Low conflict risk.
- `ui/src/routes/digest2/[roundId]/+page.svelte` — one-line prop addition (`snapshot={data.snapshot}`). Medium risk if another lane modified this file.
- `ui/src/lib/digest2/amaVote.test.ts` — new file. No conflict.
- `ui/src/routes/api/digest2/[roundId]/ama-vote/+server.ts` — new file. No conflict.

**Merge command:**
```bash
cd ~/Projects/music-league-bot
git merge lane/opencode-r168-ama --no-ff
```

If `+page.svelte` conflicts, the fix is to add `snapshot={data.snapshot} roundId={data.roundId}` to the existing `<AmaSection content={data.oneoffs.ama} />` line. If `client.ts` conflicts (another migration added at the same line), place either migration block before the other — both are additive `CREATE TABLE IF NOT EXISTS`.

### 2. DB migration on the LIVE DB

The `ama_votes` table is created automatically by `openLeagueDb()` (in `client.ts`) on first `getDb()` call. No manual SQL needed.

**What happens on boot:**
```sql
CREATE TABLE IF NOT EXISTS ama_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL,
  prompt_index INTEGER NOT NULL,
  answer_index INTEGER NOT NULL,
  voter_id TEXT NOT NULL,
  voted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(round_id, prompt_index, voter_id)
);
```

**Verification:**
```bash
sqlite3 data/league.db ".schema ama_votes"
```

**Additive-only:** Yes. The `IF NOT EXISTS` clause means the live DB's existing tables, rows, and R168 draft data are never touched. This is a zero-risk migration.

**Backup step (before first boot after merge):**
```bash
cp data/league.db "data/backups/league.pre-ama-migration-$(date +%Y%m%d-%H%M%S).db"
```

**Rollback:** To remove the table entirely: `DROP TABLE IF EXISTS ama_votes;` — deletes all votes, zero impact on digest content or draft rows. The AMA content lives in `digest2_sections`, not in this table. To roll back without data loss, simply stop the service and revert the commit.

### 3. bot-ui rebuild / restart

**Does NOT need a bot-ui rebuild.** The AMA section is only rendered in the digest 2.0 page served by the Vite/SvelteKit frontend (`/digest2/168`). The `bot-ui` container serves the 1.0 digest layout and admin panels — it does not render 2.0 sections.

**What needs to happen:**
1. Merge the branch into `master`
2. Restart the SvelteKit dev server or rebuild the production bundle (if using `npm run build`)
3. That's it. No container restarts, no Docker rebuild.

### 4. Risk to live R168 draft rows

**Zero risk.** The changes are:
- One new table (`ama_votes`) — does not read or write any digest table
- One new API endpoint (`/api/digest2/[roundId]/ama-vote`) — does not touch `digest2_sections`, `digest2_drafts`, or any 1.0/2.0 content tables
- One component redesign (`AmaSection.svelte`) — read-only rendering of existing `digest2_sections` content
- The `+page.svelte` change only adds props to an existing component instance

The R168 draft rows (`d2-168` in `digest2_drafts`, and its `digest2_sections` with `kind='ama'`) are never written to by any code in this branch.

### 5. Steps (exact order, for Mashew)

1. Read these notes and confirm.
2. Backup the live DB: `cp data/league.db "data/backups/league.pre-ama-$(date +%Y%m%d-%H%M%S).db"`
3. Merge: `git checkout master && git merge lane/opencode-r168-ama --no-ff`
4. Restart the SvelteKit frontend (dev server: `npm run dev` or rebuild: `npm run build`)
5. Load `https://mlb13.mattmariani.com/digest2/168` and confirm the AMA section renders.
6. Vote on an answer; confirm the count increments and the cookie is set.
7. Done. No publish or share needed — the AMA section is public on the digest page.