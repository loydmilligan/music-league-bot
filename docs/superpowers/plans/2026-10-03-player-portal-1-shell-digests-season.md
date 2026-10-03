# Player Portal Piece 1 (Shell, Digests, Live Season) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each league's b-side page into the player portal: instant 2.0 digest links (via a deterministic `portal.json`), a Digests screen covering every round, a Home "Read the latest digest" button, and a live Season section fed by the survey app.

**Architecture:** music-league-bot writes `DIGESTS_DIR/<leagueSlug>/portal.json` (DB-only, leak-checked, atomic) on every 2.0 finalize, b-side publish, Update, and season-settings save. The static b-side SPA (`bside/`) loads `portal.json` next to `read_model.json`, adds a shared nav, and fetches the survey app's public CORS feed client-side for the Season screen. The survey half (feed endpoint, CORS, nav strip) is built by the boarz-season-2-survey session in its own repo against the §6 contract.

**Tech Stack:** SvelteKit + better-sqlite3 + Vitest (`ui/`), Svelte 5 + Vite SPA (`bside/`), Express (survey repo, other session), Caddy (unchanged).

**Spec:** `docs/superpowers/specs/2026-10-03-player-portal-1-shell-digests-season-design.md`

## Global Constraints

- No portal file or bundle may contain the admin host `new URL(appBaseUrl()).host` or the internal origin host; reuse `findLeaks` from `ui/src/lib/digest2/publishHtml.ts`.
- No hardcoded hostnames in `ui/` code — use `appBaseUrl()` / `digestBaseUrl()` from `$lib/config/urls.js` (`hostLiterals.test.ts` has 3 pre-existing failures; add none). The b-side SPA uses only relative paths for its own files and the configured feed/hub URLs from `portal.json`.
- No changes to `Caddyfile.digest`; `portal.json` lives in the already-served `/<leagueSlug>/` folder.
- Do not change the Update flow's LLM pipeline or `archived_rounds` bookkeeping — only its `digestUrl` link rule and a post-success `portal.json` write.
- Do not edit `ui/src/lib/digest/export.ts` or `ui/src/lib/digest2/publish.ts` (`publishDigest2`); the portal hook goes in the publish **endpoint**.
- A `portal.json` failure never fails a 2.0 publish, b-side publish, or Update — it is logged and surfaced as a warning.
- Season URLs must be `https://` URLs (or null). Feed fetch from the browser: `credentials: 'omit'`, 8 s timeout.
- Survey repo (`~/Projects/boarz-season-2-survey`) is owned by the other session — this plan's executors never edit it.
- Repo rules: gitnexus impact before editing an existing symbol; `detect-changes` before merge; `cd ui && npm run check` 0 errors; `cd bside && npm run check` 0 errors. Commit trailers:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SAJiVCbHEqhbaSePqoQF5v
  ```
- Never `git push`; never send to any WhatsApp group.

## Review Focus

1. **A league with no `dashboard_sites` row** (never published b-side) → `writePortalJson` returns null, no file, no error; publish of a 2.0 digest in that league still succeeds. Pinned in Task 2 + Task 3.
2. **Rounds with neither a 2.0 nor 1.0 share** (most historical rounds) → listed with `digestUrl: null`, `digestKind: null`, rendered as "No digest" (not a dead link). Pinned in Task 1 + Task 2.
3. **Old b-side page with no `portal.json` yet** (before first write) → Digests falls back to `read_model.archive`; Season tab hidden; nothing crashes. Pinned in Task 6.
4. **Feed unreachable / CORS-blocked / malformed / unknown version** → Season shows "Open season hub" (or tab hidden if no hub URL). Pinned in Task 5 (normalizer) + Task 6.
5. **Teaser rounds** must never render a title/description/credit even if a malformed feed includes them. Pinned in Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `ui/src/lib/portal/digestLinks.ts` (new) | `digestLinkForRound` — v2 → v1 → null link rule. |
| `ui/src/lib/dashboard/buildReadModel.ts` (modify) | `buildArchiveRows` export; archive uses the link helper. |
| `ui/src/routes/api/content/[leagueId]/update/+server.ts` (modify) | `buildArchiveEntry` uses the link helper; writes portal.json after success. |
| `ui/src/lib/portal/portalJson.ts` (new) | Build + leak-check + atomic write of `portal.json`; season settings read/write. |
| `ui/src/lib/dashboard/publish.ts` (modify) | `publishSite` writes portal.json after artifacts. |
| `ui/src/routes/api/digest2/[roundId]/publish/+server.ts` (modify) | Writes portal.json after a successful publish; `portalWarning`. |
| `ui/src/lib/digest2/AdminBar.svelte` (modify) | Shows `portalWarning`. |
| `ui/src/routes/api/portal/[leagueId]/season/+server.ts` (new) | GET/PUT season feed + hub URLs; rewrites portal.json. |
| `ui/src/routes/content/+page.server.ts`, `+page.svelte` (modify) | Season URL inputs per league card. |
| `bside/src/lib/seasonFeed.ts` (new) | Pure normalizer for the survey feed (privacy-safe). |
| `bside/src/lib/portal.ts` (new) | `PortalJson` types + loader with fallback. |
| `bside/src/lib/atoms/PortalNav.svelte` (new) | Shared Home · Digests · Season nav. |
| `bside/src/App.svelte`, `routes/*.svelte` (modify), `routes/SeasonScreen.svelte` (new) | Routing, Digests from portal.json, Home button, Season screen. |
| `ui/src/lib/portal/seasonFeed.test.ts` (new) | Vitest for the bside normalizer (imported by relative path; bside has no test runner). |

---

### Task 1: Digest link helper; archive prefers 2.0

**Files:**
- Create: `ui/src/lib/portal/digestLinks.ts`, `ui/src/lib/portal/digestLinks.test.ts`
- Modify: `ui/src/lib/dashboard/buildReadModel.ts` (`buildArchive`, ~L296–407), `ui/src/routes/api/content/[leagueId]/update/+server.ts` (`buildArchiveEntry`, ~L702–756) — impact-check both first.
- Test: extend `ui/src/lib/dashboard/buildReadModel.test.ts`

**Interfaces:**
- Produces: `digestLinkForRound(db, roundId): { url: string; kind: 'v2' | 'v1' } | null`
- Produces: `export function buildArchiveRows(db, leagueId): (ArchiveEntry & { roundId: number; digestKind: 'v2' | 'v1' | null })[]` (same order/content as today's archive, newest first); `buildArchive` becomes `buildArchiveRows(...).map(({ roundId, digestKind, ...e }) => e)`.

- [ ] **Step 1: Failing test** — `ui/src/lib/portal/digestLinks.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { digestBaseUrl } from '$lib/config/urls.js';
import { digestLinkForRound } from './digestLinks.js';

let db: Database.Database;
beforeEach(() => {
	db = openLeagueDb(':memory:');
	db.exec(`
		INSERT INTO leagues (id, slug, name) VALUES (1, 'bz', 'Boarz');
		INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 1, 'active');
		INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES
			(1, 10, 'a', 'R1', '2026-01-01'), (2, 10, 'b', 'R2', '2026-01-02'), (3, 10, 'c', 'R3', '2026-01-03');
		INSERT INTO digest_shares (round_id, slug) VALUES (1, 'v1only0000000000'), (2, 'v1both0000000000');
		INSERT INTO digest2_shares (round_id, slug) VALUES (2, 'v2both0000000000');
	`);
});

describe('digestLinkForRound', () => {
	it('prefers the 2.0 share when both exist', () => {
		expect(digestLinkForRound(db, 2)).toEqual({ url: `${digestBaseUrl()}/d2/v2both0000000000`, kind: 'v2' });
	});
	it('falls back to the 1.0 share', () => {
		expect(digestLinkForRound(db, 1)).toEqual({ url: `${digestBaseUrl()}/d/v1only0000000000`, kind: 'v1' });
	});
	it('null when the round has no share', () => {
		expect(digestLinkForRound(db, 3)).toBeNull();
	});
});
```

- [ ] **Step 2: Run** `cd ui && npx vitest run src/lib/portal/digestLinks.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `ui/src/lib/portal/digestLinks.ts`

```ts
import type Database from 'better-sqlite3';
import { digestBaseUrl } from '$lib/config/urls.js';

/** Best public digest link for a round: 2.0 share, else 1.0 share, else null. */
export function digestLinkForRound(
	db: Database.Database,
	roundId: number
): { url: string; kind: 'v2' | 'v1' } | null {
	const v2 = db.prepare('SELECT slug FROM digest2_shares WHERE round_id = ?').get(roundId) as { slug: string } | undefined;
	if (v2) return { url: `${digestBaseUrl()}/d2/${v2.slug}`, kind: 'v2' };
	const v1 = db.prepare('SELECT slug FROM digest_shares WHERE round_id = ?').get(roundId) as { slug: string } | undefined;
	if (v1) return { url: `${digestBaseUrl()}/d/${v1.slug}`, kind: 'v1' };
	return null;
}
```

- [ ] **Step 4: Archive uses the helper.** In `buildReadModel.ts`: rename the body of `buildArchive` into `export function buildArchiveRows(db, leagueId)`; drop the `digest_shares` query + `digestSlugByRound` map; per row set `const link = digestLinkForRound(db, row.round_id)` and emit `{ ...existing fields, digestUrl: link?.url ?? null, roundId: row.round_id, digestKind: link?.kind ?? null }` (keep the newest-first reverse + `n` renumbering exactly). Then `function buildArchive(db, leagueId) { return buildArchiveRows(db, leagueId).map(({ roundId: _r, digestKind: _k, ...e }) => e); }`. In the Update endpoint's `buildArchiveEntry`, replace the `digest_shares` lookup with `digestLinkForRound(db, roundId)?.url ?? null`.

- [ ] **Step 5: Add a test** to `buildReadModel.test.ts` (reuse its seeding helpers): seed one completed round with both a `digest_shares` and a `digest2_shares` row → the read model's archive entry `digestUrl` ends with `/d2/<v2slug>`; and `buildArchiveRows` returns that `roundId` and `digestKind: 'v2'`.

- [ ] **Step 6: Run** `cd ui && npx vitest run src/lib/portal src/lib/dashboard "src/routes/api/content"` → new tests PASS, no new failures vs. master (note any pre-existing ones in the report); `npm run check` 0 errors.

- [ ] **Step 7: Commit** `feat(portal): digest link helper — archive prefers 2.0 shares`

---

### Task 2: `portal.json` builder + writer

**Files:**
- Create: `ui/src/lib/portal/portalJson.ts`, `ui/src/lib/portal/portalJson.test.ts`

**Interfaces:**
- Consumes: `buildArchiveRows` (Task 1), `findLeaks` (`$lib/digest2/publishHtml.js`), `appBaseUrl` (`$lib/config/urls.js`).
- Produces:
  - `interface PortalDigest { roundId: number; n: number; season: number; theme: string; date: string; winnerSong: string; winnerArtist: string; submitter: string; votes: number; hue: string; digestUrl: string | null; digestKind: 'v2' | 'v1' | null }`
  - `interface PortalJson { version: 1; generatedAt: string; seasonFeedUrl: string | null; seasonHubUrl: string | null; digests: PortalDigest[] }`
  - `getSeasonSettings(db, leagueId): { feedUrl: string | null; hubUrl: string | null }`
  - `setSeasonSettings(db, leagueId, s: { feedUrl: string | null; hubUrl: string | null }): void` (validates https; throws `Error('invalid url: …')`)
  - `buildPortalJson(db, leagueId, now?: string): PortalJson`
  - `writePortalJson(db, leagueId, opts?: { digestsDir?: string }): Promise<{ path: string; digests: number } | null>` — null when the league has no `dashboard_sites` row; throws on leak (message lists snippets); writes `<dir>/<slug>/.portal.json.tmp` then renames to `portal.json`.
  - Settings keys: `portal_season_feed_url:<leagueId>`, `portal_season_hub_url:<leagueId>`.

- [ ] **Step 1: Failing tests** — `ui/src/lib/portal/portalJson.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { appBaseUrl } from '$lib/config/urls.js';
import { buildPortalJson, writePortalJson, getSeasonSettings, setSeasonSettings } from './portalJson.js';

