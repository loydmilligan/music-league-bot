import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { mintSlug } from './slug.js';
import { buildReadModel } from './buildReadModel.js';
import type { ReadModel } from './buildReadModel.js';

// Shared digests volume — same as export.ts; digest-static (caddy) serves it read-only.
const DIGESTS_DIR = process.env.DIGESTS_DIR || '/app/digests';

interface DashboardSiteRow {
	slug: string;
}

// Returns round IDs that have a FINALIZED digest — these are what actually land in the b-side.
// Only these rounds belong in archived_rounds; un-finalized rounds are not baked into the site.
function getArchivedRoundIdsForLeague(db: Database.Database, leagueId: number): number[] {
	return (
		db
			.prepare(
				`SELECT DISTINCT r.id FROM rounds r
			 JOIN seasons se ON se.id = r.season_id
			 JOIN digest_drafts dd ON dd.round_id = r.id
			 WHERE se.league_id = ? AND dd.finalized_at IS NOT NULL
			 ORDER BY r.id`,
			)
			.all(leagueId) as { id: number }[]
	).map((r) => r.id);
}

export async function publishSite(
	db: Database.Database,
	leagueId: number,
): Promise<{ slug: string }> {
	const league = db.prepare('SELECT id FROM leagues WHERE id = ?').get(leagueId) as
		| { id: number }
		| undefined;
	if (!league) throw new Error(`League ${leagueId} not found`);

	// Reuse existing slug if already published, otherwise mint a new one
	const existing = db
		.prepare('SELECT slug FROM dashboard_sites WHERE league_id = ?')
		.get(leagueId) as DashboardSiteRow | undefined;
	const slug = existing?.slug ?? mintSlug();

	const readModel = await buildReadModel(db, leagueId, { slug });
	// archived_rounds is an array of round IDs (numbers) that are in the archive
	const archivedRoundIds = getArchivedRoundIdsForLeague(db, leagueId);
	const now = new Date().toISOString();

	if (existing) {
		db.prepare(
			`UPDATE dashboard_sites
			 SET read_model = ?, archived_rounds = ?, season = ?, refreshed_at = ?
			 WHERE league_id = ?`,
		).run(
			JSON.stringify(readModel),
			JSON.stringify(archivedRoundIds),
			readModel.league.season,
			now,
			leagueId,
		);
	} else {
		db.prepare(
			`INSERT INTO dashboard_sites
			 (slug, league_id, season, read_model, archived_rounds, is_live, published_at, refreshed_at)
			 VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
		).run(
			slug,
			leagueId,
			readModel.league.season,
			JSON.stringify(readModel),
			JSON.stringify(archivedRoundIds),
			now,
			now,
		);
	}

	await writePublicArtifacts(slug, readModel);

	return { slug };
}

// ── Public artifact writes ───────────────────────────────────────────────────
//
// Hosting model (sprint-32): the b-side is a standalone static SPA served ONLY
// by digest-static (caddy on digest.mattmariani.com), NOT by the operator app.
//
// Per-slug layout under DIGESTS_DIR/{slug}/:
//   index.html       — SPA shell that boots the shared b-side bundle
//   read_model.json  — pre-computed read-model; fetched client-side by the SPA
//
// Shared bundle layout under DIGESTS_DIR/_bside/:
//   bside.js         — b-side SPA JS entry (built by `ui/bside` Vite build)
//   bside.css        — b-side SPA styles
//
// The frontend `shell` task builds the b-side app and copies the bundle output
// to DIGESTS_DIR/_bside/ (stable filenames, no content hash in the path —
// cache busting is handled by serving read_model.json with ETag/refreshed_at).
// Build command: `cd ui/bside && npm run build` → dist/ → copy to DIGESTS_DIR/_bside/

export async function writePublicArtifacts(slug: string, readModel: ReadModel): Promise<void> {
	const dir = join(DIGESTS_DIR, slug);
	await mkdir(dir, { recursive: true });
	await Promise.all([
		writeFile(join(dir, 'read_model.json'), JSON.stringify(readModel), 'utf8'),
		writeFile(join(dir, 'index.html'), buildSpaShell(slug), 'utf8'),
	]);
}

function buildSpaShell(slug: string): string {
	// The slug is embedded as a data attribute so the SPA can read it without
	// parsing the URL (avoids hash vs. history-mode ambiguity at boot time).
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>the b-side</title>
  <link rel="stylesheet" href="/_bside/bside.css" />
</head>
<body data-league-slug="${escapeAttr(slug)}">
  <script type="module" src="/_bside/bside.js"></script>
</body>
</html>`;
}

function escapeAttr(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
