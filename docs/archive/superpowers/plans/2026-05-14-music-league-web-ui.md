# Music League Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a SvelteKit full-stack web dashboard that ingests Music League ZIP exports, displays seasons/rounds/playlists, and provides a per-round song research tool with ratings.

**Architecture:** New `ui/` SvelteKit app (adapter-node) runs as a Docker container on port 3002, mounting the host `data/` volume. Server routes handle all DB access. ZIP import runs on startup. Background worker drains the Songlink queue at ≤10/min.

**Tech Stack:** SvelteKit 2, TypeScript, better-sqlite3, adm-zip, Tailwind CSS v4, @sveltejs/adapter-node, vitest

---

## File Map

```
ui/
  src/
    lib/
      db/
        schema.ts          # CREATE TABLE statements + DEFAULT_SETTINGS
        client.ts          # openLeagueDb(), getDb() singleton
        leagues.ts         # league + season queries, SEED_LEAGUES
        rounds.ts          # round CRUD, deadline update
        submissions.ts     # competitor/submission/vote upserts + reads
        research.ts        # research_songs CRUD
        settings.ts        # getSettings(), updateWeights()
        importLog.ts       # logImport(), getImportLog()
        ytmQueue.ts        # enqueue, drain helpers, status query
      import/
        zipParser.ts       # Buffer → ParsedZip (rounds/subs/votes/competitors)
        importer.ts        # ParsedZip → league.db upserts
        startupScan.ts     # glob data/*/season-*/export.zip, run importer
      scoring.ts           # computeScore(ratings, weights) → number | null
      spotify.ts           # getSpotifyToken(), searchTracks()
      songlink.ts          # resolveSonglinkUrl() thin wrapper (reuse logic)
      queueWorker.ts       # setInterval drain loop for ytm_resolution_queue
      submissionsDb.ts     # read-only access to data/submissions.db
      types.ts             # shared TS interfaces
    routes/
      +layout.svelte       # nav bar (logo + cog)
      +page.svelte         # home screen
      +page.server.ts      # home data loader
      league/[league]/season/[n]/
        +page.svelte       # season detail
        +page.server.ts    # season loader
        round/[roundId]/
          +page.svelte     # round detail (tabs)
          +page.server.ts  # round loader
      settings/
        +page.svelte       # settings (4 sections)
        +page.server.ts    # settings loader + form actions
      api/
        spotify/search/+server.ts       # GET ?q=
        research/[roundId]/+server.ts   # GET / POST / PATCH / DELETE
        ytm/[spotifyUri]/+server.ts     # GET → ytm_url (resolve + cache)
        ytm-queue/+server.ts            # GET queue status
        import/+server.ts               # POST upload / POST rescan
        deadlines/[roundId]/+server.ts  # PATCH submission/voting deadlines
    hooks.server.ts        # DB init + startup import
    app.html
    app.css
  package.json
  svelte.config.js
  vite.config.ts
  tsconfig.json
Dockerfile.ui
(modify) docker-compose.yml
(modify) .env.example
```

---

## Task 1: SvelteKit scaffold

**Files:** `ui/package.json`, `ui/svelte.config.js`, `ui/vite.config.ts`, `ui/src/app.html`, `ui/src/app.css`, `ui/src/routes/+layout.svelte`

- [ ] **1.1 — Scaffold**

```bash
mkdir ui && cd ui
npm create svelte@latest . -- --template skeleton --types typescript --no-prettier --no-eslint --no-playwright --no-vitest
npm install
npm install better-sqlite3 adm-zip
npm install -D @types/better-sqlite3 @types/adm-zip vitest @vitest/coverage-v8
npm install @sveltejs/adapter-node
npm install -D tailwindcss @tailwindcss/vite
```

- [ ] **1.2 — svelte.config.js** (replace generated content)

```js
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
export default { preprocess: vitePreprocess(), kit: { adapter: adapter({ out: 'build' }) } };
```