let db: Database.Database;
function seed() {
	db.exec(`
		INSERT INTO leagues (id, slug, name) VALUES (1, 'bz', 'Boarz'), (2, 'np', 'Nostalgia');
		INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 1, 'complete'), (11, 1, 2, 'active');
		INSERT INTO rounds (id, season_id, ml_round_id, name, created_at, phase, voting_deadline) VALUES
			(1, 10, 'a', 'Old Round', '2026-01-01', 'complete', '2026-01-08'),
			(2, 11, 'b', 'New Round', '2026-09-01', 'complete', '2026-09-08'),
			(3, 11, 'c', 'Open Round', '2026-09-10', NULL, NULL);
		INSERT INTO digest_shares (round_id, slug) VALUES (1, 'oldv1slug0000000');
		INSERT INTO digest2_shares (round_id, slug) VALUES (2, 'newv2slug0000000');
		INSERT INTO dashboard_sites (slug, league_id, season, read_model, archived_rounds, is_live, published_at, refreshed_at)
			VALUES ('LeagueSlugAAAAAAAAAAAA', 1, 2, '{}', '[]', 1, '2026-01-01', '2026-01-01');
	`);
}
beforeEach(() => { db = openLeagueDb(':memory:'); seed(); });

describe('season settings', () => {
	it('round-trips and clears', () => {
		setSeasonSettings(db, 1, { feedUrl: 'https://s.example/feed.json', hubUrl: 'https://s.example/hub/' });
		expect(getSeasonSettings(db, 1)).toEqual({ feedUrl: 'https://s.example/feed.json', hubUrl: 'https://s.example/hub/' });
		setSeasonSettings(db, 1, { feedUrl: null, hubUrl: null });
		expect(getSeasonSettings(db, 1)).toEqual({ feedUrl: null, hubUrl: null });
	});
	it('rejects non-https urls', () => {
		expect(() => setSeasonSettings(db, 1, { feedUrl: 'http://s.example/f.json', hubUrl: null })).toThrow(/invalid url/);
		expect(() => setSeasonSettings(db, 1, { feedUrl: 'not a url', hubUrl: null })).toThrow(/invalid url/);
	});
});

