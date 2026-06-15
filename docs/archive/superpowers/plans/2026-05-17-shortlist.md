# Shortlist Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/shortlist` route where the user can search Spotify, bookmark songs for future rounds, rate them across four dimensions (Discovery, Theme Fit, Nostalgia, Personal), and assign them to open rounds.

**Architecture:** New DB tables (`shortlist_songs`, `shortlist_assignments`) in the existing SQLite DB; new DB module `shortlist.ts` following the `research.ts` pattern; nine SvelteKit API routes; six Svelte components; one page route. The shortlist CSS file ships as a static import — no Tailwind utilities, just the `.sl-*` class system from the handoff.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, better-sqlite3, Tailwind v4 (utilities only on layout wrapper), Vitest

---

## File Structure

### New files
| Path | Responsibility |
|------|---------------|
| `ui/src/lib/shortlist/colors_and_type.css` | Mash Co. CSS variable tokens (`--mash-pulp`, `--ink-*`, etc.) — copied from handoff reference |
| `ui/src/lib/shortlist/shortlist.css` | All `.sl-*` component classes — copied from `reference/ml-shortlist-styles.css` |
| `ui/src/lib/shortlist/shortlist.ts` | DB functions: CRUD for `shortlist_songs` and `shortlist_assignments` |
| `ui/src/lib/shortlist/shortlist.test.ts` | Vitest integration tests for the DB module |
| `ui/src/lib/shortlist/MiniDna.svelte` | 64×12 four-bar visualization for collapsed rows |
| `ui/src/lib/shortlist/ScoreChip.svelte` | Aggregate score pill with 4-bar opacity display |
| `ui/src/lib/shortlist/DnaStrip.svelte` | Expanded-row 4-row rating editor (click-to-set) |
| `ui/src/lib/shortlist/SearchBar.svelte` | Spotify search input with dropdown, keyboard nav |
| `ui/src/lib/shortlist/ShortlistRow.svelte` | Collapsed + expanded row states |
| `ui/src/lib/shortlist/AssignPopover.svelte` | Round assignment multi-select popover |
| `ui/src/lib/shortlist/Bookmark.svelte` | 24×24 toggle button for other pages |
| `ui/src/routes/shortlist/+page.svelte` | Page shell, row list, sort, keyboard shortcuts |
| `ui/src/routes/shortlist/+page.server.ts` | Load initial shortlist data |
| `ui/src/routes/api/shortlist/+server.ts` | GET list + POST add |
| `ui/src/routes/api/shortlist/[id]/+server.ts` | DELETE by id |
| `ui/src/routes/api/shortlist/[id]/rating/+server.ts` | PATCH rating dimension |
| `ui/src/routes/api/shortlist/[id]/notes/+server.ts` | PATCH notes |
| `ui/src/routes/api/shortlist/[id]/assign/+server.ts` | POST assign to round |
| `ui/src/routes/api/shortlist/[id]/assign/[roundId]/+server.ts` | DELETE unassign |
| `ui/src/routes/api/shortlist/[id]/submitted-elsewhere/+server.ts` | PATCH submitted-elsewhere flag |
| `ui/src/routes/api/shortlist/+server.ts` also handles `?spotify_uri=` DELETE | (same file as GET/POST — query param branch) |
| `ui/src/routes/api/rounds/open/+server.ts` | GET open rounds |

### Modified files
| Path | Change |
|------|--------|
| `ui/src/lib/db/schema.ts` | Add `shortlist_songs` + `shortlist_assignments` table DDL |
| `ui/src/lib/db/client.ts` | Add column-migration guards for new tables |
| `ui/src/lib/types.ts` | Add `ShortlistSong`, `ShortlistAssignment` interfaces |
| `ui/src/app.css` | Add `@import '$lib/shortlist/colors_and_type.css';` |

---

## Task 1: DB Schema — shortlist tables

**Files:**
- Modify: `ui/src/lib/db/schema.ts`

- [ ] **Step 1: Add the two new CREATE TABLE statements to SCHEMA**

Open `ui/src/lib/db/schema.ts`. Append before the closing backtick of `SCHEMA`:

```ts
  CREATE TABLE IF NOT EXISTS shortlist_songs (
    id              TEXT PRIMARY KEY,
    spotify_uri     TEXT NOT NULL UNIQUE,
    artist          TEXT NOT NULL,
    title           TEXT NOT NULL,
    album           TEXT,
    year            INTEGER,
    duration_sec    INTEGER,
    album_art_url   TEXT,
    added_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    rating_discovery INTEGER NOT NULL DEFAULT 0,
    rating_theme_fit INTEGER NOT NULL DEFAULT 0,
    rating_nostalgia INTEGER NOT NULL DEFAULT 0,
    rating_personal  INTEGER NOT NULL DEFAULT 0,
    submitted_elsewhere INTEGER NOT NULL DEFAULT 0,
    notes           TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS shortlist_assignments (
    shortlist_song_id TEXT NOT NULL REFERENCES shortlist_songs(id) ON DELETE CASCADE,
    round_id          INTEGER NOT NULL REFERENCES rounds(id),
    assigned_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    PRIMARY KEY (shortlist_song_id, round_id)
  );
```

- [ ] **Step 2: Run existing DB tests to verify schema is valid**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx vitest run src/lib/db/client.test.ts
```
Expected: all tests PASS (idempotent schema creation still works).

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/db/schema.ts
git commit -m "feat(shortlist): add shortlist_songs + shortlist_assignments schema"
```

---

## Task 2: DB Client Migration Guards

**Files:**
- Modify: `ui/src/lib/db/client.ts`

The `openLeagueDb` function already handles schema init via `db.exec(SCHEMA)` — new `CREATE TABLE IF NOT EXISTS` statements run automatically. No column-migration guard is needed for brand-new tables. This task is a no-op **unless** the existing DB already has these tables from a prior failed attempt; in that case the `IF NOT EXISTS` guards are sufficient.

Verify by inspecting `client.ts` — if you see no `shortlist` table in PRAGMA checks, no change is needed.

- [ ] **Step 1: Confirm no migration guard needed**

```bash
grep -n "shortlist" /home/loydmilligan/Projects/music-league-bot/ui/src/lib/db/client.ts
```
Expected: no output. Tables are brand-new so `IF NOT EXISTS` handles init.

- [ ] **Step 2: Commit (skip if no change)**

If client.ts was not modified, nothing to commit for this task.

---

## Task 3: TypeScript Types

**Files:**
- Modify: `ui/src/lib/types.ts`

- [ ] **Step 1: Add shortlist interfaces**

Append to the end of `ui/src/lib/types.ts`:

```ts
export interface ShortlistSong {
  id: string;
  spotifyUri: string;
  artist: string;
  title: string;
  album: string | null;
  year: number | null;
  durationSec: number | null;
  albumArtUrl: string | null;
  addedAt: string;
  ratingDiscovery: number;
  ratingThemeFit: number;
  ratingNostalgia: number;
  ratingPersonal: number;
  submittedElsewhere: boolean;
  notes: string;
  assignments?: ShortlistAssignment[];
}
export interface ShortlistAssignment {
  shortlistSongId: string;
  roundId: number;
  assignedAt: string;
}
```

- [ ] **Step 2: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "^(Error|Warning)" | head -20
```
Expected: no new errors about `ShortlistSong` or `ShortlistAssignment`.

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/types.ts
git commit -m "feat(shortlist): add ShortlistSong + ShortlistAssignment types"
```

