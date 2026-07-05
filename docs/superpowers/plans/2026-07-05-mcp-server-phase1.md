# MCP Server Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a greenfield MCP server that lets an LLM assistant manage a round's song list, run a new random-pairing H2H mode alongside the existing king-of-the-hill tournament, and drive digest generation for music-league-bot — talking only to the app's existing (and a few new) HTTP API routes, never touching sqlite directly.

**Architecture:** New standalone `mcp-server/` package (own `package.json`/`tsconfig.json`/`vitest.config.ts`) with a transport-agnostic `createServer()` factory and a thin `botUiFetch()` HTTP client. New backend surface lives in the existing `ui/` SvelteKit app: 3 new/extended API route groups (song-list cascade + removal, H2H random mode, round resolver) plus one incidental fix to the H2H tab's stale rating display/scoring.

**Tech Stack:** `@modelcontextprotocol/sdk` + `zod` (mcp-server), SvelteKit + better-sqlite3 (existing `ui/` app), vitest (both, as two independent test suites).

## Global Constraints

- Every round parameter across all new code is `roundId: number` (`rounds.id`) — never `round_number`.
- Only 4 rating traits are ever written by new code: `discoveryPotential`, `themeFit`, `quality`, `replayability`. `nostalgiaPotential`/`personalRating` are read-only legacy fields — no new code writes them.
- Every **new** API route added in this plan calls `requireBearerToken(request, db)` (from `ui/src/lib/auth/bearer.ts`) as its first line. Existing routes this plan reuses as-is (`/api/research/:roundId`, `/api/shortlist*`, `/api/digest/:roundId/prepare`, `/api/digest/:roundId/draft`) are **not** touched for auth — leave them exactly as they are.
- The `mcp-server` package never imports from `ui/src/lib` and never opens the sqlite file — every tool is an HTTP call via `botUiFetch()`.
- `ui/` changes: run `cd ui && npm run check` (svelte-check, 0 errors) and `npx vitest run <changed test files>` before every commit in this plan that touches `ui/`.
- `mcp-server` changes: run `cd mcp-server && npx tsc --noEmit` and `npx vitest run` before every commit that touches `mcp-server`.

---

### Task 1: Schema migration — `research_songs` removal columns + `h2h_pending_matchup` table

**Files:**
- Modify: `ui/src/lib/db/schema.ts` (add `h2h_pending_matchup` table near the existing `head_to_head_matches` table, around line 75)
- Modify: `ui/src/lib/db/client.ts` (add a guarded `ALTER TABLE` migration block for `research_songs`, following the existing pattern around line 166-170)
- Test: `ui/src/lib/db/schema.test.ts` (new file)

