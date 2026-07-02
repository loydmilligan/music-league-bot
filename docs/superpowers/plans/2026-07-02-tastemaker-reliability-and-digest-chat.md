# Tastemaker reliability + digest chat auto-fetch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the digest Tastemaker section reliable (popularity_proxy always fresh at generate time, on a regular uniform scale, with Spotify + manual fallbacks and an honest prep-checks matrix) and make digest generation auto-use the league's chat.

**Architecture:** A single corpus-wide `recomputePopularityProxies(db)` (uniform percentile rank; Spotify calibrated onto the Last.fm ranking) runs at digest prepare/generate. A layered fill (Last.fm → calibrated Spotify → manual override) supplies the raw signal. prep-checks report real proxy coverage and chat availability. Digest generation auto-reads `chat_messages` for the league's mapped group over the round window and feeds it to the prompt.

**Tech Stack:** SvelteKit (adapter-node, Svelte 5 runes), TypeScript (ESM, `.js` import specifiers), better-sqlite3, Zod, Vitest.

## Global Constraints

- **ESM imports** use `.js` specifiers (e.g. `from './spotify.js'`).
- **Test runner:** `cd ui && npm run test` (Vitest). Type gate: `cd ui && npm run check` (must be 0 errors).
- **DB:** the app reads `data/league.db` (resolved as `../data` when SvelteKit runs from `ui/`). Table `song_popularity` columns today: `spotify_uri PK, artist, title, listeners, playcount, popularity_proxy, spotify_popularity, fetched_at, tags`. `popularity_source` does NOT exist yet (this plan adds it). `spotify_popularity` ALREADY exists.
- **Popularity scale:** `popularity_proxy` is a **uniform percentile rank (0–100)** across the corpus. Higher = more popular. Waveform obscurity is `100 - popularity_proxy` (`tasteData.ts:45`).
- **Source priority for the proxy:** `manual` (fixed, never overwritten) > `lastfm` (log1p signal) > `spotify` (calibrated onto the Last.fm ranking). Songs with no signal stay `popularity_proxy = NULL`.
- **Spotify creds** are `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` (present in `.env`). Any Spotify call must **no-op gracefully** when creds are absent (return empty, never throw).
- **Commit after every task.** Do not `git push` (project policy).
- **Coverage gate unchanged:** `getDiscoverability` still self-suppresses below 0.8 (`discoverability.ts:161`, `COVERAGE_THRESHOLD = 0.8`).

---

## File structure

- `ui/src/lib/spotify.ts` — add `fetchSpotifyPopularity(uris)` (extract the script's local helper, use shared `getSpotifyToken()`).
- `ui/src/lib/lastfm.ts` — add `recomputePopularityProxies(db)` (calibrated uniform-percentile corpus recompute). Existing `computePopularityProxies` stays (superseded for the corpus path but still exported; not deleted).
- `ui/src/lib/db/schema.ts` — add `popularity_source TEXT` column (additive migration).
- `scripts/backfill-popularity.ts` — refactor to call the lib functions (single implementation).
- `ui/src/routes/api/digest/[roundId]/draft/+server.ts` — call recompute before `gatherRoundData`.
- `ui/src/routes/api/digest/[roundId]/prepare/+server.ts` — call recompute before prep-checks.
- `ui/src/lib/digest/prepChecks.ts` — honest Tastemaker check + new Chat row.
- `ui/src/lib/digest/llm.ts` — `RoundData.chatHistory` + populate in `gatherRoundData` + emit in `buildUserPrompt`.
- `ui/src/routes/api/songs/[spotifyUri]/popularity/+server.ts` — manual override POST/DELETE (new).
- `ui/src/routes/digest/[roundId]/+page.svelte` — manual-popularity panel on the prepare stage.

Test files sit beside their module (`*.test.ts`), matching the project convention.

---

### Task 1: `fetchSpotifyPopularity` in the shared Spotify client

**Files:**
- Modify: `ui/src/lib/spotify.ts` (add export; reuse `getSpotifyToken()` at top of file)
- Test: `ui/src/lib/spotify.popularity.test.ts` (new)

**Interfaces:**
- Consumes: `getSpotifyToken(): Promise<string | null>` (already in `spotify.ts`).
- Produces: `fetchSpotifyPopularity(uris: string[]): Promise<Map<string, number>>` — maps `spotify:track:<id>` URI → popularity (0–100). Empty map when creds missing or on error. Batches 50 ids per request.

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/spotify.popularity.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIG_ID = process.env.SPOTIFY_CLIENT_ID;
const ORIG_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

beforeEach(() => {
  process.env.SPOTIFY_CLIENT_ID = 'id';
  process.env.SPOTIFY_CLIENT_SECRET = 'secret';
  vi.resetModules();
});
afterEach(() => {
  if (ORIG_ID === undefined) delete process.env.SPOTIFY_CLIENT_ID; else process.env.SPOTIFY_CLIENT_ID = ORIG_ID;
  if (ORIG_SECRET === undefined) delete process.env.SPOTIFY_CLIENT_SECRET; else process.env.SPOTIFY_CLIENT_SECRET = ORIG_SECRET;
  vi.restoreAllMocks();
});

it('maps track URIs to popularity, batching by 50', async () => {
  const uris = Array.from({ length: 51 }, (_, i) => `spotify:track:id${i}`);
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: any) => {
    if (String(url).includes('accounts.spotify.com')) {
      return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
    }
    calls.push(String(url));
    const ids = new URL(String(url)).searchParams.get('ids')!.split(',');
    return new Response(JSON.stringify({ tracks: ids.map((id) => ({ uri: `spotify:track:${id}`, popularity: 42 })) }), { status: 200 });
  }));
  const { fetchSpotifyPopularity } = await import('./spotify.js');
  const out = await fetchSpotifyPopularity(uris);
  expect(out.size).toBe(51);
  expect(out.get('spotify:track:id0')).toBe(42);
  expect(calls.length).toBe(2); // 50 + 1
});

