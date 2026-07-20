#!/usr/bin/env node
/**
 * ml-rebuild — reconcile DB seasons against live ML state via name-match upsert.
 *
 * Algorithm per target season:
 *   1. Pull live rounds via CLI (themes view; falls back to rounds list).
 *   2. Drop ML rounds named "TBD" (case-insensitive) — user explicitly wants
 *      only real themed rounds in the DB.
 *   3. Match each surviving ML round to a DB round in this season by case-
 *      insensitive name. Matched DB rounds get UPDATED in place (preserves
 *      row id, votes, ml_submissions, research_songs, head_to_head_matches).
 *   4. ML rounds with no DB match → INSERT.
 *   5. DB rounds with no ML match → DELETE, but ONLY if data-free (empty-name
 *      CSV corruption rows). A round with votes/submissions is never deleted;
 *      if the plan wants to, the season aborts with no writes (wrong-league
 *      backstop). Their dependent rows go with them.
 *   6. Flip the season's status → active.
 *
 * Dry-run by default. Pass --apply to write. Always backs up the DB first.
 */
import { spawn } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DB_PATH = process.env.LEAGUE_DB ?? resolve(REPO_ROOT, 'data/league.db');
const APPLY = process.argv.includes('--apply');

// Per-season targets. INVARIANTS (see the reconcile-safety guards below):
//   1. Every target MUST pin an exact live `mlLeagueId`. Name-substring matching
//      is unsafe now that most leagues have several live seasons sharing a name
//      ("Second Second Best" contains "second best"; three "Hip Jammers *"
//      leagues all match "hip jammers") — a bare needle resolves to the WRONG
//      season and would delete the rounds of a completed one.
//   2. Only *in-progress* (status='active') seasons belong here. A completed
//      season has nothing to sync and everything to lose; leaving one in this
//      list is how second-best S1 became a data-loss landmine (2026-07-19).
// To retire a season, DELETE its line here the moment it completes.
const TARGETS = [
	{ slug: 'fam-jam',      season: 4, mlLeagueId: 'd3d3b2046a2c4c639976ca2621a8afa3' }, // Fam Jam IV: Uncharted Tracks
	{ slug: 'second-best',  season: 2, mlLeagueId: '78b2e6400520468e8d726e8793127fb0' }, // Second Second Best
	{ slug: 'boarz-ii-men', season: 1, mlLeagueId: '71598b6952064ca4afe4baf437495604' }  // Boarz II Men
	// hip-jammers S3 retired 2026-07-19 — its ML league completed (drops off the
	// default `leagues list`). Add the next season here, pinned, when it starts.
];

function normName(s) {
	return (s ?? '').trim().toLowerCase();
}
function isTbd(name) {
	return /^tbd$/i.test((name ?? '').trim());
}

const db = new Database(DB_PATH);

main().catch((err) => {
	console.error('FAILED:', err);
	process.exit(1);
});

async function main() {
	if (APPLY) {
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const backupPath = `${DB_PATH}.backup-${stamp}`;
		copyFileSync(DB_PATH, backupPath);
		console.log('Backed up DB → ' + backupPath);
	} else {
		console.log('DRY-RUN mode. Use --apply to actually write.');
	}

	const mlLeagues = await cli(['leagues', 'list']);

	for (const target of TARGETS) {
		// Invariant 1: pin required. Never resolve by name substring — a needle can
		// match several live seasons and mis-resolve to the wrong one.
		if (!target.mlLeagueId) {
			throw new Error(`[${target.slug} s${target.season}] target has no mlLeagueId — refusing to name-match (unsafe). Pin the exact live league id.`);
		}
		const mlL = mlLeagues.find((l) => l.id === target.mlLeagueId);
		if (!mlL) {
			console.log(`\n[${target.slug} s${target.season}] pinned league ${target.mlLeagueId.slice(0, 8)} not in live list — skipping`);
			continue;
		}
		await reconcileSeason(target.slug, target.season, mlL);
	}

	console.log('\nDone.');
}