describe('buildPortalJson', () => {
	it('lists completed rounds across seasons newest first with v2/v1/null links', () => {
		const p = buildPortalJson(db, 1, '2026-10-03T00:00:00Z');
		expect(p.version).toBe(1);
		expect(p.digests.map((d) => [d.roundId, d.digestKind])).toEqual([[2, 'v2'], [1, 'v1']]);
		expect(p.digests[0].digestUrl).toMatch(/\/d2\/newv2slug0000000$/);
		expect(p.digests.find((d) => d.roundId === 3)).toBeUndefined(); // not completed
	});
	it('a round with no share has null link + kind', () => {
		db.exec(`DELETE FROM digest_shares`);
		expect(buildPortalJson(db, 1).digests.find((d) => d.roundId === 1)).toMatchObject({ digestUrl: null, digestKind: null });
	});
	it('carries the season settings', () => {
		setSeasonSettings(db, 1, { feedUrl: 'https://s.example/feed.json', hubUrl: null });
		expect(buildPortalJson(db, 1)).toMatchObject({ seasonFeedUrl: 'https://s.example/feed.json', seasonHubUrl: null });
	});
});

describe('writePortalJson', () => {
	it('writes <dir>/<slug>/portal.json atomically', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'portal-'));
		const res = await writePortalJson(db, 1, { digestsDir: dir });
		expect(res?.digests).toBe(2);
		const body = JSON.parse(await readFile(join(dir, 'LeagueSlugAAAAAAAAAAAA', 'portal.json'), 'utf8'));
		expect(body.digests).toHaveLength(2);
		expect(await readdir(join(dir, 'LeagueSlugAAAAAAAAAAAA'))).toEqual(['portal.json']); // no tmp left
	});
	it('returns null and writes nothing when the league has no b-side site', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'portal-'));
		expect(await writePortalJson(db, 2, { digestsDir: dir })).toBeNull();
		expect(await readdir(dir)).toEqual([]);
	});
	it('refuses to write when the admin host would leak (e.g. via a setting)', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'portal-'));
		const adminHub = `${appBaseUrl()}/hub`;
		db.prepare(`INSERT INTO settings (key, value) VALUES ('portal_season_hub_url:1', ?)`).run(adminHub); // bypass validation
		await expect(writePortalJson(db, 1, { digestsDir: dir })).rejects.toThrow(/admin|leak|forbidden/i);
		expect(await readdir(dir)).toEqual([]);
	});
});
```

- [ ] **Step 2: Run** `cd ui && npx vitest run src/lib/portal/portalJson.test.ts` → FAIL.

- [ ] **Step 3: Implement** `ui/src/lib/portal/portalJson.ts`

```ts
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { appBaseUrl } from '$lib/config/urls.js';
import { buildArchiveRows } from '$lib/dashboard/buildReadModel.js';
import { findLeaks } from '$lib/digest2/publishHtml.js';