it('returns an empty map when creds are absent (no throw)', async () => {
  delete process.env.SPOTIFY_CLIENT_ID;
  delete process.env.SPOTIFY_CLIENT_SECRET;
  const { fetchSpotifyPopularity } = await import('./spotify.js');
  const out = await fetchSpotifyPopularity(['spotify:track:x']);
  expect(out.size).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ui && npm run test -- spotify.popularity`
Expected: FAIL — `fetchSpotifyPopularity` not exported.

- [ ] **Step 3: Implement**

Add to `ui/src/lib/spotify.ts`:

```ts
/**
 * Fetch Spotify track popularity (0–100) for a list of spotify:track: URIs.
 * Batches 50 ids/request. Returns an empty map when creds are missing or on
 * any error (best-effort — callers treat absence as "no Spotify signal").
 */
export async function fetchSpotifyPopularity(uris: string[]): Promise<Map<string, number>> {
	const out = new Map<string, number>();
	if (!uris.length) return out;
	const token = await getSpotifyToken();
	if (!token) return out;
	const ids = uris.map((u) => u.split(':').pop()!).filter(Boolean);
	try {
		for (let i = 0; i < ids.length; i += 50) {
			const batch = ids.slice(i, i + 50);
			const r = await fetch(`https://api.spotify.com/v1/tracks?ids=${batch.join(',')}`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!r.ok) continue;
			const { tracks } = (await r.json()) as { tracks: ({ uri: string; popularity?: number } | null)[] };
			for (const t of tracks) if (t && typeof t.popularity === 'number') out.set(t.uri, t.popularity);
		}
	} catch (e) {
		console.warn('[spotify] popularity fetch skipped:', (e as Error).message);
	}
	return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd ui && npm run test -- spotify.popularity && npm run check`
Expected: PASS; 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/spotify.ts ui/src/lib/spotify.popularity.test.ts
git commit -m "feat(spotify): fetchSpotifyPopularity — batched track popularity in shared client"
```

---

### Task 2: Add `popularity_source` column (additive migration)

**Files:**
- Modify: `ui/src/lib/db/schema.ts` (song_popularity CREATE ~L228–236, plus the migration list)

**Interfaces:**
- Produces: `song_popularity.popularity_source TEXT` (nullable; values `'lastfm' | 'spotify' | 'manual'`).

- [ ] **Step 1: Inspect the migration pattern**

Read `ui/src/lib/db/schema.ts` and find how additive columns are applied (the file runs `CREATE TABLE IF NOT EXISTS` plus a set of idempotent `ALTER TABLE ... ADD COLUMN` guarded migrations — locate the existing migration block, e.g. where other nullable columns like `spotify_popularity`/`tags` were added). Match that exact mechanism.

- [ ] **Step 2: Add the column to the CREATE and the migration list**

In the `song_popularity` `CREATE TABLE IF NOT EXISTS` block, add after `spotify_popularity INTEGER,`:

```sql
    popularity_source  TEXT,
```

And add an idempotent migration alongside the existing `ALTER TABLE ... ADD COLUMN` guards (use the same helper/try-catch pattern the file already uses for additive columns):

```ts
// additive: popularity_source tags which source set popularity_proxy (lastfm|spotify|manual)
addColumnIfMissing('song_popularity', 'popularity_source', 'TEXT');
```

> Use the file's actual existing helper name/idiom for "add column if missing" — do not invent a new one. If the file inlines `try { db.exec('ALTER TABLE ... ADD COLUMN ...') } catch {}`, follow that form exactly.

- [ ] **Step 3: Verify migration applies cleanly**

Run: `cd ui && npm run check`
Then verify against a scratch DB copy:
```bash
cp data/league.db /tmp/mig-test.db
# start the app once against the copy OR run the schema init path; then:
sqlite3 /tmp/mig-test.db "PRAGMA table_info(song_popularity);" | grep popularity_source
```
Expected: `popularity_source|TEXT` present; running twice does not error (idempotent).

- [ ] **Step 4: Commit**

```bash
git add ui/src/lib/db/schema.ts
git commit -m "feat(db): add song_popularity.popularity_source (additive migration)"
```

---

### Task 3: `recomputePopularityProxies` — calibrated uniform-percentile scale

**Files:**
- Modify: `ui/src/lib/lastfm.ts` (add export)
- Test: `ui/src/lib/lastfm.recompute.test.ts` (new)

**Interfaces:**
- Consumes: `fetchSpotifyPopularity` (Task 1); `song_popularity` incl. `popularity_source`, `spotify_popularity` (Task 2).
- Produces: `recomputePopularityProxies(db: Database.Database, opts?: { fetchSpotify?: boolean }): Promise<{ updated: number; nullRemaining: number }>`.
  - Writes `popularity_proxy` (0–100 uniform percentile) + `popularity_source` for every non-manual row.
  - `opts.fetchSpotify` (default `true`): when true, first fills missing `spotify_popularity` via `fetchSpotifyPopularity` for rows lacking it. Tests pass `false` to stay offline.

**Algorithm (uniform percentile with Spotify→Last.fm quantile calibration):**
1. Last.fm raw signal `lf(r) = playcount>0 ? log1p(playcount) : listeners>0 ? log1p(listeners) : null`.
2. Overlap = rows with `lf!=null && spotify_popularity!=null`. Build sorted `spSorted` (spotify) and `lfSorted` (lf). Map a spotify value → its quantile in `spSorted` → the lf value at that quantile in `lfSorted` (`spToLf`).
3. Unified signal: `lf(r)` if present; else if `spotify_popularity!=null && overlap.length` then `spToLf(spotify_popularity)`; else none. Skip `popularity_source==='manual'` rows entirely (fixed points).
4. `popularity_proxy = round(quantile(unifiedValue within all unified values) * 100)` → uniform 0–100. `popularity_source = lf!=null ? 'lastfm' : 'spotify'`.
5. Rows with no signal → set `popularity_proxy=NULL, popularity_source=NULL`. Manual rows: leave both columns untouched.

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/lastfm.recompute.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { recomputePopularityProxies } from './lastfm.js';

function db0() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE song_popularity (
    spotify_uri TEXT PRIMARY KEY, artist TEXT, title TEXT,
    listeners INTEGER, playcount INTEGER, popularity_proxy INTEGER,
    spotify_popularity INTEGER, fetched_at TEXT, tags TEXT, popularity_source TEXT);`);
  return db;
}
const ins = (db: Database.Database, uri: string, playcount: number | null, spotifyPop: number | null, source: string | null = null, proxy: number | null = null) =>
  db.prepare(`INSERT INTO song_popularity (spotify_uri, listeners, playcount, spotify_popularity, popularity_source, popularity_proxy) VALUES (?,?,?,?,?,?)`)
    .run(uri, playcount ?? 0, playcount, spotifyPop, source, proxy);

it('produces a near-uniform 0..100 distribution from skewed inputs', async () => {
  const db = db0();
  // exponentially-skewed playcounts (like real data)
  for (let i = 0; i < 100; i++) ins(db, `spotify:track:p${i}`, Math.round(Math.exp(i / 10)), null);
  await recomputePopularityProxies(db, { fetchSpotify: false });
  const vals = (db.prepare('SELECT popularity_proxy p FROM song_popularity').all() as { p: number }[]).map(r => r.p);
  expect(Math.min(...vals)).toBeLessThan(10);
  expect(Math.max(...vals)).toBeGreaterThan(90);
  // uniform: each quartile band holds a comparable share (not clustered at the top)
  const band = (lo: number, hi: number) => vals.filter(v => v >= lo && v < hi).length;
  for (const [lo, hi] of [[0,25],[25,50],[50,75],[75,101]] as const) {
    expect(band(lo, hi)).toBeGreaterThan(10); // ~25 each; skewed log-norm would fail low bands
  }
});

it('calibrates spotify-only songs onto the last.fm ranking (obscure stays low)', async () => {
  const db = db0();
  // overlap: lf grows with spotify popularity (monotonic relationship)
  for (let i = 0; i < 20; i++) ins(db, `spotify:track:o${i}`, Math.round(Math.exp(i / 3)), i * 5); // spotifyPop 0..95
  // spotify-only obscure song (low spotify popularity, no lastfm)
  ins(db, 'spotify:track:obscure', null, 3);
  // spotify-only popular song
  ins(db, 'spotify:track:hit', null, 92);
  await recomputePopularityProxies(db, { fetchSpotify: false });
  const p = (u: string) => (db.prepare('SELECT popularity_proxy p, popularity_source s FROM song_popularity WHERE spotify_uri=?').get(u) as { p: number; s: string });
  expect(p('spotify:track:obscure').s).toBe('spotify');
  expect(p('spotify:track:hit').s).toBe('spotify');
  expect(p('spotify:track:obscure').p).toBeLessThan(p('spotify:track:hit').p); // obscure ranks below hit
});

it('never overwrites manual entries and is idempotent', async () => {
  const db = db0();
  ins(db, 'spotify:track:m', 1000, 80, 'manual', 33);
  ins(db, 'spotify:track:a', 5000, null);
  ins(db, 'spotify:track:b', 50, null);
  await recomputePopularityProxies(db, { fetchSpotify: false });
  const first = db.prepare('SELECT spotify_uri, popularity_proxy, popularity_source FROM song_popularity ORDER BY spotify_uri').all();
  await recomputePopularityProxies(db, { fetchSpotify: false });
  const second = db.prepare('SELECT spotify_uri, popularity_proxy, popularity_source FROM song_popularity ORDER BY spotify_uri').all();
  expect(second).toEqual(first); // idempotent
  const m = db.prepare("SELECT popularity_proxy p, popularity_source s FROM song_popularity WHERE spotify_uri='spotify:track:m'").get() as { p: number; s: string };
  expect(m).toEqual({ p: 33, s: 'manual' }); // untouched
});

it('leaves signal-less songs null', async () => {
  const db = db0();
  ins(db, 'spotify:track:none', null, null);
  ins(db, 'spotify:track:has', 100, null);
  const res = await recomputePopularityProxies(db, { fetchSpotify: false });
  const none = db.prepare("SELECT popularity_proxy p, popularity_source s FROM song_popularity WHERE spotify_uri='spotify:track:none'").get() as { p: number | null; s: string | null };
  expect(none.p).toBeNull();
  expect(none.s).toBeNull();
  expect(res.nullRemaining).toBe(1);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd ui && npm run test -- lastfm.recompute`
Expected: FAIL — `recomputePopularityProxies` not exported.

- [ ] **Step 3: Implement in `ui/src/lib/lastfm.ts`**

```ts
import { fetchSpotifyPopularity } from './spotify.js';

interface PopRow {
	spotify_uri: string; listeners: number | null; playcount: number | null;
	spotify_popularity: number | null; popularity_source: string | null;
}

/** Corpus-wide popularity_proxy recompute on a uniform percentile scale.
 *  Last.fm signal is primary; Spotify popularity is calibrated onto the
 *  Last.fm ranking via quantile matching; manual entries are fixed points. */
export async function recomputePopularityProxies(
	db: Database.Database,
	opts: { fetchSpotify?: boolean } = {},
): Promise<{ updated: number; nullRemaining: number }> {
	const rows = db.prepare(
		'SELECT spotify_uri, listeners, playcount, spotify_popularity, popularity_source FROM song_popularity',
	).all() as PopRow[];

	if (opts.fetchSpotify !== false) {
		const missing = rows.filter((r) => r.spotify_popularity == null).map((r) => r.spotify_uri);
		if (missing.length) {
			const sp = await fetchSpotifyPopularity(missing);
			if (sp.size) {
				const updSp = db.prepare('UPDATE song_popularity SET spotify_popularity = ? WHERE spotify_uri = ?');
				db.transaction(() => { for (const [uri, pop] of sp) updSp.run(pop, uri); })();
				for (const r of rows) { const v = sp.get(r.spotify_uri); if (v != null) r.spotify_popularity = v; }
			}
		}
	}

	const lf = (r: PopRow): number | null => {
		const pc = r.playcount ?? 0, ls = r.listeners ?? 0;
		if (pc > 0) return Math.log1p(pc);
		if (ls > 0) return Math.log1p(ls);
		return null;
	};

	// quantile helpers over ascending sorted arrays
	const quantileOf = (sorted: number[], v: number): number => {
		if (!sorted.length) return 0.5;
		let lo = 0, hi = sorted.length;
		while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= v) lo = mid + 1; else hi = mid; }
		return lo / sorted.length;
	};
	const valueAtQuantile = (sorted: number[], q: number): number => {
		if (!sorted.length) return 0;
		const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
		return sorted[idx];
	};

	const overlap = rows.filter((r) => r.popularity_source !== 'manual' && lf(r) !== null && r.spotify_popularity != null);
	const spSorted = overlap.map((r) => r.spotify_popularity!).sort((a, b) => a - b);
	const lfSorted = overlap.map((r) => lf(r)!).sort((a, b) => a - b);
	const spToLf = (sp: number): number => valueAtQuantile(lfSorted, quantileOf(spSorted, sp));

	const unified = new Map<string, { value: number; source: 'lastfm' | 'spotify' }>();
	for (const r of rows) {
		if (r.popularity_source === 'manual') continue;
		const l = lf(r);
		if (l !== null) unified.set(r.spotify_uri, { value: l, source: 'lastfm' });
		else if (r.spotify_popularity != null && overlap.length) unified.set(r.spotify_uri, { value: spToLf(r.spotify_popularity), source: 'spotify' });
	}
	const vals = [...unified.values()].map((u) => u.value).sort((a, b) => a - b);
	const pct = (v: number): number => (vals.length ? Math.round(quantileOf(vals, v) * 100) : 0);

	const upd = db.prepare('UPDATE song_popularity SET popularity_proxy = ?, popularity_source = ? WHERE spotify_uri = ?');
	const clr = db.prepare('UPDATE song_popularity SET popularity_proxy = NULL, popularity_source = NULL WHERE spotify_uri = ?');
	let updated = 0, nullRemaining = 0;
	db.transaction(() => {
		for (const r of rows) {
			if (r.popularity_source === 'manual') { updated++; continue; }
			const u = unified.get(r.spotify_uri);
			if (!u) { clr.run(r.spotify_uri); nullRemaining++; continue; }
			upd.run(pct(u.value), u.source, r.spotify_uri);
			updated++;
		}
	})();
	return { updated, nullRemaining };
}
```

> Ensure the file already imports `Database` type (it does — `fetchPopularity` uses it). Add the `fetchSpotifyPopularity` import at the top with the other imports.

- [ ] **Step 4: Run to verify pass**

Run: `cd ui && npm run test -- lastfm.recompute && npm run check`
Expected: all 4 tests PASS; 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/lastfm.ts ui/src/lib/lastfm.recompute.test.ts
git commit -m "feat(popularity): recomputePopularityProxies — uniform percentile w/ calibrated spotify ranking"
```

---

### Task 4: Refactor the backfill script onto the shared functions

**Files:**
- Modify: `scripts/backfill-popularity.ts` (replace its local `spotifyPopularity` + inline proxy recompute)

**Interfaces:**
- Consumes: `fetchSpotifyPopularity` (Task 1), `recomputePopularityProxies` (Task 3).

- [ ] **Step 1: Replace the script's popularity math with the lib calls**

In `scripts/backfill-popularity.ts`:
- Delete the local `async function spotifyPopularity(...)` (lines ~34–58).
- Replace the "Spotify popularity ride-along" block and the "Recompute popularity_proxy over the WHOLE corpus" block (the tail of `main()`, ~L110–128) with:

```ts
  // Fill spotify popularity + recompute proxy on the uniform percentile scale.
  const { updated, nullRemaining } = await recomputePopularityProxies(db);
  console.log(`[popularity] recomputed proxy for ${updated} song(s); ${nullRemaining} still missing all signal`);
```
- Import at the top: `import { recomputePopularityProxies } from '../ui/src/lib/lastfm.js';` (match the script's existing import style/paths — the script already imports `computePopularityProxies` from the ui lib; reuse that same relative path form).

> The script's own `CREATE TABLE ... spotify_popularity ...` (line ~27) stays; if it defines the table without `popularity_source`, add that column there too so a fresh script-run DB matches.

- [ ] **Step 2: Verify the script type-checks / runs its lookup path**

Run: `cd ui && npm run check` (the script is under the repo; ensure no import breaks the ui typecheck if it's included).
Then dry-verify against a DB copy (no network needed if data present):
```bash
cp data/league.db /tmp/backfill-test.db
# run the script pointed at the copy per its usage (see file header for how it takes the DB path);
# confirm it completes and prints the "recomputed proxy for N" line.
```
Expected: completes; proxy column repopulated on the uniform scale.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-popularity.ts
git commit -m "refactor(backfill): use shared recomputePopularityProxies + fetchSpotifyPopularity"
```

---

### Task 5: Recompute proxy at digest prepare + generate

**Files:**
- Modify: `ui/src/routes/api/digest/[roundId]/prepare/+server.ts`
- Modify: `ui/src/routes/api/digest/[roundId]/draft/+server.ts` (~L28+, before `gatherRoundData`)

**Interfaces:**
- Consumes: `recomputePopularityProxies` (Task 3).

- [ ] **Step 1: Call recompute in the prepare endpoint**

In `ui/src/routes/api/digest/[roundId]/prepare/+server.ts`, before it builds prep-checks (before `runPrepChecks(db, roundId)`), add:

```ts
  await recomputePopularityProxies(db); // ensure proxy is fresh before coverage is judged
```
Add the import: `import { recomputePopularityProxies } from '$lib/lastfm.js';`.

- [ ] **Step 2: Call recompute in the draft endpoint**

In `ui/src/routes/api/digest/[roundId]/draft/+server.ts`, before the `gatherRoundData(db, roundId)` call, add the same:

```ts
  await recomputePopularityProxies(db); // fresh proxy so the tastemaker gate passes when data exists
```
Add the import.

> Both handlers are already `async`. Recompute is idempotent and fast; running it on each prepare/generate is intended (spec Part 1).

- [ ] **Step 3: Typecheck**

Run: `cd ui && npm run check`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add ui/src/routes/api/digest/[roundId]/prepare/+server.ts ui/src/routes/api/digest/[roundId]/draft/+server.ts
git commit -m "feat(digest): recompute popularity_proxy at prepare + generate"
```

---

### Task 6: Honest prep-checks — Tastemaker coverage + new Chat row

**Files:**
- Modify: `ui/src/lib/digest/prepChecks.ts` (Tastemaker check ~L95–101/L148; add Chat row)
- Test: `ui/src/lib/digest/prepChecks.test.ts` (new or extend if present)

**Interfaces:**
- Consumes: `getChatSettings` (`$lib/chat/historyQuery.js`), `getRoundMessages` (same). `CheckResult { name, ok, src, count?, optional? }`.
- Produces: a `Tastemaker leaderboard` check reflecting real proxy coverage; a `Chat` check reflecting mapped-group + in-window message count.

- [ ] **Step 1: Write the failing test**

Create/extend `ui/src/lib/digest/prepChecks.test.ts`. Use an in-memory DB seeded with the minimal tables `runPrepChecks` reads (mirror the columns it queries — round/season/league, ml_submissions, song_popularity, chat_messages, settings). Assert:

```ts
// Tastemaker: with <80% of season submissions having non-null popularity_proxy → not ok;
// with >=80% → ok.
it('Tastemaker check reflects popularity_proxy coverage, not row existence', () => {
  // seed 10 submissions in season; give 7 a popularity_proxy (rows exist for all 10)
  // expect check.ok === false (7/10 < 0.8)
  // then give 8 → expect ok === true
});
// Chat: league mapped to a group with N in-window messages → ok with count N;
// unmapped or zero messages → not ok (optional).
it('Chat check reflects mapped group + in-window message count', () => { /* ... */ });
```

Write these with concrete seed rows and asserted values (follow the seeding style of the existing digest tests such as `ui/src/lib/db/digestData.test.ts`).

- [ ] **Step 2: Run to verify fail**

Run: `cd ui && npm run test -- prepChecks`
Expected: FAIL (current Tastemaker check uses row-existence; no Chat row).

- [ ] **Step 3: Implement**

In `prepChecks.ts`, replace the Tastemaker `pop_count` query (row existence via JOIN) with a **cumulative-season proxy coverage** matching `discoverability.ts`:

```ts
  // Tastemaker coverage: cumulative over the season through this round, counting
  // only submissions whose song has a non-null popularity_proxy (matches the
  // getDiscoverability gate — row existence is NOT enough).
  const cov = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN sp.popularity_proxy IS NOT NULL THEN 1 ELSE 0 END) AS covered
    FROM ml_submissions s
    JOIN rounds r ON r.id = s.round_id
    LEFT JOIN song_popularity sp ON sp.spotify_uri = s.spotify_uri
    WHERE r.season_id = (SELECT season_id FROM rounds WHERE id = ?)
      AND r.id <= ?
  `).get(roundId, roundId) as { total: number; covered: number };
  const covRatio = cov.total ? cov.covered / cov.total : 0;
  const tastemakerOk = cov.total > 0 && covRatio >= 0.8;
```

And the row:

```ts
    {
      name: 'Tastemaker leaderboard',
      ok: tastemakerOk,
      src: `song_popularity · ${cov.covered}/${cov.total} proxied`,
      count: cov.covered,
      optional: true,
    },
```

Add a **Chat** check (compute the round window the same way as the round page — reuse the window logic; see Task 9 for the exact formula, keep them identical):

```ts
  const chatSettings = getChatSettings(db);
  const chatGroup = chatSettings.leagueGroupMap[leagueSlug] ?? '';  // leagueSlug already resolved above in this fn
  let chatCount = 0;
  if (chatGroup) {
    const msgs = getRoundMessages(db, chatGroup, chatFromIso, chatToIso); // window computed as in Task 9
    chatCount = msgs.length;
  }
  // ...in the returned array:
    {
      name: 'Chat',
      ok: chatCount > 0,
      src: chatGroup ? `chat_messages · ${chatGroup}` : 'chat_messages · league unmapped',
      count: chatCount,
      optional: true,
    },
```

> If `runPrepChecks` doesn't already resolve the league slug and round window, add those lookups (league slug via `rounds → seasons → leagues`; window via `round.created_at → next round.created_at` with the buffer rule). Keep the window formula byte-identical to Task 9's helper — if Task 9 extracts a shared `roundChatWindow(db, roundId)` helper, call it here instead of duplicating.

- [ ] **Step 4: Run to verify pass**

Run: `cd ui && npm run test -- prepChecks && npm run check`
Expected: PASS; 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/digest/prepChecks.ts ui/src/lib/digest/prepChecks.test.ts
git commit -m "feat(prepchecks): honest tastemaker coverage + chat availability row"
```

---

### Task 7: Manual popularity override API

**Files:**
- Create: `ui/src/routes/api/songs/[spotifyUri]/popularity/+server.ts`
- Test: `ui/src/routes/api/songs/[spotifyUri]/popularity/server.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/songs/[spotifyUri]/popularity` body `{ popularity_proxy: number }` (0–100) → upserts the row, sets `popularity_source='manual'`, returns `{ ok: true }`.
  - `DELETE /api/songs/[spotifyUri]/popularity` → clears the manual flag (`popularity_source=NULL`) so the next recompute recomputes it; returns `{ ok: true }`.
- Uses a plain Zod schema in a sibling `schema.ts` if the body needs validation imported by the test (SvelteKit forbids non-handler exports from `+server.ts` — do NOT export the schema from the route file; put it in `./schema.ts` and import in both).

- [ ] **Step 1: Write the failing test**

Create `.../popularity/server.test.ts` validating the Zod schema from `./schema.js` (accepts 0–100, rejects out-of-range / non-number), mirroring the pattern in `ui/src/routes/api/settings/taste/server.test.ts`.

```ts
import { describe, it, expect } from 'vitest';
import { PopularityBodySchema } from './schema.js';
it('accepts a 0-100 popularity_proxy', () => {
  expect(PopularityBodySchema.safeParse({ popularity_proxy: 45 }).success).toBe(true);
});
it('rejects out-of-range / non-number', () => {
  expect(PopularityBodySchema.safeParse({ popularity_proxy: 150 }).success).toBe(false);
  expect(PopularityBodySchema.safeParse({ popularity_proxy: 'x' }).success).toBe(false);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd ui && npm run test -- songs/`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`ui/src/routes/api/songs/[spotifyUri]/popularity/schema.ts`:
```ts
import { z } from 'zod';
export const PopularityBodySchema = z.object({ popularity_proxy: z.number().min(0).max(100) });
```

`ui/src/routes/api/songs/[spotifyUri]/popularity/+server.ts`:
```ts
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { PopularityBodySchema } from './schema.js';

export const POST: RequestHandler = async ({ params, request }) => {
	const body = await request.json().catch(() => null);
	const parsed = PopularityBodySchema.safeParse(body);
	if (!parsed.success) throw error(400, parsed.error.message);
	const uri = decodeURIComponent(params.spotifyUri!);
	const db = getDb();
	db.prepare(`INSERT INTO song_popularity (spotify_uri, popularity_proxy, popularity_source)
	            VALUES (?, ?, 'manual')
	            ON CONFLICT(spotify_uri) DO UPDATE SET popularity_proxy = excluded.popularity_proxy, popularity_source = 'manual'`)
	  .run(uri, Math.round(parsed.data.popularity_proxy));
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const uri = decodeURIComponent(params.spotifyUri!);
	const db = getDb();
	db.prepare("UPDATE song_popularity SET popularity_source = NULL WHERE spotify_uri = ?").run(uri);
	return json({ ok: true });
};
```

> Confirm `song_popularity` allows an INSERT with only these columns (others are nullable — verify `artist`/`title` are nullable in the live schema; they are declared `TEXT` NOT NULL in `schema.ts` line 230–231 per the CREATE — if NOT NULL, the ON CONFLICT UPDATE path is fine for existing rows, but a brand-new manual row needs artist/title. Since manual overrides target songs that already have a `song_popularity` row (they appear in the missing-proxy list because the row exists with null proxy, OR the submission exists), prefer UPDATE-only: if the row may not exist, INSERT with `artist=''`/`title=''` placeholders or look them up from `ml_submissions`. Choose UPDATE-first: `UPDATE ...; if changes()===0 then INSERT with title/artist from ml_submissions`.)

Implement the UPDATE-first variant to respect NOT NULL:
```ts
	const upd = db.prepare("UPDATE song_popularity SET popularity_proxy=?, popularity_source='manual' WHERE spotify_uri=?").run(Math.round(parsed.data.popularity_proxy), uri);
	if (upd.changes === 0) {
		const s = db.prepare('SELECT title, artist FROM ml_submissions WHERE spotify_uri=? LIMIT 1').get(uri) as { title?: string; artist?: string } | undefined;
		db.prepare("INSERT INTO song_popularity (spotify_uri, title, artist, popularity_proxy, popularity_source, fetched_at) VALUES (?,?,?,?,'manual',?)")
		  .run(uri, s?.title ?? '', s?.artist ?? '', Math.round(parsed.data.popularity_proxy), new Date().toISOString());
	}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd ui && npm run test -- songs/ && npm run check`
Expected: PASS; 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add ui/src/routes/api/songs/[spotifyUri]/popularity/
git commit -m "feat(popularity): manual override endpoint (POST set / DELETE clear)"
```

---

### Task 8: Manual popularity panel on the prepare screen

**Files:**
- Modify: `ui/src/routes/digest/[roundId]/+page.svelte` (prepare stage; near the prep-checks matrix render)
- Possibly add: a tiny server endpoint or reuse the discoverability/prepare data to list missing-proxy songs. Prefer computing the list from an existing endpoint; if none returns it, add `GET /api/digest/[roundId]/missing-popularity` returning `{ songs: {spotifyUri,title,artist}[] }` for season-cumulative submissions with null `popularity_proxy`.

**Interfaces:**
- Consumes: `POST/DELETE /api/songs/[spotifyUri]/popularity` (Task 7).

- [ ] **Step 1: Add the missing-popularity list source**

Create `ui/src/routes/api/digest/[roundId]/missing-popularity/+server.ts`:
```ts
import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
export const GET: RequestHandler = async ({ params }) => {
	const db = getDb();
	const roundId = Number(params.roundId);
	const songs = db.prepare(`
		SELECT DISTINCT s.spotify_uri AS spotifyUri, s.title, s.artist
		FROM ml_submissions s JOIN rounds r ON r.id = s.round_id
		LEFT JOIN song_popularity sp ON sp.spotify_uri = s.spotify_uri
		WHERE r.season_id = (SELECT season_id FROM rounds WHERE id = ?)
		  AND r.id <= ? AND (sp.popularity_proxy IS NULL)
		ORDER BY s.title
	`).all(roundId, roundId);
	return json({ songs });
};
```

- [ ] **Step 2: Add the panel UI**

On the prepare stage of `ui/src/routes/digest/[roundId]/+page.svelte`, near where prep-checks render, add a collapsible/inline panel shown only when the Tastemaker check is not ok (or always, listing count). It fetches `/api/digest/[roundId]/missing-popularity`, renders each song with title/artist, a lookup link (`https://www.last.fm/search?q=<artist title>` or a Spotify link), a 0–100 number input, and a Save button that `POST`s to `/api/songs/<encodeURIComponent(uri)>/popularity` then refreshes the list + re-runs prepare (invalidate). Match the existing prep UI's Svelte 5 runes + styling conventions in this file.

- [ ] **Step 3: Typecheck + manual smoke deferred to Task 10**

Run: `cd ui && npm run check`
Expected: 0 errors. (Visual smoke happens in Task 10; do not run a browser here.)

- [ ] **Step 4: Commit**

```bash
git add ui/src/routes/api/digest/[roundId]/missing-popularity/ ui/src/routes/digest/[roundId]/+page.svelte
git commit -m "feat(prepare): manual popularity panel for songs missing a proxy"
```

---

### Task 9: Auto-fetch league chat into digest generation

**Files:**
- Modify: `ui/src/lib/digest/llm.ts` (`RoundData` ~L53, `gatherRoundData` ~L92, `buildUserPrompt` pasted-chat block ~L712)
- Possibly add: `ui/src/lib/chat/historyQuery.ts` — a shared `roundChatWindow(db, roundId): { groupName: string; fromIso: string; toIso: string }` if it doesn't exist, so prepChecks (Task 6) and this both use identical window logic.
- Test: `ui/src/lib/digest/chatAutofetch.test.ts` (new)

**Interfaces:**
- Consumes: `getChatSettings` + `getRoundMessages` (`$lib/chat/historyQuery.js`).
- Produces: `RoundData.chatHistory?: string` (serialized conversation, or undefined). `buildUserPrompt` emits it when present and no `genParams.pastedChat`.

**Window logic (reuse verbatim from `league/[league]/season/[n]/round/[roundId]/+page.server.ts:44–55`):**
`from = round.createdAt`, `to = nextRound?.createdAt ?? new Date().toISOString()`; if `chatSettings.roundBoundary === 'buffer'`, widen both by `chatSettings.bufferDays * 86_400_000` ms.

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/digest/chatAutofetch.test.ts`. Seed an in-memory DB with a round (createdAt), a next round, a league slug mapped in `settings.chat_league_group_map` to a group, and `chat_messages` some in-window and some out-of-window. Assert a helper `roundChatWindow(db, roundId)` returns the right group + ISO bounds, and that `getRoundMessages` over that window returns only the in-window messages. (If `gatherRoundData` is hard to unit-test directly due to its breadth, test the extracted `roundChatWindow` + the message selection, which is the logic that matters.)

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { roundChatWindow } from '$lib/chat/historyQuery.js';
import { getRoundMessages } from '$lib/chat/historyQuery.js';
// seed helper omitted for brevity in this snippet — the implementer writes concrete seeds:
it('selects the mapped group and in-window messages for the round', () => {
  // ...seed round(id=1, created 2026-06-01), round(id=2, created 2026-06-08),
  //    settings chat_league_group_map {slug: "G"}, chat_messages: 2 in [06-01,06-08), 1 after
  // const w = roundChatWindow(db, 1);
  // expect(w.groupName).toBe('G');
  // expect(getRoundMessages(db, w.groupName, w.fromIso, w.toIso).length).toBe(2);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd ui && npm run test -- chatAutofetch`
Expected: FAIL — `roundChatWindow` not exported.

- [ ] **Step 3: Implement `roundChatWindow`**

Add to `ui/src/lib/chat/historyQuery.ts` (extracting the round-page formula so both callers share it):

```ts
export function roundChatWindow(db: Database.Database, roundId: number): { groupName: string; fromIso: string; toIso: string } {
	const round = db.prepare('SELECT r.created_at AS createdAt, l.slug AS slug, r.season_id AS seasonId FROM rounds r JOIN seasons s ON s.id=r.season_id JOIN leagues l ON l.id=s.league_id WHERE r.id=?').get(roundId) as { createdAt: string; slug: string; seasonId: number } | undefined;
	if (!round) return { groupName: '', fromIso: '', toIso: '' };
	const next = db.prepare('SELECT created_at AS createdAt FROM rounds WHERE season_id=? AND created_at > ? ORDER BY created_at ASC LIMIT 1').get(round.seasonId, round.createdAt) as { createdAt: string } | undefined;
	const settings = getChatSettings(db);
	const groupName = settings.leagueGroupMap[round.slug] ?? '';
	let fromIso = round.createdAt;
	let toIso = next ? next.createdAt : new Date().toISOString();
	if (settings.roundBoundary === 'buffer') {
		const buf = settings.bufferDays * 86_400_000;
		fromIso = new Date(new Date(fromIso).getTime() - buf).toISOString();
		toIso = new Date(new Date(toIso).getTime() + buf).toISOString();
	}
	return { groupName, fromIso, toIso };
}
```

> Match the actual `rounds`/`seasons`/`leagues` column names in `schema.ts` (e.g. `created_at`); adjust the SQL to the real columns. Verify `getChatSettings` shape (`leagueGroupMap`, `roundBoundary`, `bufferDays`).

- [ ] **Step 4: Wire into `gatherRoundData` + `buildUserPrompt`**

In `llm.ts`: add `chatHistory?: string;` to `RoundData` (~L88 near `pastedChat`). In `gatherRoundData`, after building the base data:
```ts
	const win = roundChatWindow(db, roundId);
	let chatHistory: string | undefined;
	if (win.groupName) {
		const msgs = getRoundMessages(db, win.groupName, win.fromIso, win.toIso);
		if (msgs.length) chatHistory = msgs.map((m) => `[${m.ts}] ${m.sender}: ${m.text.replace(/\s+/g, ' ').trim()}`).join('\n');
	}
	// include chatHistory in the returned RoundData object
```
In `buildUserPrompt`, after the existing pasted-chat block (~L712–717), add:
```ts
	// Auto-fetched league chat (used when nothing was pasted).
	if (!genParams?.pastedChat?.trim() && data.chatHistory?.trim()) {
		parts.push(
			`\n# League chat for this round — use THIS as the source for the "chat" section (ignore auto-captured mentions for that section):\n${data.chatHistory.trim()}`,
		);
	}
```
Add imports for `roundChatWindow`/`getRoundMessages` in `llm.ts`.

- [ ] **Step 5: Run to verify pass**

Run: `cd ui && npm run test -- chatAutofetch && npm run check`
Expected: PASS; 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/digest/llm.ts ui/src/lib/chat/historyQuery.ts ui/src/lib/digest/chatAutofetch.test.ts
git commit -m "feat(digest): auto-fetch league chat over the round window into generation"
```

> If Task 6 was implemented before this task, refactor its inline window computation to call `roundChatWindow` (single source of truth). If this task lands first, Task 6 calls `roundChatWindow` directly.

---

### Task 10: Deploy + verify live

**Files:** none (integration/deploy). Follow `docs/dev-loop-playbook.md` + CLAUDE.md two-loop deploy.

- [ ] **Step 1: Full gate**

Run: `cd ui && npm run test && npm run check`
Expected: all touched suites PASS; svelte-check 0 errors. (Pre-existing unrelated failures in content/queueWorker/adapters/metadataQueue/chat-page may remain — confirm the count matches the known baseline and none are newly introduced by this plan.)

- [ ] **Step 2: Dev-server smoke (DB copy)**

```bash
cp -r data /tmp/tm-smoke-data   # never mutate prod data during smoke
```
Run the dev server (`cd ui && npm run dev -- --host --port 5188`) pointed at the copy if feasible, or accept read/generate against real data carefully. On a Hip Jammers and a Second Best round:
- Prepare screen shows the **Chat** row (with a message count) and a **Tastemaker** row reflecting real coverage; if coverage <80%, the manual-popularity panel lists missing songs and a manual save flips a song to covered.
- Generate a draft → the **Tastemaker section renders**, and the generated **chat section reflects the auto-fetched conversation**.
Kill the dev server (kill the npm parent) when done.

- [ ] **Step 3: Prod deploy (merge to master already; build from main checkout)**

```bash
docker compose build bot-ui && docker compose up -d --force-recreate bot-ui
```

- [ ] **Step 4: Mandatory post-deploy assertions**

```bash
# settings/prepare/draft endpoints respond
curl -s -o /dev/null -w "prepare %{http_code}\n" http://192.168.4.217:3002/api/digest/117/prepare
# client bundle contains the new prepare panel string (grep a known new UI label)
docker compose exec -T bot-ui sh -c "grep -rl 'popularity' /app/ui/build/client/_app/immutable | head -1"
```
Then load `mlbot2.mattmariani.com`, open a Hip Jammers round digest, generate, and confirm Tastemaker + auto-chat render and the prep matrix is honest.

- [ ] **Step 5: Report status** (do not push per policy; surface ahead-of-origin count).

---

## Self-Review

**Spec coverage:**
- Spec Part 1 (fresh proxy at generate) → Tasks 3 + 5. Part 2 (uniform percentile, calibrated Spotify, manual override, columns) → Tasks 1 (spotify fetch), 2 (`popularity_source`), 3 (recompute algorithm), 7 (manual API), 8 (manual UI). Part 3 (honest prep-checks) → Task 6. Part 4 (chat auto-fetch + prep-checks chat row) → Tasks 9 (auto-fetch) + 6 (chat row). Backfill dedup → Task 4. Deploy/verify → Task 10. All covered.

**Placeholder scan:** Logic tasks (1,3,6,7,9) carry full code. UI/wiring tasks (8) and DB-shape-dependent SQL (6,9) instruct the implementer to match real column names — with the exact query provided and a one-line "verify column names" note, not vague "handle it" language. No TBD/TODO.

**Type consistency:** `fetchSpotifyPopularity(uris): Promise<Map<string,number>>` (Task 1) consumed in Task 3. `recomputePopularityProxies(db, {fetchSpotify?})` (Task 3) consumed in Tasks 4, 5. `popularity_source` (Task 2) used in Tasks 3, 6, 7. `roundChatWindow(db, roundId)` (Task 9) shared with Task 6. `PopularityBodySchema` (Task 7) used by its test. `RoundData.chatHistory` (Task 9) consumed in `buildUserPrompt` same task. Consistent.

**Scope:** One coherent feature (per the user's all-in-one choice), ordered so each task is independently testable; Tasks 6 and 9 share `roundChatWindow` with a note on whichever lands first.
