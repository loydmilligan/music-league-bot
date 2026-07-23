# Theme Strategy Brief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a per-round "Theme Strategy Brief" that finds prior runs of an upcoming round's theme across all leagues, shows how songs performed, and synthesizes what wins/loses and what the owner should submit.

**Architecture:** All logic lives in bot-ui under `ui/src/lib/theme-brief/` as small, independently-testable units (pure data modules + DI-injected LLM modules), assembled behind one `POST /api/theme-brief/[roundId]` endpoint that caches into a new `theme_briefs` table. A SvelteKit view and a thin MCP tool are two consumers of that endpoint.

**Tech Stack:** TypeScript (NodeNext ESM — imports use `.js` suffix), SvelteKit (Svelte 5), better-sqlite3, vitest, OpenRouter via existing `callOpenRouter` helper, `@modelcontextprotocol/sdk`.

## Global Constraints

- **Single-owner bot.** "Me"/owner = the competitor named `Mashew` → `players.id` (currently player_id 1). Never hardcode player_id 1 — resolve via `SELECT player_id FROM competitors WHERE name='Mashew'`. Constant: `OWNER_COMPETITOR_NAME = 'Mashew'`.
- **LLM calls** go through `callOpenRouter(messages, {model?, jsonMode?, meta?})` from `$lib/digest/llm.js`; parse JSON output with `extractJsonContent`; log cost with `logLlmCall`. Default model = `process.env.OPENROUTER_DIGEST_MODEL`.
- **LLM is dependency-injected** into `themeMatch` and `themeBriefLlm` as a `LlmFn` so unit tests use a stub; production wires the real helper. Never call `callOpenRouter` directly inside those pure-testable modules.
- **Tests:** vitest (`npm test` in `ui/`), in-memory `new Database(':memory:')` with a minimal schema slice per the existing `structuralReview.test.ts` pattern. Co-locate `*.test.ts`.
- **DB access** via `getDb()` from `$lib/db/client.js` in endpoints only; library functions take `db: Database.Database` as their first arg (pure/injectable).
- **ESM import suffix:** always import local files with `.js` (e.g. `import { standings } from './themeBriefData.js'`).
- **Degrade, never crash:** a song missing `song_popularity` or comments is omitted from that enrichment, not fatal. No prior runs → graceful "first time" brief.
- **Commit** after each task (never push; project commits to `master`). End commit messages with the Co-Authored-By trailer.

---

### Task 1: Deterministic data layer (`themeBriefData.ts`)

Pure functions: per-round standings, podium/cellar split, familiarity buckets, and league scoring-type detection. No LLM, no network.

**Files:**
- Create: `ui/src/lib/theme-brief/types.ts`
- Create: `ui/src/lib/theme-brief/themeBriefData.ts`
- Test: `ui/src/lib/theme-brief/themeBriefData.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `types.ts`: `SongStanding`, `Bucket`, `PodiumCellar`, `ScoringType` (see code).
  - `standings(db, roundId, ownerCompetitorId): SongStanding[]`
  - `podiumCellar(rows: SongStanding[]): PodiumCellar`
  - `familiarityBuckets(rows: SongStanding[]): Bucket[]`
  - `leagueScoringType(db, leagueId): ScoringType`

- [ ] **Step 1: Write the failing test**

```typescript
// ui/src/lib/theme-brief/themeBriefData.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { standings, podiumCellar, familiarityBuckets, leagueScoringType } from './themeBriefData.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE leagues (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER);
    CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER, name TEXT, description TEXT);
    CREATE TABLE competitors (id INTEGER PRIMARY KEY, name TEXT, player_id INTEGER);
    CREATE TABLE ml_submissions (id INTEGER PRIMARY KEY, round_id INTEGER, competitor_id INTEGER, spotify_uri TEXT, title TEXT, artists TEXT);
    CREATE TABLE votes (id INTEGER PRIMARY KEY, round_id INTEGER, voter_id INTEGER, spotify_uri TEXT, points INTEGER, comment TEXT);
    CREATE TABLE song_popularity (spotify_uri TEXT PRIMARY KEY, spotify_popularity INTEGER, listeners INTEGER);
  `);
  db.prepare('INSERT INTO leagues VALUES (1,?)').run('Test League');
  db.prepare('INSERT INTO seasons VALUES (1,1,1)').run();
  db.prepare('INSERT INTO rounds VALUES (10,1,?,?)').run('R', 'theme');
  db.prepare('INSERT INTO competitors VALUES (3,?,1)').run('Mashew');
  db.prepare('INSERT INTO competitors VALUES (4,?,2)').run('Other');
  // Two songs: owner's (uri A, 5 pts, pop 80), other's (uri B, 1 pt, pop 20)
  db.prepare('INSERT INTO ml_submissions VALUES (100,10,3,?,?,?)').run('A', 'Song A', 'Artist A');
  db.prepare('INSERT INTO ml_submissions VALUES (101,10,4,?,?,?)').run('B', 'Song B', 'Artist B');
  db.prepare('INSERT INTO votes VALUES (200,10,4,?,3,?)').run('A', 'love it');
  db.prepare('INSERT INTO votes VALUES (201,10,3,?,2,NULL)').run('A');
  db.prepare('INSERT INTO votes VALUES (202,10,4,?,1,NULL)').run('B');
  db.prepare('INSERT INTO song_popularity VALUES (?,80,1000)').run('A');
  db.prepare('INSERT INTO song_popularity VALUES (?,20,50)').run('B');
  return db;
}

describe('standings', () => {
  it('ranks by summed points, marks owner picks, and joins popularity', () => {
    const rows = standings(makeDb(), 10, 3);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ rank: 1, points: 5, title: 'Song A', submitterIsOwner: true, popularity: 80 });
    expect(rows[1]).toMatchObject({ rank: 2, points: 1, title: 'Song B', submitterIsOwner: false, popularity: 20 });
  });
  it('degrades to null popularity when song_popularity is missing', () => {
    const db = makeDb();
    db.prepare('DELETE FROM song_popularity WHERE spotify_uri=?').run('B');
    const rows = standings(db, 10, 3);
    expect(rows.find((r) => r.title === 'Song B')?.popularity).toBeNull();
  });
});

describe('podiumCellar', () => {
  it('splits top (up to 3) and the single lowest', () => {
    const rows = standings(makeDb(), 10, 3);
    const { podium, cellar } = podiumCellar(rows);
    expect(podium.map((r) => r.title)).toEqual(['Song A', 'Song B']);
    expect(cellar.map((r) => r.title)).toEqual(['Song B']);
  });
});

describe('familiarityBuckets', () => {
  it('buckets by popularity and averages points', () => {
    const rows = standings(makeDb(), 10, 3);
    const b = familiarityBuckets(rows);
    expect(b.find((x) => x.key === 'mainstream')).toMatchObject({ n: 1, avgPoints: 5 });
    expect(b.find((x) => x.key === 'obscure')).toMatchObject({ n: 1, avgPoints: 1 });
  });
});

describe('leagueScoringType', () => {
  it('reports downvotes when any negative vote exists, else upvote-only', () => {
    const db = makeDb();
    expect(leagueScoringType(db, 1)).toBe('upvote-only');
    db.prepare('INSERT INTO votes VALUES (203,10,3,?,-1,NULL)').run('B');
    expect(leagueScoringType(db, 1)).toBe('downvotes');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/theme-brief/themeBriefData.test.ts`