const DIGESTS_DIR = process.env.DIGESTS_DIR || '/app/digests';
const INTERNAL_URL = process.env.DIGEST_EXPORT_INTERNAL_URL || `http://localhost:${process.env.PORT || 3002}`;

export interface PortalDigest {
	roundId: number; n: number; season: number; theme: string; date: string;
	winnerSong: string; winnerArtist: string; submitter: string; votes: number; hue: string;
	digestUrl: string | null; digestKind: 'v2' | 'v1' | null;
}
export interface PortalJson {
	version: 1; generatedAt: string;
	seasonFeedUrl: string | null; seasonHubUrl: string | null;
	digests: PortalDigest[];
}

const feedKey = (id: number) => `portal_season_feed_url:${id}`;
const hubKey = (id: number) => `portal_season_hub_url:${id}`;

function readSetting(db: Database.Database, key: string): string | null {
	const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
	return row?.value ? row.value : null;
}

function validHttps(u: string | null): string | null {
	if (u === null || u.trim() === '') return null;
	let parsed: URL;
	try { parsed = new URL(u.trim()); } catch { throw new Error(`invalid url: ${u}`); }
	if (parsed.protocol !== 'https:') throw new Error(`invalid url: ${u}`);
	return parsed.toString();
}

export function getSeasonSettings(db: Database.Database, leagueId: number) {
	return { feedUrl: readSetting(db, feedKey(leagueId)), hubUrl: readSetting(db, hubKey(leagueId)) };
}