- [ ] **1.3 — vite.config.ts**

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  test: { include: ['src/**/*.{test,spec}.ts'] },
});
```

- [ ] **1.4 — app.css**

```css
@import "tailwindcss";
body { background: #0f172a; color: #e2e8f0; font-family: system-ui, sans-serif; }
```

- [ ] **1.5 — app.html** (standard SvelteKit shell, add `<link rel="stylesheet" href="%sveltekit.assets%/app.css">` if needed by your Tailwind setup)

- [ ] **1.6 — layout shell**

`ui/src/routes/+layout.svelte`:
```svelte
<script lang="ts">
  import '../app.css';
</script>
<nav class="flex items-center justify-between px-6 py-3 border-b border-slate-700 bg-slate-900">
  <a href="/" class="text-purple-400 font-bold text-lg">🎵 Music League</a>
  <a href="/settings" class="text-slate-400 hover:text-slate-200 text-xl" title="Settings">⚙</a>
</nav>
<main class="max-w-6xl mx-auto px-6 py-8"><slot /></main>
```

- [ ] **1.7 — Smoke test**
```bash
cd ui && npm run dev
```
Expected: SvelteKit starts at http://localhost:5173, nav bar visible.

- [ ] **1.8 — Commit**
```bash
git add ui/ && git commit -m "feat: scaffold SvelteKit UI project"
```

---

## Task 2: Database schema + client

**Files:** `ui/src/lib/db/schema.ts`, `ui/src/lib/db/client.ts`

- [ ] **2.1 — schema.ts**

```ts
export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS leagues (
    id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    exclude_from_combined INTEGER NOT NULL DEFAULT 0, notes TEXT
  );
  CREATE TABLE IF NOT EXISTS seasons (
    id INTEGER PRIMARY KEY, league_id INTEGER NOT NULL REFERENCES leagues(id),
    season_number INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','complete')),
    UNIQUE(league_id, season_number)
  );
  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY, season_id INTEGER NOT NULL REFERENCES seasons(id),
    ml_round_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT,
    spotify_playlist_url TEXT, submission_deadline TEXT, voting_deadline TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS competitors (
    id INTEGER PRIMARY KEY, ml_competitor_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ml_submissions (
    id INTEGER PRIMARY KEY, round_id INTEGER NOT NULL REFERENCES rounds(id),
    competitor_id INTEGER NOT NULL REFERENCES competitors(id),
    spotify_uri TEXT NOT NULL, title TEXT NOT NULL, album TEXT, artists TEXT NOT NULL,
    comment TEXT, created_at TEXT NOT NULL, visible_to_voters INTEGER NOT NULL DEFAULT 0,
    UNIQUE(round_id, spotify_uri, competitor_id)
  );
  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY, round_id INTEGER NOT NULL REFERENCES rounds(id),
    voter_id INTEGER NOT NULL REFERENCES competitors(id),
    spotify_uri TEXT NOT NULL, points INTEGER NOT NULL, comment TEXT, created_at TEXT NOT NULL,
    UNIQUE(round_id, voter_id, spotify_uri)
  );
  CREATE TABLE IF NOT EXISTS research_songs (
    id INTEGER PRIMARY KEY, round_id INTEGER NOT NULL REFERENCES rounds(id),
    spotify_uri TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL, album TEXT,
    added_at TEXT NOT NULL, notes TEXT,
    theme_fit INTEGER CHECK(theme_fit BETWEEN 1 AND 5),
    discovery_potential INTEGER CHECK(discovery_potential BETWEEN 1 AND 5),
    nostalgia_potential INTEGER CHECK(nostalgia_potential BETWEEN 1 AND 5),
    personal_rating INTEGER CHECK(personal_rating BETWEEN 1 AND 5),
    save_for_future INTEGER NOT NULL DEFAULT 0,
    submitted_by_me INTEGER NOT NULL DEFAULT 0,
    submitted_by_other INTEGER NOT NULL DEFAULT 0,
    other_submission_votes INTEGER,
    UNIQUE(round_id, spotify_uri)
  );
  CREATE TABLE IF NOT EXISTS ytm_link_cache (
    spotify_uri TEXT PRIMARY KEY, ytm_url TEXT, resolved_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ytm_resolution_queue (
    id INTEGER PRIMARY KEY, spotify_uri TEXT NOT NULL UNIQUE,
    title TEXT, artist TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','done','failed')),
    error TEXT, queued_at TEXT NOT NULL, resolved_at TEXT
  );
  CREATE TABLE IF NOT EXISTS import_log (
    id INTEGER PRIMARY KEY, league_slug TEXT NOT NULL, season_number INTEGER NOT NULL,
    filename TEXT NOT NULL, imported_at TEXT NOT NULL,
    rounds_count INTEGER NOT NULL DEFAULT 0, submissions_count INTEGER NOT NULL DEFAULT 0,
    votes_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK(status IN ('success','partial','error')), error TEXT
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;
export const DEFAULT_SETTINGS: Record<string,string> = {
  weight_discovery: '35', weight_theme_fit: '25',
  weight_personal: '25',  weight_nostalgia: '15',
};
```

- [ ] **2.2 — client.ts**

```ts
import Database from 'better-sqlite3';
import { SCHEMA, DEFAULT_SETTINGS } from './schema.js';

let _db: Database.Database | null = null;

export function openLeagueDb(path?: string): Database.Database {
  const dbPath = path ?? `${process.env.DATA_DIR ?? 'data'}/league.db`;
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  const upsert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) upsert.run(k, v);
  return db;
}

export function getDb(): Database.Database {
  if (!_db) _db = openLeagueDb();
  return _db;
}
```

- [ ] **2.3 — Test**

`ui/src/lib/db/client.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { openLeagueDb } from './client.js';
import { unlinkSync, existsSync } from 'node:fs';

const TMP = '/tmp/test-league.db';
afterEach(() => { if (existsSync(TMP)) unlinkSync(TMP); });

it('creates all tables', () => {
  const db = openLeagueDb(TMP);
  const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(r => r.name);
  ['leagues','seasons','rounds','ml_submissions','votes','research_songs',
   'ytm_link_cache','ytm_resolution_queue','import_log','settings'].forEach(t => expect(names).toContain(t));
  db.close();
});

it('is idempotent', () => {
  openLeagueDb(TMP).close();
  expect(() => openLeagueDb(TMP)).not.toThrow();
});
```

- [ ] **2.4 — Run**
```bash
cd ui && npx vitest run src/lib/db/client.test.ts
```
Expected: PASS

- [ ] **2.5 — Commit**
```bash
git add ui/src/lib/db/ && git commit -m "feat: league.db schema and client"
```

---

## Task 3: Types + shared interfaces

**Files:** `ui/src/lib/types.ts`

- [ ] **3.1 — Create types.ts**

```ts
export interface League { id: number; slug: string; name: string; excludeFromCombined: boolean; notes: string | null; }
export interface Season { id: number; leagueId: number; seasonNumber: number; status: 'active' | 'complete'; }
export interface Round {
  id: number; seasonId: number; mlRoundId: string; name: string; description: string | null;
  spotifyPlaylistUrl: string | null; submissionDeadline: string | null; votingDeadline: string | null; createdAt: string;
}
export interface Competitor { id: number; mlCompetitorId: string; name: string; }
export interface MlSubmission {
  id: number; roundId: number; competitorId: number; spotifyUri: string; title: string;
  album: string | null; artists: string; comment: string | null; createdAt: string;
  visibleToVoters: boolean; totalPoints?: number; rank?: number; submitterName?: string;
}
export interface ResearchSong {
  id: number; roundId: number; spotifyUri: string; title: string; artist: string;
  album: string | null; addedAt: string; notes: string | null;
  themeFit: number | null; discoveryPotential: number | null;
  nostalgiaPotential: number | null; personalRating: number | null;
  saveForFuture: boolean; submittedByMe: boolean; submittedByOther: boolean;
  otherSubmissionVotes: number | null; score?: number | null;
}
export interface Settings { weightDiscovery: number; weightThemeFit: number; weightPersonal: number; weightNostalgia: number; }
export interface ImportLogEntry {
  id: number; leagueSlug: string; seasonNumber: number; filename: string; importedAt: string;
  roundsCount: number; submissionsCount: number; votesCount: number;
  status: 'success' | 'partial' | 'error'; error: string | null;
}
export interface YtmQueueEntry {
  id: number; spotifyUri: string; title: string | null; artist: string | null;
  status: 'pending' | 'processing' | 'done' | 'failed'; error: string | null;
  queuedAt: string; resolvedAt: string | null;
}
```

- [ ] **3.2 — Commit**
```bash
git add ui/src/lib/types.ts && git commit -m "feat: shared TypeScript types"
```

---

## Task 4: League + season DB layer

**Files:** `ui/src/lib/db/leagues.ts`

- [ ] **4.1 — leagues.ts**

```ts
import type Database from 'better-sqlite3';
import type { League, Season } from '../types.js';

const SEED = [
  { slug: 'hip-jammers',  name: 'Hip Jammers',  exclude: 0 },
  { slug: 'fam-jam',      name: 'Fam-Jam',      exclude: 0 },
  { slug: 'second-best',  name: 'Second Best',  exclude: 0 },
  { slug: 'nostalgia-pit',name: 'Nostalgia Pit',exclude: 1 },
];

export function seedLeagues(db: Database.Database): void {
  const stmt = db.prepare(`INSERT INTO leagues (slug,name,exclude_from_combined) VALUES (@slug,@name,@exclude)
    ON CONFLICT(slug) DO UPDATE SET name=excluded.name`);
  for (const l of SEED) stmt.run(l);
}

export function getAllLeagues(db: Database.Database): League[] {
  return (db.prepare('SELECT * FROM leagues ORDER BY id').all() as any[]).map(r => ({
    id: r.id, slug: r.slug, name: r.name, excludeFromCombined: !!r.exclude_from_combined, notes: r.notes,
  }));
}

export function getLeagueBySlug(db: Database.Database, slug: string): League | null {
  const r = db.prepare('SELECT * FROM leagues WHERE slug=?').get(slug) as any;
  return r ? { id: r.id, slug: r.slug, name: r.name, excludeFromCombined: !!r.exclude_from_combined, notes: r.notes } : null;
}

export function getSeasonsForLeague(db: Database.Database, leagueId: number): Season[] {
  return (db.prepare('SELECT * FROM seasons WHERE league_id=? ORDER BY season_number').all(leagueId) as any[])
    .map(r => ({ id: r.id, leagueId: r.league_id, seasonNumber: r.season_number, status: r.status }));
}

export function getActiveSeasonsWithLeague(db: Database.Database): Array<Season & { league: League }> {
  return (db.prepare(`SELECT s.*,l.slug league_slug,l.name league_name,l.exclude_from_combined
    FROM seasons s JOIN leagues l ON s.league_id=l.id WHERE s.status='active'
    ORDER BY l.id,s.season_number`).all() as any[]).map(r => ({
    id: r.id, leagueId: r.league_id, seasonNumber: r.season_number, status: r.status,
    league: { id: r.league_id, slug: r.league_slug, name: r.league_name, excludeFromCombined: !!r.exclude_from_combined, notes: null },
  }));
}

export function upsertSeason(db: Database.Database, leagueId: number, seasonNumber: number, status: 'active'|'complete'): number {
  return (db.prepare(`INSERT INTO seasons (league_id,season_number,status) VALUES (?,?,?)
    ON CONFLICT(league_id,season_number) DO UPDATE SET status=excluded.status RETURNING id`)
    .get(leagueId, seasonNumber, status) as { id: number }).id;
}
```

- [ ] **4.2 — Test**

`ui/src/lib/db/leagues.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, getAllLeagues, getActiveSeasonsWithLeague, upsertSeason } from './leagues.js';

const mk = () => openLeagueDb(':memory:');

it('seeds 4 leagues, nostalgia-pit excluded', () => {
  const db = mk(); seedLeagues(db);
  const leagues = getAllLeagues(db);
  expect(leagues).toHaveLength(4);
  expect(leagues.find(l => l.slug === 'nostalgia-pit')?.excludeFromCombined).toBe(true);
});

it('seed idempotent', () => {
  const db = mk(); seedLeagues(db); seedLeagues(db);
  expect(getAllLeagues(db)).toHaveLength(4);
});

it('getActiveSeasonsWithLeague', () => {
  const db = mk(); seedLeagues(db);
  const [hj] = getAllLeagues(db);
  upsertSeason(db, hj.id, 1, 'complete');
  upsertSeason(db, hj.id, 3, 'active');
  const active = getActiveSeasonsWithLeague(db);
  expect(active).toHaveLength(1);
  expect(active[0].seasonNumber).toBe(3);
});
```

- [ ] **4.3 — Run**
```bash
cd ui && npx vitest run src/lib/db/leagues.test.ts
```
Expected: PASS

- [ ] **4.4 — Commit**
```bash
git add ui/src/lib/db/leagues.ts ui/src/lib/db/leagues.test.ts
git commit -m "feat: league and season DB layer"
```

---

## Task 5: Scoring formula + settings DB layer

**Files:** `ui/src/lib/scoring.ts`, `ui/src/lib/db/settings.ts`

- [ ] **5.1 — scoring.ts**

```ts
export interface Weights { weightDiscovery: number; weightThemeFit: number; weightPersonal: number; weightNostalgia: number; }
export interface RatingInputs {
  discoveryPotential?: number | null; themeFit?: number | null;
  personalRating?: number | null; nostalgiaPotential?: number | null;
}

export function computeScore(r: RatingInputs, w: Weights): number | null {
  const dims = [
    { v: r.discoveryPotential, w: w.weightDiscovery },
    { v: r.themeFit,           w: w.weightThemeFit },
    { v: r.personalRating,     w: w.weightPersonal },
    { v: r.nostalgiaPotential, w: w.weightNostalgia },
  ].filter(d => d.v != null) as { v: number; w: number }[];
  if (!dims.length) return null;
  const totalW = dims.reduce((s, d) => s + d.w, 0);
  return dims.reduce((s, d) => s + d.v * d.w, 0) / totalW;
}
```

- [ ] **5.2 — scoring.test.ts**

```ts
import { it, expect } from 'vitest';
import { computeScore } from './scoring.js';
const W = { weightDiscovery: 35, weightThemeFit: 25, weightPersonal: 25, weightNostalgia: 15 };

it('null when no ratings', () => expect(computeScore({}, W)).toBeNull());
it('full score', () => expect(computeScore({ discoveryPotential:5,themeFit:4,personalRating:4,nostalgiaPotential:1 }, W)).toBeCloseTo(3.9, 1));
it('discovery > nostalgia when equal otherwise', () => {
  const d = computeScore({ discoveryPotential:5,nostalgiaPotential:1,themeFit:3,personalRating:3 }, W);
  const n = computeScore({ discoveryPotential:1,nostalgiaPotential:5,themeFit:3,personalRating:3 }, W);
  expect(d!).toBeGreaterThan(n!);
});
```

- [ ] **5.3 — settings.ts**

```ts
import type Database from 'better-sqlite3';
import type { Settings } from '../types.js';
import { DEFAULT_SETTINGS } from './schema.js';

export function getSettings(db: Database.Database): Settings {
  const m = Object.fromEntries(
    (db.prepare('SELECT key,value FROM settings').all() as any[]).map(r => [r.key, r.value])
  );
  return {
    weightDiscovery: +( m.weight_discovery ?? DEFAULT_SETTINGS.weight_discovery),
    weightThemeFit:  +( m.weight_theme_fit  ?? DEFAULT_SETTINGS.weight_theme_fit),
    weightPersonal:  +( m.weight_personal   ?? DEFAULT_SETTINGS.weight_personal),
    weightNostalgia: +( m.weight_nostalgia  ?? DEFAULT_SETTINGS.weight_nostalgia),
  };
}

export function updateWeights(db: Database.Database, w: Partial<Settings>): void {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  const tx = db.transaction((weights: Partial<Settings>) => {
    if (weights.weightDiscovery != null) stmt.run('weight_discovery', String(weights.weightDiscovery));
    if (weights.weightThemeFit  != null) stmt.run('weight_theme_fit',  String(weights.weightThemeFit));
    if (weights.weightPersonal  != null) stmt.run('weight_personal',   String(weights.weightPersonal));
    if (weights.weightNostalgia != null) stmt.run('weight_nostalgia',  String(weights.weightNostalgia));
  });
  tx(w);
}
```

- [ ] **5.4 — Run**
```bash
cd ui && npx vitest run src/lib/scoring.test.ts
```
Expected: PASS

- [ ] **5.5 — Commit**
```bash
git add ui/src/lib/scoring.ts ui/src/lib/scoring.test.ts ui/src/lib/db/settings.ts
git commit -m "feat: scoring formula and settings DB layer"
```

---

## Task 6: ZIP import pipeline

**Files:** `ui/src/lib/import/zipParser.ts`, `ui/src/lib/import/importer.ts`, `ui/src/lib/import/startupScan.ts`, `ui/src/lib/db/rounds.ts`, `ui/src/lib/db/submissions.ts`, `ui/src/lib/db/importLog.ts`

- [ ] **6.1 — rounds.ts**

```ts
import type Database from 'better-sqlite3';
import type { Round } from '../types.js';

function row(r: any): Round {
  return { id: r.id, seasonId: r.season_id, mlRoundId: r.ml_round_id, name: r.name,
    description: r.description, spotifyPlaylistUrl: r.spotify_playlist_url,
    submissionDeadline: r.submission_deadline, votingDeadline: r.voting_deadline, createdAt: r.created_at };
}

export function upsertRound(db: Database.Database, seasonId: number, r: {
  mlRoundId: string; name: string; description: string; spotifyPlaylistUrl: string; createdAt: string;
}): number {
  return (db.prepare(`INSERT INTO rounds (season_id,ml_round_id,name,description,spotify_playlist_url,created_at)
    VALUES (@seasonId,@mlRoundId,@name,@description,@spotifyPlaylistUrl,@createdAt)
    ON CONFLICT(ml_round_id) DO UPDATE SET name=excluded.name,description=excluded.description,
    spotify_playlist_url=excluded.spotify_playlist_url RETURNING id`).get({ seasonId, ...r }) as { id: number }).id;
}

export function getRoundsForSeason(db: Database.Database, seasonId: number): Round[] {
  return (db.prepare('SELECT * FROM rounds WHERE season_id=? ORDER BY created_at').all(seasonId) as any[]).map(row);
}

export function getRoundById(db: Database.Database, id: number): Round | null {
  const r = db.prepare('SELECT * FROM rounds WHERE id=?').get(id) as any;
  return r ? row(r) : null;
}

export function getCurrentRoundForSeason(db: Database.Database, seasonId: number): Round | null {
  const r = db.prepare('SELECT * FROM rounds WHERE season_id=? ORDER BY created_at DESC LIMIT 1').get(seasonId) as any;
  return r ? row(r) : null;
}

export function updateDeadlines(db: Database.Database, roundId: number, sub: string | null, vote: string | null): void {
  db.prepare('UPDATE rounds SET submission_deadline=?,voting_deadline=? WHERE id=?').run(sub, vote, roundId);
}
```

- [ ] **6.2 — submissions.ts**

```ts
import type Database from 'better-sqlite3';
import type { MlSubmission } from '../types.js';

export function upsertCompetitor(db: Database.Database, mlId: string, name: string): number {
  return (db.prepare(`INSERT INTO competitors (ml_competitor_id,name) VALUES (?,?)
    ON CONFLICT(ml_competitor_id) DO UPDATE SET name=excluded.name RETURNING id`).get(mlId, name) as { id: number }).id;
}

export function upsertSubmission(db: Database.Database, s: {
  roundId: number; competitorId: number; spotifyUri: string; title: string;
  album: string; artists: string; comment: string; createdAt: string; visibleToVoters: boolean;
}): void {
  db.prepare(`INSERT INTO ml_submissions
    (round_id,competitor_id,spotify_uri,title,album,artists,comment,created_at,visible_to_voters)
    VALUES (@roundId,@competitorId,@spotifyUri,@title,@album,@artists,@comment,@createdAt,@visibleToVoters)
    ON CONFLICT(round_id,spotify_uri,competitor_id) DO UPDATE SET title=excluded.title`)
    .run({ ...s, visibleToVoters: s.visibleToVoters ? 1 : 0 });
}

export function upsertVote(db: Database.Database, v: {
  roundId: number; voterId: number; spotifyUri: string; points: number; comment: string; createdAt: string;
}): void {
  db.prepare(`INSERT INTO votes (round_id,voter_id,spotify_uri,points,comment,created_at)
    VALUES (@roundId,@voterId,@spotifyUri,@points,@comment,@createdAt)
    ON CONFLICT(round_id,voter_id,spotify_uri) DO UPDATE SET points=excluded.points`).run(v);
}

export function getSubmissionsForRound(db: Database.Database, roundId: number): MlSubmission[] {
  return (db.prepare(`SELECT s.*,c.name submitter_name,COALESCE(SUM(v.points),0) total_points
    FROM ml_submissions s JOIN competitors c ON s.competitor_id=c.id
    LEFT JOIN votes v ON v.round_id=s.round_id AND v.spotify_uri=s.spotify_uri
    WHERE s.round_id=? GROUP BY s.id ORDER BY total_points DESC`).all(roundId) as any[])
    .map((r, i) => ({
      id: r.id, roundId: r.round_id, competitorId: r.competitor_id, spotifyUri: r.spotify_uri,
      title: r.title, album: r.album, artists: r.artists, comment: r.comment, createdAt: r.created_at,
      visibleToVoters: !!r.visible_to_voters, totalPoints: r.total_points, rank: i + 1,
      submitterName: r.submitter_name,
    }));
}
```

- [ ] **6.3 — zipParser.ts**

```ts
import AdmZip from 'adm-zip';

export interface ParsedRound { id: string; createdAt: string; name: string; description: string; playlistUrl: string; }
export interface ParsedSubmission { spotifyUri: string; title: string; album: string; artists: string; submitterId: string; createdAt: string; comment: string; roundId: string; visibleToVoters: boolean; }
export interface ParsedVote { spotifyUri: string; voterId: string; createdAt: string; points: number; comment: string; roundId: string; }
export interface ParsedCompetitor { id: string; name: string; }
export interface ParsedZip { rounds: ParsedRound[]; submissions: ParsedSubmission[]; votes: ParsedVote[]; competitors: ParsedCompetitor[]; }

function csv(text: string): Record<string,string>[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  return lines.slice(1).map(line => {
    const vals: string[] = []; let inQ = false; let cur = '';
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { vals.push(cur); cur = ''; }
      else cur += ch;
    }
    vals.push(cur);
    return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? '').trim()]));
  });
}