---

## Task 4: DB Module

**Files:**
- Create: `ui/src/lib/shortlist/shortlist.ts`

- [ ] **Step 1: Create the shortlist DB module**

Create `ui/src/lib/shortlist/shortlist.ts`:

```ts
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { ShortlistSong, ShortlistAssignment } from '../types.js';

function songRow(r: any): ShortlistSong {
  return {
    id: r.id,
    spotifyUri: r.spotify_uri,
    artist: r.artist,
    title: r.title,
    album: r.album,
    year: r.year,
    durationSec: r.duration_sec,
    albumArtUrl: r.album_art_url,
    addedAt: r.added_at,
    ratingDiscovery: r.rating_discovery,
    ratingThemeFit: r.rating_theme_fit,
    ratingNostalgia: r.rating_nostalgia,
    ratingPersonal: r.rating_personal,
    submittedElsewhere: !!r.submitted_elsewhere,
    notes: r.notes,
  };
}

function assignmentRow(r: any): ShortlistAssignment {
  return { shortlistSongId: r.shortlist_song_id, roundId: r.round_id, assignedAt: r.assigned_at };
}

export function getShortlistSongs(db: Database.Database): ShortlistSong[] {
  const songs = (db.prepare('SELECT * FROM shortlist_songs ORDER BY added_at DESC').all() as any[]).map(songRow);
  const assignments = (db.prepare('SELECT * FROM shortlist_assignments').all() as any[]).map(assignmentRow);
  const byId: Record<string, ShortlistAssignment[]> = {};
  for (const a of assignments) {
    (byId[a.shortlistSongId] ??= []).push(a);
  }
  return songs.map(s => ({ ...s, assignments: byId[s.id] ?? [] }));
}

export function addShortlistSong(db: Database.Database, s: {
  spotifyUri: string; title: string; artist: string;
  album?: string | null; albumArtUrl?: string | null;
  year?: number | null; durationSec?: number | null;
}): ShortlistSong {
  const id = randomUUID();
  db.prepare(`INSERT OR IGNORE INTO shortlist_songs
    (id, spotify_uri, title, artist, album, album_art_url, year, duration_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, s.spotifyUri, s.title, s.artist, s.album ?? null, s.albumArtUrl ?? null, s.year ?? null, s.durationSec ?? null);
  const row = db.prepare('SELECT * FROM shortlist_songs WHERE spotify_uri=?').get(s.spotifyUri) as any;
  return { ...songRow(row), assignments: [] };
}

export function deleteShortlistSongById(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM shortlist_songs WHERE id=?').run(id);
}

export function deleteShortlistSongByUri(db: Database.Database, spotifyUri: string): void {
  db.prepare('DELETE FROM shortlist_songs WHERE spotify_uri=?').run(spotifyUri);
}

export function patchShortlistRating(db: Database.Database, id: string, dimension: 'discovery' | 'theme_fit' | 'nostalgia' | 'personal', value: number): void {
  const col = `rating_${dimension}`;
  db.prepare(`UPDATE shortlist_songs SET ${col}=? WHERE id=?`).run(value, id);
}

export function patchShortlistNotes(db: Database.Database, id: string, notes: string): void {
  db.prepare('UPDATE shortlist_songs SET notes=? WHERE id=?').run(notes, id);
}

export function patchSubmittedElsewhere(db: Database.Database, id: string, value: boolean): void {
  db.prepare('UPDATE shortlist_songs SET submitted_elsewhere=? WHERE id=?').run(value ? 1 : 0, id);
}