export function setSeasonSettings(
	db: Database.Database,
	leagueId: number,
	s: { feedUrl: string | null; hubUrl: string | null }
): void {
	const feed = validHttps(s.feedUrl);
	const hub = validHttps(s.hubUrl);
	const put = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
	const del = db.prepare('DELETE FROM settings WHERE key = ?');
	db.transaction(() => {
		if (feed) put.run(feedKey(leagueId), feed); else del.run(feedKey(leagueId));
		if (hub) put.run(hubKey(leagueId), hub); else del.run(hubKey(leagueId));
	})();
}

export function buildPortalJson(db: Database.Database, leagueId: number, now = new Date().toISOString()): PortalJson {
	const { feedUrl, hubUrl } = getSeasonSettings(db, leagueId);
	return {
		version: 1,
		generatedAt: now,
		seasonFeedUrl: feedUrl,
		seasonHubUrl: hubUrl,
		digests: buildArchiveRows(db, leagueId).map((r) => ({
			roundId: r.roundId, n: r.n, season: r.season, theme: r.theme, date: r.date,
			winnerSong: r.winnerSong, winnerArtist: r.winnerArtist, submitter: r.submitter,
			votes: r.votes, hue: r.hue, digestUrl: r.digestUrl ?? null, digestKind: r.digestKind
		}))
	};
}

/** Build, leak-check, and atomically write <digestsDir>/<leagueSlug>/portal.json. */
export async function writePortalJson(
	db: Database.Database,
	leagueId: number,
	opts: { digestsDir?: string } = {}
): Promise<{ path: string; digests: number } | null> {
	const site = db.prepare('SELECT slug FROM dashboard_sites WHERE league_id = ?').get(leagueId) as { slug: string } | undefined;
	if (!site) return null;
	const portal = buildPortalJson(db, leagueId);
	const body = JSON.stringify(portal);
	const leaks = findLeaks({
		html: '',
		textAssets: new Map([['portal.json', body]]),
		forbiddenHosts: [new URL(appBaseUrl()).host, new URL(INTERNAL_URL).host]
	});
	if (leaks.length) throw new Error(`portal.json blocked — forbidden host leak:\n${leaks.slice(0, 3).join('\n')}`);
	const dir = join(opts.digestsDir ?? DIGESTS_DIR, site.slug);
	await mkdir(dir, { recursive: true });
	const tmp = join(dir, '.portal.json.tmp');
	const path = join(dir, 'portal.json');
	await writeFile(tmp, body, 'utf8');
	await rename(tmp, path);
	return { path, digests: portal.digests.length };
}
```

(Note the `refuses to write` test: the leak check must run **before** `mkdir`, so the temp dir stays empty — as written above.)

- [ ] **Step 4: Run** the test file → 8 PASS; `npm run check` 0 errors.

- [ ] **Step 5: Commit** `feat(portal): deterministic portal.json builder + leak-checked atomic writer`

---

### Task 3: Write portal.json on 2.0 finalize, b-side publish, and Update

**Files:**
- Modify: `ui/src/routes/api/digest2/[roundId]/publish/+server.ts`, `ui/src/routes/api/digest2/[roundId]/publish/server.test.ts`, `ui/src/lib/digest2/AdminBar.svelte`, `ui/src/lib/dashboard/publish.ts` (`publishSite`), `ui/src/routes/api/content/[leagueId]/update/+server.ts` (after `writePublicArtifacts`) — impact-check `publishSite`, `POST` handlers.

**Interfaces:**
- Consumes: `writePortalJson(db, leagueId)` (Task 2).
- Produces: publish endpoint success JSON gains optional `portalWarning?: string`.

- [ ] **Step 1: Failing tests** — extend `publish/server.test.ts` (it already mocks `$lib/db/client.js` and `$lib/digest2/publish.js`); add `vi.mock('$lib/portal/portalJson.js', () => ({ writePortalJson: (...a: unknown[]) => writePortalJson(...a) }))` with `const writePortalJson = vi.fn()` declared above the mocks:
  - success path: `publishDigest2` resolves → `writePortalJson` called once with `(db, 1)` (league id of round 152's season in the fixture), response has no `portalWarning`.
  - portal failure: `writePortalJson` rejects `new Error('disk full')` → still 200 with `url`, and `portalWarning` contains `disk full`.
  - publish failure (422): `writePortalJson` NOT called.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** In the publish endpoint after `const result = await publishDigest2(roundId)`:

```ts
	let portalWarning: string | undefined;
	try {
		const leagueId = (db.prepare(
			'SELECT s.league_id AS id FROM rounds r JOIN seasons s ON s.id = r.season_id WHERE r.id = ?'
		).get(roundId) as { id: number }).id;
		await writePortalJson(db, leagueId);
	} catch (e) {
		portalWarning = `Published, but the league portal list was not updated: ${e instanceof Error ? e.message : String(e)}`;
		console.warn('[digest2] portal.json write failed', e);
	}
	return json(portalWarning ? { ...result, portalWarning } : result);
