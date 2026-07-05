# MCP Server Phase 1b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the discovery/lookup layer Phase 1's MCP server was missing — list leagues, list/browse rounds, get the currently-active round per league, search Spotify's catalog for a track URI, and trigger the host-side CLI import — so an LLM assistant never has to guess an exact round name or query sqlite directly to find IDs.

**Architecture:** 2 brand-new UI routes (`GET /api/leagues`, `GET /api/rounds/list`), a one-line query fix on the existing `resolve_round` route (case-insensitive name match), and 5 new MCP tools added to the existing `rounds.ts`/`songs.ts`/`digest.ts` tool modules. 3 pre-existing UI routes (`/api/spotify/search`, `/api/active-rounds`, `/api/digest/:roundId/import-export-zip`) get MCP tool wrappers but are **left exactly as they are otherwise** — all three already have real, unauthenticated production Svelte UI callers, so this plan does not retrofit auth onto them (see Design Correction below).

## Design Correction

The originally-approved spec for this phase called for adding `requireBearerToken` to these same 3 pre-existing routes, on the stated assumption that they had "no established caller this would break." That assumption was never actually verified and turned out to be wrong: all 3 have real production Svelte callers —

- `/api/spotify/search`: `ui/src/lib/shortlist/SearchBar.svelte`, `ui/src/lib/components/ResearchList.svelte`, `ui/src/lib/components/SongSearchTab.svelte`
- `/api/active-rounds`: `ui/src/lib/shortlist/ShortlistStrip.svelte`, `ui/src/lib/components/SongSearchTab.svelte`, `ui/src/lib/active/ActiveRounds.svelte`
- `/api/digest/:roundId/import-export-zip`: `ui/src/routes/digest/[roundId]/+page.svelte` (the "Import from CLI" button)

None of these browser callers send an `Authorization` header today. Adding `requireBearerToken` as originally planned would 401 all three live UI flows on every page load. This plan instead follows Phase 1's original convention for routes with an established caller: **reuse as-is, do not touch for auth.** These 3 routes remain exactly as they are; the new MCP tools in Tasks 5-6 call them the same way the existing UI does.

## Global Constraints

- Every round parameter across all new/touched code is `roundId: number` (`rounds.id`) — never `round_number`, except where a route's own job is resolving/listing by a human-friendly reference (`leagueSlug`, `seasonNumber`, `roundName`), where those fields legitimately appear as inputs/outputs.
- Every **new** API route added in this plan calls `requireBearerToken(request, db)` as its first line (immediately after obtaining `db` via `getDb()`). This applies to Tasks 1-2's 2 new routes only — see Design Correction above for why the 3 pre-existing routes this plan wraps with MCP tools are explicitly excluded.
- `ui/` changes: run `cd ui && npm run check` (svelte-check, 0 errors) and `npx vitest run <changed test files>` before every commit in this plan that touches `ui/`.
- `mcp-server` changes: the `mcp-server` package never imports from `ui/src/lib` and never opens the sqlite file — every tool is an HTTP call via `botUiFetch()`. Run `cd mcp-server && npx tsc --noEmit` (full project, no file scoping — Phase 1 confirmed file-scoped `tsc` invocations produce false-positive errors) and `npx vitest run` before every commit that touches `mcp-server`.

---

### Task 1: New route — `GET /api/leagues`

**Files:**
- Create: `ui/src/routes/api/leagues/+server.ts`
- Test: `ui/src/routes/api/leagues/leagues.test.ts`

**Interfaces:**
- Consumes: `getAllLeagues` (existing, `ui/src/lib/db/leagues.ts`, returns `League[]` — `{id, slug, name, excludeFromCombined, notes}`), `requireBearerToken` (existing, `ui/src/lib/auth/bearer.ts`).
- Produces: `GET /api/leagues` → `200 [{slug, name}]`. Task 4's `list_leagues` MCP tool calls this route.

- [ ] **Step 1: Write the failing test**

Create `ui/src/routes/api/leagues/leagues.test.ts`:

```ts
import { it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { seedLeagues } from '$lib/db/leagues.js';

let db: Database.Database;

vi.mock('$lib/db/client.js', async (orig) => {
  const actual = await orig<typeof import('$lib/db/client.js')>();
  return { ...actual, getDb: () => db };
});
vi.mock('$lib/auth/bearer.js', () => ({ requireBearerToken: vi.fn() }));

import { requireBearerToken } from '$lib/auth/bearer.js';
import { GET } from './+server.js';

beforeEach(() => {
  db = openLeagueDb(':memory:');
  seedLeagues(db);
});

it('returns every league as {slug, name}, calling requireBearerToken first', async () => {
  const res = await GET({ request: { headers: new Headers() } } as any);
  expect(requireBearerToken).toHaveBeenCalled();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toContainEqual({ slug: 'hip-jammers', name: 'Hip Jammers' });
  expect(body).toHaveLength(4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/routes/api/leagues/leagues.test.ts`
Expected: FAIL — `./+server.js` doesn't exist yet (module not found).

- [ ] **Step 3: Implement the route**

Create `ui/src/routes/api/leagues/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { requireBearerToken } from '$lib/auth/bearer.js';
import { getAllLeagues } from '$lib/db/leagues.js';

// GET /api/leagues — list every league as {slug, name}. New route (Phase 1b);
// the discovery/lookup layer for the MCP server's list_leagues tool, so an
// LLM assistant can find a league slug without already knowing it.
export const GET: RequestHandler = async ({ request }) => {
  const db = getDb();
  requireBearerToken(request, db);

  const leagues = getAllLeagues(db).map((l) => ({ slug: l.slug, name: l.name }));
  return json(leagues);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/routes/api/leagues/leagues.test.ts`
Expected: 1/1 PASS.

- [ ] **Step 5: Run svelte-check and commit**

```bash
cd ui && npm run check
```
Expected: 0 errors.

```bash
git add ui/src/routes/api/leagues/+server.ts ui/src/routes/api/leagues/leagues.test.ts
git commit -m "feat(api): GET /api/leagues — list leagues for MCP discovery

New route, bearer-token protected. Returns {slug, name} for every
league — the list-then-pick companion to resolve_round's exact lookup."
```

---

### Task 2: New route — `GET /api/rounds/list`

**Files:**
- Create: `ui/src/routes/api/rounds/list/+server.ts`
- Test: `ui/src/routes/api/rounds/list/list.test.ts`

**Interfaces:**
- Consumes: `requireBearerToken` (existing).
- Produces: `GET /api/rounds/list?leagueSlug=&seasonNumber=` (seasonNumber optional) → `200 [{id, name, roundNumber, phase, seasonNumber}]`. Task 4's `list_rounds` MCP tool calls this route.

- [ ] **Step 1: Write the failing test**

Create `ui/src/routes/api/rounds/list/list.test.ts`:

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
  const url = new URL('http://localhost/api/rounds/list');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return { url, request: { headers: new Headers() } } as any;
}

let leagueId: number;