Expected: FAIL — `Failed to resolve import "./themeBriefData.js"`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// ui/src/lib/theme-brief/types.ts
export interface SongStanding {
  rank: number;
  points: number;
  spotifyUri: string;
  title: string;
  artist: string;
  submitterIsOwner: boolean;
  popularity: number | null;
  listeners: number | null;
}
export interface PodiumCellar { podium: SongStanding[]; cellar: SongStanding[]; }
export type BucketKey = 'mainstream' | 'mid' | 'obscure' | 'unknown';
export interface Bucket { key: BucketKey; label: string; n: number; avgPoints: number; }
export type ScoringType = 'downvotes' | 'upvote-only';
```

```typescript
// ui/src/lib/theme-brief/themeBriefData.ts
import type Database from 'better-sqlite3';
import type { SongStanding, PodiumCellar, Bucket, BucketKey, ScoringType } from './types.js';

export function standings(db: Database.Database, roundId: number, ownerCompetitorId: number): SongStanding[] {
  const rows = db.prepare(`
    SELECT ms.spotify_uri AS uri, ms.title, ms.artists AS artist, ms.competitor_id AS cid,
           COALESCE(SUM(v.points), 0) AS pts, sp.spotify_popularity AS pop, sp.listeners AS lst
    FROM ml_submissions ms
    LEFT JOIN votes v ON v.round_id = ms.round_id AND v.spotify_uri = ms.spotify_uri
    LEFT JOIN song_popularity sp ON sp.spotify_uri = ms.spotify_uri
    WHERE ms.round_id = ?
    GROUP BY ms.id
    ORDER BY pts DESC
  `).all(roundId) as Array<{ uri: string; title: string; artist: string; cid: number; pts: number; pop: number | null; lst: number | null }>;
  return rows.map((r, i) => ({
    rank: i + 1,
    points: r.pts,
    spotifyUri: r.uri,
    title: r.title,
    artist: r.artist,
    submitterIsOwner: r.cid === ownerCompetitorId,
    popularity: r.pop ?? null,
    listeners: r.lst ?? null,
  }));
}

export function podiumCellar(rows: SongStanding[]): PodiumCellar {
  if (rows.length === 0) return { podium: [], cellar: [] };
  return { podium: rows.slice(0, 3), cellar: [rows[rows.length - 1]] };
}

function bucketOf(pop: number | null): BucketKey {
  if (pop === null) return 'unknown';
  if (pop >= 65) return 'mainstream';
  if (pop >= 45) return 'mid';
  return 'obscure';
}
const BUCKET_LABEL: Record<BucketKey, string> = {
  mainstream: 'Mainstream (pop 65+)', mid: 'Mid (45–64)', obscure: 'Obscure (<45)', unknown: 'Unknown',
};

export function familiarityBuckets(rows: SongStanding[]): Bucket[] {
  const groups = new Map<BucketKey, number[]>();
  for (const r of rows) {
    const k = bucketOf(r.popularity);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r.points);
  }
  const order: BucketKey[] = ['mainstream', 'mid', 'obscure', 'unknown'];
  return order.filter((k) => groups.has(k)).map((k) => {
    const pts = groups.get(k)!;
    return { key: k, label: BUCKET_LABEL[k], n: pts.length, avgPoints: Math.round((pts.reduce((a, b) => a + b, 0) / pts.length) * 10) / 10 };
  });
}

export function leagueScoringType(db: Database.Database, leagueId: number): ScoringType {
  const row = db.prepare(`
    SELECT MIN(v.points) AS minp
    FROM votes v JOIN rounds r ON r.id = v.round_id JOIN seasons s ON s.id = r.season_id
    WHERE s.league_id = ?
  `).get(leagueId) as { minp: number | null };
  return (row.minp ?? 0) < 0 ? 'downvotes' : 'upvote-only';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/theme-brief/themeBriefData.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/theme-brief/types.ts ui/src/lib/theme-brief/themeBriefData.ts ui/src/lib/theme-brief/themeBriefData.test.ts
git commit -m "feat(theme-brief): deterministic data layer — standings, podium/cellar, familiarity, scoring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Audience-overlap layer (`audienceOverlap.ts`)

Pure. For the owner's submissions in the matched rounds, compute which players in those rounds' seasons are ALSO in the target league — the "who would recognize this" set. Golden case: Abissama seen by Jon Black (Second Best) but not by any Boarz player from Hip Jammers.

**Files:**
- Create: `ui/src/lib/theme-brief/audienceOverlap.ts`
- Modify: `ui/src/lib/theme-brief/types.ts` (add `Exposure`, `ExposurePlayer`)
- Test: `ui/src/lib/theme-brief/audienceOverlap.test.ts`

**Interfaces:**
- Consumes: nothing at runtime; shares `types.ts`.
- Produces:
  - `resolveOwnerCompetitorId(db, ownerName): number | null`
  - `ownerExposure(db, ownerCompetitorId, matchedRoundIds: number[], targetLeagueId): Exposure[]`
  - `types.ts`: `ExposurePlayer = { playerId: number; name: string }`, `Exposure = { submissionId; roundId; title; artist; seenBy: ExposurePlayer[]; recognizable: boolean }`

- [ ] **Step 1: Write the failing test**

```typescript
// ui/src/lib/theme-brief/audienceOverlap.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { ownerExposure, resolveOwnerCompetitorId } from './audienceOverlap.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE leagues (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER);
    CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER);
    CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE competitors (id INTEGER PRIMARY KEY, name TEXT, player_id INTEGER);
    CREATE TABLE season_players (season_id INTEGER, player_id INTEGER);
    CREATE TABLE ml_submissions (id INTEGER PRIMARY KEY, round_id INTEGER, competitor_id INTEGER, title TEXT, artists TEXT);
  `);
  // leagues: 1=Hip Jammers, 3=Second Best, 5=Boarz (target)
  db.prepare('INSERT INTO leagues VALUES (1,?),(3,?),(5,?)').run('Hip Jammers', 'Second Best', 'Boarz');
  db.prepare('INSERT INTO seasons VALUES (11,1),(33,3),(55,5)').run(); // s11∈HJ, s33∈SB, s55∈Boarz
  db.prepare('INSERT INTO rounds VALUES (69,11),(109,33)').run();      // R69∈s11, R109∈s33
  db.prepare('INSERT INTO players VALUES (1,?),(4,?)').run('Matt', 'Jon Black');
  db.prepare('INSERT INTO competitors VALUES (3,?,1)').run('Mashew');  // owner = player 1
  // rosters: Matt in all; Jon Black in SB(s33) + Boarz(s55) but NOT HJ(s11)
  db.prepare('INSERT INTO season_players VALUES (11,1),(33,1),(55,1),(33,4),(55,4)').run();
  // owner submitted Abissama in R69 (HJ) and R109 (SB)
  db.prepare('INSERT INTO ml_submissions VALUES (900,69,3,?,?)').run('Abissama', 'Incredible Polo');
  db.prepare('INSERT INTO ml_submissions VALUES (901,109,3,?,?)').run('Abissama', 'Incredible Polo');
  return db;
}

describe('resolveOwnerCompetitorId', () => {
  it('finds the owner competitor by name', () => {
    expect(resolveOwnerCompetitorId(makeDb(), 'Mashew')).toBe(3);
  });
  it('returns null when absent', () => {
    expect(resolveOwnerCompetitorId(makeDb(), 'Nobody')).toBeNull();
  });
});

