#!/usr/bin/env node
/**
 * ml-reconcile — diff the DB's view of each league/season/round against the
 * live state from cli-web-musicleague.
 *
 * Read-only by default. Pass `--apply` to actually write the diffs back.
 *
 * Mapping is by slug → ML league name (currently hard-coded, fine for 4
 * leagues). A future iteration adds an `ml_league_id` column.
 */
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DB_PATH = process.env.LEAGUE_DB ?? resolve(REPO_ROOT, 'data/league.db');
const APPLY = process.argv.includes('--apply');

// Slug → ML league name pattern (substring match, lowercase)
const SLUG_TO_ML_NAME = {
	'nostalgia-pit': 'nostalgia pit',
	'hip-jammers':   'hip jammers',
	'second-best':   'second best',
	'fam-jam':       'fam jam'
};

const db = new Database(DB_PATH, { readonly: !APPLY });

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

async function main() {
	const mlLeagues = await cli(['leagues', 'list']);
	console.log(`\nML reports ${mlLeagues.length} current leagues:`);
	for (const l of mlLeagues) console.log(`  ${l.id.slice(0, 8)}  ${l.name}`);

	const dbLeagues = db.prepare('SELECT id, slug, name FROM leagues').all();
	console.log(`\nDB has ${dbLeagues.length} leagues: ${dbLeagues.map((l) => l.slug).join(', ')}`);

	for (const dbL of dbLeagues) {
		const needle = SLUG_TO_ML_NAME[dbL.slug];
		if (!needle) {
			console.log(`\n[${dbL.slug}] (no slug→ML mapping; skipping)`);
			continue;
		}
		const mlL = mlLeagues.find((l) => l.name.toLowerCase().includes(needle));
		if (!mlL) {
			console.log(`\n[${dbL.slug}] (no live league named like "${needle}"; skipping)`);
			continue;
		}
		await reconcileLeague(dbL, mlL);
	}

	console.log(APPLY ? '\nApplied changes.' : '\nDry-run. Re-run with --apply to write changes.');
}

async function reconcileLeague(dbL, mlL) {
	console.log(`\n=== [${dbL.slug}] ↔ "${mlL.name}" (${mlL.id.slice(0, 8)}) ===`);

	const themes = await cli(['rounds', 'themes', mlL.id]);
	// Themes have richer data (UTC deadlines); fall back to `rounds list` if not commissioner
	const haveThemes = themes.length > 0;
	const rounds = haveThemes ? themes : await cli(['rounds', 'list', mlL.id]);
	if (!rounds.length) {
		console.log('  (live ML returned no rounds)');
		return;
	}

	// Active season = the season this ML league corresponds to (max season_number for now)
	const seasons = db
		.prepare('SELECT id, season_number, status FROM seasons WHERE league_id = ? ORDER BY season_number')
		.all(dbL.id);
	if (!seasons.length) {
		console.log(`  ⚠ DB has no seasons for ${dbL.slug}; live ML has ${rounds.length} rounds.`);
		console.log('    → SUGGEST: create new season row + rounds (skipping in dry-run)');
		return;
	}
	const dbSeason = seasons[seasons.length - 1];
	const dbRounds = db
		.prepare(
			'SELECT id, ml_round_id, name, description, submission_deadline, voting_deadline FROM rounds WHERE season_id = ? ORDER BY id'
		)
		.all(dbSeason.id);

	console.log(
		`  DB season ${dbSeason.season_number} (${dbSeason.status}) has ${dbRounds.length} rounds; ` +
			`ML has ${rounds.length} rounds`
	);

	// Match by round number (ML themes have `number`; rounds list has `number`)
	for (const mlR of rounds) {
		const num = mlR.number;
		const dbR = dbRounds[num - 1]; // 1-indexed
		const diffs = [];
		if (!dbR) {
			diffs.push('NOT IN DB — would INSERT');
		} else {
			if (!dbR.ml_round_id || dbR.ml_round_id.startsWith('csv-')) {
				diffs.push(`ml_round_id: ${dbR.ml_round_id ?? '(none)'} → ${mlR.id}`);
			} else if (dbR.ml_round_id !== mlR.id) {
				diffs.push(`ml_round_id MISMATCH: db=${dbR.ml_round_id} live=${mlR.id}`);
			}
			if ((dbR.name ?? '') !== mlR.name) {
				diffs.push(`name: "${dbR.name ?? ''}" → "${mlR.name}"`);
			}
			if ((dbR.description ?? '') !== (mlR.description ?? '')) {
				diffs.push(
					`description: ${snippet(dbR.description)} → ${snippet(mlR.description)}`
				);
			}
			const liveSub = haveThemes ? mlR.submissions_due_utc : mlR.deadline_iso;
			const liveVote = haveThemes ? mlR.votes_due_utc : null;
			if (liveSub && (dbR.submission_deadline ?? '') !== liveSub) {
				diffs.push(`submission_deadline: ${dbR.submission_deadline ?? '(null)'} → ${liveSub}`);
			}
			if (liveVote && (dbR.voting_deadline ?? '') !== liveVote) {
				diffs.push(`voting_deadline: ${dbR.voting_deadline ?? '(null)'} → ${liveVote}`);
			}
		}

		if (diffs.length === 0) {
			console.log(`  ✓ round ${num} "${mlR.name}" — in sync`);
		} else {
			console.log(`  Δ round ${num} "${mlR.name}"`);
			for (const d of diffs) console.log(`      ${d}`);
		}

		if (APPLY && dbR) {
			const liveSub = haveThemes ? mlR.submissions_due_utc : mlR.deadline_iso;
			const liveVote = haveThemes ? mlR.votes_due_utc : null;
			db.prepare(
				`UPDATE rounds
				 SET ml_round_id = ?,
				     name = ?,
				     description = ?,
				     submission_deadline = COALESCE(?, submission_deadline),
				     voting_deadline = COALESCE(?, voting_deadline)
				 WHERE id = ?`
			).run(mlR.id, mlR.name, mlR.description ?? null, liveSub ?? null, liveVote ?? null, dbR.id);
		}
	}

	// Surface ML rounds beyond what DB has
	if (rounds.length > dbRounds.length) {
		const extra = rounds.slice(dbRounds.length);
		console.log(`  ⚠ ${extra.length} live round(s) past DB end — would INSERT in --apply mode:`);
		for (const r of extra) console.log(`      ${r.number}: ${r.name}`);
	}
}

function snippet(s) {
	if (!s) return '(empty)';
	return JSON.stringify(s.slice(0, 60) + (s.length > 60 ? '…' : ''));
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
			} catch (err) {
				reject(new Error(`cli ${args.join(' ')} non-JSON: ${stdout.slice(0, 200)}`));
			}
		});
	});
}