beforeEach(() => {
  db = openLeagueDb(':memory:');
  seedLeagues(db);
  leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const s3 = upsertSeason(db, leagueId, 3, 'complete');
  const s4 = upsertSeason(db, leagueId, 4, 'active');
  const r1 = upsertRound(db, s3, {
    mlRoundId: 'list-test-1', name: 'Round Three A', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
  db.prepare('UPDATE rounds SET round_number = 1 WHERE id = ?').run(r1);
  upsertRound(db, s4, {
    mlRoundId: 'list-test-2', name: 'Round Four A', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-01-02T00:00:00Z',
  });
});

it('returns 400 when leagueSlug is missing', async () => {
  await expect(GET(mkEvent({}))).rejects.toMatchObject({ status: 400 });
});

it('lists every round for a league when seasonNumber is omitted', async () => {
  const res = await GET(mkEvent({ leagueSlug: 'hip-jammers' }));
  const body = await res.json();
  expect(body).toHaveLength(2);
  expect(body.map((r: any) => r.name)).toEqual(['Round Three A', 'Round Four A']);
});

it('scopes to one season when seasonNumber is given', async () => {
  const res = await GET(mkEvent({ leagueSlug: 'hip-jammers', seasonNumber: '3' }));
  const body = await res.json();
  expect(body).toHaveLength(1);
  expect(body[0]).toMatchObject({ name: 'Round Three A', roundNumber: 1, seasonNumber: 3 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run "src/routes/api/rounds/list/list.test.ts"`
Expected: FAIL — route doesn't exist yet.

- [ ] **Step 3: Implement the route**

Create `ui/src/routes/api/rounds/list/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { requireBearerToken } from '$lib/auth/bearer.js';

// GET /api/rounds/list?leagueSlug=&seasonNumber=
// Lists a league's rounds (optionally scoped to one season) for discovery —
// the browse-then-pick companion to /api/rounds/resolve's exact lookup. New
// route (Phase 1b), bearer-token protected.
export const GET: RequestHandler = async ({ url, request }) => {
  const db = getDb();
  requireBearerToken(request, db);

  const leagueSlug = url.searchParams.get('leagueSlug');
  const seasonNumber = url.searchParams.get('seasonNumber');
  if (!leagueSlug) throw error(400, 'leagueSlug required');

  const rows = seasonNumber
    ? db
        .prepare(
          `SELECT r.id, r.name, r.round_number AS roundNumber, r.phase,
                  s.season_number AS seasonNumber
           FROM rounds r
           JOIN seasons s ON s.id = r.season_id
           JOIN leagues l ON l.id = s.league_id
           WHERE l.slug = ? AND s.season_number = ?
           ORDER BY s.season_number, r.id`,
        )
        .all(leagueSlug, Number(seasonNumber))
    : db
        .prepare(
          `SELECT r.id, r.name, r.round_number AS roundNumber, r.phase,
                  s.season_number AS seasonNumber
           FROM rounds r
           JOIN seasons s ON s.id = r.season_id
           JOIN leagues l ON l.id = s.league_id
           WHERE l.slug = ?
           ORDER BY s.season_number, r.id`,
        )
        .all(leagueSlug);

  return json(rows);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run "src/routes/api/rounds/list/list.test.ts"`
Expected: 3/3 PASS.

- [ ] **Step 5: Run svelte-check and commit**

```bash
cd ui && npm run check
```
Expected: 0 errors.

```bash
git add ui/src/routes/api/rounds/list/
git commit -m "feat(api): GET /api/rounds/list — browse a league's rounds

New route, bearer-token protected. leagueSlug required, seasonNumber
optional (omit to list every round across every season). The
list-then-pick companion to resolve_round's exact-name/number lookup."
```

---

### Task 3: `resolve_round` case-insensitive name matching

**Files:**
- Modify: `ui/src/routes/api/rounds/resolve/+server.ts`
- Test: `ui/src/routes/api/rounds/resolve/resolve.test.ts` (existing file — extend, don't replace)

**Interfaces:** none — `GET /api/rounds/resolve`'s query params and response shape are unchanged; only the `roundName` branch's SQL comparison changes.

- [ ] **Step 1: Write the failing test**

Open `ui/src/routes/api/rounds/resolve/resolve.test.ts` and add this test at the end of the file (keep all 4 existing tests in place, do not remove or modify them):

```ts
it('resolves by roundName case-insensitively', async () => {
  const res = await GET(mkEvent({ leagueSlug: 'hip-jammers', seasonNumber: '3', roundName: 'test round' }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.name).toBe('Test Round');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/routes/api/rounds/resolve/resolve.test.ts`
Expected: the new test FAILs (404 — `'test round'` doesn't exactly match the seeded `'Test Round'`); the 4 pre-existing tests still PASS.

- [ ] **Step 3: Fix the query**

In `ui/src/routes/api/rounds/resolve/+server.ts`, change the `roundName` branch's `WHERE` clause:

```ts
           WHERE l.slug = ? AND s.season_number = ? AND r.name = ?`,
        )
        .get(leagueSlug, Number(seasonNumber), roundName);
```

to:

```ts
           WHERE l.slug = ? AND s.season_number = ? AND LOWER(r.name) = LOWER(?)`,
        )
        .get(leagueSlug, Number(seasonNumber), roundName);
```

(The `roundNumber` branch is untouched — it's an exact numeric comparison, no case concept applies.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/routes/api/rounds/resolve/resolve.test.ts`
Expected: 5/5 PASS (the 4 pre-existing tests plus the new one).

- [ ] **Step 5: Run svelte-check and commit**

```bash
cd ui && npm run check
```
Expected: 0 errors.

```bash
git add ui/src/routes/api/rounds/resolve/+server.ts ui/src/routes/api/rounds/resolve/resolve.test.ts
git commit -m "fix(api): resolve_round matches roundName case-insensitively

'listen to this...' now resolves against a round actually named
'Listen To This...' — found in live use. roundNumber matching is
unchanged (already an exact numeric comparison)."
```

---

### Task 4: MCP tools — `list_leagues` + `list_rounds`

**Files:**
- Modify: `mcp-server/src/tools/rounds.ts`
- Modify: `mcp-server/src/tools/rounds.test.ts`

**Interfaces:**
- Consumes: `botUiFetch` (existing).
- Produces: `registerRoundTools` (existing, `mcp-server/src/tools/rounds.ts`) now also registers `list_leagues` and `list_rounds`. `index.ts` already imports and calls `registerRoundTools` — no wiring changes needed.

- [ ] **Step 1: Write the failing tests**

Open `mcp-server/src/tools/rounds.test.ts` and add at the end of the file (keep the 2 existing tests in place):

```ts
import { listLeagues, listRounds } from './rounds.js';

it('listLeagues GETs /api/leagues', async () => {
  vi.mocked(botUiFetch).mockResolvedValue([{ slug: 'hip-jammers', name: 'Hip Jammers' }]);
  const result = await listLeagues();
  expect(botUiFetch).toHaveBeenCalledWith('/api/leagues');
  expect(result).toEqual([{ slug: 'hip-jammers', name: 'Hip Jammers' }]);
});

it('listRounds GETs /api/rounds/list with leagueSlug only when seasonNumber is omitted', async () => {
  vi.mocked(botUiFetch).mockResolvedValue([]);
  await listRounds({ leagueSlug: 'hip-jammers' });
  expect(botUiFetch).toHaveBeenCalledWith('/api/rounds/list?leagueSlug=hip-jammers');
});

it('listRounds includes seasonNumber when given', async () => {
  vi.mocked(botUiFetch).mockResolvedValue([]);
  await listRounds({ leagueSlug: 'hip-jammers', seasonNumber: 3 });
  expect(botUiFetch).toHaveBeenCalledWith('/api/rounds/list?leagueSlug=hip-jammers&seasonNumber=3');
});
```

(Note: the existing `import { botUiFetch } from '../httpClient.js';` and `import { resolveRound } from './rounds.js';` lines at the top of the file already cover what these new tests need — just add `listLeagues, listRounds` to the existing `from './rounds.js'` import instead of adding a second import line for the same module.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run src/tools/rounds.test.ts`
Expected: FAIL — `listLeagues`/`listRounds` are not exported from `rounds.ts` yet.

- [ ] **Step 3: Implement `listLeagues` and `listRounds`**

In `mcp-server/src/tools/rounds.ts`, add after the existing `resolveRound` function and before `registerRoundTools`:

```ts
export interface LeagueSummary {
  slug: string;
  name: string;
}

export async function listLeagues(): Promise<LeagueSummary[]> {
  return botUiFetch<LeagueSummary[]>('/api/leagues');
}

export interface ListRoundsInput {
  leagueSlug: string;
  seasonNumber?: number;
}

export interface RoundSummary {
  id: number;
  name: string;
  roundNumber: number | null;
  phase: string;
  seasonNumber: number;
}

export async function listRounds(input: ListRoundsInput): Promise<RoundSummary[]> {
  const params = new URLSearchParams({ leagueSlug: input.leagueSlug });
  if (input.seasonNumber !== undefined) params.set('seasonNumber', String(input.seasonNumber));
  return botUiFetch<RoundSummary[]>(`/api/rounds/list?${params.toString()}`);
}
```

Then add 2 more `server.tool(...)` calls inside `registerRoundTools`, after the existing `resolve_round` registration and before the function's closing brace:

```ts
  server.tool(
    'list_leagues',
    'List every league (slug + name) — use this to discover league slugs before calling list_rounds or resolve_round.',
    {},
    async () => ({ content: [{ type: 'text', text: JSON.stringify(await listLeagues()) }] }),
  );

  server.tool(
    'list_rounds',
    "List a league's rounds (id, name, round number, phase, season number). Omit seasonNumber to list every round across every season for that league.",
    { leagueSlug: z.string(), seasonNumber: z.number().int().optional() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await listRounds(input)) }] }),
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run src/tools/rounds.test.ts`
Expected: 5/5 PASS (2 pre-existing plus 3 new).

- [ ] **Step 5: Typecheck and commit**

```bash
cd mcp-server && npx tsc --noEmit
```
Expected: 0 errors.

```bash
git add mcp-server/src/tools/rounds.ts mcp-server/src/tools/rounds.test.ts
git commit -m "feat(mcp-server): list_leagues + list_rounds tools

Discovery tools for browsing league slugs and round ids without
already knowing them — the list-then-pick companion to resolve_round."
```

---

### Task 5: MCP tools — `get_active_rounds` + `search_spotify`

**Files:**
- Modify: `mcp-server/src/tools/rounds.ts`
- Modify: `mcp-server/src/tools/rounds.test.ts`
- Modify: `mcp-server/src/tools/songs.ts`
- Modify: `mcp-server/src/tools/songs.test.ts`

**Interfaces:**
- Consumes: `botUiFetch` (existing). Both wrapped routes (`GET /api/active-rounds`, `GET /api/spotify/search`) are pre-existing, unauthenticated routes with established UI callers — per this plan's Design Correction, they are called as-is, not modified.
- Produces: `registerRoundTools` also registers `get_active_rounds`; `registerSongTools` also registers `search_spotify`. Both already imported/called by `index.ts` — no wiring changes needed.

- [ ] **Step 1: Write the failing tests**

In `mcp-server/src/tools/rounds.test.ts`, add at the end of the file:

```ts
import { getActiveRounds } from './rounds.js';

it('getActiveRounds GETs /api/active-rounds', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ leagues: [] });
  const result = await getActiveRounds();
  expect(botUiFetch).toHaveBeenCalledWith('/api/active-rounds');
  expect(result).toEqual({ leagues: [] });
});
```

(Same note as Task 4 Step 1: add `getActiveRounds` to the existing `from './rounds.js'` import.)

In `mcp-server/src/tools/songs.test.ts`, add at the end of the file:

```ts
import { searchSpotify } from './songs.js';

it('searchSpotify GETs /api/spotify/search with the query URL-encoded', async () => {
  vi.mocked(botUiFetch).mockResolvedValue([
    { uri: 'spotify:track:abc', name: 'Cotton', artists: 'Vince Staples', album: 'Cotton', year: '2026', imageUrl: null },
  ]);
  const result = await searchSpotify({ query: 'Cotton Vince Staples' });
  expect(botUiFetch).toHaveBeenCalledWith('/api/spotify/search?q=Cotton%20Vince%20Staples');
  expect(result[0].uri).toBe('spotify:track:abc');
});
```

(Same note: add `searchSpotify` to the existing `from './songs.js'` import at the top of the test file rather than a second import line.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mcp-server && npx vitest run src/tools/rounds.test.ts src/tools/songs.test.ts`
Expected: both FAIL — `getActiveRounds` and `searchSpotify` are not exported yet.

- [ ] **Step 3: Implement `getActiveRounds`**

In `mcp-server/src/tools/rounds.ts`, add after `listRounds` and before `registerRoundTools`:

```ts
export interface ActiveRoundView {
  id: number;
  name: string;
  theme: string | null;
  submissionDeadline: string | null;
  votingDeadline: string | null;
  phase: string;
  source: 'manual' | 'derived';
}

export interface AvailableRound {
  id: number;
  name: string;
  phase: string;
  submissionDeadline: string | null;
  votingDeadline: string | null;
}

export interface LeagueActiveRound {
  leagueId: number;
  slug: string;
  name: string;
  isActive: boolean;
  manuallyActive: boolean;
  activeSeasonId: number | null;
  needsNextRound: boolean;
  activeRound: ActiveRoundView | null;
  availableRounds: AvailableRound[];
}

export interface ActiveRoundsResponse {
  leagues: LeagueActiveRound[];
}

export async function getActiveRounds(): Promise<ActiveRoundsResponse> {
  return botUiFetch<ActiveRoundsResponse>('/api/active-rounds');
}
```

Then add a 4th `server.tool(...)` call inside `registerRoundTools`, after `list_rounds`:

```ts
  server.tool(
    'get_active_rounds',
    "Get each active league's currently-active round (or null) plus the rest of that season's rounds — a fast \"what should I work on\" starting point without needing to know league slugs upfront.",
    {},
    async () => ({ content: [{ type: 'text', text: JSON.stringify(await getActiveRounds()) }] }),
  );
```

- [ ] **Step 4: Implement `searchSpotify`**

In `mcp-server/src/tools/songs.ts`, add after the existing `listRoundSongs` function and before `registerSongTools`:

```ts
export interface SpotifySearchResult {
  uri: string;
  name: string;
  artists: string;
  album: string;
  year: string;
  imageUrl: string | null;
}

export interface SearchSpotifyInput {
  query: string;
}

export async function searchSpotify(input: SearchSpotifyInput): Promise<SpotifySearchResult[]> {
  return botUiFetch<SpotifySearchResult[]>(`/api/spotify/search?q=${encodeURIComponent(input.query)}`);
}
```

Then add a 6th `server.tool(...)` call inside `registerSongTools`, after `list_round_songs`:

```ts
  server.tool(
    'search_spotify',
    "Search Spotify's public catalog (client-credentials search — this league's own submission/vote data is not searched here) for a track. Use the returned uri with add_song_to_round or add_song_to_shortlist.",
    { query: z.string() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await searchSpotify(input)) }] }),
  );
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd mcp-server && npx vitest run src/tools/rounds.test.ts src/tools/songs.test.ts`
Expected: all PASS (6/6 in rounds.test.ts, 7/7 in songs.test.ts).

- [ ] **Step 6: Typecheck and commit**

```bash
cd mcp-server && npx tsc --noEmit
```
Expected: 0 errors.

```bash
git add mcp-server/src/tools/rounds.ts mcp-server/src/tools/rounds.test.ts mcp-server/src/tools/songs.ts mcp-server/src/tools/songs.test.ts
git commit -m "feat(mcp-server): get_active_rounds + search_spotify tools

get_active_rounds gives a fast 'what should I work on' entry point.
search_spotify closes the gap where add_song_to_round required a real
spotifyUri but no tool could look one up — found in live use. Both
wrap pre-existing, unauthenticated UI routes as-is (see plan's Design
Correction) — not modified by this task."
```

---

### Task 6: MCP tool — `import_round_data`

**Files:**
- Modify: `mcp-server/src/tools/digest.ts`
- Modify: `mcp-server/src/tools/digest.test.ts`

**Interfaces:**
- Consumes: `botUiFetch` (existing). Wraps the pre-existing, unauthenticated `POST /api/digest/:roundId/import-export-zip` route as-is (see Design Correction) — not modified by this task.
- Produces: `registerDigestTools` also registers `import_round_data`. Already imported/called by `index.ts` — no wiring changes needed.

- [ ] **Step 1: Write the failing test**

Open `mcp-server/src/tools/digest.test.ts` and add at the end of the file:

```ts
import { importRoundData } from './digest.js';

it('importRoundData POSTs to the import-export-zip route', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ ok: true, imported: { submissions: 12, votes: 40, voteComments: 8 } });
  const result = await importRoundData({ roundId: 5 });
  expect(botUiFetch).toHaveBeenCalledWith('/api/digest/5/import-export-zip', { method: 'POST' });
  expect(result.ok).toBe(true);
});
```

(Same note as prior tasks: add `importRoundData` to the existing `from './digest.js'` import at the top of the file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run src/tools/digest.test.ts`
Expected: FAIL — `importRoundData` is not exported yet.

- [ ] **Step 3: Implement `importRoundData`**

In `mcp-server/src/tools/digest.ts`, add after `generateDigest` and before `sectionShape`:

```ts
export interface ImportRoundDataResult {
  ok: boolean;
  imported?: { submissions: number; votes: number; voteComments: number };
  reason?: string;
  stage?: 'auth' | 'cli' | 'download' | 'import' | 'other';
}

export async function importRoundData(input: { roundId: number }): Promise<ImportRoundDataResult> {
  return botUiFetch(`/api/digest/${input.roundId}/import-export-zip`, { method: 'POST' });
}
```

Then add a 3rd `server.tool(...)` call inside `registerDigestTools`, after `generate_digest`:

```ts
  server.tool(
    'import_round_data',
    "Trigger a host-side CLI export+import of a round's submissions/votes/vote-comments from Music League — the same action as the app's \"Import from CLI\" button. Use when check_digest_readiness shows Submissions/Votes/Vote comments failing. Can take noticeably longer than other tools (shells out to a CLI process on the host). A stage:'auth' failure means Music League auth has expired and needs manual re-login — this tool cannot self-heal that case.",
    { roundId: z.number().int() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await importRoundData(input)) }] }),
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run src/tools/digest.test.ts`
Expected: 4/4 PASS (3 pre-existing plus 1 new).

- [ ] **Step 5: Typecheck, full test suite, and commit**

```bash
cd mcp-server && npx tsc --noEmit
```
Expected: 0 errors.

```bash
cd mcp-server && npx vitest run
```
Expected: all tests across every `src/**/*.test.ts` file PASS (this is the first point all 5 new tools coexist — confirms no cross-file wiring issues).

```bash
git add mcp-server/src/tools/digest.ts mcp-server/src/tools/digest.test.ts
git commit -m "feat(mcp-server): import_round_data tool

Wraps the existing 'Import from CLI' action so a failing
Submissions/Votes/Vote-comments check in check_digest_readiness can be
fixed without a manual UI click. Wraps the pre-existing,
unauthenticated route as-is (see plan's Design Correction)."
```

---

### Task 7: README update + full verification

**Files:**
- Modify: `mcp-server/README.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Update the tools table**

In `mcp-server/README.md`, find the `## Tools` table and add 5 rows (place `list_leagues`, `list_rounds`, and `get_active_rounds` near the top, before `resolve_round`, since they're the new starting points; `search_spotify` and `import_round_data` slot in near their related tools — table row order is cosmetic, just keep it readable):

```markdown
| Tool | Purpose |
|---|---|
| `list_leagues` | List every league (slug + name) |
| `list_rounds` | Browse a league's rounds by id/name/round number/phase |
| `get_active_rounds` | Get each active league's currently-active round + season rounds |
| `resolve_round` | Look up a round's id by league/season/round number or name |
| `search_spotify` | Search Spotify's catalog for a track (returns a uri to use with add_song_to_round) |
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
| `import_round_data` | Trigger a host-side CLI import of submissions/votes/vote-comments |
| `generate_digest` | Generate (or fetch cached) a round's digest draft |
```

- [ ] **Step 2: Full verification of both packages**

```bash
cd mcp-server && npx tsc --noEmit && npx vitest run
```
Expected: 0 errors, all tests pass.

```bash
cd ui && npm run check
```
Expected: 0 errors.

```bash
cd ui && npx vitest run src/routes/api/leagues/leagues.test.ts "src/routes/api/rounds/list/list.test.ts" src/routes/api/rounds/resolve/resolve.test.ts
```
Expected: all pass (this re-runs every `ui/` test file this plan touched, not the whole `ui/` suite, to keep the check fast and scoped).

- [ ] **Step 3: Rebuild the mcp-server package**

```bash
cd mcp-server && npm run build
```
Expected: `dist/index.js` and friends rebuilt, 0 tsc errors.

- [ ] **Step 4: Commit**

```bash
git add mcp-server/README.md
git commit -m "docs(mcp-server): add 5 Phase 1b tools to the tool reference table"
```

---

## Self-review

**Spec coverage:** `GET /api/leagues` (Task 1) ✓; `GET /api/rounds/list` (Task 2) ✓; `resolve_round` case-insensitivity (Task 3) ✓; `list_leagues`/`list_rounds` (Task 4) ✓; `get_active_rounds`/`search_spotify` (Task 5) ✓; `import_round_data` (Task 6) ✓; README (Task 7) ✓. The out-of-scope roadmap item (`cli-import-chat-autofetch`) correctly has no task — it's logged in `roadmap.md`, not built here. The originally-planned auth retrofit on 3 pre-existing routes was found, during this plan's own drafting, to conflict with real production UI callers — dropped and replaced with the Design Correction documented above, per the human's decision.

**Placeholder scan:** no TBD/TODO.

**Type consistency:** `RoundSummary` (Task 4, mcp-server) field names (`id`, `name`, `roundNumber`, `phase`, `seasonNumber`) match `GET /api/rounds/list`'s response shape (Task 2) exactly. `LeagueActiveRound`/`ActiveRoundView`/`AvailableRound` (Task 5) match the existing `ui/src/lib/db/activeRound.ts` interfaces of the same names field-for-field (re-declared independently since `mcp-server` never imports from `ui/src/lib`, per the Global Constraints). `SpotifySearchResult` (Task 5) matches `/api/spotify/search`'s existing, unchanged response mapping (`uri, name, artists, album, year, imageUrl`) exactly. `ImportRoundDataResult` (Task 6) matches the union of `SuccessBody`/`FailureBody` shapes already defined in `import-export-zip/+server.ts`.