**Interfaces:**
- Produces: `research_songs.removed_reason TEXT` (`NULL` | `'user_removed'` | `'h2h_loss'`), `research_songs.removed_by_song_id INTEGER`, `research_songs.removed_at TEXT`; table `h2h_pending_matchup(round_id INTEGER PRIMARY KEY, song_a_id INTEGER NOT NULL, song_b_id INTEGER NOT NULL, mode TEXT NOT NULL DEFAULT 'random', created_at TEXT NOT NULL)`. Later tasks (2, 4) read/write these directly via raw SQL.

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/db/schema.test.ts`:

```ts
import { it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from './client.js';

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

it('research_songs has the new removal-tracking columns', () => {
  const cols = (db.prepare("PRAGMA table_info(research_songs)").all() as { name: string }[]).map(c => c.name);
  expect(cols).toContain('removed_reason');
  expect(cols).toContain('removed_by_song_id');
  expect(cols).toContain('removed_at');
});

it('h2h_pending_matchup table exists with the expected columns', () => {
  const cols = (db.prepare("PRAGMA table_info(h2h_pending_matchup)").all() as { name: string }[]).map(c => c.name);
  expect(cols).toEqual(['round_id', 'song_a_id', 'song_b_id', 'mode', 'created_at']);
});

it('h2h_pending_matchup enforces one pending row per round (round_id is the PK)', () => {
  db.prepare(`INSERT INTO h2h_pending_matchup (round_id, song_a_id, song_b_id, mode, created_at)
    VALUES (1, 10, 20, 'random', '2026-01-01T00:00:00Z')`).run();
  expect(() =>
    db.prepare(`INSERT INTO h2h_pending_matchup (round_id, song_a_id, song_b_id, mode, created_at)
      VALUES (1, 30, 40, 'random', '2026-01-01T00:00:01Z')`).run()
  ).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/db/schema.test.ts`
Expected: all 3 tests FAIL — `removed_reason`/`removed_by_song_id`/`removed_at` not found, `h2h_pending_matchup` table doesn't exist (query throws "no such table").

- [ ] **Step 3: Add the new table to schema.ts**

In `ui/src/lib/db/schema.ts`, find the `head_to_head_matches` table definition (around line 67-75):

```sql
CREATE TABLE IF NOT EXISTS head_to_head_matches (
  id INTEGER PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  winner_id INTEGER NOT NULL REFERENCES research_songs(id),
  loser_id INTEGER NOT NULL REFERENCES research_songs(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_h2h_round_created
  ON head_to_head_matches(round_id, created_at);
```

Add immediately after it:

```sql
-- Phase 1 MCP: the currently-proposed random-mode pairing for a round.
-- One row per round (round_id is the PK) — king-of-the-hill mode needs no
-- equivalent since it's fully re-derived from match history on every read;
-- a random pairing is arbitrary and must be persisted to survive a reshuffle
-- or a later "select winner" call.
CREATE TABLE IF NOT EXISTS h2h_pending_matchup (
  round_id INTEGER PRIMARY KEY REFERENCES rounds(id),
  song_a_id INTEGER NOT NULL REFERENCES research_songs(id),
  song_b_id INTEGER NOT NULL REFERENCES research_songs(id),
  mode TEXT NOT NULL DEFAULT 'random',
  created_at TEXT NOT NULL
);
```

- [ ] **Step 4: Add the migration block to client.ts**

In `ui/src/lib/db/client.ts`, find the existing `quality`/`replayability` migration block (around line 164-170):

```ts
const rsCols2 = db.prepare("PRAGMA table_info(research_songs)").all() as { name: string }[];
if (!rsCols2.some(c => c.name === 'quality')) {
  db.exec("ALTER TABLE research_songs ADD COLUMN quality INTEGER CHECK(quality BETWEEN 0 AND 5)");
}
if (!rsCols2.some(c => c.name === 'replayability')) {
  db.exec("ALTER TABLE research_songs ADD COLUMN replayability INTEGER CHECK(replayability BETWEEN 0 AND 5)");
}
```

Add immediately after it:

```ts
// Phase 1 MCP: soft-removal tracking (replaces the old implicit "retired"
// derivation for the new random H2H mode — see h2hRandom.ts).
const rsCols3 = db.prepare("PRAGMA table_info(research_songs)").all() as { name: string }[];
if (!rsCols3.some(c => c.name === 'removed_reason')) {
  db.exec("ALTER TABLE research_songs ADD COLUMN removed_reason TEXT");
}
if (!rsCols3.some(c => c.name === 'removed_by_song_id')) {
  db.exec("ALTER TABLE research_songs ADD COLUMN removed_by_song_id INTEGER REFERENCES research_songs(id)");
}
if (!rsCols3.some(c => c.name === 'removed_at')) {
  db.exec("ALTER TABLE research_songs ADD COLUMN removed_at TEXT");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/db/schema.test.ts`
Expected: 3/3 PASS.

- [ ] **Step 6: Run svelte-check and commit**

```bash
cd ui && npm run check
```
Expected: 0 errors.

```bash
git add ui/src/lib/db/schema.ts ui/src/lib/db/client.ts ui/src/lib/db/schema.test.ts
git commit -m "feat(db): add research_songs removal columns + h2h_pending_matchup table

Groundwork for the MCP server's song-list soft-removal and random H2H
mode. Additive only — no existing column/table behavior changes."
```

---

### Task 2: Extend `research.ts` for soft-removal + filtering, extend `/api/research/:roundId`

**Files:**
- Modify: `ui/src/lib/db/research.ts`
- Modify: `ui/src/lib/types.ts` (extend `ResearchSong`)
- Modify: `ui/src/routes/api/research/[roundId]/+server.ts` (GET gains `includeRemoved` query param support)
- Test: `ui/src/lib/db/research.test.ts` (new file)

**Interfaces:**
- Consumes: `research_songs.removed_reason`/`removed_by_song_id`/`removed_at` (Task 1).
- Produces: `getResearchSongs(db, roundId, opts?: { includeRemoved?: boolean })` (defaults to active-only); `updateResearchSong` accepts `removedReason`, `removedBySongId`, `removedAt` in its patch map. Task 3's cascade-add route and Task 5's H2H random routes both call these.

- [ ] **Step 1: Write the failing tests**

Create `ui/src/lib/db/research.test.ts`:

```ts
import { it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound } from './rounds.js';
import { getResearchSongs, addResearchSong, updateResearchSong } from './research.js';

let db: Database.Database;
let roundId: number;

beforeEach(() => {
  db = openLeagueDb(':memory:');
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 1, 'active');
  roundId = upsertRound(db, seasonId, {
    mlRoundId: 'research-test', name: 'Test Round', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
});

it('getResearchSongs excludes removed songs by default', () => {
  const a = addResearchSong(db, { roundId, spotifyUri: 'spotify:track:a', title: 'A', artist: 'Artist A', album: null });
  addResearchSong(db, { roundId, spotifyUri: 'spotify:track:b', title: 'B', artist: 'Artist B', album: null });
  updateResearchSong(db, a.id, { removedReason: 'user_removed', removedAt: '2026-01-02T00:00:00Z' } as any);

  const active = getResearchSongs(db, roundId);
  expect(active.map(s => s.spotifyUri)).toEqual(['spotify:track:b']);
});

it('getResearchSongs({ includeRemoved: true }) returns everything', () => {
  const a = addResearchSong(db, { roundId, spotifyUri: 'spotify:track:a', title: 'A', artist: 'Artist A', album: null });
  updateResearchSong(db, a.id, { removedReason: 'user_removed', removedAt: '2026-01-02T00:00:00Z' } as any);

  const all = getResearchSongs(db, roundId, { includeRemoved: true });
  expect(all).toHaveLength(1);
  expect(all[0].removedReason).toBe('user_removed');
});

it('updateResearchSong persists removedReason, removedBySongId, removedAt', () => {
  const winner = addResearchSong(db, { roundId, spotifyUri: 'spotify:track:winner', title: 'W', artist: 'Artist W', album: null });
  const loser = addResearchSong(db, { roundId, spotifyUri: 'spotify:track:loser', title: 'L', artist: 'Artist L', album: null });
  updateResearchSong(db, loser.id, {
    removedReason: 'h2h_loss', removedBySongId: winner.id, removedAt: '2026-01-03T00:00:00Z',
  } as any);

  const all = getResearchSongs(db, roundId, { includeRemoved: true });
  const found = all.find(s => s.id === loser.id)!;
  expect(found.removedReason).toBe('h2h_loss');
  expect(found.removedBySongId).toBe(winner.id);
  expect(found.removedAt).toBe('2026-01-03T00:00:00Z');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/db/research.test.ts`
Expected: FAIL — `removedReason` is not a valid patch key yet (TypeScript/runtime: the field silently won't be written since it's not in `updateResearchSong`'s `map`), and `ResearchSong` has no `removedReason`/`removedBySongId`/`removedAt` fields yet.

- [ ] **Step 3: Extend `ResearchSong` in types.ts**

In `ui/src/lib/types.ts`, find the `ResearchSong` interface (around line 16-24) and add three fields at the end, before the closing brace:

```ts
  removedReason: 'user_removed' | 'h2h_loss' | null;
  removedBySongId: number | null;
  removedAt: string | null;
```

- [ ] **Step 4: Extend `research.ts`**

In `ui/src/lib/db/research.ts`, change the `row()` function (lines 4-14) to add the three new fields:

```ts
function row(r: any): ResearchSong {
  return {
    id: r.id, roundId: r.round_id, spotifyUri: r.spotify_uri, title: r.title, artist: r.artist,
    album: r.album, addedAt: r.added_at, notes: r.notes,
    themeFit: r.theme_fit, discoveryPotential: r.discovery_potential,
    nostalgiaPotential: r.nostalgia_potential, personalRating: r.personal_rating,
    quality: r.quality ?? null, replayability: r.replayability ?? null,
    saveForFuture: !!r.save_for_future, submittedByMe: !!r.submitted_by_me,
    submittedByOther: !!r.submitted_by_other, otherSubmissionVotes: r.other_submission_votes,
    removedReason: r.removed_reason ?? null,
    removedBySongId: r.removed_by_song_id ?? null,
    removedAt: r.removed_at ?? null,
  };
}
```

Change `getResearchSongs` (lines 16-18) to accept an options param:

```ts
export function getResearchSongs(
  db: Database.Database,
  roundId: number,
  opts: { includeRemoved?: boolean } = {},
): ResearchSong[] {
  const sql = opts.includeRemoved
    ? 'SELECT * FROM research_songs WHERE round_id=? ORDER BY added_at'
    : 'SELECT * FROM research_songs WHERE round_id=? AND removed_reason IS NULL ORDER BY added_at';
  return (db.prepare(sql).all(roundId) as any[]).map(row);
}
```

Change `updateResearchSong`'s `map` (lines 45-61) to add the three new patchable fields:

```ts
export function updateResearchSong(db: Database.Database, id: number, patch: Partial<Omit<ResearchSong,'id'|'roundId'|'spotifyUri'|'addedAt'>>): void {
  const fields: string[] = [];
  const vals: unknown[] = [];
  const map: Record<string,string> = {
    notes: 'notes', themeFit: 'theme_fit', discoveryPotential: 'discovery_potential',
    nostalgiaPotential: 'nostalgia_potential', personalRating: 'personal_rating',
    quality: 'quality', replayability: 'replayability',
    saveForFuture: 'save_for_future', submittedByMe: 'submitted_by_me',
    submittedByOther: 'submitted_by_other', otherSubmissionVotes: 'other_submission_votes',
    removedReason: 'removed_reason', removedBySongId: 'removed_by_song_id', removedAt: 'removed_at',
  };
  for (const [k, col] of Object.entries(map)) {
    if (k in patch) { fields.push(`${col}=?`); vals.push((patch as any)[k] === true ? 1 : (patch as any)[k] === false ? 0 : (patch as any)[k]); }
  }
  if (!fields.length) return;
  vals.push(id);
  db.prepare(`UPDATE research_songs SET ${fields.join(',')} WHERE id=?`).run(...vals);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/db/research.test.ts`
Expected: 3/3 PASS.

- [ ] **Step 6: Extend the GET route for `includeRemoved`**

In `ui/src/routes/api/research/[roundId]/+server.ts`, change the `GET` handler (lines 9-13):

```ts
export const GET: RequestHandler = async ({ params }) => {
  const db = getDb(); const settings = getSettings(db);
  const songs = getResearchSongs(db, Number(params.roundId)).map(s => ({ ...s, score: computeScore(s, settings) }));
  return json(attachYtmLinks(db, songs));
};
```

to:

```ts
export const GET: RequestHandler = async ({ params, url }) => {
  const db = getDb(); const settings = getSettings(db);
  const includeRemoved = url.searchParams.get('includeRemoved') === 'true';
  const songs = getResearchSongs(db, Number(params.roundId), { includeRemoved }).map(s => ({ ...s, score: computeScore(s, settings) }));
  return json(attachYtmLinks(db, songs));
};
```

This existing route's default behavior (no query param) is unchanged — active-only, matching what every current UI caller already expects.

- [ ] **Step 7: Run svelte-check, existing test suite, and commit**

```bash
cd ui && npm run check
```
Expected: 0 errors.

```bash
cd ui && npx vitest run src/lib/db/headToHead.candidates.test.ts src/lib/db/research.test.ts
```
Expected: all pass (confirms the pre-existing H2H candidate test, which reads `research_songs` rows created without the new columns, still works — `removed_reason` defaults to `NULL` for any row that doesn't set it, so existing behavior is unaffected).

```bash
git add ui/src/lib/db/research.ts ui/src/lib/db/research.test.ts ui/src/lib/types.ts ui/src/routes/api/research/\[roundId\]/+server.ts
git commit -m "feat(research): soft-removal fields + includeRemoved filter on GET

getResearchSongs excludes removed_reason IS NOT NULL rows by default;
?includeRemoved=true opts back in. updateResearchSong can now set
removedReason/removedBySongId/removedAt. Existing callers unaffected —
default behavior (active-only listing) matches what the current
research_songs consumers already assumed implicitly."
```

---

### Task 3: New cascade-add route — `POST /api/rounds/:roundId/research-songs`

**Files:**
- Create: `ui/src/lib/db/researchCascade.ts`
- Create: `ui/src/routes/api/rounds/[roundId]/research-songs/+server.ts`
- Test: `ui/src/lib/db/researchCascade.test.ts`

**Interfaces:**
- Consumes: `getResearchSongs`/`updateResearchSong` (Task 2), `getShortlistSongs`/`addShortlistSong` (existing `ui/src/lib/shortlist/shortlist.ts`), `requireBearerToken` (`ui/src/lib/auth/bearer.ts`).
- Produces: `addSongToRoundWithShortlistCascade(db, { roundId, spotifyUri, title, artist, album?, notes?, ratings? })`. Task 9's `add_song_to_round` MCP tool calls this route directly.

Existing `POST /api/research/:roundId` and `POST /api/shortlist` are left completely untouched — this is a new, additional route, not a behavior change to either.

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/db/researchCascade.test.ts`:

```ts
import { it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound } from './rounds.js';
import { addSongToRoundWithShortlistCascade } from './researchCascade.js';

let db: Database.Database;
let roundId: number;

beforeEach(() => {
  db = openLeagueDb(':memory:');
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 1, 'active');
  roundId = upsertRound(db, seasonId, {
    mlRoundId: 'cascade-test', name: 'Test Round', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
});

it('creates a shortlist_songs row and a research_songs row for the round', () => {
  const result = addSongToRoundWithShortlistCascade(db, {
    roundId, spotifyUri: 'spotify:track:xyz', title: 'Song', artist: 'Artist', album: 'Album',
    notes: 'great pick', ratings: { discoveryPotential: 4, themeFit: 5, quality: 3, replayability: 4 },
  });

  const shortlistRow = db.prepare('SELECT * FROM shortlist_songs WHERE spotify_uri=?').get('spotify:track:xyz');
  expect(shortlistRow).toBeTruthy();

  const researchRow = db.prepare('SELECT * FROM research_songs WHERE round_id=? AND spotify_uri=?').get(roundId, 'spotify:track:xyz') as any;
  expect(researchRow.notes).toBe('great pick');
  expect(researchRow.discovery_potential).toBe(4);
  expect(researchRow.theme_fit).toBe(5);
  expect(researchRow.quality).toBe(3);
  expect(researchRow.replayability).toBe(4);
  expect(result.researchSongId).toBe(researchRow.id);
});

it('does not duplicate the shortlist row if one already exists for that spotify_uri', () => {
  addSongToRoundWithShortlistCascade(db, { roundId, spotifyUri: 'spotify:track:dup', title: 'Song', artist: 'Artist' });
  addSongToRoundWithShortlistCascade(db, { roundId, spotifyUri: 'spotify:track:dup', title: 'Song', artist: 'Artist' });

  const count = (db.prepare('SELECT COUNT(*) AS n FROM shortlist_songs WHERE spotify_uri=?').get('spotify:track:dup') as { n: number }).n;
  expect(count).toBe(1);
});

it('is idempotent for the same round + song — second call updates notes/ratings on the same research_songs row', () => {
  const first = addSongToRoundWithShortlistCascade(db, {
    roundId, spotifyUri: 'spotify:track:idem', title: 'Song', artist: 'Artist', notes: 'v1',
  });
  const second = addSongToRoundWithShortlistCascade(db, {
    roundId, spotifyUri: 'spotify:track:idem', title: 'Song', artist: 'Artist', notes: 'v2',
  });

  expect(second.researchSongId).toBe(first.researchSongId);
  const researchRow = db.prepare('SELECT notes FROM research_songs WHERE id=?').get(first.researchSongId) as { notes: string };
  expect(researchRow.notes).toBe('v2');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/db/researchCascade.test.ts`
Expected: FAIL — `researchCascade.js` doesn't exist yet (module not found).

- [ ] **Step 3: Implement `researchCascade.ts`**

Create `ui/src/lib/db/researchCascade.ts`:

```ts
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface CascadeAddInput {
  roundId: number;
  spotifyUri: string;
  title: string;
  artist: string;
  album?: string | null;
  notes?: string;
  ratings?: {
    discoveryPotential?: number;
    themeFit?: number;
    quality?: number;
    replayability?: number;
  };
}

export interface CascadeAddResult {
  shortlistSongId: string;
  researchSongId: number;
}

// Adds a song to the round's active research list AND ensures it exists on
// the (append-only, never-really-removed) global shortlist — the MCP
// server's add_song_to_round tool needs this in one atomic call rather than
// composing POST /api/shortlist + POST /api/shortlist/:id/assign/:roundId,
// which takes 2 round-trips and doesn't carry notes/ratings on the research
// row in the same step.
export function addSongToRoundWithShortlistCascade(db: Database.Database, input: CascadeAddInput): CascadeAddResult {
  const tx = db.transaction((i: CascadeAddInput): CascadeAddResult => {
    let shortlistRow = db
      .prepare('SELECT id FROM shortlist_songs WHERE spotify_uri = ?')
      .get(i.spotifyUri) as { id: string } | undefined;

    let shortlistSongId: string;
    if (shortlistRow) {
      shortlistSongId = shortlistRow.id;
    } else {
      shortlistSongId = randomUUID();
      db.prepare(
        `INSERT INTO shortlist_songs (id, spotify_uri, title, artist, album, added_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(shortlistSongId, i.spotifyUri, i.title, i.artist, i.album ?? null, new Date().toISOString());
    }

    db.prepare(
      `INSERT OR IGNORE INTO shortlist_assignments (shortlist_song_id, round_id) VALUES (?, ?)`,
    ).run(shortlistSongId, i.roundId);

    let researchRow = db
      .prepare('SELECT id FROM research_songs WHERE round_id = ? AND spotify_uri = ?')
      .get(i.roundId, i.spotifyUri) as { id: number } | undefined;

    if (!researchRow) {
      db.prepare(
        `INSERT INTO research_songs (round_id, spotify_uri, title, artist, album, added_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(i.roundId, i.spotifyUri, i.title, i.artist, i.album ?? null, new Date().toISOString());
      researchRow = db
        .prepare('SELECT id FROM research_songs WHERE round_id = ? AND spotify_uri = ?')
        .get(i.roundId, i.spotifyUri) as { id: number };
    }

    const sets: string[] = [];
    const vals: unknown[] = [];
    if (i.notes !== undefined) { sets.push('notes = ?'); vals.push(i.notes); }
    if (i.ratings?.discoveryPotential !== undefined) { sets.push('discovery_potential = ?'); vals.push(i.ratings.discoveryPotential); }
    if (i.ratings?.themeFit !== undefined) { sets.push('theme_fit = ?'); vals.push(i.ratings.themeFit); }
    if (i.ratings?.quality !== undefined) { sets.push('quality = ?'); vals.push(i.ratings.quality); }
    if (i.ratings?.replayability !== undefined) { sets.push('replayability = ?'); vals.push(i.ratings.replayability); }
    if (sets.length) {
      vals.push(researchRow.id);
      db.prepare(`UPDATE research_songs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }

    return { shortlistSongId, researchSongId: researchRow.id };
  });

  return tx(input);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/db/researchCascade.test.ts`
Expected: 3/3 PASS.

- [ ] **Step 5: Create the API route**

Create `ui/src/routes/api/rounds/[roundId]/research-songs/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { requireBearerToken } from '$lib/auth/bearer.js';
import { addSongToRoundWithShortlistCascade } from '$lib/db/researchCascade.js';

// POST /api/rounds/:roundId/research-songs — add a song to a round's active
// research list, cascading into the global shortlist. New route (Phase 1
// MCP); requires a bearer token per this project's auth convention.
export const POST: RequestHandler = async ({ params, request }) => {
  const db = getDb();
  requireBearerToken(request, db);

  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');
  if (!db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId)) throw error(404, `round not found: ${roundId}`);

  const body = (await request.json().catch(() => null)) as {
    spotifyUri?: string; title?: string; artist?: string; album?: string;
    notes?: string;
    ratings?: { discoveryPotential?: number; themeFit?: number; quality?: number; replayability?: number };
  } | null;
  if (!body?.spotifyUri || !body.title || !body.artist) {
    throw error(400, 'spotifyUri, title, and artist required');
  }

  const result = addSongToRoundWithShortlistCascade(db, {
    roundId, spotifyUri: body.spotifyUri, title: body.title, artist: body.artist,
    album: body.album, notes: body.notes, ratings: body.ratings,
  });

  return json(result, { status: 201 });
};
```

- [ ] **Step 6: Run svelte-check and commit**

```bash
cd ui && npm run check
```
Expected: 0 errors.

```bash
git add ui/src/lib/db/researchCascade.ts ui/src/lib/db/researchCascade.test.ts ui/src/routes/api/rounds/\[roundId\]/research-songs/+server.ts
git commit -m "feat(api): POST /api/rounds/:roundId/research-songs — cascade add

New route for the MCP server's add_song_to_round tool: one atomic call
creates/finds the shortlist_songs row, assigns it to the round, creates/
finds the research_songs row, and applies notes/ratings — replacing what
would otherwise be a 2-request compose of existing shortlist endpoints."
```

---

### Task 4: `h2hRandom.ts` — random-pairing logic

**Files:**
- Create: `ui/src/lib/db/h2hRandom.ts`
- Test: `ui/src/lib/db/h2hRandom.test.ts`

**Interfaces:**
- Consumes: `recordH2HMatch` (existing, `ui/src/lib/db/headToHead.ts`), `updateResearchSong` (Task 2).
- Produces: `getActiveResearchSongs(db, roundId)`, `getPendingMatchup(db, roundId)`, `startRandomMatchup(db, roundId)`, `reshuffleRandomMatchup(db, roundId)`, `selectH2HWinner(db, roundId, winnerSongId)`. Task 5's 4 new API routes call these directly; nothing else in this plan depends on their internals beyond these function signatures.

- [ ] **Step 1: Write the failing tests**

Create `ui/src/lib/db/h2hRandom.test.ts`:

```ts
import { it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound } from './rounds.js';
import { addResearchSong } from './research.js';
import {
  getActiveResearchSongs, getPendingMatchup, startRandomMatchup,
  reshuffleRandomMatchup, selectH2HWinner,
} from './h2hRandom.js';

let db: Database.Database;
let roundId: number;

beforeEach(() => {
  db = openLeagueDb(':memory:');
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 1, 'active');
  roundId = upsertRound(db, seasonId, {
    mlRoundId: 'h2h-random-test', name: 'Test Round', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
  for (const letter of ['A', 'B', 'C', 'D']) {
    addResearchSong(db, { roundId, spotifyUri: `spotify:track:${letter}`, title: letter, artist: `Artist ${letter}`, album: null });
  }
});

it('startRandomMatchup picks 2 distinct active songs and persists them', () => {
  const matchup = startRandomMatchup(db, roundId);
  expect(matchup.songAId).not.toBe(matchup.songBId);

  const pending = getPendingMatchup(db, roundId);
  expect(pending).toEqual(matchup);
});

it('startRandomMatchup returns an error result when fewer than 2 active songs exist', () => {
  // Remove 3 of the 4 seeded songs, leaving only 1 active.
  const all = getActiveResearchSongs(db, roundId);
  for (const s of all.slice(1)) {
    db.prepare('UPDATE research_songs SET removed_reason=?, removed_at=? WHERE id=?')
      .run('user_removed', '2026-01-02T00:00:00Z', s.id);
  }
  expect(() => startRandomMatchup(db, roundId)).toThrow(/not enough active songs/i);
});

it('reshuffleRandomMatchup excludes the currently-pending pair', () => {
  const first = startRandomMatchup(db, roundId);
  const reshuffled = reshuffleRandomMatchup(db, roundId);
  expect(reshuffled.songAId).not.toBe(first.songAId);
  expect(reshuffled.songAId).not.toBe(first.songBId);
  expect(reshuffled.songBId).not.toBe(first.songAId);
  expect(reshuffled.songBId).not.toBe(first.songBId);
});

it('selectH2HWinner records the match, soft-removes the loser with a reason, and advances a new challenger', () => {
  const matchup = startRandomMatchup(db, roundId);
  const result = selectH2HWinner(db, roundId, matchup.songAId);

  const match = db.prepare('SELECT * FROM head_to_head_matches WHERE round_id=?').get(roundId) as any;
  expect(match.winner_id).toBe(matchup.songAId);
  expect(match.loser_id).toBe(matchup.songBId);

  const loserRow = db.prepare('SELECT removed_reason, removed_by_song_id FROM research_songs WHERE id=?').get(matchup.songBId) as any;
  expect(loserRow.removed_reason).toBe('h2h_loss');
  expect(loserRow.removed_by_song_id).toBe(matchup.songAId);

  expect(result.songAId).toBe(matchup.songAId); // winner stays in slot A
  expect(result.songBId).not.toBe(matchup.songBId); // new challenger, not the old loser
  expect([matchup.songAId, matchup.songBId]).not.toContain(result.songBId);
});

it('selectH2HWinner throws if winnerSongId is not one of the pending pair', () => {
  startRandomMatchup(db, roundId);
  const bogusId = 999999;
  expect(() => selectH2HWinner(db, roundId, bogusId)).toThrow(/not part of the current matchup/i);
});

it('selectH2HWinner returns a completed matchup (songBId null) when no challengers remain', () => {
  // Reduce to exactly 2 active songs so there's no one left to challenge the winner.
  const all = getActiveResearchSongs(db, roundId);
  for (const s of all.slice(2)) {
    db.prepare('UPDATE research_songs SET removed_reason=?, removed_at=? WHERE id=?')
      .run('user_removed', '2026-01-02T00:00:00Z', s.id);
  }
  const matchup = startRandomMatchup(db, roundId);
  const result = selectH2HWinner(db, roundId, matchup.songAId);
  expect(result.songBId).toBeNull();
  expect(getPendingMatchup(db, roundId)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/db/h2hRandom.test.ts`
Expected: FAIL — `h2hRandom.js` doesn't exist yet.

- [ ] **Step 3: Implement `h2hRandom.ts`**

Create `ui/src/lib/db/h2hRandom.ts`:

```ts
import type Database from 'better-sqlite3';
import { recordH2HMatch } from './headToHead.js';

export interface ActiveResearchSong {
  id: number;
  spotifyUri: string;
  title: string;
  artist: string;
}

export interface PendingMatchup {
  songAId: number;
  songBId: number;
}

export interface SelectWinnerResult {
  songAId: number;
  songBId: number | null; // null when no challenger remains — tournament complete
}

// Active = still in the round's list, independent of the existing `status`
// column king-of-the-hill uses (see headToHead.ts's ELIGIBLE_STATUS gate).
// A song could be status='reviewing' (eligible for king-of-the-hill) while
// removed_reason='h2h_loss' (excluded here) — the two modes gate the same
// table independently by design; they share only the underlying pool and
// head_to_head_matches history.
export function getActiveResearchSongs(db: Database.Database, roundId: number): ActiveResearchSong[] {
  return db
    .prepare(
      `SELECT id, spotify_uri AS spotifyUri, title, artist
       FROM research_songs WHERE round_id = ? AND removed_reason IS NULL`,
    )
    .all(roundId) as ActiveResearchSong[];
}

export function getPendingMatchup(db: Database.Database, roundId: number): PendingMatchup | null {
  const row = db
    .prepare('SELECT song_a_id AS songAId, song_b_id AS songBId FROM h2h_pending_matchup WHERE round_id = ?')
    .get(roundId) as PendingMatchup | undefined;
  return row ?? null;
}

function pickTwoDistinct(pool: ActiveResearchSong[], excludeIds: number[] = []): [ActiveResearchSong, ActiveResearchSong] {
  const eligible = pool.filter((s) => !excludeIds.includes(s.id));
  if (eligible.length < 2) throw new Error('not enough active songs in the round to start a matchup');
  const shuffled = [...eligible].sort(() => Math.random() - 0.5);
  return [shuffled[0], shuffled[1]];
}

function setPendingMatchup(db: Database.Database, roundId: number, songAId: number, songBId: number): void {
  db.prepare(
    `INSERT INTO h2h_pending_matchup (round_id, song_a_id, song_b_id, mode, created_at)
     VALUES (?, ?, ?, 'random', ?)
     ON CONFLICT(round_id) DO UPDATE SET song_a_id = excluded.song_a_id, song_b_id = excluded.song_b_id, created_at = excluded.created_at`,
  ).run(roundId, songAId, songBId, new Date().toISOString());
}

export function startRandomMatchup(db: Database.Database, roundId: number): PendingMatchup {
  const pool = getActiveResearchSongs(db, roundId);
  const [a, b] = pickTwoDistinct(pool);
  setPendingMatchup(db, roundId, a.id, b.id);
  return { songAId: a.id, songBId: b.id };
}

export function reshuffleRandomMatchup(db: Database.Database, roundId: number): PendingMatchup {
  const current = getPendingMatchup(db, roundId);
  const pool = getActiveResearchSongs(db, roundId);
  const [a, b] = pickTwoDistinct(pool, current ? [current.songAId, current.songBId] : []);
  setPendingMatchup(db, roundId, a.id, b.id);
  return { songAId: a.id, songBId: b.id };
}

export function selectH2HWinner(db: Database.Database, roundId: number, winnerSongId: number): SelectWinnerResult {
  const pending = getPendingMatchup(db, roundId);
  if (!pending) throw new Error('no pending matchup for this round');
  if (winnerSongId !== pending.songAId && winnerSongId !== pending.songBId) {
    throw new Error('winnerSongId is not part of the current matchup');
  }
  const loserSongId = winnerSongId === pending.songAId ? pending.songBId : pending.songAId;

  recordH2HMatch(db, roundId, winnerSongId, loserSongId);
  db.prepare(
    `UPDATE research_songs SET removed_reason = 'h2h_loss', removed_by_song_id = ?, removed_at = ? WHERE id = ?`,
  ).run(winnerSongId, new Date().toISOString(), loserSongId);

  const pool = getActiveResearchSongs(db, roundId);
  const remaining = pool.filter((s) => s.id !== winnerSongId);
  if (!remaining.length) {
    db.prepare('DELETE FROM h2h_pending_matchup WHERE round_id = ?').run(roundId);
    return { songAId: winnerSongId, songBId: null };
  }
  const challenger = remaining[Math.floor(Math.random() * remaining.length)];
  setPendingMatchup(db, roundId, winnerSongId, challenger.id);
  return { songAId: winnerSongId, songBId: challenger.id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/db/h2hRandom.test.ts`
Expected: 6/6 PASS.

- [ ] **Step 5: Run svelte-check and commit**

```bash
cd ui && npm run check
```
Expected: 0 errors.

```bash
git add ui/src/lib/db/h2hRandom.ts ui/src/lib/db/h2hRandom.test.ts
git commit -m "feat(h2h): random-pairing mode logic (h2hRandom.ts)

New, independent mode alongside the existing king-of-the-hill tournament
in headToHead.ts — reuses recordH2HMatch as-is. Gates the active pool by
removed_reason IS NULL, a separate filter from king-of-the-hill's own
status='reviewing' gate; the two modes share only research_songs and
head_to_head_matches, never each other's derivation logic."
```

---

### Task 5: 4 new H2H random-mode API routes

**Files:**
- Create: `ui/src/routes/api/rounds/[roundId]/h2h/random/start/+server.ts`
- Create: `ui/src/routes/api/rounds/[roundId]/h2h/random/reshuffle/+server.ts`
- Create: `ui/src/routes/api/rounds/[roundId]/h2h/random/select-winner/+server.ts`
- Create: `ui/src/routes/api/rounds/[roundId]/h2h/random/current/+server.ts`
- Test: `ui/src/routes/api/rounds/[roundId]/h2h/random/random.test.ts` (colocated single test file covering all 4 routes)

**Interfaces:**
- Consumes: `startRandomMatchup`/`reshuffleRandomMatchup`/`selectH2HWinner`/`getPendingMatchup` (Task 4), `requireBearerToken` (existing).
- Produces: nothing new for later tasks — Task 10's MCP tools call these 4 routes by URL directly.

Each route follows the exact request/response contract Task 9/10's MCP tools expect:
- `POST .../start` → `201 { songAId, songBId }`, or `400` if fewer than 2 active songs.
- `POST .../reshuffle` → `200 { songAId, songBId }`, or `400` if fewer than 2 active songs remain excluding the current pair.
- `POST .../select-winner` body `{ winnerSongId: number }` → `200 { songAId, songBId: number | null }`, or `400` for an invalid `winnerSongId`.
- `GET .../current` → `200 { songAId, songBId } | null`.

- [ ] **Step 1: Write the failing tests**

Create `ui/src/routes/api/rounds/[roundId]/h2h/random/random.test.ts`:

```ts
import { it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { seedLeagues, upsertSeason } from '$lib/db/leagues.js';
import { upsertRound } from '$lib/db/rounds.js';
import { addResearchSong } from '$lib/db/research.js';

let db: Database.Database;
let roundId: number;

vi.mock('$lib/db/client.js', async (orig) => {
  const actual = await orig<typeof import('$lib/db/client.js')>();
  return { ...actual, getDb: () => db };
});
vi.mock('$lib/auth/bearer.js', () => ({ requireBearerToken: vi.fn() }));

import { POST as startPost } from './start/+server.js';
import { POST as reshufflePost } from './reshuffle/+server.js';
import { POST as selectWinnerPost } from './select-winner/+server.js';
import { GET as currentGet } from './current/+server.js';

function mkEvent(roundIdParam: number, body?: unknown) {
  return {
    params: { roundId: String(roundIdParam) },
    request: { json: () => Promise.resolve(body ?? {}), headers: new Headers() },
  } as any;
}

beforeEach(() => {
  db = openLeagueDb(':memory:');
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 1, 'active');
  roundId = upsertRound(db, seasonId, {
    mlRoundId: 'route-test', name: 'Test Round', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
  for (const letter of ['A', 'B', 'C']) {
    addResearchSong(db, { roundId, spotifyUri: `spotify:track:${letter}`, title: letter, artist: `Artist ${letter}`, album: null });
  }
});

it('GET current returns null before any matchup is started', async () => {
  const res = await currentGet(mkEvent(roundId));
  expect(await res.json()).toBeNull();
});

it('POST start returns 201 with a pairing, then GET current returns it', async () => {
  const res = await startPost(mkEvent(roundId));
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.songAId).toBeDefined();
  expect(body.songBId).toBeDefined();

  const current = await (await currentGet(mkEvent(roundId))).json();
  expect(current).toEqual(body);
});

it('POST reshuffle returns a different pairing', async () => {
  const first = await (await startPost(mkEvent(roundId))).json();
  const res = await reshufflePost(mkEvent(roundId));
  expect(res.status).toBe(200);
  const reshuffled = await res.json();
  expect([first.songAId, first.songBId]).not.toContain(reshuffled.songAId);
});

it('POST select-winner advances the matchup', async () => {
  const started = await (await startPost(mkEvent(roundId))).json();
  const res = await selectWinnerPost(mkEvent(roundId, { winnerSongId: started.songAId }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.songAId).toBe(started.songAId);
});

it('POST select-winner with an invalid id returns 400', async () => {
  await startPost(mkEvent(roundId));
  const res = await selectWinnerPost(mkEvent(roundId, { winnerSongId: 999999 }));
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/routes/api/rounds/\[roundId\]/h2h/random/random.test.ts`
Expected: FAIL — none of the 4 route files exist yet.

- [ ] **Step 3: Implement the 4 route files**

Create `ui/src/routes/api/rounds/[roundId]/h2h/random/start/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { requireBearerToken } from '$lib/auth/bearer.js';
import { startRandomMatchup } from '$lib/db/h2hRandom.js';

export const POST: RequestHandler = async ({ params, request }) => {
  const db = getDb();
  requireBearerToken(request, db);
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');
  try {
    return json(startRandomMatchup(db, roundId), { status: 201 });
  } catch (e) {
    throw error(400, (e as Error).message);
  }
};
```

Create `ui/src/routes/api/rounds/[roundId]/h2h/random/reshuffle/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { requireBearerToken } from '$lib/auth/bearer.js';
import { reshuffleRandomMatchup } from '$lib/db/h2hRandom.js';

export const POST: RequestHandler = async ({ params, request }) => {
  const db = getDb();
  requireBearerToken(request, db);
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');
  try {
    return json(reshuffleRandomMatchup(db, roundId));
  } catch (e) {
    throw error(400, (e as Error).message);
  }
};
```

Create `ui/src/routes/api/rounds/[roundId]/h2h/random/select-winner/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { requireBearerToken } from '$lib/auth/bearer.js';
import { selectH2HWinner } from '$lib/db/h2hRandom.js';

export const POST: RequestHandler = async ({ params, request }) => {
  const db = getDb();
  requireBearerToken(request, db);
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');
  const body = (await request.json().catch(() => null)) as { winnerSongId?: number } | null;
  if (!body?.winnerSongId) throw error(400, 'winnerSongId required');
  try {
    return json(selectH2HWinner(db, roundId, body.winnerSongId));
  } catch (e) {
    throw error(400, (e as Error).message);
  }
};
```

Create `ui/src/routes/api/rounds/[roundId]/h2h/random/current/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { requireBearerToken } from '$lib/auth/bearer.js';
import { getPendingMatchup } from '$lib/db/h2hRandom.js';

export const GET: RequestHandler = async ({ params, request }) => {
  const db = getDb();
  requireBearerToken(request, db);
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');
  return json(getPendingMatchup(db, roundId));
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/routes/api/rounds/\[roundId\]/h2h/random/random.test.ts`
Expected: 5/5 PASS.

- [ ] **Step 5: Run svelte-check and commit**

```bash
cd ui && npm run check
```
Expected: 0 errors.

```bash
git add ui/src/routes/api/rounds/\[roundId\]/h2h/random/
git commit -m "feat(api): 4 new routes for H2H random-pairing mode

POST .../h2h/random/{start,reshuffle,select-winner}, GET .../current.
All require a bearer token (new routes, per this project's auth
convention). Thin wrappers over h2hRandom.ts — no new business logic here."
```

---

### Task 6: `resolve_round` API route

**Files:**
- Create: `ui/src/routes/api/rounds/resolve/+server.ts`
- Test: `ui/src/routes/api/rounds/resolve/resolve.test.ts`

**Interfaces:**
- Produces: `GET /api/rounds/resolve?leagueSlug=&seasonNumber=&roundNumber=|roundName=` → `200 { id, name, roundNumber, phase, seasonNumber, leagueSlug } | 404`. Task 9's `resolve_round` MCP tool calls this route.

- [ ] **Step 1: Write the failing test**

Create `ui/src/routes/api/rounds/resolve/resolve.test.ts`:

```ts
import { it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { seedLeagues, upsertSeason } from '$lib/db/leagues.js';
import { upsertRound } from '$lib/db/rounds.js';

let db: Database.Database;

vi.mock('$lib/db/client.js', async (orig) => {
  const actual = await orig<typeof import('$lib/db/client.js')>();
  return { ...actual, getDb: () => db };
});
vi.mock('$lib/auth/bearer.js', () => ({ requireBearerToken: vi.fn() }));

import { GET } from './+server.js';

function mkEvent(query: Record<string, string>) {
  const url = new URL('http://localhost/api/rounds/resolve');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return { url, request: { headers: new Headers() } } as any;
}

beforeEach(() => {
  db = openLeagueDb(':memory:');
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 3, 'active');
  const roundId = upsertRound(db, seasonId, {
    mlRoundId: 'resolve-test', name: 'Test Round', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
  db.prepare('UPDATE rounds SET round_number = 5 WHERE id = ?').run(roundId);
});

it('resolves by leagueSlug + seasonNumber + roundNumber', async () => {
  const res = await GET(mkEvent({ leagueSlug: 'hip-jammers', seasonNumber: '3', roundNumber: '5' }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.name).toBe('Test Round');
  expect(body.roundNumber).toBe(5);
});

it('resolves by leagueSlug + seasonNumber + roundName', async () => {
  const res = await GET(mkEvent({ leagueSlug: 'hip-jammers', seasonNumber: '3', roundName: 'Test Round' }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.roundNumber).toBe(5);
});

it('returns 404 when nothing matches', async () => {
  const res = await GET(mkEvent({ leagueSlug: 'hip-jammers', seasonNumber: '3', roundNumber: '99' }));
  expect(res.status).toBe(404);
});

it('returns 400 when neither roundNumber nor roundName is given', async () => {
  const res = await GET(mkEvent({ leagueSlug: 'hip-jammers', seasonNumber: '3' }));
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/routes/api/rounds/resolve/resolve.test.ts`
Expected: FAIL — route doesn't exist yet.

- [ ] **Step 3: Implement the route**

Create `ui/src/routes/api/rounds/resolve/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { requireBearerToken } from '$lib/auth/bearer.js';

// GET /api/rounds/resolve?leagueSlug=&seasonNumber=&roundNumber=|roundName=
// Resolves a human-friendly round reference to its stable rounds.id.
// round_number is nullable/manually-curated (see rounds.md design notes),
// so this is a lookup convenience, not a chronology guarantee.
export const GET: RequestHandler = async ({ url, request }) => {
  const db = getDb();
  requireBearerToken(request, db);

  const leagueSlug = url.searchParams.get('leagueSlug');
  const seasonNumber = url.searchParams.get('seasonNumber');
  const roundNumber = url.searchParams.get('roundNumber');
  const roundName = url.searchParams.get('roundName');

  if (!leagueSlug || !seasonNumber) throw error(400, 'leagueSlug and seasonNumber required');
  if (!roundNumber && !roundName) throw error(400, 'one of roundNumber or roundName required');

  const row = roundNumber
    ? db
        .prepare(
          `SELECT r.id, r.name, r.round_number AS roundNumber, r.phase,
                  s.season_number AS seasonNumber, l.slug AS leagueSlug
           FROM rounds r
           JOIN seasons s ON s.id = r.season_id
           JOIN leagues l ON l.id = s.league_id
           WHERE l.slug = ? AND s.season_number = ? AND r.round_number = ?`,
        )
        .get(leagueSlug, Number(seasonNumber), Number(roundNumber))
    : db
        .prepare(
          `SELECT r.id, r.name, r.round_number AS roundNumber, r.phase,
                  s.season_number AS seasonNumber, l.slug AS leagueSlug
           FROM rounds r
           JOIN seasons s ON s.id = r.season_id
           JOIN leagues l ON l.id = s.league_id
           WHERE l.slug = ? AND s.season_number = ? AND r.name = ?`,
        )
        .get(leagueSlug, Number(seasonNumber), roundName);

  if (!row) throw error(404, 'no matching round found');
  return json(row);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/routes/api/rounds/resolve/resolve.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 5: Run svelte-check and commit**

```bash
cd ui && npm run check
```
Expected: 0 errors.

```bash
git add ui/src/routes/api/rounds/resolve/
git commit -m "feat(api): GET /api/rounds/resolve — human-friendly round lookup

Resolves {leagueSlug, seasonNumber, roundNumber|roundName} to a rounds.id.
New route, bearer-token protected. round_number is nullable/manually-
curated — this is a lookup convenience, never a chronology source."
```

---

### Task 7: Incidental fix — H2H rating display + scoring (quality/replayability, not nostalgia/personal)

**Files:**
- Modify: `ui/src/lib/db/headToHead.ts`
- Modify: `ui/src/lib/components/HeadToHeadCard.svelte`
- Test: `ui/src/lib/db/headToHead.candidates.test.ts` (existing file — extend, don't replace)

**Interfaces:**
- Consumes: `computeUnicardScore` (existing, `ui/src/lib/scoring.ts`), `getSettings` (existing, already returns all 6 weight fields including `weightQuality`/`weightReplayability`).
- No interface changes for other tasks — `getH2HCandidates`'s exported signature is unchanged, only its internal scoring formula changes.

This fixes two things found during design research: (1) the H2H tab UI displays the deprecated `nostalgia`/`personal` ratings instead of the current `quality`/`replayability`; (2) `getH2HCandidates`'s `weightedScore` — which drives king-of-the-hill's champion/challenger ordering — is computed via `computeScore` (an alias for the *legacy* 4-axis formula: discovery/theme/personal/nostalgia), not `computeUnicardScore` (the current 4-axis formula: discovery/theme/quality/replayability). Both are fixed together since they're the same root cause.

- [ ] **Step 1: Write the failing test**

Open `ui/src/lib/db/headToHead.candidates.test.ts` and add this test at the end of the file, reusing the file's existing `mkRound(db, mlRoundId?)` helper (defined at the top of the file, returns a plain `roundId: number`) — keep all 4 existing tests in place, do not remove or modify them:

```ts
it('weightedScore is computed from quality/replayability (Unicard), not personal/nostalgia (legacy)', () => {
  const roundId = mkRound(db, 'unicard-scoring-test');
  const row = addResearchSong(db, { roundId, spotifyUri: 'spotify:track:unicard', title: 'U', artist: 'X', album: null });
  updateResearchSong(db, row.id, {
    themeFit: 5, discoveryPotential: 5, quality: 5, replayability: 5,
    // Explicitly no personalRating/nostalgiaPotential — under the legacy
    // formula (computeScore) this song would score null since neither of
    // its two required dims (personal/nostalgia) has a value.
  });
  const candidates = getH2HCandidates(db, roundId);
  const scored = candidates.find(c => c.spotifyUri === 'spotify:track:unicard')!;
  expect(scored.weightedScore).not.toBeNull();
  expect(scored.weightedScore).toBe(20); // max score: all 4 Unicard dims rated 5/5
});
```

I hand-verified (by computing `computeUnicardScore`'s formula by hand against this file's 4 existing tests' exact seeded ratings) that none of the 4 pre-existing tests' assertions change under this fix — they only assert the top/bottom candidate and monotonic ordering (test 1), status filtering (test 2), null-sorts-last behavior (test 3), or round-scoping (test 4), never an exact `weightedScore` number for a song with only legacy ratings set. No existing assertion needs updating.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/db/headToHead.candidates.test.ts`
Expected: the new test FAILs (`weightedScore` is `null` under the current legacy formula, since the test song has no `personalRating`/`nostalgiaPotential`); all pre-existing tests in the file still PASS (untouched).

- [ ] **Step 3: Fix `getH2HCandidates`'s scoring**

In `ui/src/lib/db/headToHead.ts`, change the import (line 3):

```ts
import { computeScore } from '../scoring.js';
```

to:

```ts
import { computeUnicardScore } from '../scoring.js';
```

Change `getH2HCandidates` (lines 28-41):

```ts
export function getH2HCandidates(db: Database.Database, roundId: number): H2HCandidate[] {
  const rows = db.prepare(`
    SELECT rs.*, ylc.ytm_url AS ytm_url
    FROM research_songs rs
    LEFT JOIN ytm_link_cache ylc ON ylc.spotify_uri = rs.spotify_uri
    WHERE rs.round_id = ? AND rs.status = ?
  `).all(roundId, ELIGIBLE_STATUS) as any[];
  const weights = getSettings(db);
  return rows
    .map(r => candidateRow(r, computeScore({
      discoveryPotential: r.discovery_potential,
      themeFit: r.theme_fit,
      personalRating: r.personal_rating,
      nostalgiaPotential: r.nostalgia_potential,
    }, weights)))
    .sort((a, b) => (b.weightedScore ?? -Infinity) - (a.weightedScore ?? -Infinity));
}
```

to:

```ts
export function getH2HCandidates(db: Database.Database, roundId: number): H2HCandidate[] {
  const rows = db.prepare(`
    SELECT rs.*, ylc.ytm_url AS ytm_url
    FROM research_songs rs
    LEFT JOIN ytm_link_cache ylc ON ylc.spotify_uri = rs.spotify_uri
    WHERE rs.round_id = ? AND rs.status = ?
  `).all(roundId, ELIGIBLE_STATUS) as any[];
  const weights = getSettings(db);
  return rows
    .map(r => candidateRow(r, computeUnicardScore({
      discovery: r.discovery_potential,
      themeFit: r.theme_fit,
      quality: r.quality,
      replayability: r.replayability,
    }, weights)))
    .sort((a, b) => (b.weightedScore ?? -Infinity) - (a.weightedScore ?? -Infinity));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/db/headToHead.candidates.test.ts`
Expected: all 5 tests PASS (the 4 pre-existing ones plus the new one) — per the hand-verification above, none of the 4 pre-existing assertions depend on an exact `weightedScore` number for a legacy-only-rated song, so no existing assertion needs changing.

- [ ] **Step 5: Fix `HeadToHeadCard.svelte`'s display**

In `ui/src/lib/components/HeadToHeadCard.svelte`, change the `H2HCardSong` type (lines 18-29):

```ts
export type H2HCardSong = {
  id: number;
  artist: string;
  title: string;
  spotifyUri?: string | null;
  themeFit: number | null;
  discoveryPotential: number | null;
  nostalgiaPotential: number | null;
  personalRating: number | null;
  notes: string | null;
  weightedScore: number | null;
};
```

to:

```ts
export type H2HCardSong = {
  id: number;
  artist: string;
  title: string;
  spotifyUri?: string | null;
  themeFit: number | null;
  discoveryPotential: number | null;
  quality: number | null;
  replayability: number | null;
  notes: string | null;
  weightedScore: number | null;
};
```

Change the `dims` array (lines 51-56):

```ts
const dims = [
  { key: 'themeFit',           label: 'Theme'     },
  { key: 'discoveryPotential', label: 'Discovery' },
  { key: 'nostalgiaPotential', label: 'Nostalgia' },
  { key: 'personalRating',     label: 'Personal'  },
] as const;
```

to:

```ts
const dims = [
  { key: 'themeFit',           label: 'Theme'       },
  { key: 'discoveryPotential', label: 'Discovery'   },
  { key: 'quality',            label: 'Quality'     },
  { key: 'replayability',      label: 'Replayability' },
] as const;
```

Change the optimistic-update mapping inside `setRating` (lines 92-98):

```ts
local = {
  ...local,
  themeFit: body.themeFit ?? local.themeFit,
  discoveryPotential: body.discoveryPotential ?? local.discoveryPotential,
  nostalgiaPotential: body.nostalgiaPotential ?? local.nostalgiaPotential,
  personalRating: body.personalRating ?? local.personalRating,
  weightedScore:
```

to:

```ts
local = {
  ...local,
  themeFit: body.themeFit ?? local.themeFit,
  discoveryPotential: body.discoveryPotential ?? local.discoveryPotential,
  quality: body.quality ?? local.quality,
  replayability: body.replayability ?? local.replayability,
  weightedScore:
```

Check the rest of this file (`grep -n "nostalgiaPotential\|personalRating" ui/src/lib/components/HeadToHeadCard.svelte`) for any remaining references (e.g. in `computeScore(optimistic, weights)` calls inside `setRating` — that call passes `optimistic`/`local`, which is a `H2HCardSong` object; since the type no longer has `nostalgiaPotential`/`personalRating`, TypeScript will catch any remaining mismatches. If `computeScore` is called anywhere in this file, change it to `computeUnicardScore` matching Task 7 Step 3's reasoning, and update its `weights` param type to match (`UnicardWeights` instead of `Weights`, both from `$lib/scoring.js`).

- [ ] **Step 6: Check the round research page for related references**

Run: `grep -n "nostalgiaPotential\|personalRating" ui/src/routes/league/\[league\]/season/\[n\]/round/\[roundId\]/+page.svelte`

If this file passes `nostalgiaPotential`/`personalRating` into a `H2HCardSong`-typed prop, update it to pass `quality`/`replayability` instead, following the same pattern as Step 5. If it's an unrelated usage (e.g. a different, non-H2H rating display on the same page), leave it alone — only touch code that constructs or consumes an `H2HCardSong`.

- [ ] **Step 7: Run svelte-check, full research_songs/headToHead test suite, and commit**

```bash
cd ui && npm run check
```
Expected: 0 errors.

```bash
cd ui && npx vitest run src/lib/db/headToHead.candidates.test.ts src/lib/db/h2hRandom.test.ts
```
Expected: all PASS.

```bash
git add ui/src/lib/db/headToHead.ts ui/src/lib/components/HeadToHeadCard.svelte ui/src/lib/db/headToHead.candidates.test.ts ui/src/routes/league/\[league\]/season/\[n\]/round/\[roundId\]/+page.svelte
git commit -m "fix(h2h): use current quality/replayability ratings, not legacy pair

getH2HCandidates now scores via computeUnicardScore (discovery/theme/
quality/replayability) instead of the legacy computeScore alias
(discovery/theme/personal/nostalgia) — this also fixes king-of-the-hill's
champion/challenger ordering, which was silently using the deprecated
formula. HeadToHeadCard's rating dots/labels updated to match."
```

---

### Task 8: `mcp-server` package scaffolding + HTTP client

**Files:**
- Create: `mcp-server/package.json`
- Create: `mcp-server/tsconfig.json`
- Create: `mcp-server/vitest.config.ts`
- Create: `mcp-server/.env.example`
- Create: `mcp-server/src/httpClient.ts`
- Create: `mcp-server/src/server.ts`
- Create: `mcp-server/src/index.ts`
- Test: `mcp-server/src/httpClient.test.ts`

**Interfaces:**
- Produces: `botUiFetch<T>(path: string, init?: RequestInit): Promise<T>` — every tool task (9, 10, 11) calls this exclusively for HTTP access. `createServer(): McpServer` — a bare server with no tools registered yet; Tasks 9-11 each call `server.tool(...)` on the instance this factory returns (via a shared module-level export, see Task 9 Step 1 for exactly how tool files attach to it).

- [ ] **Step 1: Create the package files**

Create `mcp-server/package.json`:

```json
{
  "name": "music-league-mcp-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.4",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

Create `mcp-server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

Create `mcp-server/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
```

Create `mcp-server/.env.example`:

```
# Base URL of the running bot-ui app (SvelteKit server).
BOT_UI_BASE_URL=http://localhost:3002

# Bearer token minted via the app's Settings → API tokens page.
BOT_UI_API_TOKEN=
```

- [ ] **Step 2: Write the failing test for `httpClient.ts`**

Create `mcp-server/src/httpClient.test.ts`:

```ts
import { it, expect, beforeEach, vi, afterEach } from 'vitest';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.BOT_UI_BASE_URL = 'http://localhost:3002';
  process.env.BOT_UI_API_TOKEN = 'test-token';
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
  vi.resetModules();
});

it('sends the bearer token and base URL on every request', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  global.fetch = fetchMock as any;

  const { botUiFetch } = await import('./httpClient.js');
  const result = await botUiFetch('/api/rounds/resolve?leagueSlug=x&seasonNumber=1&roundNumber=1');

  expect(fetchMock).toHaveBeenCalledWith(
    'http://localhost:3002/api/rounds/resolve?leagueSlug=x&seasonNumber=1&roundNumber=1',
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
    }),
  );
  expect(result).toEqual({ ok: true });
});

it('throws a descriptive error on a non-2xx response', async () => {
  global.fetch = vi.fn().mockResolvedValue(new Response('round not found: 999', { status: 404 })) as any;
  const { botUiFetch } = await import('./httpClient.js');
  await expect(botUiFetch('/api/rounds/resolve')).rejects.toThrow(/404/);
});

it('throws if BOT_UI_BASE_URL is not configured', async () => {
  delete process.env.BOT_UI_BASE_URL;
  const { botUiFetch } = await import('./httpClient.js');
  await expect(botUiFetch('/api/rounds/resolve')).rejects.toThrow(/BOT_UI_BASE_URL/);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd mcp-server && npm install && npx vitest run src/httpClient.test.ts`
Expected: FAIL — `httpClient.ts` doesn't exist yet.

- [ ] **Step 4: Implement `httpClient.ts`**

Create `mcp-server/src/httpClient.ts`:

```ts
// Every MCP tool talks to the bot-ui app exclusively through this function —
// no tool file ever imports from ui/src/lib or opens the sqlite file
// directly (see the plan's Global Constraints).
export async function botUiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = process.env.BOT_UI_BASE_URL;
  if (!baseUrl) throw new Error('BOT_UI_BASE_URL is not configured (see .env.example)');
  const token = process.env.BOT_UI_API_TOKEN;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`bot-ui request failed: ${init.method ?? 'GET'} ${path} → ${res.status} ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run src/httpClient.test.ts`
Expected: 3/3 PASS.

- [ ] **Step 6: Create the server factory and entrypoint**

Create `mcp-server/src/server.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Transport-agnostic: this factory registers every tool (Tasks 9-11 each
// call `.tool(...)` on the instance returned here) but never connects a
// transport itself. index.ts picks stdio today; an HTTP/SSE entrypoint
// later just imports this same factory and connects a different transport.
export function createServer(): McpServer {
  return new McpServer({
    name: 'music-league-mcp-server',
    version: '0.1.0',
  });
}
```

Create `mcp-server/src/index.ts`:

```ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { registerRoundTools } from './tools/rounds.js';
import { registerSongTools } from './tools/songs.js';
import { registerH2HTools } from './tools/h2h.js';
import { registerDigestTools } from './tools/digest.js';

const server = createServer();
registerRoundTools(server);
registerSongTools(server);
registerH2HTools(server);
registerDigestTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
```

(`index.ts` imports 4 tool-registration modules that don't exist yet — this is expected and resolved by Tasks 9-11. This task's own verification only covers `httpClient.ts` and the scaffolding files; `index.ts`/`server.ts` are wired up but not yet runnable end-to-end.)

- [ ] **Step 7: Verify the package typechecks for what exists so far**

`index.ts` will show "module not found" errors for the 4 tool-registration imports until Tasks 9-11 land — this is expected, not a failure of this task. Confirm `httpClient.ts` and `server.ts` alone typecheck cleanly:

```bash
cd mcp-server && npx tsc --noEmit src/httpClient.ts src/server.ts
```
Expected: 0 errors.

- [ ] **Step 8: Add `mcp-server/` to root gitignore patterns and commit**

Check `/home/loydmilligan/Projects/music-league-bot/.gitignore` for a `node_modules`/`dist` pattern that already covers subdirectories (e.g. `**/node_modules/`, `**/dist/`) — if one already exists, no change needed. If not, add `mcp-server/node_modules/` and `mcp-server/dist/` to the root `.gitignore`.

```bash
git add mcp-server/package.json mcp-server/tsconfig.json mcp-server/vitest.config.ts mcp-server/.env.example mcp-server/src/httpClient.ts mcp-server/src/httpClient.test.ts mcp-server/src/server.ts mcp-server/src/index.ts
git add .gitignore  # only if it was changed in this step
git commit -m "feat(mcp-server): package scaffolding + botUiFetch HTTP client

New standalone package, greenfield in this monorepo (no existing
precedent — src/api is a plain tsx script inside the root package, not a
separate package.json). index.ts references 4 tool-registration modules
that land in Tasks 9-11; expected to not yet resolve until then."
```

---

### Task 9: MCP tools — rounds + song list

**Files:**
- Create: `mcp-server/src/tools/rounds.ts`
- Create: `mcp-server/src/tools/songs.ts`
- Test: `mcp-server/src/tools/rounds.test.ts`
- Test: `mcp-server/src/tools/songs.test.ts`

**Interfaces:**
- Consumes: `botUiFetch` (Task 8), `McpServer` (Task 8's `createServer()`).
- Produces: `registerRoundTools(server: McpServer): void` (registers `resolve_round`), `registerSongTools(server: McpServer): void` (registers `add_song_to_round`, `add_song_to_shortlist`, `update_song`, `remove_song_from_round`, `list_round_songs`). `index.ts` (Task 8) already imports and calls both.

Each tool's handler is a thin `zod`-validated wrapper that calls one `botUiFetch` and returns its JSON result as MCP tool content. Testing strategy: call the registered handler function directly (via the `McpServer`'s internal tool registry is not simply introspectable — instead, each test imports the tool module, calls `registerXTools` on a real `McpServer` instance, and drives it through the SDK's `Client`/`InMemoryTransport` pair, OR — simpler and used here — each tool's core logic is exported as a plain async function separately from the `server.tool(...)` registration call, so tests import and call that plain function directly without needing an MCP client/transport round-trip at all).

- [ ] **Step 1: Write the failing tests**

Create `mcp-server/src/tools/rounds.test.ts`:

```ts
import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../httpClient.js', () => ({ botUiFetch: vi.fn() }));

import { botUiFetch } from '../httpClient.js';
import { resolveRound } from './rounds.js';

beforeEach(() => { vi.mocked(botUiFetch).mockReset(); });

it('resolveRound calls the resolve endpoint with the given params', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ id: 42, name: 'Round X', roundNumber: 5, phase: 'complete', seasonNumber: 3, leagueSlug: 'hip-jammers' });

  const result = await resolveRound({ leagueSlug: 'hip-jammers', seasonNumber: 3, roundNumber: 5 });

  expect(botUiFetch).toHaveBeenCalledWith(
    '/api/rounds/resolve?leagueSlug=hip-jammers&seasonNumber=3&roundNumber=5',
  );
  expect(result.id).toBe(42);
});

it('resolveRound supports roundName instead of roundNumber', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ id: 42, name: 'Round X', roundNumber: 5, phase: 'complete', seasonNumber: 3, leagueSlug: 'hip-jammers' });

  await resolveRound({ leagueSlug: 'hip-jammers', seasonNumber: 3, roundName: 'Round X' });

  expect(botUiFetch).toHaveBeenCalledWith(
    '/api/rounds/resolve?leagueSlug=hip-jammers&seasonNumber=3&roundName=Round+X',
  );
});
```

Create `mcp-server/src/tools/songs.test.ts`:

```ts
import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../httpClient.js', () => ({ botUiFetch: vi.fn() }));

import { botUiFetch } from '../httpClient.js';
import { addSongToRound, addSongToShortlist, updateSong, removeSongFromRound, listRoundSongs } from './songs.js';

beforeEach(() => { vi.mocked(botUiFetch).mockReset(); });

it('addSongToRound POSTs to the cascade route', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ shortlistSongId: 'uuid-1', researchSongId: 7 });

  const result = await addSongToRound({
    roundId: 1, spotifyUri: 'spotify:track:a', title: 'Song', artist: 'Artist',
    notes: 'good pick', ratings: { discovery: 4, themeFit: 5, quality: 3, replayability: 4 },
  });

  expect(botUiFetch).toHaveBeenCalledWith('/api/rounds/1/research-songs', {
    method: 'POST',
    body: JSON.stringify({
      spotifyUri: 'spotify:track:a', title: 'Song', artist: 'Artist', album: undefined,
      notes: 'good pick',
      ratings: { discoveryPotential: 4, themeFit: 5, quality: 3, replayability: 4 },
    }),
  });
  expect(result.researchSongId).toBe(7);
});

it('addSongToShortlist POSTs to the existing shortlist route with snake_case body', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ id: 'uuid-2' });

  await addSongToShortlist({ spotifyUri: 'spotify:track:b', title: 'Song B', artist: 'Artist B', album: 'Album B' });

  expect(botUiFetch).toHaveBeenCalledWith('/api/shortlist', {
    method: 'POST',
    body: JSON.stringify({ spotify_uri: 'spotify:track:b', title: 'Song B', artist: 'Artist B', album: 'Album B' }),
  });
});

it('updateSong PATCHes the research route', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ id: 7, notes: 'updated' });

  await updateSong({ researchSongId: 7, roundId: 1, notes: 'updated', ratings: { quality: 5 } });

  expect(botUiFetch).toHaveBeenCalledWith('/api/research/1', {
    method: 'PATCH',
    body: JSON.stringify({ id: 7, notes: 'updated', quality: 5 }),
  });
});

it('removeSongFromRound PATCHes with removedReason=user_removed', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ id: 7 });

  await removeSongFromRound({ researchSongId: 7, roundId: 1 });

  expect(botUiFetch).toHaveBeenCalledWith('/api/research/1', {
    method: 'PATCH',
    body: JSON.stringify({ id: 7, removedReason: 'user_removed', removedAt: expect.any(String) }),
  });
});

it('listRoundSongs GETs the research route with includeRemoved passed through', async () => {
  vi.mocked(botUiFetch).mockResolvedValue([]);

  await listRoundSongs({ roundId: 1, includeRemoved: true });

  expect(botUiFetch).toHaveBeenCalledWith('/api/research/1?includeRemoved=true');
});

it('listRoundSongs defaults includeRemoved to false (omitted from the query string)', async () => {
  vi.mocked(botUiFetch).mockResolvedValue([]);

  await listRoundSongs({ roundId: 1 });

  expect(botUiFetch).toHaveBeenCalledWith('/api/research/1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run src/tools/rounds.test.ts src/tools/songs.test.ts`
Expected: FAIL — neither module exists yet.

- [ ] **Step 3: Implement `rounds.ts`**

Create `mcp-server/src/tools/rounds.ts`:

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { botUiFetch } from '../httpClient.js';

export interface ResolvedRound {
  id: number;
  name: string;
  roundNumber: number | null;
  phase: string;
  seasonNumber: number;
  leagueSlug: string;
}

export interface ResolveRoundInput {
  leagueSlug: string;
  seasonNumber: number;
  roundNumber?: number;
  roundName?: string;
}

export async function resolveRound(input: ResolveRoundInput): Promise<ResolvedRound> {
  const params = new URLSearchParams({
    leagueSlug: input.leagueSlug,
    seasonNumber: String(input.seasonNumber),
  });
  if (input.roundNumber !== undefined) params.set('roundNumber', String(input.roundNumber));
  else if (input.roundName !== undefined) params.set('roundName', input.roundName);
  return botUiFetch<ResolvedRound>(`/api/rounds/resolve?${params.toString()}`);
}

export function registerRoundTools(server: McpServer): void {
  server.tool(
    'resolve_round',
    'Resolve a human-friendly round reference (league slug, season number, and either a round number or round name) to its stable round id.',
    {
      leagueSlug: z.string().describe('The league slug, e.g. "hip-jammers"'),
      seasonNumber: z.number().int().describe('The season number within the league'),
      roundNumber: z.number().int().optional().describe('The round number, if known'),
      roundName: z.string().optional().describe('The round name/theme, if roundNumber is not known'),
    },
    async (input) => {
      const round = await resolveRound(input);
      return { content: [{ type: 'text', text: JSON.stringify(round) }] };
    },
  );
}
```

- [ ] **Step 4: Implement `songs.ts`**

Create `mcp-server/src/tools/songs.ts`:

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { botUiFetch } from '../httpClient.js';

const ratingsShape = {
  discovery: z.number().min(0).max(5).optional(),
  themeFit: z.number().min(0).max(5).optional(),
  quality: z.number().min(0).max(5).optional(),
  replayability: z.number().min(0).max(5).optional(),
};

export interface RatingsInput {
  discovery?: number;
  themeFit?: number;
  quality?: number;
  replayability?: number;
}

export interface AddSongToRoundInput {
  roundId: number;
  spotifyUri: string;
  title: string;
  artist: string;
  album?: string;
  notes?: string;
  ratings?: RatingsInput;
}

export async function addSongToRound(input: AddSongToRoundInput) {
  return botUiFetch(`/api/rounds/${input.roundId}/research-songs`, {
    method: 'POST',
    body: JSON.stringify({
      spotifyUri: input.spotifyUri, title: input.title, artist: input.artist, album: input.album,
      notes: input.notes,
      ratings: input.ratings && {
        discoveryPotential: input.ratings.discovery,
        themeFit: input.ratings.themeFit,
        quality: input.ratings.quality,
        replayability: input.ratings.replayability,
      },
    }),
  });
}

export interface AddSongToShortlistInput {
  spotifyUri: string;
  title: string;
  artist: string;
  album?: string;
}

export async function addSongToShortlist(input: AddSongToShortlistInput) {
  return botUiFetch('/api/shortlist', {
    method: 'POST',
    body: JSON.stringify({
      spotify_uri: input.spotifyUri, title: input.title, artist: input.artist, album: input.album,
    }),
  });
}

export interface UpdateSongInput {
  researchSongId: number;
  roundId: number;
  notes?: string;
  ratings?: RatingsInput;
}

export async function updateSong(input: UpdateSongInput) {
  const body: Record<string, unknown> = { id: input.researchSongId };
  if (input.notes !== undefined) body.notes = input.notes;
  if (input.ratings?.discovery !== undefined) body.discoveryPotential = input.ratings.discovery;
  if (input.ratings?.themeFit !== undefined) body.themeFit = input.ratings.themeFit;
  if (input.ratings?.quality !== undefined) body.quality = input.ratings.quality;
  if (input.ratings?.replayability !== undefined) body.replayability = input.ratings.replayability;
  return botUiFetch(`/api/research/${input.roundId}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export interface RemoveSongFromRoundInput {
  researchSongId: number;
  roundId: number;
}

export async function removeSongFromRound(input: RemoveSongFromRoundInput) {
  return botUiFetch(`/api/research/${input.roundId}`, {
    method: 'PATCH',
    body: JSON.stringify({ id: input.researchSongId, removedReason: 'user_removed', removedAt: new Date().toISOString() }),
  });
}

export interface ListRoundSongsInput {
  roundId: number;
  includeRemoved?: boolean;
}

export async function listRoundSongs(input: ListRoundSongsInput) {
  const query = input.includeRemoved ? '?includeRemoved=true' : '';
  return botUiFetch(`/api/research/${input.roundId}${query}`);
}

export function registerSongTools(server: McpServer): void {
  server.tool(
    'add_song_to_round',
    "Add a song to a round's active research/candidate list. Also ensures it exists on the global shortlist.",
    {
      roundId: z.number().int(), spotifyUri: z.string(), title: z.string(), artist: z.string(),
      album: z.string().optional(), notes: z.string().optional(),
      ratings: z.object(ratingsShape).optional(),
    },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await addSongToRound(input)) }] }),
  );

  server.tool(
    'add_song_to_shortlist',
    'Add a song to the global shortlist only (no round association).',
    { spotifyUri: z.string(), title: z.string(), artist: z.string(), album: z.string().optional() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await addSongToShortlist(input)) }] }),
  );

  server.tool(
    'update_song',
    "Update a song's notes and/or ratings on a round's research list.",
    {
      researchSongId: z.number().int(), roundId: z.number().int(),
      notes: z.string().optional(), ratings: z.object(ratingsShape).optional(),
    },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await updateSong(input)) }] }),
  );

  server.tool(
    'remove_song_from_round',
    "Remove a song from a round's active research list (soft-remove, reason recorded as user_removed).",
    { researchSongId: z.number().int(), roundId: z.number().int() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await removeSongFromRound(input)) }] }),
  );

  server.tool(
    'list_round_songs',
    "List a round's research/candidate songs.",
    { roundId: z.number().int(), includeRemoved: z.boolean().optional() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await listRoundSongs(input)) }] }),
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run src/tools/rounds.test.ts src/tools/songs.test.ts`
Expected: all PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
cd mcp-server && npx tsc --noEmit src/tools/rounds.ts src/tools/songs.ts src/httpClient.ts
```
Expected: 0 errors.

```bash
git add mcp-server/src/tools/rounds.ts mcp-server/src/tools/songs.ts mcp-server/src/tools/rounds.test.ts mcp-server/src/tools/songs.test.ts
git commit -m "feat(mcp-server): resolve_round + song-list tools

resolve_round, add_song_to_round, add_song_to_shortlist, update_song,
remove_song_from_round, list_round_songs. Each is a plain exported async
function (unit-testable without an MCP client) plus a thin server.tool()
registration wrapper."
```

---

### Task 10: MCP tools — H2H random matchups

**Files:**
- Create: `mcp-server/src/tools/h2h.ts`
- Test: `mcp-server/src/tools/h2h.test.ts`

**Interfaces:**
- Consumes: `botUiFetch` (Task 8).
- Produces: `registerH2HTools(server: McpServer): void` (registers `start_random_matchup`, `reshuffle_random_matchup`, `select_h2h_winner`, `get_current_matchup`). `index.ts` (Task 8) already imports and calls this.

- [ ] **Step 1: Write the failing test**

Create `mcp-server/src/tools/h2h.test.ts`:

```ts
import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../httpClient.js', () => ({ botUiFetch: vi.fn() }));

import { botUiFetch } from '../httpClient.js';
import { startRandomMatchup, reshuffleRandomMatchup, selectH2HWinner, getCurrentMatchup } from './h2h.js';

beforeEach(() => { vi.mocked(botUiFetch).mockReset(); });

it('startRandomMatchup POSTs to the start route', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ songAId: 1, songBId: 2 });
  const result = await startRandomMatchup({ roundId: 5 });
  expect(botUiFetch).toHaveBeenCalledWith('/api/rounds/5/h2h/random/start', { method: 'POST' });
  expect(result).toEqual({ songAId: 1, songBId: 2 });
});

it('reshuffleRandomMatchup POSTs to the reshuffle route', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ songAId: 3, songBId: 4 });
  await reshuffleRandomMatchup({ roundId: 5 });
  expect(botUiFetch).toHaveBeenCalledWith('/api/rounds/5/h2h/random/reshuffle', { method: 'POST' });
});

it('selectH2HWinner POSTs the winnerSongId', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ songAId: 1, songBId: null });
  await selectH2HWinner({ roundId: 5, winnerSongId: 1 });
  expect(botUiFetch).toHaveBeenCalledWith('/api/rounds/5/h2h/random/select-winner', {
    method: 'POST', body: JSON.stringify({ winnerSongId: 1 }),
  });
});

it('getCurrentMatchup GETs the current route', async () => {
  vi.mocked(botUiFetch).mockResolvedValue(null);
  const result = await getCurrentMatchup({ roundId: 5 });
  expect(botUiFetch).toHaveBeenCalledWith('/api/rounds/5/h2h/random/current');
  expect(result).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run src/tools/h2h.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `h2h.ts`**

Create `mcp-server/src/tools/h2h.ts`:

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { botUiFetch } from '../httpClient.js';

export interface Matchup {
  songAId: number;
  songBId: number | null;
}

export async function startRandomMatchup(input: { roundId: number }): Promise<Matchup> {
  return botUiFetch(`/api/rounds/${input.roundId}/h2h/random/start`, { method: 'POST' });
}

export async function reshuffleRandomMatchup(input: { roundId: number }): Promise<Matchup> {
  return botUiFetch(`/api/rounds/${input.roundId}/h2h/random/reshuffle`, { method: 'POST' });
}

export async function selectH2HWinner(input: { roundId: number; winnerSongId: number }): Promise<Matchup> {
  return botUiFetch(`/api/rounds/${input.roundId}/h2h/random/select-winner`, {
    method: 'POST',
    body: JSON.stringify({ winnerSongId: input.winnerSongId }),
  });
}

export async function getCurrentMatchup(input: { roundId: number }): Promise<Matchup | null> {
  return botUiFetch(`/api/rounds/${input.roundId}/h2h/random/current`);
}

export function registerH2HTools(server: McpServer): void {
  server.tool(
    'start_random_matchup',
    "Pick 2 random active songs from a round's research list to face off. Returns their research-song ids (call list_round_songs for titles/artists/spotify URIs).",
    { roundId: z.number().int() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await startRandomMatchup(input)) }] }),
  );

  server.tool(
    'reshuffle_random_matchup',
    'Replace the current pending matchup with 2 different random active songs.',
    { roundId: z.number().int() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await reshuffleRandomMatchup(input)) }] }),
  );

  server.tool(
    'select_h2h_winner',
    "Record the winner of the current matchup. The loser is removed from the round's research list. A new random challenger automatically faces the winner (songBId is null if no challengers remain).",
    { roundId: z.number().int(), winnerSongId: z.number().int() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await selectH2HWinner(input)) }] }),
  );

  server.tool(
    'get_current_matchup',
    "Get the currently-pending random-mode matchup for a round, or null if none is active.",
    { roundId: z.number().int() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await getCurrentMatchup(input)) }] }),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run src/tools/h2h.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
cd mcp-server && npx tsc --noEmit src/tools/h2h.ts
```
Expected: 0 errors.

```bash
git add mcp-server/src/tools/h2h.ts mcp-server/src/tools/h2h.test.ts
git commit -m "feat(mcp-server): H2H random-matchup tools

start_random_matchup, reshuffle_random_matchup, select_h2h_winner,
get_current_matchup — thin wrappers over the 4 routes added in Task 5."
```

---

### Task 11: MCP tools — digest generation

**Files:**
- Create: `mcp-server/src/tools/digest.ts`
- Test: `mcp-server/src/tools/digest.test.ts`

**Interfaces:**
- Consumes: `botUiFetch` (Task 8).
- Produces: `registerDigestTools(server: McpServer): void` (registers `check_digest_readiness`, `generate_digest`). `index.ts` (Task 8) already imports and calls this — this is the last of the 4 tool-registration modules `index.ts` needs, so this task also makes `index.ts` fully resolvable for the first time.

- [ ] **Step 1: Write the failing test**

Create `mcp-server/src/tools/digest.test.ts`:

```ts
import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../httpClient.js', () => ({ botUiFetch: vi.fn() }));

import { botUiFetch } from '../httpClient.js';
import { checkDigestReadiness, generateDigest } from './digest.js';

beforeEach(() => { vi.mocked(botUiFetch).mockReset(); });

it('checkDigestReadiness POSTs to the prepare route', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ checks: [{ name: 'Submissions', ok: true, src: 'ml_submissions' }] });
  const result = await checkDigestReadiness({ roundId: 5 });
  expect(botUiFetch).toHaveBeenCalledWith('/api/digest/5/prepare', { method: 'POST' });
  expect(result.checks).toHaveLength(1);
});

it('generateDigest POSTs an empty body when no params are given (uses defaults/cache)', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ cached: true, draft: {}, sections: [] });
  await generateDigest({ roundId: 5 });
  expect(botUiFetch).toHaveBeenCalledWith('/api/digest/5/draft', { method: 'POST', body: JSON.stringify({}) });
});

it('generateDigest passes through sections/pastedChat/recap when given', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ cached: false, draft: {}, sections: [] });
  await generateDigest({
    roundId: 5,
    sections: [{ id: 'podium', enabled: true }],
    pastedChat: 'chat text',
    recap: { enabled: true, final: false },
  });
  expect(botUiFetch).toHaveBeenCalledWith('/api/digest/5/draft', {
    method: 'POST',
    body: JSON.stringify({
      sections: [{ id: 'podium', enabled: true }],
      pastedChat: 'chat text',
      recap: { enabled: true, final: false },
    }),
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run src/tools/digest.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `digest.ts`**

Create `mcp-server/src/tools/digest.ts`:

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { botUiFetch } from '../httpClient.js';

export interface PrepareCheck {
  name: string;
  ok: boolean;
  src: string;
  count?: number;
  optional?: boolean;
}

export async function checkDigestReadiness(input: { roundId: number }): Promise<{ checks: PrepareCheck[] }> {
  return botUiFetch(`/api/digest/${input.roundId}/prepare`, { method: 'POST' });
}

export interface GenerateDigestInput {
  roundId: number;
  sections?: Array<{ id: string; enabled?: boolean; style?: string[]; variant?: 'textual' | 'visual' | 'both'; context?: string }>;
  pastedChat?: string;
  recap?: { enabled: boolean; final?: boolean };
}

export async function generateDigest(input: GenerateDigestInput) {
  const { roundId, ...genParams } = input;
  return botUiFetch(`/api/digest/${roundId}/draft`, { method: 'POST', body: JSON.stringify(genParams) });
}

const sectionShape = z.object({
  id: z.string(),
  enabled: z.boolean().optional(),
  style: z.array(z.string()).optional(),
  variant: z.enum(['textual', 'visual', 'both']).optional(),
  context: z.string().optional(),
});

export function registerDigestTools(server: McpServer): void {
  server.tool(
    'check_digest_readiness',
    "Check whether a round has everything needed to generate its digest (submissions, votes, comments, album art, etc). Returns each prerequisite's status.",
    { roundId: z.number().int() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await checkDigestReadiness(input)) }] }),
  );

  server.tool(
    'generate_digest',
    "Generate (or fetch the cached) digest draft for a round. Omit sections/pastedChat/recap to use defaults or return the existing cached draft.",
    {
      roundId: z.number().int(),
      sections: z.array(sectionShape).optional(),
      pastedChat: z.string().optional(),
      recap: z.object({ enabled: z.boolean(), final: z.boolean().optional() }).optional(),
    },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await generateDigest(input)) }] }),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run src/tools/digest.test.ts`
Expected: 3/3 PASS.

- [ ] **Step 5: Typecheck the whole package now that all 4 tool modules exist**

```bash
cd mcp-server && npx tsc --noEmit
```
Expected: 0 errors — `index.ts`'s 4 tool-registration imports all resolve now.

```bash
cd mcp-server && npx vitest run
```
Expected: all tests across every `src/**/*.test.ts` file PASS.

- [ ] **Step 6: Commit**

```bash
git add mcp-server/src/tools/digest.ts mcp-server/src/tools/digest.test.ts
git commit -m "feat(mcp-server): digest generation tools

check_digest_readiness, generate_digest. This completes index.ts's 4
tool-registration imports — the package typechecks end-to-end for the
first time."
```

---

### Task 12: Wire-up verification + README

**Files:**
- Create: `mcp-server/README.md`

**Interfaces:** none — this is an end-to-end verification and documentation task, no new code interfaces.

- [ ] **Step 1: Build the package**

```bash
cd mcp-server && npm run build
```
Expected: `dist/index.js` and friends are created, 0 tsc errors.

- [ ] **Step 2: Manually mint a bearer token**

```bash
cd ui && npm run dev -- --host --port 51XX
```
(pick an unused port). In a browser, go to Settings → API tokens, create a token labeled "mcp-server-dev", copy the plaintext token shown once. Kill the dev server after.

- [ ] **Step 3: Run the server standalone and verify it starts without crashing**

```bash
cd mcp-server
BOT_UI_BASE_URL=http://localhost:3002 BOT_UI_API_TOKEN=<paste-token> node dist/index.js &
sleep 1
kill %1
```
Expected: the process starts and stays running (stdio servers block waiting for a client — starting and then being killed without an error/stack-trace printed to stderr is the pass condition; it will not print anything on success since no MCP client connected).

- [ ] **Step 4: Manual smoke test through a real Claude Code MCP connection (if the bot-ui app is reachable in this environment)**

If a bot-ui instance is genuinely reachable (real DB with real rounds), configure `mcp-server` in Claude Code's MCP settings pointing at the built `dist/index.js` with the env vars from Step 2, restart Claude Code, and manually exercise: `resolve_round` for a known league/season/round, `list_round_songs` for that round, `start_random_matchup` → `select_h2h_winner` → confirm `get_current_matchup` shows a new challenger, `check_digest_readiness`. If no reachable bot-ui instance with real data exists in this environment, skip this step and say so plainly in the final report — do not claim this was done if it wasn't.

- [ ] **Step 5: Write the README**

Create `mcp-server/README.md`:

```markdown
# music-league-mcp-server

An MCP server exposing music-league-bot's round song-list management, H2H
random-matchup mode, and digest generation to an LLM assistant.

## Setup

1. Install dependencies: `npm install`
2. Mint a bearer token: in the bot-ui app, go to **Settings → API tokens**,
   create one (any label), and copy the plaintext token shown once.
3. Copy `.env.example` to `.env` and fill in:
   - `BOT_UI_BASE_URL` — where bot-ui is running (e.g. `http://localhost:3002`)
   - `BOT_UI_API_TOKEN` — the token from step 2
4. Build: `npm run build`

## Running with Claude Code

Add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "music-league": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {
        "BOT_UI_BASE_URL": "http://localhost:3002",
        "BOT_UI_API_TOKEN": "<your token>"
      }
    }
  }
}
```

## Tools

| Tool | Purpose |
|---|---|
| `resolve_round` | Look up a round's id by league/season/round number or name |
| `add_song_to_round` | Add a song to a round's research list (cascades to the global shortlist) |
| `add_song_to_shortlist` | Add a song to the global shortlist only |
| `update_song` | Update a round research entry's notes/ratings |
| `remove_song_from_round` | Soft-remove a song from a round's research list |
| `list_round_songs` | List a round's research songs |
| `start_random_matchup` | Start a random H2H pairing for a round |
| `reshuffle_random_matchup` | Replace the current pairing with 2 different songs |
| `select_h2h_winner` | Record a matchup winner; loser is removed, a new challenger is picked |
| `get_current_matchup` | Get the currently-pending pairing |
| `check_digest_readiness` | Check a round's digest generation prerequisites |
| `generate_digest` | Generate (or fetch cached) a round's digest draft |

## Architecture

Every tool is a thin HTTP client call (`src/httpClient.ts`) against bot-ui's
existing (and a few new) `/api/*` routes — this package never touches
sqlite or imports from `ui/src/lib` directly. Transport is stdio only for
now (`src/index.ts`); `src/server.ts`'s `createServer()` factory is
transport-agnostic, so adding HTTP/SSE later is a new entrypoint, not a
rewrite.

## Development

- `npm run dev` — run via `tsx` (no build step)
- `npm test` — run the vitest suite (HTTP calls are mocked; no live bot-ui needed)
- `npm run typecheck` — `tsc --noEmit`
```

- [ ] **Step 6: Commit**

```bash
git add mcp-server/README.md
git commit -m "docs(mcp-server): setup + tool reference README"
```

---

## Self-review

**Spec coverage:** Architecture (Task 8) ✓; round identification (Tasks 6, 9) ✓; song-list tools + cascade + soft-removal (Tasks 1-3, 9) ✓; H2H random mode (Tasks 4-5, 10) ✓; digest tools (Task 11) ✓; auth reuse (every new route in Tasks 3, 5, 6) ✓; incidental H2H rating fix (Task 7) ✓. Phase 2 (voting assistant) and Phase 3+ (archive) are explicitly out of scope per the spec — no tasks for them, correctly.

**Placeholder scan:** no TBD/TODO. Task 12 Step 4 is conditional ("if reachable... otherwise skip and say so") rather than a fabricated always-passes step, which is accurate to this environment's real constraints (no seeded bot-ui instance guaranteed available), not a placeholder.

**Type consistency:** `ResearchSong`'s new fields (`removedReason`, `removedBySongId`, `removedAt`) declared in Task 2 are used identically in Task 4's `h2hRandom.ts` (raw SQL, same column names) and Task 9's `songs.ts` (`removedReason: 'user_removed'` matching the union type exactly). `Matchup`/`PendingMatchup`/`SelectWinnerResult` shapes in Task 4 (`ui/`) and Task 10 (`mcp-server/`, re-declared independently since the two packages don't share types) use the same field names (`songAId`, `songBId`) throughout. `AddSongToRoundInput`'s `ratings.discovery` (Task 9) maps to `ratings.discoveryPotential` before hitting the wire (Task 3's route body) — verified consistent in both the tool code and its test's expected `botUiFetch` call.
