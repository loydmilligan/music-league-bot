#!/usr/bin/env node
/**
 * ml-comment-sync — wire the voting-page comment fetcher to the DB (spec §7.2).
 *
 *   node scripts/ml-comment-sync.mjs --round <dbRoundId> [--league <mlLeagueId>]
 *
 * Spawns scripts/ml-vote-comments.py for the round, converts its snake_case
 * JSON into the camelCase shape applyComments() expects, and applies it.
 * Run it from the repo root; LEAGUE_DB overrides the DB path (default
 * data/league.db), exactly as in ml-reconcile.mjs / ml-rebuild.mjs.
 *
 * IDS: --round is the LOCAL DB rounds.id (an integer). The fetcher speaks
 * Music League ids, so the 32-char hex `rounds.ml_round_id` is looked up here;
 * a round with no ml_round_id (zip/CSV-imported) cannot be fetched and says so.
 * --league is the ML LEAGUE id, optional — the fetcher auto-resolves it by
 * scanning the owner's current leagues, which costs a page fetch per league and
 * cannot find a finished season. Pass it when you know it.
 *
 * INTERPRETER: the fetcher needs both `bs4` and `cli_web`; as of 2026-09-01 the
 * only interpreter here with both is ~/Projects/ttstt/venv/bin/python3. Override
 * with ML_COMMENT_PYTHON=/path/to/python3.
 *
 * SAFETY: the fetcher is GET-only against the owner's real Music League
 * account, and reads /vote/ (anonymous) — never /-/results, which would name
 * submitters and leak the guessing game's answers. Nothing here writes to ML.
 *
 * FAILURE IS DATA: a failed or stale scrape must not block the sitting. Any
 * failure — missing interpreter, expired session, closed ballot, garbled JSON —
 * is handed to applyComments as { ok: false, error }, which records it on
 * guess_round_state.comments_error and leaves every existing comment intact.
 * The process still exits non-zero so a caller can see something went wrong.
 *
 * Exit codes: 0 = comments applied; 1 = fetch failed (recorded on the round);
 * 2 = bad arguments / round not fetchable (nothing written); 3 = applied but
 * some uris matched no submission row (see the `unmatched` list).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DB_PATH = process.env.LEAGUE_DB ?? resolve(REPO_ROOT, 'data/league.db');

// ---------------------------------------------------------------------------
// TypeScript, from a .mjs host script.
//
// There is no build output for ui/src, and this script needs two of its
// modules: applyComments (whose COALESCE(?, comment) write is the thing that
// stops a ballot's nulls from erasing submitter-hidden comments) and
// openLeagueDb (the repo's one DB opener — it also CREATES guess_round_state,
// which a DB that has not yet booted the current app does not have).
//
// Node 22's built-in type stripping can load commentFetch.ts on its own, but
// NOT db/client.ts, whose runtime imports use TS-style `.js` specifiers that
// resolve to `.ts` files. So the script re-execs itself once under tsx (already
// a root devDependency, used by every `tsx scripts/*.ts` in package.json).
// That keeps the plain `node scripts/ml-comment-sync.mjs …` invocation working.
// ---------------------------------------------------------------------------
const TSX_LOADER = resolve(REPO_ROOT, 'node_modules/tsx/dist/loader.mjs');
if (!process.env.ML_COMMENT_SYNC_TSX) {
	if (!existsSync(TSX_LOADER)) {
		console.error(`ml-comment-sync: tsx not installed at ${TSX_LOADER}; run npm install at the repo root`);
		process.exit(2);
	}
	const child = spawnSync(
		process.execPath,
		['--import', pathToFileURL(TSX_LOADER).href, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
		{ cwd: REPO_ROOT, stdio: 'inherit', env: { ...process.env, ML_COMMENT_SYNC_TSX: '1' } }
	);
	process.exit(child.status ?? 1);
}

const { applyComments } = await import('../ui/src/lib/guessing/commentFetch.ts');
const { toCommentPayload, countComments } = await import('../ui/src/lib/guessing/commentPayload.ts');
const { openLeagueDb } = await import('../ui/src/lib/db/client.ts');
const FETCHER = resolve(REPO_ROOT, 'scripts/ml-vote-comments.py');
const PYTHON = process.env.ML_COMMENT_PYTHON ?? '/home/loydmilligan/Projects/ttstt/venv/bin/python3';

const args = process.argv.slice(2);
const roundArg = flag('--round');
const leagueArg = flag('--league');

function flag(name) {
	const i = args.indexOf(name);
	return i === -1 ? null : args[i + 1] ?? null;
}

function die(msg) {
	console.error(`ml-comment-sync: ${msg}`);
	process.exit(2);
}

if (!roundArg || !/^\d+$/.test(roundArg)) {
	die('usage: node scripts/ml-comment-sync.mjs --round <dbRoundId> [--league <mlLeagueId>]');
}
if (leagueArg !== null && !/^[0-9a-f]{32}$/i.test(leagueArg)) {
	die(`--league must be a 32-char hex Music League id, got "${leagueArg}"`);
}

const dbRoundId = Number(roundArg);
const db = openLeagueDb(DB_PATH);

const round = db
	.prepare('SELECT id, ml_round_id, name, season_id FROM rounds WHERE id = ?')
	.get(dbRoundId);
if (!round) die(`no round with id ${dbRoundId} in ${DB_PATH}`);
if (!round.ml_round_id || !/^[0-9a-f]{32}$/i.test(round.ml_round_id)) {
	die(
		`round ${dbRoundId} ("${round.name ?? ''}") has no Music League round id ` +
			`(ml_round_id = ${round.ml_round_id ?? 'NULL'}); there is no voting page to fetch. ` +
			'Run scripts/ml-reconcile.mjs --apply to backfill it.'
	);
}

const mlRoundId = round.ml_round_id;
console.log(`Round ${dbRoundId} "${round.name ?? ''}" → ML round ${mlRoundId}`);
console.log(`DB: ${DB_PATH}`);

const raw = await fetchComments(mlRoundId, leagueArg);
const payload = toCommentPayload(raw);
const now = new Date().toISOString();
const res = applyComments(db, dbRoundId, payload, now);

if (!payload.ok) {
	console.error(`\n✗ fetch failed: ${payload.error}`);
	console.error('  Recorded on guess_round_state.comments_error; no comments were changed.');
	process.exit(1);
}

const fetched = payload.songs?.length ?? 0;
const comments = countComments(payload.songs ?? []);
console.log(`\n✓ ${fetched} songs fetched, ${comments} with comments`);
console.log(`  ${res.updated} submission row(s) matched and written`);
if (res.unmatched.length) {
	console.log(`  ⚠ ${res.unmatched.length} uri(s) matched NO submission row in round ${dbRoundId}:`);
	for (const uri of res.unmatched) console.log(`      ${uri}`);
	console.log('    (wrong round id, or this round\'s submissions are not imported yet)');
	process.exit(3);
}

/**
 * Run the Python fetcher and return its parsed JSON. Every failure mode —
 * missing interpreter, non-zero exit, non-JSON stdout — comes back as an
 * ok:false object rather than throwing, so the caller always has something to
 * record. The fetcher itself always exits 0 once its args parse.
 */
function fetchComments(mlRound, mlLeague) {
	const argv = [FETCHER, '--round', mlRound, ...(mlLeague ? ['--league', mlLeague] : [])];
	return new Promise((res) => {
		const proc = spawn(PYTHON, argv, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		proc.stdout.on('data', (c) => (stdout += c));
		proc.stderr.on('data', (c) => (stderr += c));
		proc.on('error', (err) => res({ ok: false, error: `could not run ${PYTHON}: ${err.message}` }));
		proc.on('close', (code) => {
			if (code !== 0) {
				return res({
					ok: false,
					error: `fetcher exit ${code}: ${(stderr || stdout).trim().slice(0, 300)}`
				});
			}
			try {
				res(JSON.parse(stdout));
			} catch {
				res({ ok: false, error: `fetcher emitted non-JSON: ${stdout.trim().slice(0, 200)}` });
			}
		});
	});
}