export function assignToRound(db: Database.Database, shortlistSongId: string, roundId: number): void {
  db.prepare(`INSERT OR IGNORE INTO shortlist_assignments (shortlist_song_id, round_id) VALUES (?, ?)`)
    .run(shortlistSongId, roundId);
  // Mirror into research_songs so the song appears in H2H for that round.
  const song = db.prepare('SELECT * FROM shortlist_songs WHERE id=?').get(shortlistSongId) as any;
  if (song) {
    db.prepare(`INSERT OR IGNORE INTO research_songs
      (round_id, spotify_uri, title, artist, album, added_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(roundId, song.spotify_uri, song.title, song.artist, song.album ?? null, new Date().toISOString());
  }
}

export function unassignFromRound(db: Database.Database, shortlistSongId: string, roundId: number): void {
  db.prepare('DELETE FROM shortlist_assignments WHERE shortlist_song_id=? AND round_id=?').run(shortlistSongId, roundId);
}

export function getOpenRounds(db: Database.Database): { id: number; name: string; description: string | null; submissionDeadline: string | null; leagueName: string }[] {
  return (db.prepare(`
    SELECT r.id, r.name, r.description, r.submission_deadline,
           l.name AS league_name
    FROM rounds r
    JOIN seasons s ON r.season_id = s.id
    JOIN leagues l ON s.league_id = l.id
    WHERE r.submission_deadline IS NULL OR r.submission_deadline > datetime('now')
    ORDER BY r.submission_deadline ASC NULLS LAST
  `).all() as any[]).map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    submissionDeadline: r.submission_deadline,
    leagueName: r.league_name,
  }));
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/src/lib/shortlist/shortlist.ts
git commit -m "feat(shortlist): add shortlist DB module"
```

---

## Task 5: DB Module Tests

**Files:**
- Create: `ui/src/lib/shortlist/shortlist.test.ts`

- [ ] **Step 1: Write failing tests**

Create `ui/src/lib/shortlist/shortlist.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openLeagueDb } from '../db/client.js';
import {
  addShortlistSong, getShortlistSongs,
  deleteShortlistSongById, deleteShortlistSongByUri,
  patchShortlistRating, patchShortlistNotes,
  patchSubmittedElsewhere, assignToRound, unassignFromRound,
} from './shortlist.js';
import { unlinkSync, existsSync } from 'node:fs';
import type Database from 'better-sqlite3';

const TMP = '/tmp/test-shortlist.db';
let db: Database.Database;

function cleanup() {
  if (db) { try { db.close(); } catch {} }
  for (const s of ['', '-wal', '-shm']) {
    const p = `${TMP}${s}`;
    if (existsSync(p)) unlinkSync(p);
  }
}

function seedRound(db: Database.Database): number {
  db.exec(`
    INSERT OR IGNORE INTO leagues (id, slug, name) VALUES (1, 'test', 'Test League');
    INSERT OR IGNORE INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active');
    INSERT OR IGNORE INTO rounds (id, season_id, ml_round_id, name, description, spotify_playlist_url, created_at)
      VALUES (1, 1, 'r1', 'Round 1', null, null, '2026-01-01T00:00:00Z');
  `);
  return 1;
}

beforeEach(() => {
  cleanup();
  db = openLeagueDb(TMP);
});
afterEach(cleanup);

describe('addShortlistSong', () => {
  it('inserts a new song and returns it', () => {
    const s = addShortlistSong(db, { spotifyUri: 'spotify:track:abc', title: 'Song A', artist: 'Artist X' });
    expect(s.spotifyUri).toBe('spotify:track:abc');
    expect(s.title).toBe('Song A');
    expect(s.ratingDiscovery).toBe(0);
    expect(s.submittedElsewhere).toBe(false);
    expect(s.assignments).toEqual([]);
  });

  it('is idempotent — duplicate URI returns existing row without throwing', () => {
    addShortlistSong(db, { spotifyUri: 'spotify:track:abc', title: 'Song A', artist: 'Artist X' });
    expect(() => addShortlistSong(db, { spotifyUri: 'spotify:track:abc', title: 'Song A again', artist: 'X' })).not.toThrow();
    expect(getShortlistSongs(db)).toHaveLength(1);
  });
});

describe('getShortlistSongs', () => {
  it('returns songs in descending added_at order', () => {
    addShortlistSong(db, { spotifyUri: 'spotify:track:a1', title: 'First', artist: 'A' });
    addShortlistSong(db, { spotifyUri: 'spotify:track:a2', title: 'Second', artist: 'B' });
    const songs = getShortlistSongs(db);
    expect(songs[0].title).toBe('Second');
    expect(songs[1].title).toBe('First');
  });
});

describe('deleteShortlistSongById', () => {
  it('removes the song', () => {
    const s = addShortlistSong(db, { spotifyUri: 'spotify:track:del', title: 'D', artist: 'X' });
    deleteShortlistSongById(db, s.id);
    expect(getShortlistSongs(db)).toHaveLength(0);
  });
});

describe('deleteShortlistSongByUri', () => {
  it('removes the song by URI', () => {
    addShortlistSong(db, { spotifyUri: 'spotify:track:del2', title: 'D2', artist: 'X' });
    deleteShortlistSongByUri(db, 'spotify:track:del2');
    expect(getShortlistSongs(db)).toHaveLength(0);
  });
});

describe('patchShortlistRating', () => {
  it('updates the given dimension', () => {
    const s = addShortlistSong(db, { spotifyUri: 'spotify:track:rate', title: 'R', artist: 'X' });
    patchShortlistRating(db, s.id, 'discovery', 4);
    const updated = getShortlistSongs(db).find(x => x.id === s.id)!;
    expect(updated.ratingDiscovery).toBe(4);
    expect(updated.ratingThemeFit).toBe(0);
  });
});

describe('patchShortlistNotes', () => {
  it('updates notes', () => {
    const s = addShortlistSong(db, { spotifyUri: 'spotify:track:note', title: 'N', artist: 'X' });
    patchShortlistNotes(db, s.id, 'great vibe');
    expect(getShortlistSongs(db).find(x => x.id === s.id)!.notes).toBe('great vibe');
  });
});

describe('patchSubmittedElsewhere', () => {
  it('toggles the flag', () => {
    const s = addShortlistSong(db, { spotifyUri: 'spotify:track:sub', title: 'S', artist: 'X' });
    patchSubmittedElsewhere(db, s.id, true);
    expect(getShortlistSongs(db).find(x => x.id === s.id)!.submittedElsewhere).toBe(true);
    patchSubmittedElsewhere(db, s.id, false);
    expect(getShortlistSongs(db).find(x => x.id === s.id)!.submittedElsewhere).toBe(false);
  });
});

describe('assignToRound / unassignFromRound', () => {
  it('assigns a song to a round and mirrors into research_songs', () => {
    seedRound(db);
    const s = addShortlistSong(db, { spotifyUri: 'spotify:track:asgn', title: 'A', artist: 'X' });
    assignToRound(db, s.id, 1);
    const songs = getShortlistSongs(db);
    expect(songs[0].assignments).toHaveLength(1);
    expect(songs[0].assignments![0].roundId).toBe(1);
    const research = db.prepare("SELECT * FROM research_songs WHERE round_id=1 AND spotify_uri='spotify:track:asgn'").get();
    expect(research).toBeTruthy();
  });

  it('unassigns a song', () => {
    seedRound(db);
    const s = addShortlistSong(db, { spotifyUri: 'spotify:track:unasgn', title: 'U', artist: 'X' });
    assignToRound(db, s.id, 1);
    unassignFromRound(db, s.id, 1);
    expect(getShortlistSongs(db)[0].assignments).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx vitest run src/lib/shortlist/shortlist.test.ts
```
Expected: FAIL — module `./shortlist.js` not found (if task 4 wasn't done first) **or** all tests pass (if task 4 is already done). If all pass, move to step 4.

- [ ] **Step 3: Run tests after Task 4 is complete**

```bash
npx vitest run src/lib/shortlist/shortlist.test.ts
```
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add ui/src/lib/shortlist/shortlist.test.ts
git commit -m "test(shortlist): add shortlist DB module tests"
```

---

## Task 6: CSS Setup

**Files:**
- Create: `ui/src/lib/shortlist/colors_and_type.css` (copy from handoff)
- Create: `ui/src/lib/shortlist/shortlist.css` (copy from handoff)
- Modify: `ui/src/app.css`

- [ ] **Step 1: Copy CSS files from the handoff reference**

```bash
cp /home/loydmilligan/Projects/music-league-bot/docs/shortlist-proto/shortlist-handoff/reference/colors_and_type.css \
   /home/loydmilligan/Projects/music-league-bot/ui/src/lib/shortlist/colors_and_type.css

cp /home/loydmilligan/Projects/music-league-bot/docs/shortlist-proto/shortlist-handoff/reference/ml-shortlist-styles.css \
   /home/loydmilligan/Projects/music-league-bot/ui/src/lib/shortlist/shortlist.css
```

- [ ] **Step 2: Remove the Google Fonts @import from colors_and_type.css**

The app already loads these fonts via app.html or another mechanism. Open `ui/src/lib/shortlist/colors_and_type.css` and delete the first `@import url(...)` line (the Google Fonts CDN import). This prevents a double-load.

Verify the line to remove is:
```css
@import url("https://fonts.googleapis.com/css2?family=Bricolage+Grotesque...");
```

- [ ] **Step 3: Add import to app.css**

Open `ui/src/app.css` and add immediately after the `@import "tailwindcss";` line:

```css
@import '$lib/shortlist/colors_and_type.css';
```

- [ ] **Step 4: Run type check to verify no CSS parse errors**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "Error" | head -10
```
Expected: no new CSS parse errors.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/shortlist/colors_and_type.css ui/src/lib/shortlist/shortlist.css ui/src/app.css
git commit -m "feat(shortlist): add shortlist CSS (tokens + component styles)"
```

---

## Task 7: API Routes — GET/POST/DELETE /api/shortlist

**Files:**
- Create: `ui/src/routes/api/shortlist/+server.ts`

- [ ] **Step 1: Create the route file**

Create `ui/src/routes/api/shortlist/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import {
  getShortlistSongs, addShortlistSong,
  deleteShortlistSongById, deleteShortlistSongByUri,
} from '$lib/shortlist/shortlist.js';

export const GET: RequestHandler = async () => {
  const db = getDb();
  return json(getShortlistSongs(db));
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json() as {
    spotify_uri?: string; title?: string; artist?: string;
    album?: string; album_art_url?: string; year?: number; duration_sec?: number;
  };
  if (!body.spotify_uri || !body.title || !body.artist) {
    throw error(400, 'spotify_uri, title, and artist are required');
  }
  const db = getDb();
  const song = addShortlistSong(db, {
    spotifyUri: body.spotify_uri,
    title: body.title,
    artist: body.artist,
    album: body.album ?? null,
    albumArtUrl: body.album_art_url ?? null,
    year: body.year ?? null,
    durationSec: body.duration_sec ?? null,
  });
  return json(song, { status: 201 });
};

export const DELETE: RequestHandler = async ({ request, url }) => {
  const spotifyUri = url.searchParams.get('spotify_uri');
  if (spotifyUri) {
    const db = getDb();
    deleteShortlistSongByUri(db, spotifyUri);
    return new Response(null, { status: 204 });
  }
  // Body-based delete (fallback; prefer /:id route for id-based deletes)
  const body = await request.json().catch(() => ({})) as { spotify_uri?: string };
  if (body.spotify_uri) {
    const db = getDb();
    deleteShortlistSongByUri(db, body.spotify_uri);
    return new Response(null, { status: 204 });
  }
  throw error(400, 'spotify_uri query param required');
};
```

- [ ] **Step 2: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "Error" | head -10
```
Expected: no errors from the new file.

- [ ] **Step 3: Commit**

```bash
git add ui/src/routes/api/shortlist/+server.ts
git commit -m "feat(shortlist): add GET/POST/DELETE /api/shortlist"
```

---

## Task 8: API Routes — /api/shortlist/[id] sub-routes

**Files:**
- Create: `ui/src/routes/api/shortlist/[id]/+server.ts`
- Create: `ui/src/routes/api/shortlist/[id]/rating/+server.ts`
- Create: `ui/src/routes/api/shortlist/[id]/notes/+server.ts`
- Create: `ui/src/routes/api/shortlist/[id]/submitted-elsewhere/+server.ts`
- Create: `ui/src/routes/api/shortlist/[id]/assign/+server.ts`
- Create: `ui/src/routes/api/shortlist/[id]/assign/[roundId]/+server.ts`

- [ ] **Step 1: DELETE /api/shortlist/[id]**

Create `ui/src/routes/api/shortlist/[id]/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { deleteShortlistSongById } from '$lib/shortlist/shortlist.js';

export const DELETE: RequestHandler = async ({ params }) => {
  if (!params.id) throw error(400, 'id required');
  const db = getDb();
  deleteShortlistSongById(db, params.id);
  return new Response(null, { status: 204 });
};
```

- [ ] **Step 2: PATCH /api/shortlist/[id]/rating**

Create `ui/src/routes/api/shortlist/[id]/rating/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { patchShortlistRating } from '$lib/shortlist/shortlist.js';

const VALID_DIMENSIONS = ['discovery', 'theme_fit', 'nostalgia', 'personal'] as const;
type Dimension = typeof VALID_DIMENSIONS[number];

export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await request.json() as { dimension?: string; value?: number };
  if (!VALID_DIMENSIONS.includes(body.dimension as Dimension)) {
    throw error(400, 'dimension must be one of: discovery, theme_fit, nostalgia, personal');
  }
  if (typeof body.value !== 'number' || body.value < 0 || body.value > 5) {
    throw error(400, 'value must be a number 0–5');
  }
  const db = getDb();
  patchShortlistRating(db, params.id, body.dimension as Dimension, body.value);
  return json({ ok: true });
};
```

- [ ] **Step 3: PATCH /api/shortlist/[id]/notes**

Create `ui/src/routes/api/shortlist/[id]/notes/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { patchShortlistNotes } from '$lib/shortlist/shortlist.js';

export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await request.json() as { notes?: string };
  if (typeof body.notes !== 'string') throw error(400, 'notes must be a string');
  const db = getDb();
  patchShortlistNotes(db, params.id, body.notes);
  return json({ ok: true });
};
```

- [ ] **Step 4: PATCH /api/shortlist/[id]/submitted-elsewhere**

Create `ui/src/routes/api/shortlist/[id]/submitted-elsewhere/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { patchSubmittedElsewhere } from '$lib/shortlist/shortlist.js';

export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await request.json() as { value?: boolean };
  if (typeof body.value !== 'boolean') throw error(400, 'value must be boolean');
  const db = getDb();
  patchSubmittedElsewhere(db, params.id, body.value);
  return json({ ok: true });
};
```

- [ ] **Step 5: POST /api/shortlist/[id]/assign**

Create `ui/src/routes/api/shortlist/[id]/assign/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { assignToRound } from '$lib/shortlist/shortlist.js';

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json() as { round_id?: number };
  if (typeof body.round_id !== 'number') throw error(400, 'round_id required');
  const db = getDb();
  assignToRound(db, params.id, body.round_id);
  return json({ ok: true }, { status: 201 });
};
```

- [ ] **Step 6: DELETE /api/shortlist/[id]/assign/[roundId]**

Create `ui/src/routes/api/shortlist/[id]/assign/[roundId]/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { unassignFromRound } from '$lib/shortlist/shortlist.js';

export const DELETE: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');
  const db = getDb();
  unassignFromRound(db, params.id, roundId);
  return new Response(null, { status: 204 });
};
```

- [ ] **Step 7: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "Error" | head -10
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add ui/src/routes/api/shortlist/
git commit -m "feat(shortlist): add shortlist sub-routes (rating, notes, assign, submitted-elsewhere)"
```

---

## Task 9: API Route — GET /api/rounds/open

**Files:**
- Create: `ui/src/routes/api/rounds/open/+server.ts`

- [ ] **Step 1: Create the route**

Create `ui/src/routes/api/rounds/open/+server.ts`:

```ts
import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getOpenRounds } from '$lib/shortlist/shortlist.js';

export const GET: RequestHandler = async () => {
  const db = getDb();
  return json(getOpenRounds(db));
};
```

- [ ] **Step 2: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "Error" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/routes/api/rounds/open/+server.ts
git commit -m "feat(shortlist): add GET /api/rounds/open"
```

---

## Task 10: Components — MiniDna + ScoreChip

**Files:**
- Create: `ui/src/lib/shortlist/MiniDna.svelte`
- Create: `ui/src/lib/shortlist/ScoreChip.svelte`

- [ ] **Step 1: Create MiniDna.svelte**

Create `ui/src/lib/shortlist/MiniDna.svelte`:

```svelte
<script lang="ts">
  const { discovery = 0, themeFit = 0, nostalgia = 0, personal = 0 } = $props<{
    discovery?: number;
    themeFit?: number;
    nostalgia?: number;
    personal?: number;
  }>();

  const bars = [
    { pct: `${(discovery / 5) * 100}%`, color: 'var(--sky)' },
    { pct: `${(themeFit / 5) * 100}%`, color: 'var(--mash-pulp)' },
    { pct: `${(nostalgia / 5) * 100}%`, color: 'var(--amber)' },
    { pct: `${(personal / 5) * 100}%`, color: 'var(--moss)' },
  ];
</script>

<span class="sl-row-mini-dna">
  {#each bars as bar}
    <span style="--p: {bar.pct}; --c: {bar.color}"></span>
  {/each}
</span>
```

- [ ] **Step 2: Create ScoreChip.svelte**

Create `ui/src/lib/shortlist/ScoreChip.svelte`:

```svelte
<script lang="ts">
  const { discovery = 0, themeFit = 0, nostalgia = 0, personal = 0 } = $props<{
    discovery?: number;
    themeFit?: number;
    nostalgia?: number;
    personal?: number;
  }>();

  const total = discovery + themeFit + nostalgia + personal;
  const opacities = [discovery / 5, themeFit / 5, nostalgia / 5, personal / 5];
</script>

<span class="sl-score-chip">
  <span class="bar4">
    <span class="b1" style="opacity: {opacities[0]}"></span>
    <span class="b2" style="opacity: {opacities[1]}"></span>
    <span class="b3" style="opacity: {opacities[2]}"></span>
    <span class="b4" style="opacity: {opacities[3]}"></span>
  </span>
  {total}<span class="max">/20</span>
</span>
```

- [ ] **Step 3: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "Error" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add ui/src/lib/shortlist/MiniDna.svelte ui/src/lib/shortlist/ScoreChip.svelte
git commit -m "feat(shortlist): add MiniDna + ScoreChip components"
```

---

## Task 11: Component — DnaStrip

**Files:**
- Create: `ui/src/lib/shortlist/DnaStrip.svelte`

The DnaStrip renders four rating rows with click-to-set tracks. It calls back via `onchange` when the user clicks a tick.

- [ ] **Step 1: Create DnaStrip.svelte**

Create `ui/src/lib/shortlist/DnaStrip.svelte`:

```svelte
<script lang="ts">
  const {
    discovery = 0, themeFit = 0, nostalgia = 0, personal = 0,
    onchange,
  } = $props<{
    discovery?: number;
    themeFit?: number;
    nostalgia?: number;
    personal?: number;
    onchange?: (dimension: 'discovery' | 'theme_fit' | 'nostalgia' | 'personal', value: number) => void;
  }>();

  const rows = [
    { key: 'discovery' as const,  label: 'DSC', color: 'var(--sky)',       value: discovery },
    { key: 'theme_fit' as const,  label: 'THM', color: 'var(--mash-pulp)', value: themeFit },
    { key: 'nostalgia' as const,  label: 'NST', color: 'var(--amber)',      value: nostalgia },
    { key: 'personal' as const,   label: 'PRS', color: 'var(--moss)',       value: personal },
  ];

  function handleTrackClick(key: typeof rows[0]['key'], e: MouseEvent) {
    const track = e.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const val = Math.max(0, Math.min(5, Math.round(pct * 5)));
    onchange?.(key, val);
  }
</script>

<div class="sl-dna" aria-label="Rating dimensions">
  {#each rows as row}
    <div class="sl-dna-row">
      <span class="sl-dna-label" style="color: {row.color}">{row.label}</span>
      <button
        type="button"
        class="sl-dna-track"
        aria-label="{row.label} rating {row.value} of 5"
        onclick={(e) => handleTrackClick(row.key, e)}
      >
        <span
          class="sl-dna-fill"
          style="width: {(row.value / 5) * 100}%; background: {row.color}"
        ></span>
        {#each [20, 40, 60, 80] as tick}
          <span class="sl-dna-tick" style="left: {tick}%"></span>
        {/each}
      </button>
      <span class="sl-dna-val">{row.value}/5</span>
    </div>
  {/each}
</div>
```

- [ ] **Step 2: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "Error" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/shortlist/DnaStrip.svelte
git commit -m "feat(shortlist): add DnaStrip component"
```

---

## Task 12: Component — SearchBar

**Files:**
- Create: `ui/src/lib/shortlist/SearchBar.svelte`

The SearchBar handles Spotify search, dropdown display, and keyboard navigation. It emits an `onadd` callback when the user commits a selection.

- [ ] **Step 1: Create SearchBar.svelte**

Create `ui/src/lib/shortlist/SearchBar.svelte`:

```svelte
<script lang="ts">
  import { tick } from 'svelte';

  const { onadd } = $props<{
    onadd: (track: SpotifyTrack) => void;
  }>();

  type SpotifyTrack = {
    uri: string; name: string; artists: string;
    album: string; year: string; imageUrl: string | null;
  };

  let query = $state('');
  let results = $state<SpotifyTrack[]>([]);
  let keyedIndex = $state(0);
  let focused = $state(false);
  let searchEl: HTMLInputElement;
  let debounce: ReturnType<typeof setTimeout>;

  const open = $derived(focused && results.length > 0 && query.length > 1);

  async function search(q: string) {
    if (q.length <= 1) { results = []; return; }
    const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return;
    results = await res.json();
    keyedIndex = 0;
  }

  function handleInput() {
    clearTimeout(debounce);
    debounce = setTimeout(() => search(query), 300);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); keyedIndex = Math.min(keyedIndex + 1, results.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); keyedIndex = Math.max(keyedIndex - 1, 0); }
    else if (e.key === 'Enter') { e.preventDefault(); commitKeyed(); }
    else if (e.key === 'Escape') { results = []; }
  }

  function commitKeyed() {
    if (!results[keyedIndex]) return;
    onadd(results[keyedIndex]);
    query = '';
    results = [];
  }

  export function focusInput() {
    searchEl?.focus();
  }
</script>

<div class="sl-search" class:is-focused={focused}>
  <div class="sl-search-row">
    <span class="sl-search-glyph">⌕</span>
    <input
      bind:this={searchEl}
      bind:value={query}
      type="text"
      class="sl-search-input"
      placeholder="Search Spotify to add a song…"
      autocomplete="off"
      onfocus={() => focused = true}
      onblur={() => setTimeout(() => { focused = false; }, 150)}
      oninput={handleInput}
      onkeydown={handleKeydown}
    />
    <span class="sl-search-meta">
      <span class="sl-source-pip"></span>
      spotify · client-credentials
    </span>
  </div>

  {#if open}
    <div class="sl-search-drop">
      {#each results as track, i}
        <button
          type="button"
          class="sl-search-result"
          class:is-keyed={i === keyedIndex}
          onmousedown={() => { onadd(track); query = ''; results = []; }}
          onmouseenter={() => keyedIndex = i}
        >
          {#if track.imageUrl}
            <img src={track.imageUrl} alt="" width="40" height="40" style="border-radius: var(--r-2)" />
          {:else}
            <span class="sl-search-result-art-placeholder"></span>
          {/if}
          <span class="sl-search-result-info">
            <span class="sl-search-result-title">{track.name}</span>
            <span class="sl-search-result-sub">{track.artists} · {track.album}</span>
          </span>
          <span class="sl-search-result-year">{track.year}</span>
          <span class="sl-search-result-add">+</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 2: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "Error" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/shortlist/SearchBar.svelte
git commit -m "feat(shortlist): add SearchBar component"
```

---

## Task 13: Component — AssignPopover

**Files:**
- Create: `ui/src/lib/shortlist/AssignPopover.svelte`

- [ ] **Step 1: Create AssignPopover.svelte**

Create `ui/src/lib/shortlist/AssignPopover.svelte`:

```svelte
<script lang="ts">
  const { songId, songTitle, assignedRoundIds = [], onclose } = $props<{
    songId: string;
    songTitle: string;
    assignedRoundIds?: number[];
    onclose: () => void;
  }>();

  type OpenRound = { id: number; name: string; description: string | null; submissionDeadline: string | null; leagueName: string };

  let rounds = $state<OpenRound[]>([]);
  let pending = $state<Set<number>>(new Set(assignedRoundIds));

  async function loadRounds() {
    const res = await fetch('/api/rounds/open');
    if (res.ok) rounds = await res.json();
  }

  async function toggle(roundId: number) {
    const isAssigned = pending.has(roundId);
    if (isAssigned) {
      await fetch(`/api/shortlist/${songId}/assign/${roundId}`, { method: 'DELETE' });
      pending = new Set([...pending].filter(id => id !== roundId));
    } else {
      await fetch(`/api/shortlist/${songId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ round_id: roundId }),
      });
      pending = new Set([...pending, roundId]);
    }
  }

  function formatDeadline(iso: string | null): string {
    if (!iso) return '';
    const ms = Date.parse(iso) - Date.now();
    const h = Math.round(ms / 3600000);
    if (h < 24) return `${h}h`;
    return `${Math.round(h / 24)}d`;
  }

  loadRounds();
