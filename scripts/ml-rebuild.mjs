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
 *   5. DB rounds with no ML match → DELETE (these are the empty-name CSV
 *      corruption rows). Their dependent rows go with them.
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

const ML_LEAGUE_NAME = {
	'fam-jam': 'fam jam',
	'second-best': 'second best',
	'nostalgia-pit': 'nostalgia pit',
	'hip-jammers': 'hip jammers'
};
const TARGETS = [
	{ slug: 'fam-jam', season: 3 },
	{ slug: 'second-best', season: 1 },
	{ slug: 'nostalgia-pit', season: 1 },
	{ slug: 'hip-jammers', season: 3 }
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
		const needle = ML_LEAGUE_NAME[target.slug];
		const mlL = mlLeagues.find((l) => l.name.toLowerCase().includes(needle));
		if (!mlL) {
			console.log(`\n[${target.slug} s${target.season}] no live ML league matching "${needle}" — skipping`);
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

	console.log(`  Plan: ${plan.updates.length} update, ${plan.inserts.length} insert, ${plan.deletes.length} delete`);
	for (const u of plan.updates)
		console.log(`     ↻ "${u.dbName}" id=${u.dbId} → ml=${u.mlR.id.slice(0, 8)}`);
	for (const i of plan.inserts) console.log(`     + #${i.number} "${i.name}"`);
	for (const d of plan.deletes) console.log(`     − id=${d.id} "${d.name || '(empty)'}"`);

	if (!APPLY) return;

	const tx = db.transaction(() => {
		// Flip status
		db.prepare('UPDATE seasons SET status = ? WHERE id = ?').run('active', season.id);

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

		// Deletes (kids first)
		const ids = plan.deletes.map((d) => d.id);
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