describe('ownerExposure', () => {
  it('flags the Second Best submission as recognizable (Jon Black), not the Hip Jammers one', () => {
    const rows = ownerExposure(makeDb(), 3, [69, 109], 5);
    const hj = rows.find((r) => r.roundId === 69)!;
    const sb = rows.find((r) => r.roundId === 109)!;
    expect(hj.recognizable).toBe(false);
    expect(hj.seenBy).toEqual([]);
    expect(sb.recognizable).toBe(true);
    expect(sb.seenBy).toEqual([{ playerId: 4, name: 'Jon Black' }]); // excludes the owner himself
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/theme-brief/audienceOverlap.test.ts`
Expected: FAIL — cannot resolve `./audienceOverlap.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// append to ui/src/lib/theme-brief/types.ts
export interface ExposurePlayer { playerId: number; name: string; }
export interface Exposure {
  submissionId: number; roundId: number; title: string; artist: string;
  seenBy: ExposurePlayer[]; recognizable: boolean;
}
```

```typescript
// ui/src/lib/theme-brief/audienceOverlap.ts
import type Database from 'better-sqlite3';
import type { Exposure, ExposurePlayer } from './types.js';

export function resolveOwnerCompetitorId(db: Database.Database, ownerName: string): number | null {
  const row = db.prepare('SELECT id FROM competitors WHERE name = ?').get(ownerName) as { id: number } | undefined;
  return row?.id ?? null;
}

export function ownerExposure(
  db: Database.Database, ownerCompetitorId: number, matchedRoundIds: number[], targetLeagueId: number,
): Exposure[] {
  if (matchedRoundIds.length === 0) return [];
  const owner = db.prepare('SELECT player_id FROM competitors WHERE id = ?').get(ownerCompetitorId) as { player_id: number } | undefined;
  const ownerPlayerId = owner?.player_id ?? -1;

  // Players in the target league (any of its seasons).
  const targetRoster = new Set(
    (db.prepare(`
      SELECT DISTINCT sp.player_id AS pid FROM season_players sp
      JOIN seasons s ON s.id = sp.season_id WHERE s.league_id = ?
    `).all(targetLeagueId) as Array<{ pid: number }>).map((r) => r.pid),
  );

  const placeholders = matchedRoundIds.map(() => '?').join(',');
  const subs = db.prepare(`
    SELECT ms.id AS sid, ms.round_id AS rid, ms.title, ms.artists AS artist
    FROM ml_submissions ms
    WHERE ms.competitor_id = ? AND ms.round_id IN (${placeholders})
  `).all(ownerCompetitorId, ...matchedRoundIds) as Array<{ sid: number; rid: number; title: string; artist: string }>;

  return subs.map((s) => {
    // Who saw this submission = players in the round's season, minus the owner,
    // intersected with the target roster.
    const seen = db.prepare(`
      SELECT DISTINCT p.id AS pid, p.name
      FROM rounds r
      JOIN season_players sp ON sp.season_id = r.season_id
      JOIN players p ON p.id = sp.player_id
      WHERE r.id = ? AND p.id <> ?
    `).all(s.rid, ownerPlayerId) as Array<{ pid: number; name: string }>;
    const seenBy: ExposurePlayer[] = seen
      .filter((p) => targetRoster.has(p.pid))
      .map((p) => ({ playerId: p.pid, name: p.name }));
    return { submissionId: s.sid, roundId: s.rid, title: s.title, artist: s.artist, seenBy, recognizable: seenBy.length > 0 };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/theme-brief/audienceOverlap.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/theme-brief/audienceOverlap.ts ui/src/lib/theme-brief/audienceOverlap.test.ts ui/src/lib/theme-brief/types.ts
git commit -m "feat(theme-brief): audience-aware exposure — who in the target league saw the owner's past picks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Theme matcher (`themeMatch.ts`)

Hybrid: a `round_theme_tags` overlap query builds a candidate shortlist of past rounds; an injected `LlmFn` confirms/ranks them and writes a one-line reason, classifying each as `exact` or `related`. LLM is injected so the test uses a stub.

**Files:**
- Create: `ui/src/lib/theme-brief/llmFn.ts` (the shared `LlmFn` type + production factory)
- Create: `ui/src/lib/theme-brief/themeMatch.ts`
- Modify: `ui/src/lib/theme-brief/types.ts` (add `ThemeMatch`)
- Test: `ui/src/lib/theme-brief/themeMatch.test.ts`

**Interfaces:**
- Consumes: `LlmFn` from `./llmFn.js`.
- Produces:
  - `llmFn.ts`: `type LlmFn = (messages: {role: string; content: string}[], opts?: {jsonMode?: boolean}) => Promise<string>`, and `makeLlmFn(db): LlmFn` (wraps `callOpenRouter` + `extractJsonContent` + `logLlmCall`).
  - `matchThemes(db, targetRoundId, llm: LlmFn): Promise<ThemeMatch[]>`
  - `types.ts`: `ThemeMatch = { roundId; leagueId; leagueName; seasonLabel; title; exactness: 'exact'|'related'; reason }`

- [ ] **Step 1: Write the failing test**

```typescript
// ui/src/lib/theme-brief/themeMatch.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { matchThemes } from './themeMatch.js';
import type { LlmFn } from './llmFn.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE leagues (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER);
    CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER, name TEXT, description TEXT);
    CREATE TABLE theme_tags (id INTEGER PRIMARY KEY, category TEXT, value TEXT);
    CREATE TABLE round_theme_tags (round_id INTEGER, theme_tag_id INTEGER);
  `);
  db.prepare('INSERT INTO leagues VALUES (2,?),(5,?)').run('Fam-Jam', 'Boarz');
  db.prepare('INSERT INTO seasons VALUES (22,2,2),(55,5,1)').run();
  db.prepare('INSERT INTO rounds VALUES (39,22,?,?)').run('Nada de Ingles', 'Songs in a language other than English');
  db.prepare('INSERT INTO rounds VALUES (145,55,?,?)').run('No Entiendo', 'vocals in a language other than English');
  db.prepare('INSERT INTO theme_tags VALUES (1,?,?)').run('semantic', 'non-english');
  db.prepare('INSERT INTO round_theme_tags VALUES (39,1),(145,1)').run(); // shared tag
  return db;
}

// Stub LLM: echoes a confirmation for round 39 as exact.
const stubLlm: LlmFn = async () =>
  JSON.stringify({ matches: [{ roundId: 39, exactness: 'exact', reason: 'same foreign-language rule' }] });

describe('matchThemes', () => {
  it('returns confirmed matches enriched with league/season/title, excluding the target round', async () => {
    const out = await matchThemes(makeDb(), 145, stubLlm);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      roundId: 39, leagueName: 'Fam-Jam', title: 'Nada de Ingles', exactness: 'exact', reason: 'same foreign-language rule',
    });
  });

  it('drops LLM matches that are not in the candidate shortlist (no hallucinated rounds)', async () => {
    const liar: LlmFn = async () => JSON.stringify({ matches: [{ roundId: 999, exactness: 'exact', reason: 'nope' }] });
    const out = await matchThemes(makeDb(), 145, liar);
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/theme-brief/themeMatch.test.ts`
Expected: FAIL — cannot resolve `./themeMatch.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// ui/src/lib/theme-brief/llmFn.ts
import type Database from 'better-sqlite3';
import { callOpenRouter, extractJsonContent, logLlmCall } from '$lib/digest/llm.js';

export type LlmMessage = { role: string; content: string };
export type LlmFn = (messages: LlmMessage[], opts?: { jsonMode?: boolean }) => Promise<string>;

// Production LlmFn: real OpenRouter call, cost-logged, JSON-extracted.
export function makeLlmFn(db: Database.Database, label: string): LlmFn {
  return async (messages, opts) => {
    const result = await callOpenRouter(messages as never, { jsonMode: opts?.jsonMode, meta: { db, kind: label } as never });
    try { logLlmCall(result, { model: result.model, messages } as never, { db, kind: label } as never); } catch { /* fire-and-forget */ }
    return opts?.jsonMode ? extractJsonContent(result.content) : result.content;
  };
}
```

```typescript
// append to ui/src/lib/theme-brief/types.ts
export interface ThemeMatch {
  roundId: number; leagueId: number; leagueName: string; seasonLabel: string;
  title: string; exactness: 'exact' | 'related'; reason: string;
}
```

```typescript
// ui/src/lib/theme-brief/themeMatch.ts
import type Database from 'better-sqlite3';
import type { LlmFn } from './llmFn.js';
import type { ThemeMatch } from './types.js';

interface Candidate { roundId: number; leagueId: number; leagueName: string; seasonNumber: number; title: string; description: string; }

function candidates(db: Database.Database, targetRoundId: number): Candidate[] {
  // Rounds sharing >=1 theme tag with the target, plus a text fallback so a
  // freshly-created target with no tags still surfaces candidates.
  return db.prepare(`
    SELECT DISTINCT r.id AS roundId, l.id AS leagueId, l.name AS leagueName,
           s.season_number AS seasonNumber, r.name AS title, COALESCE(r.description,'') AS description
    FROM rounds r
    JOIN seasons s ON s.id = r.season_id
    JOIN leagues l ON l.id = s.league_id
    WHERE r.id <> ?
      AND (
        r.id IN (
          SELECT rtt2.round_id FROM round_theme_tags rtt2
          WHERE rtt2.theme_tag_id IN (SELECT theme_tag_id FROM round_theme_tags WHERE round_id = ?)
        )
        OR r.description LIKE '%language%' OR r.description LIKE '%English%'
      )
  `).all(targetRoundId, targetRoundId) as Candidate[];
}

export async function matchThemes(db: Database.Database, targetRoundId: number, llm: LlmFn): Promise<ThemeMatch[]> {
  const target = db.prepare(`SELECT name, COALESCE(description,'') AS description FROM rounds WHERE id = ?`)
    .get(targetRoundId) as { name: string; description: string } | undefined;
  if (!target) return [];
  const cands = candidates(db, targetRoundId);
  if (cands.length === 0) return [];

  const sys = { role: 'system', content:
    'You match music-league round themes. Given a TARGET theme and CANDIDATE past themes, return JSON ' +
    '{"matches":[{"roundId":N,"exactness":"exact"|"related","reason":"<=12 words"}]}. ' +
    '"exact" = same core rule; "related" = adjacent but distinct. Only include candidates that genuinely match. ' +
    'Never invent a roundId not in CANDIDATES.' };
  const user = { role: 'user', content: JSON.stringify({
    target: { name: target.name, description: target.description },
    candidates: cands.map((c) => ({ roundId: c.roundId, name: c.title, description: c.description })),
  }) };

  let parsed: { matches?: Array<{ roundId: number; exactness: string; reason: string }> };
  try { parsed = JSON.parse(await llm([sys, user], { jsonMode: true })); } catch { return []; }

  const byId = new Map(cands.map((c) => [c.roundId, c]));
  return (parsed.matches ?? [])
    .filter((m) => byId.has(m.roundId)) // reject hallucinated rounds
    .map((m) => {
      const c = byId.get(m.roundId)!;
      return {
        roundId: c.roundId, leagueId: c.leagueId, leagueName: c.leagueName,
        seasonLabel: `S${c.seasonNumber}`, title: c.title,
        exactness: m.exactness === 'exact' ? 'exact' : 'related',
        reason: m.reason,
      } as ThemeMatch;
    });
}
```

> Note: `makeLlmFn` uses `as never` casts only to bridge to the existing `llm.js` signatures without importing its private types; the real `callOpenRouter` returns `{ content, model, ... }`. If `result.model` is absent, the cost-log line is a fire-and-forget no-op. The matcher itself is fully covered by the stub tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/theme-brief/themeMatch.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/theme-brief/llmFn.ts ui/src/lib/theme-brief/themeMatch.ts ui/src/lib/theme-brief/themeMatch.test.ts ui/src/lib/theme-brief/types.ts
git commit -m "feat(theme-brief): hybrid theme matcher (tag shortlist + injected LLM confirm/rank)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: LLM synthesis (`themeBriefLlm.ts`)

One injected-LLM call turning matched standings + vote comments into Winner DNA, Cellar Traps, "what to submit", and per-song language inference. Grounded strictly in supplied data.

**Files:**
- Create: `ui/src/lib/theme-brief/themeBriefLlm.ts`
- Modify: `ui/src/lib/theme-brief/types.ts` (add `Synthesis`, `SynthesisInput`)
- Test: `ui/src/lib/theme-brief/themeBriefLlm.test.ts`

**Interfaces:**
- Consumes: `LlmFn`; `SongStanding` (Task 1).
- Produces:
  - `synthesize(input: SynthesisInput, llm: LlmFn): Promise<Synthesis>`
  - `gatherComments(db, roundId): Array<{ title; points; comment }>` (helper for the assembler)
  - `types.ts`: `Synthesis = { winnerDna; cellarTraps; whatToSubmit; songLanguages: Record<string,string> }`; `SynthesisInput = { themeText; runs: Array<{ label; standings: SongStanding[]; comments: {title; points; comment}[] }> }`

- [ ] **Step 1: Write the failing test**

```typescript
// ui/src/lib/theme-brief/themeBriefLlm.test.ts
import { describe, it, expect } from 'vitest';
import { synthesize } from './themeBriefLlm.js';
import type { LlmFn } from './llmFn.js';
import type { SynthesisInput } from './types.js';

const input: SynthesisInput = {
  themeText: 'vocals in a language other than English',
  runs: [{
    label: 'Hip Jammers S1',
    standings: [
      { rank: 1, points: 29, spotifyUri: 'x', title: '99 Luftballons', artist: 'Nena', submitterIsOwner: false, popularity: 78, listeners: 1 },
      { rank: 2, points: 4, spotifyUri: 'y', title: 'Faufile', artist: 'Charlotte Cardin', submitterIsOwner: false, popularity: 49, listeners: 1 },
    ],
    comments: [{ title: '99 Luftballons', points: 4, comment: 'Bomb' }],
  }],
};

const stub: LlmFn = async (messages) => {
  // Assert the prompt only references supplied songs.
  const body = messages.map((m) => m.content).join(' ');
  if (!body.includes('99 Luftballons')) throw new Error('prompt missing supplied data');
  return JSON.stringify({
    winnerDna: 'Familiar, upbeat.', cellarTraps: 'Obscure and abrasive.',
    whatToSubmit: 'Pick a recognizable dance-pop track with real vocals.',
    songLanguages: { x: 'German', y: 'French' },
  });
};

describe('synthesize', () => {
  it('returns the four synthesis fields from the model', async () => {
    const out = await synthesize(input, stub);
    expect(out.winnerDna).toContain('Familiar');
    expect(out.whatToSubmit).toContain('recognizable');
    expect(out.songLanguages.x).toBe('German');
  });

  it('degrades to empty strings when the model returns malformed JSON', async () => {
    const bad: LlmFn = async () => 'not json';
    const out = await synthesize(input, bad);
    expect(out).toEqual({ winnerDna: '', cellarTraps: '', whatToSubmit: '', songLanguages: {} });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/theme-brief/themeBriefLlm.test.ts`
Expected: FAIL — cannot resolve `./themeBriefLlm.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// append to ui/src/lib/theme-brief/types.ts
// (SongStanding is already declared above in this same file — reference it directly, no import.)
export interface SynthesisInput {
  themeText: string;
  runs: Array<{ label: string; standings: SongStanding[]; comments: Array<{ title: string; points: number; comment: string }> }>;
}
export interface Synthesis {
  winnerDna: string; cellarTraps: string; whatToSubmit: string; songLanguages: Record<string, string>;
}
```

```typescript
// ui/src/lib/theme-brief/themeBriefLlm.ts
import type Database from 'better-sqlite3';
import type { LlmFn } from './llmFn.js';
import type { SynthesisInput, Synthesis } from './types.js';

export function gatherComments(db: Database.Database, roundId: number): Array<{ title: string; points: number; comment: string }> {
  return db.prepare(`
    SELECT ms.title, v.points, v.comment
    FROM votes v JOIN ml_submissions ms ON ms.round_id = v.round_id AND ms.spotify_uri = v.spotify_uri
    WHERE v.round_id = ? AND v.comment IS NOT NULL AND v.comment <> ''
    ORDER BY v.points DESC
  `).all(roundId) as Array<{ title: string; points: number; comment: string }>;
}

const EMPTY: Synthesis = { winnerDna: '', cellarTraps: '', whatToSubmit: '', songLanguages: {} };

export async function synthesize(input: SynthesisInput, llm: LlmFn): Promise<Synthesis> {
  const sys = { role: 'system', content:
    'You analyze music-league theme results. Using ONLY the supplied runs (standings + vote comments), return JSON: ' +
    '{"winnerDna":"what top finishers share, 1-2 sentences","cellarTraps":"what last-place songs share, 1-2 sentences",' +
    '"whatToSubmit":"forward-looking guidance on TYPES of songs this audience rewards, 2-3 sentences",' +
    '"songLanguages":{"<spotifyUri>":"<language>"}}. Infer language per song from title/artist. Do not invent songs.' };
  const user = { role: 'user', content: JSON.stringify(input) };
  let raw: string;
  try { raw = await llm([sys, user], { jsonMode: true }); } catch { return EMPTY; }
  try {
    const p = JSON.parse(raw) as Partial<Synthesis>;
    return {
      winnerDna: p.winnerDna ?? '', cellarTraps: p.cellarTraps ?? '',
      whatToSubmit: p.whatToSubmit ?? '', songLanguages: p.songLanguages ?? {},
    };
  } catch { return EMPTY; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/theme-brief/themeBriefLlm.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/theme-brief/themeBriefLlm.ts ui/src/lib/theme-brief/themeBriefLlm.test.ts ui/src/lib/theme-brief/types.ts
git commit -m "feat(theme-brief): LLM synthesis — winner DNA, cellar traps, what-to-submit, language inference

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Assembler + cache table (`assemble.ts`, `theme_briefs`)

Orchestrate matcher → data → overlap → synthesis into one `ThemeBrief`, and read/write the `theme_briefs` cache. LLM deps injected so the whole assembly is testable with stubs.

**Files:**
- Modify: `ui/src/lib/db/schema.ts` (add `theme_briefs` CREATE TABLE)
- Create: `ui/src/lib/theme-brief/assemble.ts`
- Modify: `ui/src/lib/theme-brief/types.ts` (add `ThemeBrief`, `MatchedRun`)
- Test: `ui/src/lib/theme-brief/assemble.test.ts`

**Interfaces:**
- Consumes: `matchThemes`, `standings`, `podiumCellar`, `familiarityBuckets`, `leagueScoringType`, `ownerExposure`, `resolveOwnerCompetitorId`, `synthesize`, `gatherComments`.
- Produces:
  - `buildThemeBrief(db, roundId, llm: LlmFn): Promise<ThemeBrief>`
  - `readCachedBrief(db, roundId): ThemeBrief | null`
  - `writeCachedBrief(db, roundId, brief): void`
  - `types.ts`: `MatchedRun`, `ThemeBrief` (see code).

- [ ] **Step 1: Write the failing test**

```typescript
// ui/src/lib/theme-brief/assemble.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { buildThemeBrief, readCachedBrief } from './assemble.js';
import type { LlmFn } from './llmFn.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE leagues (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER);
    CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER, name TEXT, description TEXT);
    CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE competitors (id INTEGER PRIMARY KEY, name TEXT, player_id INTEGER);
    CREATE TABLE season_players (season_id INTEGER, player_id INTEGER);
    CREATE TABLE ml_submissions (id INTEGER PRIMARY KEY, round_id INTEGER, competitor_id INTEGER, spotify_uri TEXT, title TEXT, artists TEXT);
    CREATE TABLE votes (id INTEGER PRIMARY KEY, round_id INTEGER, voter_id INTEGER, spotify_uri TEXT, points INTEGER, comment TEXT);
    CREATE TABLE song_popularity (spotify_uri TEXT PRIMARY KEY, spotify_popularity INTEGER, listeners INTEGER);
    CREATE TABLE theme_tags (id INTEGER PRIMARY KEY, category TEXT, value TEXT);
    CREATE TABLE round_theme_tags (round_id INTEGER, theme_tag_id INTEGER);
    CREATE TABLE theme_briefs (round_id INTEGER PRIMARY KEY, brief_json TEXT NOT NULL, model TEXT, cost_usd REAL, generated_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  db.prepare('INSERT INTO leagues VALUES (2,?),(5,?)').run('Fam-Jam', 'Boarz');
  db.prepare('INSERT INTO seasons VALUES (22,2,2),(55,5,1)').run();
  db.prepare('INSERT INTO rounds VALUES (39,22,?,?)').run('Nada de Ingles', 'Songs in a language other than English');
  db.prepare('INSERT INTO rounds VALUES (145,55,?,?)').run('No Entiendo', 'vocals in a language other than English');
  db.prepare('INSERT INTO players VALUES (1,?)').run('Matt');
  db.prepare('INSERT INTO competitors VALUES (3,?,1),(4,?,2)').run('Mashew', 'Other');
  db.prepare('INSERT INTO season_players VALUES (22,1),(55,1)').run();
  db.prepare('INSERT INTO ml_submissions VALUES (500,39,4,?,?,?)').run('u1', 'CAROLINA', 'Karol G');
  db.prepare('INSERT INTO votes VALUES (600,39,1,?,10,?)').run('u1', 'banger');
  db.prepare('INSERT INTO song_popularity VALUES (?,69,1000)').run('u1');
  db.prepare('INSERT INTO theme_tags VALUES (1,?,?)').run('semantic', 'non-english');
  db.prepare('INSERT INTO round_theme_tags VALUES (39,1),(145,1)').run();
  return db;
}

const stub: LlmFn = async (messages) => {
  const body = messages.map((m) => m.content).join(' ');
  if (body.includes('CANDIDATES') || body.includes('candidates')) {
    return JSON.stringify({ matches: [{ roundId: 39, exactness: 'exact', reason: 'same rule' }] });
  }
  return JSON.stringify({ winnerDna: 'familiar', cellarTraps: 'obscure', whatToSubmit: 'go familiar', songLanguages: { u1: 'Spanish' } });
};

describe('buildThemeBrief', () => {
  it('assembles matched runs, familiarity, synthesis and caches the result', async () => {
    const db = makeDb();
    const brief = await buildThemeBrief(db, 145, stub);
    expect(brief.runCount).toBe(2); // 1 prior + this run
    expect(brief.matches[0]).toMatchObject({ roundId: 39, leagueName: 'Fam-Jam', scoring: 'upvote-only' });
    expect(brief.matches[0].podium[0].title).toBe('CAROLINA');
    expect(brief.whatToSubmit).toBe('go familiar');
    expect(brief.songLanguages.u1).toBe('Spanish');
    // cached
    const cached = readCachedBrief(db, 145);
    expect(cached?.whatToSubmit).toBe('go familiar');
  });

  it('produces a graceful first-time brief when no matches', async () => {
    const noMatch: LlmFn = async () => JSON.stringify({ matches: [] });
    const brief = await buildThemeBrief(makeDb(), 145, noMatch);
    expect(brief.runCount).toBe(1);
    expect(brief.matches).toEqual([]);
    expect(brief.firstTime).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/theme-brief/assemble.test.ts`
Expected: FAIL — cannot resolve `./assemble.js`.

- [ ] **Step 3: Write minimal implementation**

First add the cache table to the shared schema (find the block of `CREATE TABLE IF NOT EXISTS` statements and append this one inside the same `db.exec(\`...\`)`):

```sql
-- ui/src/lib/db/schema.ts  (add alongside the other CREATE TABLE IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS theme_briefs (
  round_id     INTEGER PRIMARY KEY,
  brief_json   TEXT NOT NULL,
  model        TEXT,
  cost_usd     REAL,
  generated_at TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

```typescript
// append to ui/src/lib/theme-brief/types.ts
// (ScoringType, SongStanding, Bucket, Exposure are all declared above in this
// same file — reference them directly by name, no imports.)
export interface MatchedRun {
  roundId: number; leagueName: string; seasonLabel: string; title: string;
  subs: number; scoring: ScoringType; exactness: 'exact' | 'related'; reason: string;
  standings: SongStanding[]; podium: SongStanding[]; cellar: SongStanding[];
}
export interface ThemeBrief {
  roundId: number; themeTitle: string; themeText: string; leagueSlug: string;
  runCount: number; firstTime: boolean;
  matches: MatchedRun[];
  familiarity: Bucket[];
  winnerDna: string; cellarTraps: string; whatToSubmit: string;
  alreadyPlayed: Exposure[];
  songLanguages: Record<string, string>;
  generatedAt: string;
}
```

```typescript
// ui/src/lib/theme-brief/assemble.ts
import type Database from 'better-sqlite3';
import type { LlmFn } from './llmFn.js';
import type { ThemeBrief, MatchedRun, SynthesisInput } from './types.js';
import { matchThemes } from './themeMatch.js';
import { standings, podiumCellar, familiarityBuckets, leagueScoringType } from './themeBriefData.js';
import { resolveOwnerCompetitorId, ownerExposure } from './audienceOverlap.js';
import { synthesize, gatherComments } from './themeBriefLlm.js';

const OWNER = 'Mashew';

export function readCachedBrief(db: Database.Database, roundId: number): ThemeBrief | null {
  const row = db.prepare('SELECT brief_json FROM theme_briefs WHERE round_id = ?').get(roundId) as { brief_json: string } | undefined;
  return row ? (JSON.parse(row.brief_json) as ThemeBrief) : null;
}

export function writeCachedBrief(db: Database.Database, roundId: number, brief: ThemeBrief): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO theme_briefs (round_id, brief_json, generated_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(round_id) DO UPDATE SET brief_json = excluded.brief_json, updated_at = excluded.updated_at
  `).run(roundId, JSON.stringify(brief), now, now);
}

export async function buildThemeBrief(db: Database.Database, roundId: number, llm: LlmFn): Promise<ThemeBrief> {
  const target = db.prepare(`
    SELECT r.name AS title, COALESCE(r.description,'') AS descr, l.name AS leagueName, l.id AS leagueId
    FROM rounds r JOIN seasons s ON s.id = r.season_id JOIN leagues l ON l.id = s.league_id
    WHERE r.id = ?
  `).get(roundId) as { title: string; descr: string; leagueName: string; leagueId: number } | undefined;
  if (!target) throw new Error(`round ${roundId} not found`);

  const ownerCid = resolveOwnerCompetitorId(db, OWNER) ?? -1;
  const matches = await matchThemes(db, roundId, llm);

  const runs: MatchedRun[] = matches.map((m) => {
    const rows = standings(db, m.roundId, ownerCid);
    const { podium, cellar } = podiumCellar(rows);
    return {
      roundId: m.roundId, leagueName: m.leagueName, seasonLabel: m.seasonLabel, title: m.title,
      subs: rows.length, scoring: leagueScoringType(db, m.leagueId),
      exactness: m.exactness, reason: m.reason, standings: rows, podium, cellar,
    };
  });

  const allRows = runs.flatMap((r) => r.standings);
  const familiarity = familiarityBuckets(allRows);
  const alreadyPlayed = ownerExposure(db, ownerCid, matches.map((m) => m.roundId), target.leagueId);

  const synthInput: SynthesisInput = {
    themeText: target.descr,
    runs: runs.map((r) => ({ label: `${r.leagueName} ${r.seasonLabel}`, standings: r.standings, comments: gatherComments(db, r.roundId) })),
  };
  const synth = runs.length > 0 ? await synthesize(synthInput, llm) : { winnerDna: '', cellarTraps: '', whatToSubmit: '', songLanguages: {} };

  const brief: ThemeBrief = {
    roundId, themeTitle: target.title, themeText: target.descr, leagueSlug: target.leagueName,
    runCount: runs.length + 1, firstTime: runs.length === 0,
    matches: runs, familiarity,
    winnerDna: synth.winnerDna, cellarTraps: synth.cellarTraps, whatToSubmit: synth.whatToSubmit,
    alreadyPlayed, songLanguages: synth.songLanguages,
    generatedAt: new Date().toISOString(),
  };
  writeCachedBrief(db, roundId, brief);
  return brief;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/lib/theme-brief/assemble.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/db/schema.ts ui/src/lib/theme-brief/assemble.ts ui/src/lib/theme-brief/assemble.test.ts ui/src/lib/theme-brief/types.ts
git commit -m "feat(theme-brief): assembler + theme_briefs cache table

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: HTTP endpoint (`/api/theme-brief/[roundId]`)

GET returns the cached brief (or `{generated:false}`); POST generates/regenerates and caches. This is the only place the real LLM runs.

**Files:**
- Create: `ui/src/routes/api/theme-brief/[roundId]/+server.ts`
- Test: `ui/src/routes/api/theme-brief/[roundId]/server.test.ts`

**Interfaces:**
- Consumes: `getDb` (`$lib/db/client.js`), `readCachedBrief`, `buildThemeBrief`, `makeLlmFn`.
- Produces: `GET` → `{ generated: boolean; brief?: ThemeBrief }`; `POST` (body `{force?:boolean}`) → `{ brief: ThemeBrief }`.

- [ ] **Step 1: Write the failing test**

```typescript
// ui/src/routes/api/theme-brief/[roundId]/server.test.ts
import { describe, it, expect, vi } from 'vitest';

// The endpoint reads getDb() and builds a brief. We test the handler logic by
// mocking the two collaborators so no real DB/LLM is needed.
vi.mock('$lib/db/client.js', () => ({ getDb: () => ({}) }));
vi.mock('$lib/theme-brief/assemble.js', () => ({
  readCachedBrief: vi.fn(() => null),
  buildThemeBrief: vi.fn(async () => ({ roundId: 145, whatToSubmit: 'go familiar' })),
}));
vi.mock('$lib/theme-brief/llmFn.js', () => ({ makeLlmFn: () => async () => '{}' }));

import { GET, POST } from './+server.js';
import { readCachedBrief } from '$lib/theme-brief/assemble.js';

function evt(roundId: string, body?: unknown) {
  return { params: { roundId }, request: { json: async () => body ?? {} } } as never;
}

describe('theme-brief endpoint', () => {
  it('GET returns generated:false when nothing cached', async () => {
    const res = await GET(evt('145'));
    expect(await res.json()).toEqual({ generated: false });
  });
  it('GET returns the cached brief when present', async () => {
    (readCachedBrief as ReturnType<typeof vi.fn>).mockReturnValueOnce({ roundId: 145, whatToSubmit: 'cached' });
    const res = await GET(evt('145'));
    expect(await res.json()).toMatchObject({ generated: true, brief: { whatToSubmit: 'cached' } });
  });
  it('POST builds and returns a brief', async () => {
    const res = await POST(evt('145', { force: true }));
    expect(await res.json()).toMatchObject({ brief: { whatToSubmit: 'go familiar' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run "src/routes/api/theme-brief/[roundId]/server.test.ts"`
Expected: FAIL — cannot resolve `./+server.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// ui/src/routes/api/theme-brief/[roundId]/+server.ts
import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { readCachedBrief, buildThemeBrief } from '$lib/theme-brief/assemble.js';
import { makeLlmFn } from '$lib/theme-brief/llmFn.js';

export const GET: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  const brief = readCachedBrief(getDb(), roundId);
  return brief ? json({ generated: true, brief }) : json({ generated: false });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  const body = (await request.json().catch(() => ({}))) as { force?: boolean };
  const db = getDb();
  if (!body.force) {
    const cached = readCachedBrief(db, roundId);
    if (cached) return json({ brief: cached });
  }
  const brief = await buildThemeBrief(db, roundId, makeLlmFn(db, 'theme-brief'));
  return json({ brief });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run "src/routes/api/theme-brief/[roundId]/server.test.ts"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add "ui/src/routes/api/theme-brief/[roundId]/+server.ts" "ui/src/routes/api/theme-brief/[roundId]/server.test.ts"
git commit -m "feat(theme-brief): GET cached / POST generate endpoint

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: MCP tool (`get_theme_brief`)

Thin wrapper in the music-league MCP server, mirroring the existing digest tools: call the bot-ui endpoint via `botUiFetch`, return the structured brief.

**Files:**
- Create: `mcp-server/src/tools/themeBrief.ts`
- Modify: `mcp-server/src/index.ts` (import + `registerThemeBriefTools(server)`)
- Test: `mcp-server/src/tools/themeBrief.test.ts`

**Interfaces:**
- Consumes: `botUiFetch` (`../httpClient.js`), `McpServer`.
- Produces: `getThemeBrief(input: { roundId: number; force?: boolean })` → the brief JSON; `registerThemeBriefTools(server)`.

- [ ] **Step 1: Write the failing test**

```typescript
// mcp-server/src/tools/themeBrief.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../httpClient.js', () => ({ botUiFetch: vi.fn(async () => ({ brief: { roundId: 145, whatToSubmit: 'go familiar' } })) }));

import { getThemeBrief } from './themeBrief.js';
import { botUiFetch } from '../httpClient.js';

describe('getThemeBrief', () => {
  it('POSTs to the theme-brief endpoint and returns the brief', async () => {
    const out = await getThemeBrief({ roundId: 145, force: true });
    expect(botUiFetch).toHaveBeenCalledWith('/api/theme-brief/145', expect.objectContaining({ method: 'POST' }));
    expect(out).toMatchObject({ brief: { whatToSubmit: 'go familiar' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run src/tools/themeBrief.test.ts`
Expected: FAIL — cannot resolve `./themeBrief.js`.
> If `mcp-server` has no vitest configured, add `"test": "vitest run"` to its `package.json` scripts and `vitest` to devDependencies first (mirror `ui/`), then re-run.

- [ ] **Step 3: Write minimal implementation**

```typescript
// mcp-server/src/tools/themeBrief.ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { botUiFetch } from '../httpClient.js';

export interface GetThemeBriefInput { roundId: number; force?: boolean; }

export async function getThemeBrief(input: GetThemeBriefInput): Promise<unknown> {
  return botUiFetch(`/api/theme-brief/${input.roundId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ force: input.force ?? false }),
  });
}

export function registerThemeBriefTools(server: McpServer): void {
  server.tool(
    'get_theme_brief',
    "Generate (or fetch cached) the Theme Strategy Brief for a round: prior runs of the same/similar theme across all leagues, each run's podium/cellar, winner-DNA & cellar-trap patterns, a familiarity (popularity->points) summary, the owner's audience-aware already-played songs, and 'what to submit' guidance. Pass force:true to regenerate.",
    { roundId: z.number().int(), force: z.boolean().optional() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await getThemeBrief(input)) }] }),
  );
}
```

Then wire it in `mcp-server/src/index.ts` (add the import near the other tool imports and the registration next to the others):

```typescript
import { registerThemeBriefTools } from './tools/themeBrief.js';
// ...after registerDigestTools(server);
registerThemeBriefTools(server);
```

> Check `../httpClient.js`'s `botUiFetch` signature — if it does not accept a second `RequestInit` arg, extend it to forward `method/headers/body` (the digest tools' POST-style calls already do this; match their usage).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run src/tools/themeBrief.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/tools/themeBrief.ts mcp-server/src/tools/themeBrief.test.ts mcp-server/src/index.ts
git commit -m "feat(mcp): get_theme_brief tool wrapping the theme-brief endpoint

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: UI view + route (`ThemeBriefView.svelte`, `/theme-brief/[roundId]`)

Render the brief with the 7 sections. On-demand "Generate/Regenerate" button hits POST; initial load reads GET.

**Files:**
- Create: `ui/src/lib/theme-brief/ThemeBriefView.svelte`
- Create: `ui/src/routes/theme-brief/[roundId]/+page.server.ts`
- Create: `ui/src/routes/theme-brief/[roundId]/+page.svelte`
- Test: `ui/src/lib/theme-brief/ThemeBriefView.test.ts` (render smoke via a plain function-level check — see note)

**Interfaces:**
- Consumes: GET/POST `/api/theme-brief/[roundId]`; `ThemeBrief` type.
- Produces: a page at `/theme-brief/145`.

- [ ] **Step 1: Write the failing test**

Component DOM testing isn't set up in this repo, so test the one piece of non-trivial logic — the exposure highlight label — as a pure helper, and keep the Svelte file presentational.

```typescript
// ui/src/lib/theme-brief/ThemeBriefView.test.ts
import { describe, it, expect } from 'vitest';
import { exposureLabel } from './exposureLabel.js';
import type { Exposure } from './types.js';

const recognizable: Exposure = { submissionId: 1, roundId: 109, title: 'Abissama', artist: 'Incredible Polo', recognizable: true, seenBy: [{ playerId: 4, name: 'Jon Black' }] };
const safe: Exposure = { submissionId: 2, roundId: 69, title: 'Abissama', artist: 'Incredible Polo', recognizable: false, seenBy: [] };

describe('exposureLabel', () => {
  it('names who would recognize a recognizable pick', () => {
    expect(exposureLabel(recognizable)).toBe('Jon Black would recognize this');
  });
  it('marks a safe pick as unseen by this league', () => {
    expect(exposureLabel(safe)).toBe('No one in this league saw this');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/lib/theme-brief/ThemeBriefView.test.ts`
Expected: FAIL — cannot resolve `./exposureLabel.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// ui/src/lib/theme-brief/exposureLabel.ts
import type { Exposure } from './types.js';
export function exposureLabel(e: Exposure): string {
  if (!e.recognizable) return 'No one in this league saw this';
  const names = e.seenBy.map((p) => p.name);
  const list = names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  return `${list} would recognize this`;
}
```

```svelte
<!-- ui/src/lib/theme-brief/ThemeBriefView.svelte -->
<script lang="ts">
  import type { ThemeBrief } from './types.js';
  import { exposureLabel } from './exposureLabel.js';
  let { brief = $bindable(null), roundId }: { brief: ThemeBrief | null; roundId: number } = $props();
  let loading = $state(false);
  async function generate(force = false) {
    loading = true;
    const res = await fetch(`/api/theme-brief/${roundId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ force }) });
    brief = (await res.json()).brief;
    loading = false;
  }
</script>

{#if !brief}
  <button onclick={() => generate(false)} disabled={loading}>{loading ? 'Generating…' : 'Generate brief'}</button>
{:else}
  <header>
    <h2>{brief.themeTitle}</h2>
    <p>{brief.firstTime ? 'First time for this theme.' : `The ${brief.runCount}${['th','st','nd','rd'][brief.runCount % 10] ?? 'th'} run of this theme.`}</p>
    <button onclick={() => generate(true)} disabled={loading}>Regenerate</button>
  </header>

  {#each brief.matches as run}
    <section class="run">
      <h3>{run.leagueName} {run.seasonLabel} — {run.title}
        <span class="scoring">{run.scoring === 'downvotes' ? 'downvotes on' : 'upvote-only'}</span>
        <span class="exactness">{run.exactness}</span></h3>
      <p class="reason">{run.reason}</p>
      <ol class="podium">{#each run.podium as s}<li>🏅 {s.title} — {s.artist} <b>{s.points}</b></li>{/each}</ol>
      {#each run.cellar as s}<div class="cellar">🔻 {s.title} — {s.artist} <b>{s.points}</b></div>{/each}
    </section>
  {/each}

  {#if !brief.firstTime}
    <section><h3>Winner DNA</h3><p>{brief.winnerDna}</p>
      <ul class="familiarity">{#each brief.familiarity as b}<li>{b.label}: avg <b>{b.avgPoints}</b> (n={b.n})</li>{/each}</ul>
    </section>
    <section><h3>Cellar traps</h3><p>{brief.cellarTraps}</p></section>
    <section><h3>What to submit</h3><p>{brief.whatToSubmit}</p></section>
    <section><h3>You've already played</h3>
      <ul>{#each brief.alreadyPlayed as e}
        <li class:recognizable={e.recognizable}>{e.title} — {e.artist} · {exposureLabel(e)}</li>
      {/each}</ul>
    </section>
  {/if}
{/if}

<style>
  .recognizable { font-weight: 700; }
  .cellar { opacity: 0.8; }
</style>
```

```typescript
// ui/src/routes/theme-brief/[roundId]/+page.server.ts
import type { PageServerLoad } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { readCachedBrief } from '$lib/theme-brief/assemble.js';

export const load: PageServerLoad = ({ params }) => {
  const roundId = Number(params.roundId);
  return { roundId, brief: readCachedBrief(getDb(), roundId) };
};
```

```svelte
<!-- ui/src/routes/theme-brief/[roundId]/+page.svelte -->
<script lang="ts">
  import ThemeBriefView from '$lib/theme-brief/ThemeBriefView.svelte';
  let { data } = $props();
</script>
<ThemeBriefView roundId={data.roundId} brief={data.brief} />
```

- [ ] **Step 4: Run test + typecheck**

Run: `cd ui && npx vitest run src/lib/theme-brief/ThemeBriefView.test.ts && npm run check`
Expected: tests PASS; `svelte-check` reports 0 errors (fix any type mismatch it surfaces — e.g. delete the placeholder self-import lines noted in Tasks 4–5).

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/theme-brief/exposureLabel.ts ui/src/lib/theme-brief/ThemeBriefView.svelte ui/src/lib/theme-brief/ThemeBriefView.test.ts "ui/src/routes/theme-brief/[roundId]"
git commit -m "feat(theme-brief): brief view + route with audience-aware already-played

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Full-suite gate + live smoke on R145

Prove nothing regressed and the real pipeline produces a sane brief against production data.

**Files:** none (verification only).

- [ ] **Step 1: Run the whole ui test suite**

Run: `cd ui && npm test`
Expected: PASS, including all `theme-brief/*` tests.

- [ ] **Step 2: Typecheck**

Run: `cd ui && npm run check`
Expected: 0 errors.

- [ ] **Step 3: Deploy per the project playbook and live-smoke**

Build/deploy bot-ui the project way (see `docs/dev-loop-playbook.md`): `docker compose build --no-cache bot-ui && docker compose up -d bot-ui`. Then generate the R145 brief:

Run: `curl -s -X POST http://localhost:3002/api/theme-brief/145 -H 'content-type: application/json' -d '{"force":true}' | head -c 1200`
Expected: JSON with `matches` including rounds 39/69/109, `familiarity` buckets, non-empty `whatToSubmit`, and `alreadyPlayed` containing Abissama flagged recognizable by Jon Black.

- [ ] **Step 4: Eyeball against the spec appendix**

Compare the smoke output's podiums/patterns to the hand analysis in `docs/superpowers/specs/2026-07-23-theme-strategy-brief-design.md`. Note any divergence for follow-up; the deterministic sections (podium/cellar, familiarity, exposure) must match exactly.

- [ ] **Step 5: Commit (if any fixups were needed)**

```bash
git add -A && git commit -m "test(theme-brief): full-suite gate + R145 live smoke fixups

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **MCP `botUiFetch`**: confirm it forwards `RequestInit` (method/body). The digest tools already POST, so follow their call style; if it's GET-only, extend it minimally.
- **`callOpenRouter` bridge**: `makeLlmFn` deliberately keeps the LLM plumbing in one small file so every analysis module stays unit-testable with a stub. If the `as never` casts trip `svelte-check`, import the real `LLMResult`/`LLMCallMeta` types from `$lib/digest/llm.js` instead.
- **Owner identity** is resolved by name (`Mashew`) everywhere — never hardcode the numeric id.
- **Deploy**: bot-ui only for this feature (the runner/poller aren't touched). The MCP server is restarted by its own host per existing practice.