</script>

<div class="sl-popover">
  <div class="sl-popover-arrow"></div>
  <div class="sl-popover-eyebrow">Assign to a round · {songTitle}</div>
  <div class="sl-popover-body">
    {#each rounds as round}
      <button
        type="button"
        class="sl-popover-row"
        class:is-checked={pending.has(round.id)}
        onclick={() => toggle(round.id)}
      >
        <span class="sl-popover-check">{pending.has(round.id) ? '✓' : ''}</span>
        <span class="sl-popover-row-info">
          <span class="sl-popover-row-theme">{round.description ?? round.name}</span>
          <span class="sl-popover-row-sub">{round.leagueName} · {round.name}</span>
        </span>
        {#if round.submissionDeadline}
          <span class="sl-popover-row-deadline">{formatDeadline(round.submissionDeadline)}</span>
        {/if}
      </button>
    {:else}
      <p class="sl-popover-empty">No open rounds.</p>
    {/each}
  </div>
  <div class="sl-popover-footer">
    <span class="sl-popover-hint">Song stays on the shortlist after assigning.</span>
    <button type="button" class="sl-btn sl-btn-primary" onclick={onclose}>Done</button>
  </div>
</div>
```

- [ ] **Step 2: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "Error" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/shortlist/AssignPopover.svelte
git commit -m "feat(shortlist): add AssignPopover component"
```

---

## Task 14: Component — ShortlistRow

**Files:**
- Create: `ui/src/lib/shortlist/ShortlistRow.svelte`

This is the most complex component — renders both the collapsed and expanded states. It contains the action buttons and handles all API calls for a single row.

- [ ] **Step 1: Create ShortlistRow.svelte**

Create `ui/src/lib/shortlist/ShortlistRow.svelte`:

```svelte
<script lang="ts">
  import MiniDna from './MiniDna.svelte';
  import ScoreChip from './ScoreChip.svelte';
  import DnaStrip from './DnaStrip.svelte';
  import AssignPopover from './AssignPopover.svelte';
  import type { ShortlistSong } from '$lib/types.js';

  const { song, open = false, ontoggle, onremoved } = $props<{
    song: ShortlistSong;
    open?: boolean;
    ontoggle: () => void;
    onremoved: (id: string) => void;
  }>();

  let showAssignPopover = $state(false);
  let localSong = $state({ ...song });

  function humaneTime(iso: string): string {
    const ms = Date.now() - Date.parse(iso);
    const d = Math.floor(ms / 86400000);
    if (d === 0) return 'today';
    if (d === 1) return '1 day ago';
    if (d < 30) return `${d} days ago`;
    const mo = Math.floor(d / 30);
    return mo === 1 ? '1 month ago' : `${mo} months ago`;
  }

  async function patchRating(dimension: 'discovery' | 'theme_fit' | 'nostalgia' | 'personal', value: number) {
    await fetch(`/api/shortlist/${localSong.id}/rating`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dimension, value }),
    });
    if (dimension === 'discovery') localSong = { ...localSong, ratingDiscovery: value };
    else if (dimension === 'theme_fit') localSong = { ...localSong, ratingThemeFit: value };
    else if (dimension === 'nostalgia') localSong = { ...localSong, ratingNostalgia: value };
    else if (dimension === 'personal') localSong = { ...localSong, ratingPersonal: value };
  }

  let notesVal = $state(song.notes);
  async function saveNotes() {
    await fetch(`/api/shortlist/${localSong.id}/notes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: notesVal }),
    });
    localSong = { ...localSong, notes: notesVal };
  }

  async function remove() {
    await fetch(`/api/shortlist/${localSong.id}`, { method: 'DELETE' });
    onremoved(localSong.id);
  }

  async function markSubmittedElsewhere() {
    const newVal = !localSong.submittedElsewhere;
    await fetch(`/api/shortlist/${localSong.id}/submitted-elsewhere`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: newVal }),
    });
    localSong = { ...localSong, submittedElsewhere: newVal };
  }

  const assignedRoundIds = $derived((localSong.assignments ?? []).map(a => a.roundId));
  const hasAssignments = $derived(assignedRoundIds.length > 0);