export function parseZip(buf: Buffer): ParsedZip {
  const zip = new AdmZip(buf);
  const rounds = csv(zip.readAsText('rounds.csv') ?? '').filter(r => r['ID']).map(r => ({
    id: r['ID'], createdAt: r['Created'], name: r['Name'], description: r['Description'] ?? '', playlistUrl: r['Playlist URL'] ?? '',
  }));
  const submissions = csv(zip.readAsText('submissions.csv') ?? '').filter(s => s['Spotify URI']).map(s => ({
    spotifyUri: s['Spotify URI'], title: s['Title'], album: s['Album'] ?? '', artists: s['Artist(s)'] ?? '',
    submitterId: s['Submitter ID'], createdAt: s['Created'], comment: s['Comment'] ?? '',
    roundId: s['Round ID'], visibleToVoters: s['Visible To Voters'] === 'Yes',
  }));
  const votes = csv(zip.readAsText('votes.csv') ?? '').filter(v => v['Spotify URI']).map(v => ({
    spotifyUri: v['Spotify URI'], voterId: v['Voter ID'], createdAt: v['Created'],
    points: parseInt(v['Points Assigned'] ?? '0', 10), comment: v['Comment'] ?? '', roundId: v['Round ID'],
  }));
  const competitors = csv(zip.readAsText('competitors.csv') ?? '').filter(c => c['ID']).map(c => ({ id: c['ID'], name: c['Name'] }));
  return { rounds, submissions, votes, competitors };
}
```

- [ ] **6.4 — importer.ts**

```ts
import type Database from 'better-sqlite3';
import type { ParsedZip } from './zipParser.js';
import { getLeagueBySlug, upsertSeason } from '../db/leagues.js';
import { upsertRound } from '../db/rounds.js';
import { upsertCompetitor, upsertSubmission, upsertVote } from '../db/submissions.js';

export interface ImportResult { roundsCount: number; submissionsCount: number; votesCount: number; status: 'success'|'partial'|'error'; error?: string; }

export function importZipData(db: Database.Database, leagueSlug: string, seasonNumber: number, parsed: ParsedZip): ImportResult {
  const league = getLeagueBySlug(db, leagueSlug);
  if (!league) return { roundsCount: 0, submissionsCount: 0, votesCount: 0, status: 'error', error: `Unknown league: ${leagueSlug}` };
  let rc = 0, sc = 0, vc = 0;
  try {
    db.transaction(() => {
      const status = parsed.rounds.length > 0 && parsed.votes.length > 0 ? 'complete' : 'active';
      const seasonId = upsertSeason(db, league.id, seasonNumber, status);
      const cMap = new Map<string,number>();
      for (const c of parsed.competitors) cMap.set(c.id, upsertCompetitor(db, c.id, c.name));
      const rMap = new Map<string,number>();
      for (const r of parsed.rounds) {
        rMap.set(r.id, upsertRound(db, seasonId, { mlRoundId: r.id, name: r.name, description: r.description, spotifyPlaylistUrl: r.playlistUrl, createdAt: r.createdAt }));
        rc++;
      }
      for (const s of parsed.submissions) {
        const roundId = rMap.get(s.roundId), competitorId = cMap.get(s.submitterId);
        if (!roundId || !competitorId) continue;
        upsertSubmission(db, { roundId, competitorId, spotifyUri: s.spotifyUri, title: s.title, album: s.album, artists: s.artists, comment: s.comment, createdAt: s.createdAt, visibleToVoters: s.visibleToVoters });
        sc++;
      }
      for (const v of parsed.votes) {
        const roundId = rMap.get(v.roundId), voterId = cMap.get(v.voterId);
        if (!roundId || !voterId) continue;
        upsertVote(db, { roundId, voterId, spotifyUri: v.spotifyUri, points: v.points, comment: v.comment, createdAt: v.createdAt });
        vc++;
      }
    })();
    return { roundsCount: rc, submissionsCount: sc, votesCount: vc, status: 'success' };
  } catch (err) {
    return { roundsCount: rc, submissionsCount: sc, votesCount: vc, status: 'error', error: String(err) };
  }
}
```

- [ ] **6.5 — importLog.ts**

```ts
import type Database from 'better-sqlite3';
import type { ImportLogEntry } from '../types.js';

export function logImport(db: Database.Database, e: Omit<ImportLogEntry,'id'>): void {
  db.prepare(`INSERT INTO import_log (league_slug,season_number,filename,imported_at,rounds_count,submissions_count,votes_count,status,error)
    VALUES (@leagueSlug,@seasonNumber,@filename,@importedAt,@roundsCount,@submissionsCount,@votesCount,@status,@error)`).run(e);
}

export function getImportLog(db: Database.Database): ImportLogEntry[] {
  return (db.prepare('SELECT * FROM import_log ORDER BY imported_at DESC LIMIT 100').all() as any[]).map(r => ({
    id: r.id, leagueSlug: r.league_slug, seasonNumber: r.season_number, filename: r.filename,
    importedAt: r.imported_at, roundsCount: r.rounds_count, submissionsCount: r.submissions_count,
    votesCount: r.votes_count, status: r.status, error: r.error,
  }));
}
```

- [ ] **6.6 — startupScan.ts**

```ts
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import type Database from 'better-sqlite3';
import { parseZip } from './zipParser.js';
import { importZipData } from './importer.js';
import { logImport } from '../db/importLog.js';
import { seedLeagues } from '../db/leagues.js';

export async function runStartupImport(db: Database.Database, dataDir: string): Promise<void> {
  seedLeagues(db);
  if (!existsSync(dataDir)) return;
  for (const leagueSlug of readdirSync(dataDir)) {
    const leagueDir = resolve(dataDir, leagueSlug);
    if (!existsSync(leagueDir)) continue;
    for (const seasonDir of readdirSync(leagueDir)) {
      const zipPath = resolve(leagueDir, seasonDir, 'export.zip');
      if (!existsSync(zipPath)) continue;
      const seasonNumber = parseInt(seasonDir.replace('season-', ''), 10);
      if (isNaN(seasonNumber)) continue;
      try {
        const result = importZipData(db, leagueSlug, seasonNumber, parseZip(readFileSync(zipPath)));
        logImport(db, { leagueSlug, seasonNumber, filename: basename(zipPath), importedAt: new Date().toISOString(), ...result, error: result.error ?? null });
      } catch (err) {
        logImport(db, { leagueSlug, seasonNumber, filename: basename(zipPath), importedAt: new Date().toISOString(), roundsCount: 0, submissionsCount: 0, votesCount: 0, status: 'error', error: String(err) });
      }
    }
  }
}
```

- [ ] **6.7 — Tests**

`ui/src/lib/import/importer.test.ts`:
```ts
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openLeagueDb } from '../db/client.js';
import { seedLeagues } from '../db/leagues.js';
import { parseZip } from './zipParser.js';
import { importZipData } from './importer.js';

const mk = () => { const db = openLeagueDb(':memory:'); seedLeagues(db); return db; };

it('imports HJ S1 with rounds+submissions+votes', () => {
  const db = mk();
  const r = importZipData(db, 'hip-jammers', 1, parseZip(readFileSync(resolve('../../data/hip-jammers/season-1/export.zip'))));
  expect(r.status).toBe('success');
  expect(r.roundsCount).toBeGreaterThan(0);
  expect(r.votesCount).toBeGreaterThan(0);
});

it('idempotent', () => {
  const db = mk();
  const buf = readFileSync(resolve('../../data/hip-jammers/season-1/export.zip'));
  importZipData(db, 'hip-jammers', 1, parseZip(buf));
  expect(importZipData(db, 'hip-jammers', 1, parseZip(buf)).status).toBe('success');
});