```

In `publishSite` after `await writePublicArtifacts(slug, readModel);` and in the Update endpoint after its `await writePublicArtifacts(site.slug, finalModel);` add:

```ts
	await writePortalJson(db, leagueId).catch((e) => console.warn('[portal] portal.json write failed', e));
```

In `AdminBar.svelte` add `let warn = $state('');`, set `warn = body.portalWarning ?? ''` after a successful publish, and render `{#if warn}<p class="d2-admin-err">{warn}</p>{/if}` under the link.

- [ ] **Step 4: Run** `cd ui && npx vitest run "src/routes/api/digest2" src/lib/dashboard/publish.test.ts "src/routes/api/content"` → new tests PASS, no new failures; `npm run check` 0 errors. If `publish.test.ts` asserts the exact set of written files, extend it to expect `portal.json` rather than weakening it.

- [ ] **Step 5: Commit** `feat(portal): refresh portal.json on 2.0 finalize, b-side publish and Update`

---

### Task 4: Season settings endpoint + Content-tab inputs

**Files:**
- Create: `ui/src/routes/api/portal/[leagueId]/season/+server.ts`, `.../season/server.test.ts`
- Modify: `ui/src/routes/content/+page.server.ts`, `ui/src/routes/content/+page.svelte`

**Interfaces:**
- Consumes: `getSeasonSettings`, `setSeasonSettings`, `writePortalJson` (Task 2).
- Produces: `GET /api/portal/:leagueId/season` → `{ feedUrl, hubUrl }`; `PUT` body `{ feedUrl: string|null, hubUrl: string|null }` → `{ ok: true, portalWritten: boolean, warning?: string }`; 400 invalid id/url/body; 404 unknown league. Content load data gains `seasonSettings: Record<number, { feedUrl: string | null; hubUrl: string | null }>`.

- [ ] **Step 1: Failing tests** (pattern: `routes/api/digest/[roundId]/notes/server.test.ts` — in-memory DB with `SCHEMA`, `vi.mock('$lib/db/client.js', () => ({ getDb: () => db }))`; mock `$lib/portal/portalJson.js`'s `writePortalJson` only, keep real get/set via `importOriginal`):
  - GET unknown league → 404; GET returns stored values.
  - PUT `{ feedUrl: 'http://x', hubUrl: null }` → 400, nothing stored.
  - PUT valid → stored, `writePortalJson` called with `(db, leagueId)`, `{ ok: true, portalWritten: true }`.
  - PUT valid but `writePortalJson` resolves `null` (no b-side) → `portalWritten: false`.
  - PUT valid but `writePortalJson` rejects → `{ ok: true, portalWritten: false, warning }` (settings still saved).

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the endpoint (validate `Number.isInteger(id) && id > 0`; league exists; body fields are `string | null`; map `setSeasonSettings` throws → 400).

- [ ] **Step 4: Content tab.** In `+page.server.ts` add `seasonSettings` (for each league id from the leagues list, `getSeasonSettings(db, id)`). In `+page.svelte`, inside each league card (the `{#each leagues as league, i (league.id)}` block, near the "Publish b-side →" button) add a compact "Player portal — Season" form: two `<input type="url">` (Season feed URL, Season hub URL) prefilled from `data.seasonSettings[league.id]`, a Save button → `fetch('/api/portal/${league.id}/season', { method: 'PUT', … })`, and a one-line status (Saved · portal updated / Saved · no b-side yet / error text). Match existing card styling (`ct-*` classes); no new global CSS.

- [ ] **Step 5: Run** endpoint tests PASS; `npm run check` 0 errors.

- [ ] **Step 6: Commit** `feat(portal): per-league season feed/hub URL settings on the Content tab`

---

### Task 5: Survey feed normalizer (pure, privacy-safe)

**Files:**
- Create: `bside/src/lib/seasonFeed.ts`, `ui/src/lib/portal/seasonFeed.test.ts` (imports `../../../../bside/src/lib/seasonFeed.ts`)

**Interfaces:**
- Produces (exported from `bside/src/lib/seasonFeed.ts`):
  ```ts
  export interface SeasonRound { round: number; status: 'revealed' | 'teaser';
    title: string; description: string | null;          // teaser → teaser.title / teaser.description
    commentRule: { level: 'required' | 'suggested'; prompt: string; hiddenUntilVotingEnds: boolean } | null;
    credit: string[]; revealAt: string | null; startsAt: string | null; songsDue: string | null; votesDue: string | null; }
  export interface SeasonPollOpen { id: string; round: number | null; question: string; blurb: string | null;
    options: { id: string; label: string; description: string | null }[]; closesAt: string | null; }
  export interface SeasonPollClosed { id: string; round: number | null; question: string; blurb: string | null;
    results: { label: string; votes: number }[]; winner: string | null; closedAt: string | null; }
  export interface SeasonFeed { leagueName: string; season: number; surveyOpen: boolean;
    links: { hub: string | null; polls: string | null; mine: string | null; survey: string | null };
    lineup: SeasonRound[]; pollsOpen: SeasonPollOpen[]; pollsClosed: SeasonPollClosed[]; }
  export function normalizeSeasonFeed(raw: unknown): SeasonFeed | null;
  ```

- [ ] **Step 1: Failing tests** — `ui/src/lib/portal/seasonFeed.test.ts` covering:
  - a valid v1 body (copy the §6 example from the spec, filled in) → normalized; lineup sorted by `round`; closed results sorted by votes desc.
  - **teaser privacy:** a teaser round whose raw object also (wrongly) carries `title: 'SECRET'`, `description: 'SECRET'`, `credit: ['X']`, `commentRule: {…}` → normalized `title`/`description` come only from `teaser`, `credit` is `[]`, `commentRule` is `null`; `JSON.stringify(result)` does not contain `SECRET`.
  - teaser with empty `teaser.title` → `title: 'Mystery round'`.
  - `version: 2` → `null`; non-object / missing `lineup` → `null`; missing optional fields → defaults (`[]`, `null`, `false`).
  - link fields that are not `https://` URLs → `null` (never rendered as links).
- [ ] **Step 2: Run** `cd ui && npx vitest run src/lib/portal/seasonFeed.test.ts` → FAIL.
- [ ] **Step 3: Implement** `normalizeSeasonFeed` as a defensive, dependency-free parser: accept only `version === 1`; coerce strings with a `str(x): string | null` helper; `https(x)` returns the string only if `new URL(x).protocol === 'https:'`; for `status === 'teaser'` build the round ONLY from `round`, `teaser`, `revealAt` and the three dates (ignore every other field); sort as specified.
- [ ] **Step 4: Run** → PASS; `cd bside && npm run check` 0 errors.
- [ ] **Step 5: Commit** `feat(portal): privacy-safe normalizer for the survey season feed`

---

### Task 6: b-side portal shell — nav, Digests, Home button, Season screen

**Files:**
- Create: `bside/src/lib/portal.ts`, `bside/src/lib/atoms/PortalNav.svelte`, `bside/src/routes/SeasonScreen.svelte`
- Modify: `bside/src/App.svelte`, `bside/src/lib/types.ts` (`Nav` gains `goSeason`), `bside/src/routes/HomeScreen.svelte`, `bside/src/routes/ArchiveScreen.svelte`, `bside/src/routes/ProfileScreen.svelte` (nav only)

**Interfaces:**
- Consumes: `normalizeSeasonFeed`, `SeasonFeed` (Task 5); `portal.json` shape (Task 2).
- Produces: `bside/src/lib/portal.ts`: `export interface PortalJson {…}` (mirror of Task 2, `version: 1`), `export async function loadPortal(slug: string): Promise<PortalJson | null>` (fetch `/${slug}/portal.json`, `null` on any failure or `version !== 1`), `export function digestsFor(readModel, portal): PortalDigestView[]` (portal digests if present, else `readModel.archive` mapped with `digestUrl` and `roundId: null`).

- [ ] **Step 1: `portal.ts`** with `loadPortal` + `digestsFor` (pure; tested via a small case added to `ui/src/lib/portal/seasonFeed.test.ts`: `digestsFor` prefers portal digests, falls back to archive when portal is null).
- [ ] **Step 2: Routing.** In `App.svelte`: add `{ screen: 'season' }` (path `/<slug>/season`), `nav.goSeason`, load `portal` via `loadPortal(slug)` in parallel with the read model (portal failure never blocks rendering). Pass `portal` to Home/Archive/Season.
- [ ] **Step 3: `PortalNav.svelte`** — a slim tab row (Home · Digests · Season) using existing tokens (`--ink-*`, `--mash-pulp`, Bricolage/Inter Tight); active tab highlighted; Season tab rendered only when `portal?.seasonFeedUrl || portal?.seasonHubUrl`. Place it at the top of Home, Archive (replace the back button row, keep the `the b/side` mark), Profile (keep its back button), and Season.
- [ ] **Step 4: Digests.** `ArchiveScreen.svelte` renders `digestsFor(readModel, portal)` grouped by season newest first (same card markup); hero eyebrow text "The digests"; a card with no `digestUrl` renders as a non-link card with a muted "No digest" note.
- [ ] **Step 5: Home.** In the latest-round section add a primary button "Read the latest digest →" linking (plain `<a href>`) to the first `digestsFor(...)` entry with a `digestUrl`; omit the button if none.
- [ ] **Step 6: `SeasonScreen.svelte`.** On mount: if `portal.seasonFeedUrl`, `fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(8000) })` → `normalizeSeasonFeed(await res.json())`. Render:
  - Header: league name + "Season <n>".
  - "Add themes" button (→ `links.survey`) when `surveyOpen`.
  - Open polls: question, blurb, options list, closes date, "Vote →" (→ `links.polls`).
  - Lineup cards in round order: revealed → title, description, comment-rule chip ("Comment required/suggested: <prompt>"), credit ("Theme by A, B"), dates (songs due / votes due, formatted in the viewer's locale); teaser → teaser title/description, dashed border, "🔒 Revealed <date>" when `revealAt`.
  - Closed polls: question, results bars (votes), winner chip.
  - Footer link "Open the season hub →" (→ `links.hub ?? portal.seasonHubUrl`).
  - Failure / null normalize / no feed URL → only the "Open the season hub →" card (from `portal.seasonHubUrl`).
  All external links are plain `<a href>` to the normalized https URLs. No `{@html}` with feed text.
- [ ] **Step 7: Build + check.** `cd bside && npm run check` (0 errors) and `npm run build` (succeeds). Run `grep -rE "mlb[0-9]+|192\.168\." bside/dist || echo clean` → `clean`.
- [ ] **Step 8: Commit** `feat(bside): portal shell — nav, digests from portal.json, latest-digest button, live season screen`

---

### Task 7 (survey session — boarz-season-2-survey repo): feed, CORS, nav strip

Owned and implemented by the boarz-season-2-survey session in `~/Projects/boarz-season-2-survey`, per spec §6 (commit `4c83c74` or later). This plan's executors do **not** edit that repo. Acceptance criteria the survey session signs off on and proves with its own tests:

- [ ] `GET /feed/second-best/season-3.json` and `/feed/boarz/season-2.json` return the §6 v1 body from the **published** season; headers `Access-Control-Allow-Origin: https://digest.mattmariani.com`, `Vary: Origin`, `Cache-Control: public, max-age=60`; no cookies read or set; 404 for unknown league/season.
- [ ] Privacy: teaser rounds carry only `round, status, teaser{title,description}, revealAt, startsAt, songsDue, votesDue`; open polls carry no counts/ballots; draft polls absent; `credit` arrays only for revealed rounds.
- [ ] `portalUrl` per league: Second Best → `https://digest.mattmariani.com/yFfer5bePejN4PRXvgAfMg/`, Boarz → `https://digest.mattmariani.com/U7o8L06wfe1HILD1qzk-wg/`.
- [ ] Nav strip on player pages (b-side tokens per spec §6) with "← <League> league page" → `portalUrl`.
- [ ] Deployed (`docker compose up -d --build` in that repo) and reachable at the public URLs; reply to the lead with the deployed commit.

---

### Task 8 (controller): settings, deploy, smoke

- [ ] **Step 1: Merge + graph check.** Fast-forward `master`; `node .gitnexus/run.cjs analyze --index-only` then `detect-changes --scope compare --base-ref <pre-Task-1 commit>`; report risk and any HIGH/CRITICAL with explanation.
- [ ] **Step 2: Deploy bot-ui** (serialized, main checkout on master): `docker compose build bot-ui && docker compose up -d --force-recreate bot-ui`; bundle-grep the client for `Player portal — Season`.
- [ ] **Step 3: Deploy b-side bundle:** `cd bside && npm run build && cp -r dist/* ../digests/_bside/` (match the existing `_bside/` file names `bside.js` / `bside.css`; verify with `ls digests/_bside`).
- [ ] **Step 4: Seed settings** via the new endpoint (LAN): Second Best (league 3) feed `https://mlsurvey.mattmariani.com/feed/second-best/season-3.json`, hub `https://mlsurvey.mattmariani.com/second-best/season-3/`; Boarz (league 5) feed `…/feed/boarz/season-2.json`, hub `…/boarz/season-2/`. Write portal.json for leagues 1, 2, 3, 5 (`PUT` triggers it; for 1 and 2 PUT nulls).
- [ ] **Step 5: Smoke.**
  - `curl https://digest.mattmariani.com/U7o8L06wfe1HILD1qzk-wg/portal.json` → 200; round 152 entry has `digestKind: "v2"` and the `/d2/SZiywbU_DJQ1q0Is` link; `grep -c mlb13` → 0.
  - Browser (Playwright): Boarz portal Home shows "Read the latest digest →" → `/d2/…`; Digests lists all rounds; Season tab renders (live feed after Task 7 ships; before that, the fallback hub link); request-log hosts ⊆ {digest.mattmariani.com, mlsurvey.mattmariani.com, i.scdn.co, static.cloudflareinsights.com}.
  - Re-publish a 2.0 digest → portal.json `generatedAt` changes within seconds.
- [ ] **Step 6: Report** results; do not push.