async function reconcileSeason(slug, seasonNumber, mlL) {
	console.log(`\n=== ${slug} s${seasonNumber} ↔ ML "${mlL.name}" ===`);

	const dbLeague = db.prepare('SELECT id FROM leagues WHERE slug = ?').get(slug);
	if (!dbLeague) {
		console.log('  ⚠ slug missing in DB');
		return;
	}
	const season = db
		.prepare('SELECT id, status FROM seasons WHERE league_id = ? AND season_number = ?')
		.get(dbLeague.id, seasonNumber);
	if (!season) {
		console.log(`  ⚠ s${seasonNumber} missing in DB`);
		return;
	}

	// Live data — prefer themes (commissioner view; has both UTC deadlines + descriptions)
	let themes = [];
	try {
		themes = await cli(['rounds', 'themes', mlL.id]);
	} catch {}
	const haveThemes = themes.length > 0;
	const live = haveThemes ? themes : await cli(['rounds', 'list', mlL.id]);
	const realLive = live.filter((r) => !isTbd(r.name)).sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
	console.log(`  Live: ${live.length} rounds, ${realLive.length} real (TBDs filtered)`);

	const dbRounds = db
		.prepare('SELECT id, ml_round_id, name FROM rounds WHERE season_id = ? ORDER BY id')
		.all(season.id);
	console.log(`  DB s${seasonNumber} (${season.status}): ${dbRounds.length} rounds existing`);

	// Plan: pair each ML round with a DB round (by name). Track unmatched on both sides.
	const dbByName = new Map();
	for (const r of dbRounds) {
		const n = normName(r.name);
		if (!n) continue;
		if (!dbByName.has(n)) dbByName.set(n, []);
		dbByName.get(n).push(r);
	}
	const plan = { updates: [], inserts: [], deletes: [] };
	const usedDb = new Set();
	for (const mlR of realLive) {
		const candidates = dbByName.get(normName(mlR.name)) ?? [];
		const match = candidates.find((c) => !usedDb.has(c.id));
		if (match) {
			usedDb.add(match.id);
			plan.updates.push({ dbId: match.id, dbName: match.name, mlR });
		} else {
			plan.inserts.push(mlR);
		}
	}
	for (const r of dbRounds) {
		if (!usedDb.has(r.id)) {
			plan.deletes.push(r);
		}
	}

	// Delete safety: the DELETE branch exists ONLY to sweep empty-name CSV
	// corruption rows. A round carrying real data (votes or ML submissions) must
	// never be deleted by a reconcile — if the plan wants to, the target
	// mis-resolved and we ABORT rather than destroy data (see applyPlan()).
	const dataCount = db.prepare(
		'SELECT (SELECT count(*) FROM votes WHERE round_id = @id) + (SELECT count(*) FROM ml_submissions WHERE round_id = @id) AS n'
	);
	const hasData = (id) => dataCount.get({ id }).n > 0;
	plan.safeDeletes = plan.deletes.filter((d) => !hasData(d.id));
	plan.unsafeDeletes = plan.deletes.filter((d) => hasData(d.id));

	console.log(`  Plan: ${plan.updates.length} update, ${plan.inserts.length} insert, ${plan.safeDeletes.length} delete` +
		(plan.unsafeDeletes.length ? `, ${plan.unsafeDeletes.length} UNSAFE-DELETE (would abort)` : ''));
	for (const u of plan.updates)
		console.log(`     ↻ "${u.dbName}" id=${u.dbId} → ml=${u.mlR.id.slice(0, 8)}`);
	for (const i of plan.inserts) console.log(`     + #${i.number} "${i.name}"`);
	for (const d of plan.safeDeletes) console.log(`     − id=${d.id} "${d.name || '(empty)'}" (no data — safe)`);
	for (const d of plan.unsafeDeletes) console.log(`     ⛔ id=${d.id} "${d.name}" has votes/submissions — WOULD ABORT`);

	if (!APPLY) return;

	// Invariant 2 backstop: refuse to write anything for this season if the plan
	// would delete a round with real data (target resolved to the wrong league).
	if (plan.unsafeDeletes.length) {
		throw new Error(
			`[${slug} s${seasonNumber}] refusing to delete ${plan.unsafeDeletes.length} round(s) carrying votes/submissions ` +
			`(${plan.unsafeDeletes.map((d) => `#${d.id} "${d.name}"`).join(', ')}). ` +
			`The target likely resolved to the wrong ML league — no changes written.`
		);
	}

	const tx = db.transaction(() => {
		// Flip status (skip seasons with a manual override — sprint-26 season-override-fix).
		db.prepare("UPDATE seasons SET status = 'active' WHERE id = ? AND COALESCE(status_source,'derived') != 'manual'").run(season.id);

		// Updates
		const updateStmt = db.prepare(
			`UPDATE rounds
			 SET ml_round_id = ?,
			     name = ?,
			     description = ?,
			     spotify_playlist_url = COALESCE(?, spotify_playlist_url),
			     submission_deadline = COALESCE(?, submission_deadline),
			     voting_deadline = COALESCE(?, voting_deadline)
			 WHERE id = ?`
		);
		for (const u of plan.updates) {
			const r = u.mlR;
			const playlist = r.playlist_id ? `https://open.spotify.com/playlist/${r.playlist_id}` : null;
			const sub = haveThemes ? r.submissions_due_utc : r.deadline_iso;
			const vote = haveThemes ? r.votes_due_utc : null;
			updateStmt.run(r.id, r.name, r.description ?? null, playlist, sub ?? null, vote ?? null, u.dbId);
		}

		// Inserts
		const insertStmt = db.prepare(
			`INSERT INTO rounds
			   (season_id, ml_round_id, name, description, spotify_playlist_url,
			    submission_deadline, voting_deadline, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const now = new Date().toISOString();
		for (const r of plan.inserts) {
			const playlist = r.playlist_id ? `https://open.spotify.com/playlist/${r.playlist_id}` : null;
			const sub = haveThemes ? r.submissions_due_utc : r.deadline_iso;
			const vote = haveThemes ? r.votes_due_utc : null;
			insertStmt.run(season.id, r.id, r.name, r.description ?? null, playlist, sub ?? null, vote ?? null, now);
		}

		// Deletes (kids first) — only the data-free rows; unsafe ones aborted above.
		const ids = plan.safeDeletes.map((d) => d.id);
		if (ids.length) {
			const placeholders = ids.map(() => '?').join(',');
			db.prepare(`DELETE FROM head_to_head_matches WHERE round_id IN (${placeholders})`).run(...ids);
			db.prepare(`DELETE FROM research_songs WHERE round_id IN (${placeholders})`).run(...ids);
			db.prepare(`DELETE FROM votes WHERE round_id IN (${placeholders})`).run(...ids);
			db.prepare(`DELETE FROM ml_submissions WHERE round_id IN (${placeholders})`).run(...ids);
			db.prepare(`DELETE FROM rounds WHERE id IN (${placeholders})`).run(...ids);
		}
	});

	tx();
	console.log(`  ✓ Applied.`);
}

function cli(args) {
	return new Promise((resolve, reject) => {
		const proc = spawn('cli-web-musicleague', ['--json', ...args], {
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let stdout = '';
		let stderr = '';
		proc.stdout.on('data', (c) => (stdout += c));
		proc.stderr.on('data', (c) => (stderr += c));
		proc.on('error', reject);
		proc.on('close', (code) => {
			if (code !== 0) {
				return reject(new Error(`cli ${args.join(' ')} exit ${code}: ${stderr.slice(0, 300)}`));
			}
			try {
				resolve(JSON.parse(stdout));
			} catch {
				reject(new Error(`cli ${args.join(' ')} non-JSON: ${stdout.slice(0, 200)}`));
			}
		});
	});
}