it('handles empty in-progress ZIP', () => {
  const db = mk();
  const r = importZipData(db, 'nostalgia-pit', 1, parseZip(readFileSync(resolve('../../data/nostalgia-pit/season-1/export.zip'))));
  expect(r.status).toBe('success');
  expect(r.roundsCount).toBe(0);
});
```

- [ ] **6.8 — Run tests**
```bash
cd ui && npx vitest run src/lib/import/
```
Expected: PASS

- [ ] **6.9 — Commit**
```bash
git add ui/src/lib/
git commit -m "feat: ZIP import pipeline — parser, importer, startup scan"
```

---

## Task 7: Server hook + research DB layer

**Files:** `ui/src/hooks.server.ts`, `ui/src/lib/db/research.ts`

- [ ] **7.1 — hooks.server.ts**

```ts
import { getDb } from '$lib/db/client.js';
import { runStartupImport } from '$lib/import/startupScan.js';
import { resolve } from 'node:path';

const DATA_DIR = process.env.DATA_DIR ?? resolve(process.cwd(), '../data');
const db = getDb();
runStartupImport(db, DATA_DIR).catch(err => console.error('[startup] import error:', err));
```

- [ ] **7.2 — research.ts**

```ts
import type Database from 'better-sqlite3';
import type { ResearchSong } from '../types.js';

function row(r: any): ResearchSong {
  return {
    id: r.id, roundId: r.round_id, spotifyUri: r.spotify_uri, title: r.title, artist: r.artist,
    album: r.album, addedAt: r.added_at, notes: r.notes,
    themeFit: r.theme_fit, discoveryPotential: r.discovery_potential,
    nostalgiaPotential: r.nostalgia_potential, personalRating: r.personal_rating,
    saveForFuture: !!r.save_for_future, submittedByMe: !!r.submitted_by_me,
    submittedByOther: !!r.submitted_by_other, otherSubmissionVotes: r.other_submission_votes,
  };
}

export function getResearchSongs(db: Database.Database, roundId: number): ResearchSong[] {
  return (db.prepare('SELECT * FROM research_songs WHERE round_id=? ORDER BY added_at').all(roundId) as any[]).map(row);
}