</script>

{#if open}
  <!-- EXPANDED STATE -->
  <div class="sl-row is-open">
    <div class="sl-row-open">
      <!-- Art column -->
      <div class="sl-row-open-art">
        {#if localSong.albumArtUrl}
          <img src={localSong.albumArtUrl} alt="" width="180" height="180" style="border-radius: var(--r-2)" />
        {/if}
        <ScoreChip
          discovery={localSong.ratingDiscovery}
          themeFit={localSong.ratingThemeFit}
          nostalgia={localSong.ratingNostalgia}
          personal={localSong.ratingPersonal}
        />
      </div>

      <!-- Body column -->
      <div class="sl-row-open-body">
        <div class="sl-row-open-title">{localSong.title}</div>
        <div class="sl-row-open-sub">{localSong.artist}{localSong.album ? ` · ${localSong.album}` : ''}</div>

        <DnaStrip
          discovery={localSong.ratingDiscovery}
          themeFit={localSong.ratingThemeFit}
          nostalgia={localSong.ratingNostalgia}
          personal={localSong.ratingPersonal}
          onchange={patchRating}
        />

        <textarea
          class="sl-notes"
          bind:value={notesVal}
          placeholder="Notes…"
          onblur={saveNotes}
          rows="3"
        ></textarea>

        {#if hasAssignments}
          <div class="sl-row-open-assignments">
            {#each (localSong.assignments ?? []) as a}
              <span class="sl-assignment-chip">Round {a.roundId}</span>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Actions column -->
      <div class="sl-row-open-actions">
        <a
          href="https://open.spotify.com/track/{localSong.spotifyUri.split(':').at(-1)}"
          target="_blank"
          rel="noopener"
          class="sl-btn sl-btn-primary"
        >▶ Play on Spotify</a>

        <div style="position: relative">
          <button
            type="button"
            class="sl-btn sl-btn-secondary sl-iconbtn"
            class:has-some={hasAssignments}
            onclick={() => showAssignPopover = !showAssignPopover}
          >
            ⊕ Assign to round
            {#if hasAssignments}
              <span class="badge">{assignedRoundIds.length}</span>
            {/if}
          </button>
          {#if showAssignPopover}
            <AssignPopover
              songId={localSong.id}
              songTitle={localSong.title}
              assignedRoundIds={assignedRoundIds}
              onclose={() => showAssignPopover = false}
            />
          {/if}
        </div>

        <button
          type="button"
          class="sl-btn sl-btn-ghost"
          class:sl-btn-active={localSong.submittedElsewhere}
          onclick={markSubmittedElsewhere}
        >
          {localSong.submittedElsewhere ? '✓ Submitted elsewhere' : 'Mark as submitted elsewhere'}
        </button>

        <button type="button" class="sl-btn sl-btn-ghost sl-btn-ember" onclick={remove}>
          ✕ Remove from shortlist
        </button>

        <p class="sl-action-hint">Press Esc to collapse</p>
      </div>
    </div>
  </div>
{:else}
  <!-- COLLAPSED STATE -->
  <button type="button" class="sl-row" onclick={ontoggle}>
    {#if localSong.albumArtUrl}
      <img src={localSong.albumArtUrl} alt="" class="sl-row-art" width="44" height="44" />
    {:else}
      <span class="sl-row-art-placeholder"></span>
    {/if}
    <span class="sl-row-body">
      <span class="sl-row-title">{localSong.title}</span>
      <span class="sl-row-artist">{localSong.artist}</span>
    </span>
    <span class="sl-row-meta">{humaneTime(localSong.addedAt)}</span>
    <MiniDna
      discovery={localSong.ratingDiscovery}
      themeFit={localSong.ratingThemeFit}
      nostalgia={localSong.ratingNostalgia}
      personal={localSong.ratingPersonal}
    />
    <ScoreChip
      discovery={localSong.ratingDiscovery}
      themeFit={localSong.ratingThemeFit}
      nostalgia={localSong.ratingNostalgia}
      personal={localSong.ratingPersonal}
    />
  </button>
{/if}
```

- [ ] **Step 2: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "Error" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/shortlist/ShortlistRow.svelte
git commit -m "feat(shortlist): add ShortlistRow component (collapsed + expanded)"
```

---

## Task 15: Component — Bookmark

**Files:**
- Create: `ui/src/lib/shortlist/Bookmark.svelte`

- [ ] **Step 1: Create Bookmark.svelte**

Create `ui/src/lib/shortlist/Bookmark.svelte`:

```svelte
<script lang="ts">
  const { spotifyUri, title, artist, album = null, albumArtUrl = null, year = null, durationSec = null, onShortlist = false } = $props<{
    spotifyUri: string;
    title: string;
    artist: string;
    album?: string | null;
    albumArtUrl?: string | null;
    year?: number | null;
    durationSec?: number | null;
    onShortlist?: boolean;
  }>();

  let active = $state(onShortlist);
  let animating = $state(false);

  async function toggle() {
    if (active) {
      await fetch(`/api/shortlist?spotify_uri=${encodeURIComponent(spotifyUri)}`, { method: 'DELETE' });
      active = false;
    } else {
      await fetch('/api/shortlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spotify_uri: spotifyUri, title, artist,
          album: album ?? undefined,
          album_art_url: albumArtUrl ?? undefined,
          year: year ?? undefined,
          duration_sec: durationSec ?? undefined,
        }),
      });
      active = true;
      animating = true;
      setTimeout(() => animating = false, 600);
    }
  }
</script>

<button
  type="button"
  class="sl-bookmark"
  class:is-on={active}
  class:sl-pop={animating}
  aria-pressed={active}
  aria-label={active ? 'Remove from shortlist' : 'Add to shortlist'}
  onclick={toggle}
>
  {active ? '✓' : '+'}
</button>
```

- [ ] **Step 2: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "Error" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/shortlist/Bookmark.svelte
git commit -m "feat(shortlist): add Bookmark component"
```

---

## Task 16: Page Route — Server Loader

**Files:**
- Create: `ui/src/routes/shortlist/+page.server.ts`

- [ ] **Step 1: Create the server loader**

Create `ui/src/routes/shortlist/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { getShortlistSongs } from '$lib/shortlist/shortlist.js';

export const load: PageServerLoad = async () => {
  const db = getDb();
  return { songs: getShortlistSongs(db) };
};
```

- [ ] **Step 2: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "Error" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/routes/shortlist/+page.server.ts
git commit -m "feat(shortlist): add shortlist page server loader"
```

---

## Task 17: Page Route — Svelte Page

**Files:**
- Create: `ui/src/routes/shortlist/+page.svelte`

- [ ] **Step 1: Create the page**

Create `ui/src/routes/shortlist/+page.svelte`:

```svelte
<script lang="ts">
  import '$lib/shortlist/shortlist.css';
  import SearchBar from '$lib/shortlist/SearchBar.svelte';
  import ShortlistRow from '$lib/shortlist/ShortlistRow.svelte';
  import type { PageData } from './$types.js';
  import type { ShortlistSong } from '$lib/types.js';

  const { data } = $props<{ data: PageData }>();

  type SortKey = 'date' | 'score' | 'personal';

  let songs = $state<ShortlistSong[]>(data.songs);
  let openId = $state<string | null>(null);
  let sortKey = $state<SortKey>('date');
  let searchRef: { focusInput: () => void } | undefined;

  function totalScore(s: ShortlistSong) {
    return s.ratingDiscovery + s.ratingThemeFit + s.ratingNostalgia + s.ratingPersonal;
  }

  const sorted = $derived([...songs].sort((a, b) => {
    if (sortKey === 'score') return totalScore(b) - totalScore(a);
    if (sortKey === 'personal') return b.ratingPersonal - a.ratingPersonal;
    return Date.parse(b.addedAt) - Date.parse(a.addedAt);
  }));

  async function handleAdd(track: { uri: string; name: string; artists: string; album: string; year: string; imageUrl: string | null }) {
    const res = await fetch('/api/shortlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spotify_uri: track.uri,
        title: track.name,
        artist: track.artists,
        album: track.album,
        album_art_url: track.imageUrl,
        year: track.year ? parseInt(track.year) : null,
      }),
    });
    if (res.ok) {
      const song = await res.json() as ShortlistSong;
      // Avoid duplicate if already present
      if (!songs.find(s => s.id === song.id)) {
        songs = [song, ...songs];
      }
    }
  }

  function handleRemoved(id: string) {
    songs = songs.filter(s => s.id !== id);
    if (openId === id) openId = null;
  }

  function handleToggle(id: string) {
    openId = openId === id ? null : id;
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === '/') { e.preventDefault(); searchRef?.focusInput(); }
    if (e.key === 'Escape') openId = null;
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="sl-main">
  <header class="mb-6">
    <p class="font-mono text-xs text-fg-dim mb-1">music-league-bot · /shortlist</p>
    <h1 class="font-display text-3xl font-bold text-fg">Shortlist</h1>
    <p class="text-fg-muted text-sm mt-1">Research songs for upcoming rounds. Rate, assign, track.</p>
  </header>

  <SearchBar bind:this={searchRef} onadd={handleAdd} />

  <!-- Sub bar -->
  <div class="sl-bar mt-4">
    <div class="sl-sort-pills">
      {#each ([['date', 'date added'], ['score', 'score'], ['personal', 'personal']] as const) as [key, label]}
        <button
          type="button"
          class="sl-sort-pill"
          class:is-active={sortKey === key}
          onclick={() => sortKey = key}
        >{label}</button>
      {/each}
    </div>
    <span class="sl-count-chip">{songs.length} songs</span>
    <span class="sl-kb-hint">?</span>
  </div>

  <!-- Rows -->
  <div class="sl-rows mt-2">
    {#each sorted as song (song.id)}
      <ShortlistRow
        {song}
        open={openId === song.id}
        ontoggle={() => handleToggle(song.id)}
        onremoved={handleRemoved}
      />
    {/each}
    {#if songs.length === 0}
      <p class="font-mono text-sm text-fg-faint italic mt-8 text-center">
        No songs yet — search above to add your first.
      </p>
    {/if}
  </div>
</div>
```

- [ ] **Step 2: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "Error" | head -10
```
Expected: no errors.

- [ ] **Step 3: Run the dev server and open the page**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npm run dev &
```
Navigate to `http://localhost:5173/shortlist`. Verify:
- Page renders inside the existing sidebar/header shell
- Sidebar nav has "Shortlist" with the active border-left when on this route
- Search bar visible at top
- Sub-bar with three sort pills
- No console errors

- [ ] **Step 4: Commit**

```bash
git add ui/src/routes/shortlist/+page.svelte
git commit -m "feat(shortlist): add shortlist page"
```

---

## Task 18: Keyboard Navigation — `r` + `1`-`5` shortcut

**Files:**
- Modify: `ui/src/routes/shortlist/+page.svelte`
- Modify: `ui/src/lib/shortlist/ShortlistRow.svelte`

The spec calls for `r` then `1`-`5` while a row is open to set the Personal rating.

- [ ] **Step 1: Add the r+digit shortcut to the page keydown handler**

In `ui/src/routes/shortlist/+page.svelte`, replace the `handleGlobalKeydown` function with:

```ts
  let rKeyHeld = $state(false);
  let rTimeout: ReturnType<typeof setTimeout>;
  let personalRatingBus = $state<{ id: string; value: number } | null>(null);

  function handleGlobalKeydown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === '/') { e.preventDefault(); searchRef?.focusInput(); return; }
    if (e.key === 'Escape') { openId = null; return; }
    if (e.key === 'r') { rKeyHeld = true; clearTimeout(rTimeout); rTimeout = setTimeout(() => rKeyHeld = false, 1000); return; }
    if (rKeyHeld && openId && '12345'.includes(e.key)) {
      rKeyHeld = false;
      // Set bus; clear on next tick so $effect in ShortlistRow fires once
      personalRatingBus = { id: openId, value: parseInt(e.key) };
      setTimeout(() => { personalRatingBus = null; }, 0);
    }
  }
```

Then pass `personalRatingBus` as a prop to each `ShortlistRow`:

```svelte
<ShortlistRow
  {song}
  open={openId === song.id}
  ontoggle={() => handleToggle(song.id)}
  onremoved={handleRemoved}
  personalRatingSignal={personalRatingBus?.id === song.id ? personalRatingBus.value : null}
/>
```

- [ ] **Step 2: Handle personalRatingSignal in ShortlistRow**

In `ui/src/lib/shortlist/ShortlistRow.svelte`, add `personalRatingSignal` to props and a `$effect` to apply it:

```ts
  const { song, open = false, ontoggle, onremoved, personalRatingSignal = null } = $props<{
    song: ShortlistSong;
    open?: boolean;
    ontoggle: () => void;
    onremoved: (id: string) => void;
    personalRatingSignal?: number | null;
  }>();

  $effect(() => {
    if (personalRatingSignal !== null && open) {
      patchRating('personal', personalRatingSignal);
    }
  });
```

- [ ] **Step 3: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "Error" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add ui/src/routes/shortlist/+page.svelte ui/src/lib/shortlist/ShortlistRow.svelte
git commit -m "feat(shortlist): add r+1-5 keyboard shortcut for personal rating"
```

---

## Task 19: Keyboard Hints Overlay (`?`)

**Files:**
- Modify: `ui/src/routes/shortlist/+page.svelte`

The `?` button in the sub-bar opens a simple overlay listing keyboard shortcuts.

- [ ] **Step 1: Add showHelp state and overlay markup**

In `ui/src/routes/shortlist/+page.svelte`, add `let showHelp = $state(false);` with the other state declarations. Add the `?` key handler inside `handleGlobalKeydown`:

```ts
    if (e.key === '?') { e.preventDefault(); showHelp = !showHelp; return; }
```

Replace the `<span class="sl-kb-hint">?</span>` in the sub bar with:

```svelte
    <button type="button" class="sl-kb-hint" onclick={() => showHelp = !showHelp}>?</button>
```

Add the overlay before the closing `</div>` of the page root:

```svelte
  {#if showHelp}
    <div class="sl-kb-overlay" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div class="sl-kb-overlay-panel">
        <div class="sl-kb-overlay-head">
          <span>Keyboard shortcuts</span>
          <button type="button" class="sl-iconbtn" onclick={() => showHelp = false}>✕</button>
        </div>
        <table class="sl-kb-table">
          <tbody>
            <tr><td><kbd>/</kbd></td><td>Focus search</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>Close search / collapse row</td></tr>
            <tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>Move search selection</td></tr>
            <tr><td><kbd>↵</kbd></td><td>Add keyed result / expand row</td></tr>
            <tr><td><kbd>r</kbd> <kbd>1–5</kbd></td><td>Set Personal rating (row open)</td></tr>
            <tr><td><kbd>?</kbd></td><td>Toggle this overlay</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  {/if}
```

The `.sl-kb-overlay` needs minimal scoped styling. Add a `<style>` block to the page:

```svelte
<style>
  .sl-kb-overlay {
    position: fixed; inset: 0; z-index: 50;
    background: rgba(7,9,12,0.7);
    display: flex; align-items: center; justify-content: center;
  }
  .sl-kb-overlay-panel {
    background: var(--surface-2, #141921);
    border: 1px solid var(--line, #283039);
    border-radius: 8px;
    padding: 24px 28px;
    min-width: 340px;
  }
  .sl-kb-overlay-head {
    display: flex; justify-content: space-between; align-items: center;
    font: 600 14px/1 var(--font-sans, sans-serif);
    color: var(--fg, #f1f4f7);
    margin-bottom: 16px;
  }
  .sl-kb-table { border-collapse: collapse; width: 100%; }
  .sl-kb-table td { padding: 5px 8px; font: 13px/1.4 var(--font-mono, monospace); color: var(--fg-muted, #c2cad3); }
  .sl-kb-table td:first-child { color: var(--fg-dim, #8b97a4); white-space: nowrap; }
  kbd {
    display: inline-block; padding: 1px 5px;
    background: var(--surface-hover, #1d2128);
    border: 1px solid var(--line-strong, #3a4451);
    border-radius: 3px; font: 11px/1.4 var(--font-mono, monospace);
  }
</style>
```

- [ ] **Step 2: Run type check**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "Error" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/routes/shortlist/+page.svelte
git commit -m "feat(shortlist): add ? keyboard hints overlay"
```

---

## Task 20: Final Visual Check + `npm run check`

**Files:** No changes — verification only.

- [ ] **Step 1: Run the full type check suite**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx svelte-check --output machine 2>&1 | grep -E "^(Error|Warning)"
```
Expected: zero errors. Zero or minimal warnings (existing ones only).

- [ ] **Step 2: Run all tests**

```bash
cd /home/loydmilligan/Projects/music-league-bot/ui
npx vitest run
```
Expected: all tests PASS including new shortlist tests.

- [ ] **Step 3: Visual reference check**

Open `docs/shortlist-proto/shortlist-handoff/reference/Music League Bot - Shortlist.html` in a browser. Side-by-side with `http://localhost:5173/shortlist`, verify against artboard C "Focus rows · DNA strip when open":

- [ ] Collapsed row: art / title+artist / humane time / MiniDna / ScoreChip
- [ ] Expanded row: art column, DNA strip, notes, action stack
- [ ] Assign popover opens from assign button
- [ ] Bookmark component displays 3 states (off / hover / on)
- [ ] Colors match: sky=Discovery, pulp=ThemeFit, amber=Nostalgia, moss=Personal
- [ ] No raw hex literals, no Tailwind palette colors (no `bg-purple-*` etc.)
- [ ] No emoji — only Unicode glyphs (`+ ✓ ▶ ⊕ ✕ ⌕`)

- [ ] **Step 4: Final commit**

```bash
git add -p  # review any remaining unstaged changes
git commit -m "feat(shortlist): shortlist screen complete — all definition-of-done items verified"
```