export function addResearchSong(db: Database.Database, s: {
  roundId: number; spotifyUri: string; title: string; artist: string; album: string | null;
}): ResearchSong {
  // Auto-detect submitted_by_me and submitted_by_other from ml_submissions
  const myId = process.env.MY_COMPETITOR_ID;
  const mySubmission = myId
    ? db.prepare(`SELECT ms.*, COALESCE(SUM(v.points),0) pts FROM ml_submissions ms
        JOIN competitors c ON ms.competitor_id=c.id
        LEFT JOIN votes v ON v.round_id=ms.round_id AND v.spotify_uri=ms.spotify_uri
        WHERE ms.spotify_uri=? AND c.ml_competitor_id=? GROUP BY ms.id`).get(s.spotifyUri, myId) as any
    : null;
  const otherSubmission = db.prepare(`SELECT ms.*, COALESCE(SUM(v.points),0) pts FROM ml_submissions ms
    LEFT JOIN votes v ON v.round_id=ms.round_id AND v.spotify_uri=ms.spotify_uri
    WHERE ms.spotify_uri=?${myId ? ' AND ms.competitor_id != (SELECT id FROM competitors WHERE ml_competitor_id=?)' : ''}
    GROUP BY ms.id LIMIT 1`).get(...(myId ? [s.spotifyUri, myId] : [s.spotifyUri])) as any;

  db.prepare(`INSERT OR IGNORE INTO research_songs
    (round_id,spotify_uri,title,artist,album,added_at,submitted_by_me,submitted_by_other,other_submission_votes)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(s.roundId, s.spotifyUri, s.title, s.artist, s.album ?? null,
      new Date().toISOString(), mySubmission ? 1 : 0,
      otherSubmission ? 1 : 0, otherSubmission?.pts ?? null);

  return row(db.prepare('SELECT * FROM research_songs WHERE round_id=? AND spotify_uri=?').get(s.roundId, s.spotifyUri) as any);
}

export function updateResearchSong(db: Database.Database, id: number, patch: Partial<Omit<ResearchSong,'id'|'roundId'|'spotifyUri'|'addedAt'>>): void {
  const fields: string[] = [];
  const vals: unknown[] = [];
  const map: Record<string,string> = {
    notes: 'notes', themeFit: 'theme_fit', discoveryPotential: 'discovery_potential',
    nostalgiaPotential: 'nostalgia_potential', personalRating: 'personal_rating',
    saveForFuture: 'save_for_future', submittedByMe: 'submitted_by_me',
    submittedByOther: 'submitted_by_other', otherSubmissionVotes: 'other_submission_votes',
  };
  for (const [k, col] of Object.entries(map)) {
    if (k in patch) { fields.push(`${col}=?`); vals.push((patch as any)[k] === true ? 1 : (patch as any)[k] === false ? 0 : (patch as any)[k]); }
  }
  if (!fields.length) return;
  vals.push(id);
  db.prepare(`UPDATE research_songs SET ${fields.join(',')} WHERE id=?`).run(...vals);
}

export function deleteResearchSong(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM research_songs WHERE id=?').run(id);
}
```

- [ ] **7.3 — Verify dev server starts cleanly**
```bash
cd ui && npm run dev
```
Expected: No errors. DB initialized. All existing ZIPs imported on first run.

- [ ] **7.4 — Commit**
```bash
git add ui/src/hooks.server.ts ui/src/lib/db/research.ts
git commit -m "feat: server hook startup import and research DB layer"
```

---

## Task 8: Home page

**Files:** `ui/src/lib/submissionsDb.ts`, `ui/src/routes/+page.server.ts`, `ui/src/routes/+page.svelte`

- [ ] **8.1 — submissionsDb.ts** (read-only access to bot's `submissions.db`)

```ts
import Database from 'better-sqlite3';
import { resolve } from 'node:path';

let _db: Database.Database | null = null;

export function getSubmissionsDb(): Database.Database | null {
  if (_db) return _db;
  const path = resolve(process.env.DATA_DIR ?? 'data', 'submissions.db');
  try { _db = new Database(path, { readonly: true }); return _db; }
  catch { return null; }
}

export interface ChatMention {
  id: number; trackTitle: string | null; trackArtist: string | null;
  spotifyUri: string | null; submitterName: string; sourcePlatform: string | null;
  sourceUrl: string | null; createdAt: number;
}

export function getChatMentionsBetween(fromMs: number, toMs: number): ChatMention[] {
  const db = getSubmissionsDb();
  if (!db) return [];
  return (db.prepare(`SELECT id,track_title,track_artist,spotify_uri,submitter_name,source_platform,source_url,created_at
    FROM submissions WHERE created_at>=? AND created_at<? AND status IN ('added','duplicate') ORDER BY created_at`)
    .all(fromMs, toMs) as any[]).map(r => ({
    id: r.id, trackTitle: r.track_title, trackArtist: r.track_artist, spotifyUri: r.spotify_uri,
    submitterName: r.submitter_name, sourcePlatform: r.source_platform, sourceUrl: r.source_url, createdAt: r.created_at,
  }));
}

export function getAllMentions(): ChatMention[] {
  const db = getSubmissionsDb();
  if (!db) return [];
  return (db.prepare(`SELECT id,track_title,track_artist,spotify_uri,submitter_name,source_platform,source_url,created_at
    FROM submissions WHERE status IN ('added','duplicate') ORDER BY created_at DESC`).all() as any[]).map(r => ({
    id: r.id, trackTitle: r.track_title, trackArtist: r.track_artist, spotifyUri: r.spotify_uri,
    submitterName: r.submitter_name, sourcePlatform: r.source_platform, sourceUrl: r.source_url, createdAt: r.created_at,
  }));
}
```

- [ ] **8.2 — +page.server.ts**

```ts
import type { PageServerLoad } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { getActiveSeasonsWithLeague, getAllLeagues, getSeasonsForLeague } from '$lib/db/leagues.js';
import { getCurrentRoundForSeason, getRoundsForSeason } from '$lib/db/rounds.js';
import { getAllMentions } from '$lib/submissionsDb.js';

export const load: PageServerLoad = async () => {
  const db = getDb();

  const activeSeasons = getActiveSeasonsWithLeague(db).map(s => {
    const currentRound = getCurrentRoundForSeason(db, s.id);
    const researchCount = currentRound
      ? (db.prepare('SELECT COUNT(*) n FROM research_songs WHERE round_id=?').get(currentRound.id) as any).n
      : 0;
    return { ...s, currentRound, researchCount };
  });

  const allLeagues = getAllLeagues(db);
  const pastLeagues = allLeagues.filter(l => !l.excludeFromCombined).map(league => {
    const seasons = getSeasonsForLeague(db, league.id).filter(s => s.status === 'complete');
    const totalRounds = seasons.reduce((sum, s) =>
      sum + (db.prepare('SELECT COUNT(*) n FROM rounds WHERE season_id=?').get(s.id) as any).n, 0);
    const totalSongs = (db.prepare(`SELECT COUNT(DISTINCT ms.spotify_uri) n FROM ml_submissions ms
      JOIN rounds r ON ms.round_id=r.id JOIN seasons s ON r.season_id=s.id WHERE s.league_id=?`)
      .get(league.id) as any).n;
    return { league, seasons, totalRounds, totalSongs };
  }).filter(l => l.seasons.length > 0);

  // All Songs Ever: ML submissions (non-excluded leagues) + chat mentions
  const mlSongs = (db.prepare(`SELECT DISTINCT ms.title,ms.artists,ms.spotify_uri,'ml' src,
    l.slug league_slug,l.name league_name,s.season_number,r.name round_name
    FROM ml_submissions ms JOIN rounds r ON ms.round_id=r.id JOIN seasons s ON r.season_id=s.id
    JOIN leagues l ON s.league_id=l.id WHERE l.exclude_from_combined=0
    ORDER BY r.created_at DESC`).all() as any[]);
  const chatMentions = getAllMentions();

  return { activeSeasons, pastLeagues, mlSongs, chatMentions };
};
```

- [ ] **8.3 — +page.svelte**

```svelte
<script lang="ts">
  import type { PageData } from './$types.js';
  let { data } = $props<{ data: PageData }>();

  function timeUntil(iso: string | null) {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'overdue';
    const h = Math.floor(ms / 3_600_000);
    return h >= 24 ? `${Math.floor(h/24)}d ${h%24}h` : `${h}h`;
  }
  function urgent(iso: string | null) { return iso ? new Date(iso).getTime() - Date.now() < 86_400_000 : false; }
</script>

<svelte:head><title>Music League</title></svelte:head>

<section class="mb-10">
  <h2 class="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">Active Now</h2>
  <div class="grid grid-cols-2 gap-4">
    {#each data.activeSeasons as s}
      {@const np = s.league.excludeFromCombined}
      <a href="/league/{s.league.slug}/season/{s.seasonNumber}"
        class="block rounded-xl p-4 border-2 hover:bg-slate-800 transition-colors bg-slate-800/50"
        class:border-cyan-500={!np} class:border-amber-500={np}>
        <div class="text-xs font-bold mb-1" class:text-cyan-400={!np} class:text-amber-400={np}>
          ACTIVE{np ? ' · 1 BAND/ROUND' : ''}
        </div>
        <div class="font-bold text-slate-100">{s.league.name} S{s.seasonNumber}</div>
        {#if s.currentRound}<div class="text-xs text-slate-400 mt-1 truncate">"{s.currentRound.name}"</div>{/if}
        <div class="text-xs mt-2" class:text-cyan-300={s.researchCount > 0} class:text-slate-500={!s.researchCount}>
          {s.researchCount ? `🔬 ${s.researchCount} in research` : 'No research yet'}
        </div>
        {#if s.currentRound?.submissionDeadline}
          {@const t = timeUntil(s.currentRound.submissionDeadline)}
          {#if t}<div class="text-xs mt-1 font-semibold" class:text-red-400={urgent(s.currentRound.submissionDeadline)} class:text-yellow-400={!urgent(s.currentRound.submissionDeadline)}>Submit in {t}</div>{/if}
        {/if}
        {#if s.currentRound?.votingDeadline}
          {@const t = timeUntil(s.currentRound.votingDeadline)}
          {#if t}<div class="text-xs mt-1 font-semibold" class:text-red-400={urgent(s.currentRound.votingDeadline)} class:text-yellow-400={!urgent(s.currentRound.votingDeadline)}>Vote in {t}</div>{/if}
        {/if}
      </a>
    {/each}
  </div>
</section>

{#if data.pastLeagues.length}
<section class="mb-10">
  <h2 class="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">Past Seasons</h2>
  <div class="flex flex-col gap-2">
    {#each data.pastLeagues as item}
      <a href="/league/{item.league.slug}/season/{item.seasons.at(-1)?.seasonNumber ?? 1}"
        class="flex items-center rounded-lg px-4 py-3 border border-slate-700 hover:bg-slate-800 bg-slate-800/50 transition-colors">
        <span class="font-semibold text-slate-300">{item.league.name}</span>
        <span class="text-slate-500 text-xs ml-auto">{item.totalRounds} rounds · {item.totalSongs} songs →</span>
      </a>
    {/each}
  </div>
</section>
{/if}

<section>
  <h2 class="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">
    All Songs Ever
    <span class="text-slate-600 normal-case font-normal ml-2">{data.mlSongs.length + data.chatMentions.length} tracks</span>
  </h2>
  <div class="flex gap-3 mb-3 text-xs">
    <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-blue-400 inline-block"></span> ML submission</span>
    <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-green-400 inline-block"></span> Chat mention</span>
  </div>
  <div class="flex flex-col gap-1 max-h-96 overflow-y-auto">
    {#each data.mlSongs as s}
      <div class="flex items-center gap-2 px-3 py-2 rounded bg-slate-800/50 text-sm">
        <span class="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0"></span>
        <span class="text-slate-200 flex-1 truncate">{s.title} — {s.artists}</span>
        <span class="text-slate-500 text-xs flex-shrink-0">{s.league_name} S{s.season_number}</span>
      </div>
    {/each}
    {#each data.chatMentions as m}
      <div class="flex items-center gap-2 px-3 py-2 rounded bg-slate-800/50 text-sm">
        <span class="w-2 h-2 rounded-full bg-green-400 flex-shrink-0"></span>
        <span class="text-slate-200 flex-1 truncate">{m.trackTitle ?? 'Unknown'} — {m.trackArtist ?? ''}</span>
        <span class="text-slate-500 text-xs flex-shrink-0">{new Date(m.createdAt).toLocaleDateString()}</span>
      </div>
    {/each}
  </div>
</section>
```

- [ ] **8.4 — Verify in browser** — open http://localhost:5173, confirm active seasons + all songs list appear.

- [ ] **8.5 — Commit**
```bash
git add ui/src/ && git commit -m "feat: home page — active seasons, past seasons, all songs"
```

---

## Task 9: Season detail page

**Files:** `ui/src/routes/league/[league]/season/[n]/+page.server.ts`, `+page.svelte`

- [ ] **9.1 — +page.server.ts**

```ts
import type { PageServerLoad } from './$types.js';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getLeagueBySlug, getSeasonsForLeague } from '$lib/db/leagues.js';
import { getRoundsForSeason } from '$lib/db/rounds.js';

export const load: PageServerLoad = async ({ params }) => {
  const db = getDb();
  const league = getLeagueBySlug(db, params.league);
  if (!league) throw error(404, 'League not found');
  const seasons = getSeasonsForLeague(db, league.id);
  const season = seasons.find(s => s.seasonNumber === Number(params.n));
  if (!season) throw error(404, 'Season not found');
  const rounds = getRoundsForSeason(db, season.id).map(r => {
    const songCount = (db.prepare('SELECT COUNT(*) n FROM ml_submissions WHERE round_id=?').get(r.id) as any).n;
    const researchCount = (db.prepare('SELECT COUNT(*) n FROM research_songs WHERE round_id=?').get(r.id) as any).n;
    return { ...r, songCount, researchCount };
  });
  return { league, season, rounds };
};
```

- [ ] **9.2 — +page.svelte**

```svelte
<script lang="ts">
  import type { PageData } from './$types.js';
  let { data } = $props<{ data: PageData }>();
</script>

<svelte:head><title>{data.league.name} S{data.season.seasonNumber}</title></svelte:head>

<div class="text-sm text-slate-400 mb-6">
  <a href="/" class="hover:text-purple-400">Home</a> › {data.league.name} › Season {data.season.seasonNumber}
  <span class="ml-2 text-xs px-2 py-0.5 rounded font-bold"
    class:bg-cyan-900={data.season.status==='active'} class:text-cyan-300={data.season.status==='active'}
    class:bg-slate-700={data.season.status==='complete'} class:text-slate-300={data.season.status==='complete'}>
    {data.season.status.toUpperCase()}
  </span>
</div>

<h1 class="text-2xl font-bold mb-8">{data.league.name} — Season {data.season.seasonNumber}</h1>

<div class="flex flex-col gap-3">
  {#each data.rounds as r}
    <a href="/league/{data.league.slug}/season/{data.season.seasonNumber}/round/{r.id}"
      class="block rounded-xl p-4 border border-slate-700 hover:border-purple-500 hover:bg-slate-800 transition-colors bg-slate-800/50">
      <div class="flex items-start justify-between gap-4">
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-slate-100">{r.name}</div>
          {#if r.description}<div class="text-sm text-slate-400 mt-0.5 truncate">{r.description}</div>{/if}
        </div>
        <div class="text-right flex-shrink-0 text-xs text-slate-500">
          <div>{r.songCount} songs</div>
          {#if r.researchCount}<div class="text-purple-400">🔬 {r.researchCount} researched</div>{/if}
        </div>
      </div>
    </a>
  {/each}
  {#if !data.rounds.length}
    <p class="text-slate-500">No rounds imported yet. Upload an export ZIP in Settings.</p>
  {/if}
</div>
```

- [ ] **9.3 — Verify** — click a season from home, rounds list appears.

- [ ] **9.4 — Commit**
```bash
git add ui/src/routes/league/ && git commit -m "feat: season detail page"
```

---

## Task 10: Round detail — ML Playlist + Chat Mentions tabs

**Files:** `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.server.ts`, `+page.svelte`

- [ ] **10.1 — +page.server.ts**

```ts
import type { PageServerLoad } from './$types.js';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getLeagueBySlug, getSeasonsForLeague } from '$lib/db/leagues.js';
import { getRoundById, getRoundsForSeason } from '$lib/db/rounds.js';
import { getSubmissionsForRound } from '$lib/db/submissions.js';
import { getResearchSongs } from '$lib/db/research.js';
import { getSettings } from '$lib/db/settings.js';
import { computeScore } from '$lib/scoring.js';
import { getChatMentionsBetween } from '$lib/submissionsDb.js';

export const load: PageServerLoad = async ({ params }) => {
  const db = getDb();
  const league = getLeagueBySlug(db, params.league);
  if (!league) throw error(404, 'League not found');
  const seasons = getSeasonsForLeague(db, league.id);
  const season = seasons.find(s => s.seasonNumber === Number(params.n));
  if (!season) throw error(404, 'Season not found');
  const round = getRoundById(db, Number(params.roundId));
  if (!round || round.seasonId !== season.id) throw error(404, 'Round not found');

  const mlSubmissions = getSubmissionsForRound(db, round.id);

  // Chat mentions: from this round's created_at to next round's created_at (or now)
  const allRounds = getRoundsForSeason(db, season.id);
  const idx = allRounds.findIndex(r => r.id === round.id);
  const nextRound = allRounds[idx + 1];
  const fromMs = new Date(round.createdAt).getTime();
  const toMs = nextRound ? new Date(nextRound.createdAt).getTime() : Date.now();
  const chatMentions = getChatMentionsBetween(fromMs, toMs);

  const settings = getSettings(db);
  const research = getResearchSongs(db, round.id).map(s => ({
    ...s, score: computeScore(s, settings),
  }));

  return { league, season, round, mlSubmissions, chatMentions, research, settings };
};
```

- [ ] **10.2 — +page.svelte** (tabs: ML Playlist | Chat Mentions | Research)

```svelte
<script lang="ts">
  import type { PageData } from './$types.js';
  let { data } = $props<{ data: PageData }>();
  let tab = $state<'ml' | 'chat' | 'research'>('ml');
  let ytmMode = $state(false);
</script>

<svelte:head><title>{data.round.name}</title></svelte:head>

<div class="text-sm text-slate-400 mb-4">
  <a href="/" class="hover:text-purple-400">Home</a> ›
  <a href="/league/{data.league.slug}/season/{data.season.seasonNumber}" class="hover:text-purple-400">{data.league.name} S{data.season.seasonNumber}</a> ›
  {data.round.name}
</div>

<div class="mb-6">
  <h1 class="text-2xl font-bold text-slate-100">{data.round.name}</h1>
  {#if data.round.description}<p class="text-slate-400 mt-1">{data.round.description}</p>{/if}
</div>

<!-- Tabs -->
<div class="flex gap-1 mb-6 bg-slate-900 rounded-lg p-1 w-fit">
  {#each [['ml','ML Playlist'],['chat','Chat Mentions'],['research','🔬 Research']] as [key, label]}
    <button onclick={() => tab = key as any}
      class="px-4 py-1.5 rounded text-sm font-medium transition-colors"
      class:bg-purple-600={tab===key} class:text-white={tab===key}
      class:text-slate-400={tab!==key} class:hover:text-slate-200={tab!==key}>
      {label}
    </button>
  {/each}
</div>

<!-- ML Playlist tab -->
{#if tab === 'ml'}
  <div class="flex items-center gap-4 mb-4">
    {#if data.round.spotifyPlaylistUrl}
      <a href={data.round.spotifyPlaylistUrl} target="_blank" class="text-green-400 text-sm hover:underline">Open in Spotify ↗</a>
    {/if}
    <div class="flex items-center gap-1 bg-slate-800 rounded-full px-1 py-1 text-xs ml-auto">
      <button onclick={() => ytmMode = false}
        class="px-3 py-0.5 rounded-full transition-colors"
        class:bg-green-500={!ytmMode} class:text-black={!ytmMode} class:font-bold={!ytmMode} class:text-slate-400={ytmMode}>
        Spotify
      </button>
      <button onclick={() => ytmMode = true}
        class="px-3 py-0.5 rounded-full transition-colors"
        class:bg-red-500={ytmMode} class:text-white={ytmMode} class:font-bold={ytmMode} class:text-slate-400={!ytmMode}>
        YT Music
      </button>
    </div>
  </div>
  <div class="flex flex-col gap-2">
    {#each data.mlSubmissions as s}
      <div class="flex items-center gap-3 px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-700">
        <span class="text-slate-500 text-xs w-5 text-right flex-shrink-0">#{s.rank}</span>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-slate-100 truncate">{s.title}</div>
          <div class="text-xs text-slate-400">{s.artists}{s.submitterName ? ` · ${s.submitterName}` : ''}</div>
        </div>
        {#if ytmMode}
          <!-- YTM link loaded lazily via api route -->
          <a href="/api/ytm/{encodeURIComponent(s.spotifyUri)}?redirect=1" target="_blank"
            class="text-xs text-red-400 hover:underline flex-shrink-0">YT Music ↗</a>
        {:else}
          <span class="text-amber-400 font-bold text-sm flex-shrink-0">{s.totalPoints} pts</span>
        {/if}
      </div>
    {/each}
    {#if !data.mlSubmissions.length}<p class="text-slate-500">No submissions imported yet.</p>{/if}
  </div>
{/if}

<!-- Chat Mentions tab -->
{#if tab === 'chat'}
  <div class="flex flex-col gap-2">
    {#each data.chatMentions as m}
      <div class="flex items-center gap-3 px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-700">
        <div class="flex-1 min-w-0">
          <div class="font-medium text-slate-100 truncate">{m.trackTitle ?? 'Unknown'}</div>
          <div class="text-xs text-slate-400">{m.trackArtist ?? ''} · {m.submitterName}</div>
        </div>
        <span class="text-green-400 text-xs flex-shrink-0">{m.sourcePlatform ?? 'chat'}</span>
        <span class="text-slate-500 text-xs flex-shrink-0">{new Date(m.createdAt).toLocaleDateString()}</span>
      </div>
    {/each}
    {#if !data.chatMentions.length}<p class="text-slate-500">No chat mentions found for this round's time window.</p>{/if}
  </div>
{/if}

<!-- Research tab — full component in Task 11 -->
{#if tab === 'research'}
  <p class="text-slate-500">Research coming in next task.</p>
{/if}
```

- [ ] **10.3 — Verify** — navigate to a round, ML Playlist and Chat Mentions tabs work.

- [ ] **10.4 — Commit**
```bash
git add ui/src/routes/league/ && git commit -m "feat: round detail page with ML playlist and chat mentions tabs"
```

---

## Task 11: YTM API route + toggle

**Files:** `ui/src/routes/api/ytm/[spotifyUri]/+server.ts`, `ui/src/lib/songlink.ts`, `ui/src/lib/db/ytmQueue.ts`

- [ ] **11.1 — songlink.ts** (thin wrapper, reuses same Odesli API)

```ts
const ODESLI = 'https://api.song.link/v1-alpha.1/links';

export async function resolveYtmLink(spotifyUri: string): Promise<string | null> {
  const url = spotifyUri.startsWith('spotify:track:')
    ? `https://open.spotify.com/track/${spotifyUri.slice('spotify:track:'.length)}`
    : spotifyUri;
  try {
    const res = await fetch(`${ODESLI}?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const data = await res.json() as any;
    return data.linksByPlatform?.youtubeMusic?.url ?? null;
  } catch { return null; }
}
```

- [ ] **11.2 — ytmQueue.ts**

```ts
import type Database from 'better-sqlite3';
import type { YtmQueueEntry } from '../types.js';

export function enqueueYtm(db: Database.Database, spotifyUri: string, title?: string, artist?: string): void {
  db.prepare(`INSERT OR IGNORE INTO ytm_resolution_queue (spotify_uri,title,artist,queued_at)
    VALUES (?,?,?,?)`).run(spotifyUri, title ?? null, artist ?? null, new Date().toISOString());
}

export function getQueueStatus(db: Database.Database) {
  const pending = (db.prepare("SELECT COUNT(*) n FROM ytm_resolution_queue WHERE status='pending'").get() as any).n;
  const processing = (db.prepare("SELECT COUNT(*) n FROM ytm_resolution_queue WHERE status='processing'").get() as any).n;
  const done24h = (db.prepare(`SELECT COUNT(*) n FROM ytm_resolution_queue WHERE status='done' AND resolved_at > datetime('now','-1 day')`).get() as any).n;
  const failures = db.prepare("SELECT * FROM ytm_resolution_queue WHERE status='failed' ORDER BY queued_at DESC").all() as any[];
  return { pending, processing, done24h, estimatedMinutes: Math.ceil((pending + processing) / 10), failures };
}

export function retryFailed(db: Database.Database, id: number): void {
  db.prepare("UPDATE ytm_resolution_queue SET status='pending',error=NULL WHERE id=?").run(id);
}
```

- [ ] **11.3 — api/ytm/[spotifyUri]/+server.ts**

```ts
import type { RequestHandler } from './$types.js';
import { json, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { resolveYtmLink } from '$lib/songlink.js';

export const GET: RequestHandler = async ({ params, url }) => {
  const db = getDb();
  const uri = decodeURIComponent(params.spotifyUri);
  const cached = db.prepare('SELECT ytm_url FROM ytm_link_cache WHERE spotify_uri=?').get(uri) as any;
  if (cached) {
    if (url.searchParams.get('redirect') === '1' && cached.ytm_url)
      throw redirect(302, cached.ytm_url);
    return json({ ytmUrl: cached.ytm_url });
  }
  const ytmUrl = await resolveYtmLink(uri);
  db.prepare('INSERT OR REPLACE INTO ytm_link_cache (spotify_uri,ytm_url,resolved_at) VALUES (?,?,?)')
    .run(uri, ytmUrl, new Date().toISOString());
  if (url.searchParams.get('redirect') === '1' && ytmUrl)
    throw redirect(302, ytmUrl);
  return json({ ytmUrl });
};
```

- [ ] **11.4 — Verify** — in the ML Playlist tab, toggle to YT Music, click a song link. Should redirect to YouTube Music (or show nothing if not found).

- [ ] **11.5 — Commit**
```bash
git add ui/src/routes/api/ytm/ ui/src/lib/songlink.ts ui/src/lib/db/ytmQueue.ts
git commit -m "feat: YTM resolution API route and Songlink wrapper"
```

---

## Task 12: Research tab — compact cards + ratings

**Files:** `ui/src/routes/api/research/[roundId]/+server.ts`, `ui/src/lib/components/ResearchList.svelte`

- [ ] **12.1 — api/research/[roundId]/+server.ts**

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getResearchSongs, addResearchSong, updateResearchSong, deleteResearchSong } from '$lib/db/research.js';
import { getSettings } from '$lib/db/settings.js';
import { computeScore } from '$lib/scoring.js';

export const GET: RequestHandler = async ({ params }) => {
  const db = getDb(); const settings = getSettings(db);
  const songs = getResearchSongs(db, Number(params.roundId)).map(s => ({ ...s, score: computeScore(s, settings) }));
  return json(songs);
};

export const POST: RequestHandler = async ({ params, request }) => {
  const db = getDb();
  const body = await request.json() as { spotifyUri: string; title: string; artist: string; album?: string };
  if (!body.spotifyUri || !body.title) throw error(400, 'spotifyUri and title required');
  const song = addResearchSong(db, { roundId: Number(params.roundId), ...body, album: body.album ?? null });
  return json(song, { status: 201 });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const db = getDb();
  const body = await request.json() as { id: number; [key: string]: unknown };
  if (!body.id) throw error(400, 'id required');
  updateResearchSong(db, body.id, body as any);
  const settings = getSettings(db);
  const updated = getResearchSongs(db, Number(params.roundId)).find(s => s.id === body.id);
  return json({ ...updated, score: updated ? computeScore(updated, settings) : null });
};

export const DELETE: RequestHandler = async ({ request }) => {
  const db = getDb();
  const { id } = await request.json() as { id: number };
  deleteResearchSong(db, id);
  return new Response(null, { status: 204 });
};
```

- [ ] **12.2 — ResearchList.svelte component**

Create `ui/src/lib/components/ResearchList.svelte`:
```svelte
<script lang="ts">
  import type { ResearchSong } from '$lib/types.js';
  let { roundId, initial } = $props<{ roundId: number; initial: ResearchSong[] }>();

  let songs = $state<ResearchSong[]>(initial);
  let expanded = $state<number | null>(null);
  let showAdd = $state(false);
  let searchQ = $state('');
  let searchResults = $state<any[]>([]);
  let searching = $state(false);

  async function patch(id: number, updates: Partial<ResearchSong>) {
    const res = await fetch(`/api/research/${roundId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...updates }),
    });
    const updated = await res.json();
    songs = songs.map(s => s.id === id ? updated : s);
  }

  async function remove(id: number) {
    await fetch(`/api/research/${roundId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    songs = songs.filter(s => s.id !== id);
    if (expanded === id) expanded = null;
  }

  async function searchSpotify() {
    if (!searchQ.trim()) return;
    searching = true;
    const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(searchQ)}`);
    searchResults = await res.json();
    searching = false;
  }

  async function addSong(track: any) {
    const res = await fetch(`/api/research/${roundId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spotifyUri: track.uri, title: track.name, artist: track.artists, album: track.album }),
    });
    const newSong = await res.json();
    songs = [...songs, newSong];
    showAdd = false; searchQ = ''; searchResults = [];
  }

  function stars(val: number | null, max = 5) {
    return Array.from({ length: max }, (_, i) => i < (val ?? 0) ? '★' : '☆');
  }

  async function setStar(id: number, field: string, value: number) {
    await patch(id, { [field]: value } as any);
  }
</script>

<div class="flex items-center justify-between mb-3">
  <span class="text-xs text-purple-400 font-bold uppercase tracking-widest">Research</span>
  <button onclick={() => showAdd = !showAdd}
    class="text-xs bg-purple-800 hover:bg-purple-700 text-purple-200 px-3 py-1 rounded transition-colors">
    + Add Song
  </button>
</div>

{#if showAdd}
  <div class="bg-slate-900 rounded-lg p-4 mb-4 border border-purple-700">
    <div class="flex gap-2 mb-3">
      <input bind:value={searchQ} onkeydown={e => e.key==='Enter' && searchSpotify()}
        placeholder="Search Spotify..." class="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-purple-500" />
      <button onclick={searchSpotify} disabled={searching}
        class="bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50">
        {searching ? '…' : 'Search'}
      </button>
    </div>
    <div class="flex flex-col gap-1 max-h-48 overflow-y-auto">
      {#each searchResults as t}
        <button onclick={() => addSong(t)}
          class="flex items-center gap-3 px-3 py-2 rounded hover:bg-slate-700 text-left">
          <div class="flex-1 min-w-0">
            <div class="text-sm text-slate-100 truncate">{t.name}</div>
            <div class="text-xs text-slate-400">{t.artists} · {t.album}</div>
          </div>
          <span class="text-purple-400 text-xs">Add</span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<div class="flex flex-col gap-2">
  {#each songs as s (s.id)}
    <!-- Compact collapsed row -->
    <div class="rounded-lg border transition-colors overflow-hidden"
      class:border-purple-600={expanded===s.id} class:border-slate-700={expanded!==s.id}
      style="background: var(--surface)">
      <button class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-700/30"
        onclick={() => expanded = expanded===s.id ? null : s.id}>
        <span class="text-slate-500 text-sm">▶</span>
        <div class="flex-1 min-w-0">
          <span class="text-sm font-medium text-slate-100 truncate">{s.title}</span>
          <span class="text-xs text-slate-400 ml-2">{s.artist}</span>
        </div>
        <div class="flex gap-1 flex-shrink-0">
          {#if s.themeFit != null}<span class="text-xs bg-blue-900 text-blue-300 px-1.5 rounded">T:{s.themeFit}</span>{/if}
          {#if s.discoveryPotential != null}<span class="text-xs bg-green-900 text-green-300 px-1.5 rounded">D:{s.discoveryPotential}</span>{/if}
          {#if s.nostalgiaPotential != null}<span class="text-xs bg-orange-900 text-orange-300 px-1.5 rounded">N:{s.nostalgiaPotential}</span>{/if}
          {#if s.personalRating != null}<span class="text-xs bg-purple-900 text-purple-300 px-1.5 rounded">P:{s.personalRating}</span>{/if}
        </div>
        {#if s.score != null}<span class="text-xs font-bold ml-2 flex-shrink-0" class:text-green-400={s.score>=4} class:text-yellow-400={s.score>=3&&s.score<4} class:text-slate-400={s.score<3}>{s.score.toFixed(1)}</span>{/if}
        {#if s.saveForFuture}<span class="text-xs text-amber-400 ml-1">future✓</span>{/if}
        <span class="text-slate-500 ml-2">{expanded===s.id ? '▴' : '▾'}</span>
      </button>

      {#if expanded === s.id}
        <div class="px-4 pb-4 border-t border-slate-700 bg-slate-900/50">
          <!-- Star ratings grid -->
          <div class="grid grid-cols-2 gap-3 mt-3 mb-3">
            {#each [
              ['themeFit',           'Theme Fit',           'text-blue-400'],
              ['discoveryPotential', 'Discovery ⭐',        'text-green-400'],
              ['nostalgiaPotential', 'Nostalgia',           'text-orange-400'],
              ['personalRating',     'Personal',            'text-purple-400'],
            ] as [field, label, color]}
              <div>
                <div class="text-xs mb-1 {color}">{label}</div>
                <div class="flex gap-0.5">
                  {#each [1,2,3,4,5] as n}
                    <button onclick={() => setStar(s.id, field, n)}
                      class="text-lg leading-none transition-colors"
                      class:text-yellow-400={n <= ((s as any)[field] ?? 0)}
                      class:text-slate-600={n > ((s as any)[field] ?? 0)}>
                      ★
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>

          <!-- Booleans -->
          <div class="flex flex-wrap gap-4 mb-3 text-xs">
            {#each [
              ['saveForFuture','Save for future round'],
              ['submittedByMe','I submitted this before'],
              ['submittedByOther','Someone else submitted this'],
            ] as [field, label]}
              <label class="flex items-center gap-1.5 text-slate-400 cursor-pointer">
                <input type="checkbox" checked={(s as any)[field]}
                  onchange={e => patch(s.id, { [field]: (e.target as HTMLInputElement).checked } as any)}
                  class="accent-purple-500" />
                {label}
              </label>
            {/each}
          </div>

          {#if s.submittedByOther && s.otherSubmissionVotes != null}
            <div class="text-xs text-slate-500 mb-2">Previously received {s.otherSubmissionVotes} votes</div>
          {/if}

          <!-- Notes -->
          <textarea
            value={s.notes ?? ''}
            onblur={e => patch(s.id, { notes: (e.target as HTMLTextAreaElement).value })}
            placeholder="Add a note..."
            class="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-purple-500 resize-none"
            rows="2"></textarea>

          <button onclick={() => remove(s.id)} class="mt-2 text-xs text-red-500 hover:text-red-400">Remove</button>
        </div>
      {/if}
    </div>
  {/each}
  {#if !songs.length}<p class="text-slate-500 text-sm">No research songs yet. Add one above.</p>{/if}
</div>
```

- [ ] **12.3 — Wire ResearchList into round page**

In `+page.svelte`, replace the Research tab stub:
```svelte
{#if tab === 'research'}
  <ResearchList roundId={data.round.id} initial={data.research} />
{/if}
```

Add import at top of script:
```svelte
import ResearchList from '$lib/components/ResearchList.svelte';
```

- [ ] **12.4 — Spotify search API route**

Create `ui/src/routes/api/spotify/search/+server.ts`:
```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';

let _token: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (_token && _token.expiresAt > Date.now()) return _token.value;
  const id = process.env.SPOTIFY_CLIENT_ID!;
  const secret = process.env.SPOTIFY_CLIENT_SECRET!;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json() as any;
  _token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return _token.value;
}

export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q');
  if (!q) throw error(400, 'q required');
  const token = await getToken();
  const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=10`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json() as any;
  const tracks = (data.tracks?.items ?? []).map((t: any) => ({
    uri: t.uri, name: t.name,
    artists: t.artists.map((a: any) => a.name).join(', '),
    album: t.album.name, year: t.album.release_date?.slice(0,4) ?? '',
    imageUrl: t.album.images?.[2]?.url ?? null,
  }));
  return json(tracks);
};
```

- [ ] **12.5 — Verify** — open a round's Research tab, add a song via search, rate it with stars, add notes. Ratings persist on page reload.

- [ ] **12.6 — Commit**
```bash
git add ui/src/routes/api/ ui/src/lib/components/
git commit -m "feat: research tab — compact cards, star ratings, add song modal"
```

---

## Task 13: Settings page

**Files:** `ui/src/routes/settings/+page.server.ts`, `ui/src/routes/settings/+page.svelte`

- [ ] **13.1 — +page.server.ts**

```ts
import type { PageServerLoad, Actions } from './$types.js';
import { fail } from '@sveltejs/kit';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDb } from '$lib/db/client.js';
import { getSettings, updateWeights } from '$lib/db/settings.js';
import { getImportLog, logImport } from '$lib/db/importLog.js';
import { getRoundsForSeason, updateDeadlines } from '$lib/db/rounds.js';
import { getAllLeagues, getSeasonsForLeague, getActiveSeasonsWithLeague } from '$lib/db/leagues.js';
import { getQueueStatus, retryFailed } from '$lib/db/ytmQueue.js';
import { parseZip } from '$lib/import/zipParser.js';
import { importZipData } from '$lib/import/importer.js';
import { runStartupImport } from '$lib/import/startupScan.js';

const DATA_DIR = process.env.DATA_DIR ?? resolve(process.cwd(), '../data');

export const load: PageServerLoad = async () => {
  const db = getDb();
  const settings = getSettings(db);
  const importLog = getImportLog(db);
  const allLeagues = getAllLeagues(db);
  // Active rounds for deadline editing
  const activeRounds = getActiveSeasonsWithLeague(db).flatMap(s => {
    const rounds = getRoundsForSeason(db, s.id);
    return rounds.map(r => ({ ...r, leagueName: s.league.name, seasonNumber: s.seasonNumber }));
  });
  const queueStatus = getQueueStatus(db);
  return { settings, importLog, allLeagues, activeRounds, queueStatus };
};

export const actions: Actions = {
  updateWeights: async ({ request }) => {
    const db = getDb();
    const fd = await request.formData();
    const w = {
      weightDiscovery: Number(fd.get('weightDiscovery')),
      weightThemeFit:  Number(fd.get('weightThemeFit')),
      weightPersonal:  Number(fd.get('weightPersonal')),
      weightNostalgia: Number(fd.get('weightNostalgia')),
    };
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    if (Math.abs(total - 100) > 1) return fail(400, { error: 'Weights must sum to 100' });
    updateWeights(db, w);
    return { success: true };
  },

  importZip: async ({ request }) => {
    const db = getDb();
    const fd = await request.formData();
    const leagueSlug = fd.get('league') as string;
    const seasonNumber = Number(fd.get('season'));
    const file = fd.get('zip') as File;
    if (!file || !leagueSlug || !seasonNumber) return fail(400, { error: 'Missing fields' });
    const buf = Buffer.from(await file.arrayBuffer());
    const parsed = parseZip(buf);
    const result = importZipData(db, leagueSlug, seasonNumber, parsed);
    logImport(db, { leagueSlug, seasonNumber, filename: file.name, importedAt: new Date().toISOString(), ...result, error: result.error ?? null });
    return { success: true, ...result };
  },

  rescan: async () => {
    const db = getDb();
    await runStartupImport(db, DATA_DIR);
    return { success: true };
  },

  updateDeadline: async ({ request }) => {
    const db = getDb();
    const fd = await request.formData();
    const roundId = Number(fd.get('roundId'));
    const sub = (fd.get('submissionDeadline') as string) || null;
    const vote = (fd.get('votingDeadline') as string) || null;
    updateDeadlines(db, roundId, sub, vote);
    return { success: true };
  },

  retryYtm: async ({ request }) => {
    const db = getDb();
    const fd = await request.formData();
    retryFailed(db, Number(fd.get('id')));
    return { success: true };
  },
};
```

- [ ] **13.2 — +page.svelte**

```svelte
<script lang="ts">
  import type { PageData } from './$types.js';
  import { enhance } from '$app/forms';
  let { data } = $props<{ data: PageData }>();

  let w = $state({ ...data.settings });
  let wTotal = $derived(w.weightDiscovery + w.weightThemeFit + w.weightPersonal + w.weightNostalgia);

  function resetWeights() {
    w = { weightDiscovery: 35, weightThemeFit: 25, weightPersonal: 25, weightNostalgia: 15 };
  }
</script>

<svelte:head><title>Settings</title></svelte:head>
<h1 class="text-2xl font-bold mb-8">Settings</h1>

<!-- Section 1: Rating Weights -->
<section class="mb-10 bg-slate-800/50 rounded-xl p-6 border border-slate-700">
  <h2 class="font-bold text-slate-100 mb-1">Research Rating Weights</h2>
  <p class="text-xs text-slate-400 mb-4">Must sum to 100. Discovery is weighted highest by default.</p>
  <form method="POST" action="?/updateWeights" use:enhance class="space-y-4">
    {#each [
      ['weightDiscovery', 'Discovery Potential ⭐', 'text-green-400'],
      ['weightThemeFit',  'Theme Fit',              'text-blue-400'],
      ['weightPersonal',  'Personal Rating',         'text-purple-400'],
      ['weightNostalgia', 'Nostalgia Potential',     'text-orange-400'],
    ] as [field, label, color]}
      <div class="flex items-center gap-4">
        <label class="w-44 text-sm {color}">{label}</label>
        <input type="range" name={field} min="0" max="100"
          bind:value={(w as any)[field]}
          class="flex-1 accent-purple-500" />
        <span class="w-10 text-right text-sm font-mono text-slate-300">{(w as any)[field]}%</span>
        <input type="hidden" name={field} value={(w as any)[field]} />
      </div>
    {/each}
    <!-- Visual proportion bar -->
    <div class="flex h-2 rounded overflow-hidden mt-2">
      <div class="bg-green-500 transition-all" style="width:{w.weightDiscovery}%"></div>
      <div class="bg-blue-500 transition-all" style="width:{w.weightThemeFit}%"></div>
      <div class="bg-purple-500 transition-all" style="width:{w.weightPersonal}%"></div>
      <div class="bg-orange-500 transition-all" style="width:{w.weightNostalgia}%"></div>
    </div>
    <div class="flex items-center gap-4 mt-2">
      <span class="text-xs" class:text-red-400={Math.abs(wTotal-100)>1} class:text-green-400={Math.abs(wTotal-100)<=1}>
        Total: {wTotal}%
      </span>
      <button type="button" onclick={resetWeights} class="text-xs text-slate-400 hover:text-slate-200">Reset to defaults</button>
      <button type="submit" class="ml-auto bg-purple-700 hover:bg-purple-600 text-white px-4 py-1.5 rounded text-sm">Save</button>
    </div>
  </form>
</section>

<!-- Section 2: ZIP Import -->
<section class="mb-10 bg-slate-800/50 rounded-xl p-6 border border-slate-700">
  <h2 class="font-bold text-slate-100 mb-4">ZIP Import</h2>
  <form method="POST" action="?/importZip" use:enhance enctype="multipart/form-data" class="flex flex-wrap gap-3 items-end mb-4">
    <div>
      <label class="block text-xs text-slate-400 mb-1">League</label>
      <select name="league" class="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-100">
        {#each data.allLeagues as l}<option value={l.slug}>{l.name}</option>{/each}
      </select>
    </div>
    <div>
      <label class="block text-xs text-slate-400 mb-1">Season #</label>
      <input type="number" name="season" min="1" value="1" class="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-100" />
    </div>
    <div>
      <label class="block text-xs text-slate-400 mb-1">export.zip</label>
      <input type="file" name="zip" accept=".zip" class="text-sm text-slate-300" />
    </div>
    <button type="submit" class="bg-blue-700 hover:bg-blue-600 text-white px-4 py-1.5 rounded text-sm">Import</button>
    <form method="POST" action="?/rescan" use:enhance>
      <button type="submit" class="bg-slate-600 hover:bg-slate-500 text-white px-4 py-1.5 rounded text-sm">Re-scan disk</button>
    </form>
  </form>
  <!-- Import log -->
  {#if data.importLog.length}
    <div class="overflow-x-auto">
      <table class="w-full text-xs text-slate-400">
        <thead><tr class="border-b border-slate-700">
          <th class="text-left py-1 pr-4">League</th><th class="text-left py-1 pr-4">Season</th>
          <th class="text-left py-1 pr-4">Imported</th><th class="text-left py-1 pr-4">Rounds</th>
          <th class="text-left py-1 pr-4">Songs</th><th class="text-left py-1">Status</th>
        </tr></thead>
        <tbody>
          {#each data.importLog as entry}
            <tr class="border-b border-slate-800 hover:bg-slate-800/30">
              <td class="py-1 pr-4">{entry.leagueSlug}</td>
              <td class="py-1 pr-4">S{entry.seasonNumber}</td>
              <td class="py-1 pr-4">{new Date(entry.importedAt).toLocaleString()}</td>
              <td class="py-1 pr-4">{entry.roundsCount}</td>
              <td class="py-1 pr-4">{entry.submissionsCount}</td>
              <td class="py-1" class:text-green-400={entry.status==='success'} class:text-red-400={entry.status==='error'} class:text-yellow-400={entry.status==='partial'}>
                {entry.status}{entry.error ? ` — ${entry.error}` : ''}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <p class="text-slate-500 text-sm">No imports yet.</p>
  {/if}
</section>

<!-- Section 3: Round Deadlines -->
<section class="mb-10 bg-slate-800/50 rounded-xl p-6 border border-slate-700">
  <h2 class="font-bold text-slate-100 mb-1">Round Deadlines</h2>
  <p class="text-xs text-slate-400 mb-4">Set submission and voting deadlines for active rounds. Shown as countdowns on the home screen.</p>
  {#if data.activeRounds.length}
    <div class="flex flex-col gap-3">
      {#each data.activeRounds as r}
        <form method="POST" action="?/updateDeadline" use:enhance class="flex flex-wrap items-center gap-3 text-sm">
          <input type="hidden" name="roundId" value={r.id} />
          <span class="text-slate-300 w-48 truncate">{r.leagueName} S{r.seasonNumber} — {r.name}</span>
          <div class="flex items-center gap-2">
            <label class="text-xs text-yellow-400">Submit by</label>
            <input type="datetime-local" name="submissionDeadline" value={r.submissionDeadline?.slice(0,16) ?? ''}
              class="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200" />
          </div>
          <div class="flex items-center gap-2">
            <label class="text-xs text-cyan-400">Vote by</label>
            <input type="datetime-local" name="votingDeadline" value={r.votingDeadline?.slice(0,16) ?? ''}
              class="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200" />
          </div>
          <button type="submit" class="bg-slate-600 hover:bg-slate-500 text-white px-3 py-1 rounded text-xs">Save</button>
        </form>
      {/each}
    </div>
  {:else}
    <p class="text-slate-500 text-sm">No active rounds found.</p>
  {/if}
</section>

<!-- Section 4: Songlink Queue -->
<section class="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
  <h2 class="font-bold text-slate-100 mb-4">Songlink Resolution Queue</h2>
  <div class="grid grid-cols-3 gap-4 mb-4 text-center">
    <div class="bg-slate-900 rounded-lg p-3">
      <div class="text-2xl font-bold text-yellow-400">{data.queueStatus.pending}</div>
      <div class="text-xs text-slate-400">Pending</div>
      {#if data.queueStatus.pending > 0}
        <div class="text-xs text-slate-500 mt-1">~{data.queueStatus.estimatedMinutes}m at 10/min</div>
      {/if}
    </div>
    <div class="bg-slate-900 rounded-lg p-3">
      <div class="text-2xl font-bold text-green-400">{data.queueStatus.done24h}</div>
      <div class="text-xs text-slate-400">Resolved (24h)</div>
    </div>
    <div class="bg-slate-900 rounded-lg p-3">
      <div class="text-2xl font-bold text-red-400">{data.queueStatus.failures.length}</div>
      <div class="text-xs text-slate-400">Failures</div>
    </div>
  </div>
  {#if data.queueStatus.failures.length}
    <div class="overflow-x-auto">
      <table class="w-full text-xs text-slate-400">
        <thead><tr class="border-b border-slate-700"><th class="text-left py-1 pr-4">Track</th><th class="text-left py-1 pr-4">Error</th><th class="py-1"></th></tr></thead>
        <tbody>
          {#each data.queueStatus.failures as f}
            <tr class="border-b border-slate-800">
              <td class="py-1 pr-4">{f.title ?? f.spotify_uri}</td>
              <td class="py-1 pr-4 text-red-400">{f.error ?? 'No YTM link found'}</td>
              <td class="py-1">
                <form method="POST" action="?/retryYtm" use:enhance>
                  <input type="hidden" name="id" value={f.id} />
                  <button type="submit" class="text-blue-400 hover:text-blue-300">Retry</button>
                </form>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
```

- [ ] **13.3 — Verify** — open /settings: all four sections render. Adjust sliders, save, reload — weights persist. Import a ZIP. Edit a deadline.

- [ ] **13.4 — Commit**
```bash
git add ui/src/routes/settings/ && git commit -m "feat: settings page — weights, import, deadlines, queue"
```

---

## Task 14: Background Songlink queue worker

**Files:** `ui/src/lib/queueWorker.ts` (modify `hooks.server.ts`)

- [ ] **14.1 — queueWorker.ts**

```ts
import { getDb } from './db/client.js';
import { resolveYtmLink } from './songlink.js';

const RATE_MS = 6_000; // 10/min = one every 6s

export function startQueueWorker(): void {
  setInterval(async () => {
    const db = getDb();
    const next = db.prepare(`SELECT id,spotify_uri,title,artist FROM ytm_resolution_queue
      WHERE status='pending' ORDER BY queued_at LIMIT 1`).get() as any;
    if (!next) return;
    db.prepare("UPDATE ytm_resolution_queue SET status='processing' WHERE id=?").run(next.id);
    try {
      const ytmUrl = await resolveYtmLink(next.spotify_uri);
      const now = new Date().toISOString();
      db.prepare("UPDATE ytm_resolution_queue SET status='done',resolved_at=? WHERE id=?").run(now, next.id);
      db.prepare('INSERT OR REPLACE INTO ytm_link_cache (spotify_uri,ytm_url,resolved_at) VALUES (?,?,?)').run(next.spotify_uri, ytmUrl, now);
    } catch (err) {
      db.prepare("UPDATE ytm_resolution_queue SET status='failed',error=? WHERE id=?").run(String(err), next.id);
    }
  }, RATE_MS);
}
```

- [ ] **14.2 — Add to hooks.server.ts**

Append to `ui/src/hooks.server.ts`:
```ts
import { startQueueWorker } from '$lib/queueWorker.js';
startQueueWorker();
```

- [ ] **14.3 — ytm-queue status API**

Create `ui/src/routes/api/ytm-queue/+server.ts`:
```ts
import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getQueueStatus } from '$lib/db/ytmQueue.js';
export const GET: RequestHandler = async () => json(getQueueStatus(getDb()));
```

- [ ] **14.4 — Commit**
```bash
git add ui/src/lib/queueWorker.ts ui/src/routes/api/ytm-queue/ ui/src/hooks.server.ts
git commit -m "feat: background Songlink queue worker"
```

---

## Task 15: Docker

**Files:** `Dockerfile.ui`, `docker-compose.yml` (modify), `.env.example` (modify)

- [ ] **15.1 — Dockerfile.ui**

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY ui/package*.json ./
RUN npm ci
COPY ui/ .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json .
ENV NODE_ENV=production
ENV PORT=3002
ENV DATA_DIR=/app/data
EXPOSE 3002
CMD ["node", "build"]
```

- [ ] **15.2 — Add UI service to docker-compose.yml**

Open `docker-compose.yml` and add:
```yaml
  ui:
    build:
      context: .
      dockerfile: Dockerfile.ui
    ports:
      - "3002:3002"
    volumes:
      - ./data:/app/data
    environment:
      - SPOTIFY_CLIENT_ID=${SPOTIFY_CLIENT_ID}
      - SPOTIFY_CLIENT_SECRET=${SPOTIFY_CLIENT_SECRET}
      - MY_COMPETITOR_ID=${MY_COMPETITOR_ID}
      - DATA_DIR=/app/data
    restart: unless-stopped
```

- [ ] **15.3 — Add to .env.example**

```
# Web UI
MY_COMPETITOR_ID=           # Your ml_competitor_id from competitors.csv
```

- [ ] **15.4 — Build and test**
```bash
docker compose build ui
docker compose up -d ui
curl http://localhost:3002
```
Expected: SvelteKit app responds on port 3002.

- [ ] **15.5 — Commit**
```bash
git add Dockerfile.ui docker-compose.yml .env.example
git commit -m "feat: Docker build for UI service on port 3002"
```

---

## Self-Review Checklist

- [x] **Active seasons grid** — Task 8
- [x] **Past seasons collapsed** — Task 8
- [x] **All Songs Ever list** — Task 8
- [x] **Season detail** — Task 9
- [x] **Round detail / ML Playlist tab** — Task 10
- [x] **Spotify/YTM toggle** — Task 10 + 11
- [x] **Chat Mentions tab** — Task 10
- [x] **Research tab with compact/expand cards** — Task 12
- [x] **Star ratings (T/D/N/P) + booleans + notes** — Task 12
- [x] **Discovery weighted ⭐** — Tasks 5, 12
- [x] **Add Song modal (Spotify search)** — Task 12
- [x] **Submitted-by-me auto-detection** — Task 7 (`addResearchSong`)
- [x] **Settings: rating weights** — Task 13
- [x] **Settings: ZIP import + history** — Task 13
- [x] **Settings: round deadlines** — Task 13
- [x] **Settings: Songlink queue + failures** — Tasks 13, 14
- [x] **Deadline countdowns on home cards** — Task 8
- [x] **Nostalgia Pit excluded from combined** — Tasks 4, 8
- [x] **Background queue worker** — Task 14
- [x] **Docker** — Task 15
- [x] **ZIP import idempotent** — Task 6
- [x] **Startup auto-import** — Task 7
