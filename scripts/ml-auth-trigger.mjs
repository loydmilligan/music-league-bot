#!/usr/bin/env node
/**
 * ml-auth-trigger — host daemon that bridges container → host CLI invocations.
 *
 * Listens on localhost:7679 by default.
 *
 *   POST /login       — spawn a graphical terminal running `cli-web-musicleague auth login`.
 *   POST /export-zip  — sprint-11 Task A. Run `cli-web-musicleague leagues export`
 *                       host-side and drop the resulting zip into the shared
 *                       data dir so the container can import it.
 *   GET  /health      — heartbeat.
 *
 * The UI in docker reaches this via host.docker.internal:7679 (configured
 * in docker-compose.yml via extra_hosts).
 *
 * Run via systemd user unit (mlb-auth-trigger.service).
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { resolveActiveSourceCompetition } from './lib/mlSource.mjs';

const PORT = Number(process.env.ML_AUTH_TRIGGER_PORT ?? 7679);
const BIND = process.env.ML_AUTH_TRIGGER_BIND ?? '0.0.0.0';
const CLI = process.env.ML_AUTH_TRIGGER_CLI ?? 'cli-web-musicleague';
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DATA_DIR = process.env.ML_AUTH_TRIGGER_DATA_DIR ?? resolve(REPO_ROOT, 'data');
const EXPORT_CLI_TIMEOUT_MS = Number(process.env.ML_EXPORT_CLI_TIMEOUT_MS ?? 90_000);
const LEAGUES_LIST_TIMEOUT_MS = 30_000;

// Detect a graphical terminal. Order matters — prefer modern ones.
const TERMINAL_CANDIDATES = [
	{ bin: 'kitty', args: (cmd) => ['--title', 'ML Auth', 'bash', '-lc', cmd] },
	{ bin: 'wezterm', args: (cmd) => ['start', '--', 'bash', '-lc', cmd] },
	{ bin: 'gnome-terminal', args: (cmd) => ['--title=ML Auth', '--', 'bash', '-lc', cmd] },
	{ bin: 'alacritty', args: (cmd) => ['--title', 'ML Auth', '-e', 'bash', '-lc', cmd] },
	{ bin: 'tilix', args: (cmd) => ['--title=ML Auth', '-e', `bash -lc "${cmd.replace(/"/g, '\\"')}"`] },
	{ bin: 'xfce4-terminal', args: (cmd) => ['--title=ML Auth', '-e', `bash -lc "${cmd.replace(/"/g, '\\"')}"`] },
	{ bin: 'konsole', args: (cmd) => ['--separate', '-p', 'tabtitle=ML Auth', '-e', 'bash', '-lc', cmd] },
	{ bin: 'xterm', args: (cmd) => ['-title', 'ML Auth', '-e', `bash -lc "${cmd.replace(/"/g, '\\"')}"`] }
];

function pickTerminal() {
	const pathDirs = (process.env.PATH ?? '').split(':').filter(Boolean);
	for (const cand of TERMINAL_CANDIDATES) {
		for (const dir of pathDirs) {
			if (existsSync(`${dir}/${cand.bin}`)) return { ...cand, path: `${dir}/${cand.bin}` };
		}
	}
	return null;
}

// The interactive login spawns a HEADED browser, which needs a display. When
// this daemon's systemd user unit starts before the graphical session, the
// service env has no DISPLAY/WAYLAND_DISPLAY — the exact "Missing X server /
// $DISPLAY" failure this sprint fixed. Fall back to the standard XWayland
// display (:0) so the headed terminal+browser can still render. The
// non-interactive path (`auth refresh`) needs no display at all.
const FALLBACK_DISPLAY = process.env.ML_AUTH_TRIGGER_DISPLAY ?? ':0';
function loginEnv() {
	const env = { ...process.env };
	if (!env.DISPLAY && !env.WAYLAND_DISPLAY) {
		env.DISPLAY = FALLBACK_DISPLAY;
	}
	return env;
}

let lastTriggerAt = null;

const server = createServer((req, res) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
	if (req.method === 'OPTIONS') {
		res.writeHead(204).end();
		return;
	}

	if (req.method === 'GET' && req.url === '/health') {
		const term = pickTerminal();
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(
			JSON.stringify({
				ok: true,
				terminal: term?.bin ?? null,
				cli: CLI,
				display: process.env.DISPLAY ?? null,
				effectiveDisplay: loginEnv().DISPLAY ?? null,
				wayland: process.env.WAYLAND_DISPLAY ?? null,
				lastTriggerAt
			})
		);
		return;
	}

	if (req.method === 'POST' && req.url === '/login') {
		const term = pickTerminal();
		if (!term) {
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ ok: false, error: 'No graphical terminal found on host' }));
			return;
		}
		// Command inside the terminal: run the CLI, hold the window open afterward
		const inner = `${CLI} auth login; echo; echo '— login script exited. Press any key to close —'; read -n 1 -s`;
		const args = term.args(inner);
		try {
			const child = spawn(term.path, args, {
				detached: true,
				stdio: 'ignore',
				env: loginEnv()
			});
			child.unref();
			lastTriggerAt = new Date().toISOString();
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					ok: true,
					terminal: term.bin,
					triggeredAt: lastTriggerAt,
					message: `Spawned ${term.bin}. Complete Spotify OAuth in the browser window that opens, then press Enter in the terminal.`
				})
			);
		} catch (err) {
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
		}
		return;
	}

	if (req.method === 'POST' && req.url === '/export-zip') {
		void handleExportZip(req, res);
		return;
	}

	if (req.method === 'POST' && req.url === '/rounds-snapshot') {
		void handleRoundsSnapshot(req, res);
		return;
	}

	res.writeHead(404, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify({ error: 'Not found' }));
});

async function handleExportZip(req, res) {
	let body = '';
	for await (const chunk of req) body += chunk.toString();
	let payload;
	try {
		payload = body ? JSON.parse(body) : {};
	} catch {
		return writeJson(res, 400, { ok: false, stage: 'other', reason: 'invalid JSON body' });
	}
	const leagueName = typeof payload?.leagueName === 'string' ? payload.leagueName.trim() : '';
	const slug = typeof payload?.slug === 'string' ? payload.slug.trim() : '';
	const seasonNumber = Number(payload?.seasonNumber);
	if (!leagueName || !slug || !Number.isFinite(seasonNumber) || seasonNumber <= 0) {
		return writeJson(res, 400, {
			ok: false,
			stage: 'other',
			reason: 'leagueName, slug, seasonNumber required'
		});
	}

	const startedAt = Date.now();
	const resolved = await resolveLeagueId({ leagueName, slug });
	if (!resolved.mlLeagueId) return writeJson(res, resolved.status, resolved.error);
	const { mlLeagueId } = resolved;

	// 2. Spawn `leagues export <id> -o <path>` writing into the shared volume.
	const outDir = resolve(DATA_DIR, slug, `season-${seasonNumber}`);
	const outPath = resolve(outDir, 'export.zip');
	try {
		mkdirSync(outDir, { recursive: true });
	} catch (err) {
		return writeJson(res, 500, {
			ok: false,
			stage: 'download',
			reason: `mkdir failed: ${err instanceof Error ? err.message : String(err)}`
		});
	}

	const exportResult = await runCli(
		['leagues', 'export', mlLeagueId, '-o', outPath],
		EXPORT_CLI_TIMEOUT_MS
	);
	if (exportResult.kind === 'spawn-error') {
		return writeJson(res, 500, {
			ok: false,
			stage: 'cli',
			reason: `spawn failed: ${exportResult.message}`
		});
	}
	if (exportResult.kind === 'timeout') {
		return writeJson(res, 504, {
			ok: false,
			stage: 'download',
			reason: `leagues export timed out after ${EXPORT_CLI_TIMEOUT_MS}ms`
		});
	}
	if (exportResult.exitCode !== 0 || !existsSync(outPath)) {
		const tail = (exportResult.stderr || exportResult.stdout || '').trim().slice(-400);
		const isAuth = /AUTH_EXPIRED|auth login|expired/i.test(tail);
		return writeJson(res, isAuth ? 200 : 502, {
			ok: false,
			stage: isAuth ? 'auth' : 'download',
			reason:
				tail.slice(0, 300) || `leagues export exit ${exportResult.exitCode}, file missing`
		});
	}

	return writeJson(res, 200, {
		ok: true,
		stage: 'cli',
		mlLeagueId,
		path: outPath,
		durationMs: Date.now() - startedAt
	});
}

async function handleRoundsSnapshot(req, res) {
	let body = '';
	for await (const chunk of req) body += chunk.toString();
	let payload;
	try {
		payload = body ? JSON.parse(body) : {};
	} catch {
		return writeJson(res, 400, { ok: false, stage: 'other', reason: 'invalid JSON body' });
	}
	const leagueName = typeof payload?.leagueName === 'string' ? payload.leagueName.trim() : '';
	const slug = typeof payload?.slug === 'string' ? payload.slug.trim() : '';
	if (!leagueName || !slug) {
		return writeJson(res, 400, { ok: false, stage: 'other', reason: 'leagueName, slug required' });
	}

	const startedAt = Date.now();
	const resolved = await resolveLeagueId({ leagueName, slug });
	if (!resolved.mlLeagueId) return writeJson(res, resolved.status, resolved.error);
	const { mlLeagueId } = resolved;

	const roundsResult = await runCli(['--json', 'rounds', 'themes', mlLeagueId], LEAGUES_LIST_TIMEOUT_MS);
	if (roundsResult.kind === 'spawn-error') {
		return writeJson(res, 500, {
			ok: false,
			stage: 'cli',
			reason: `cli-web-musicleague not on PATH: ${roundsResult.message}`
		});
	}
	if (roundsResult.kind === 'timeout') {
		return writeJson(res, 504, { ok: false, stage: 'cli', reason: 'rounds themes timed out' });
	}
	let roundsPayload = null;
	try {
		roundsPayload = JSON.parse(roundsResult.stdout || 'null');
	} catch {
		return writeJson(res, 500, {
			ok: false,
			stage: 'cli',
			reason: `rounds themes emitted non-JSON: ${roundsResult.stderr.slice(0, 200) || 'unknown'}`
		});
	}
	if (roundsPayload && roundsPayload.error === true) {
		const code = roundsPayload.code ?? '';
		if (code === 'AUTH_EXPIRED') {
			return writeJson(res, 200, { ok: false, stage: 'auth', reason: 'ml-auth required' });
		}
		return writeJson(res, 502, {
			ok: false,
			stage: 'cli',
			reason: roundsPayload.message ?? `rounds themes failed: ${code || roundsResult.exitCode}`
		});
	}

	const rounds = normalizeLiveRounds(roundsPayload);
	return writeJson(res, 200, {
		ok: true,
		stage: 'cli',
		mlLeagueId,
		rounds,
		durationMs: Date.now() - startedAt,
	});
}

async function resolveLeagueId({ leagueName, slug }) {
	// SP1 fast-path: if the DB maps this slug's active season to an upstream id,
	// use it directly and skip name-matching entirely. Read-only; failure is
	// non-fatal — fall through to the existing CLI name-match below.
	try {
		const db = new Database(process.env.LEAGUE_DB ?? 'data/league.db', { readonly: true });
		const hit = slug ? resolveActiveSourceCompetition(db, slug) : null;
		db.close();
		if (hit?.sourceCompetitionId) {
			return { mlLeagueId: hit.sourceCompetitionId };
		}
	} catch {
		// ignore — fall through to name-matching
	}
	const listResult = await runCli(['--json', 'leagues', 'list'], LEAGUES_LIST_TIMEOUT_MS);
	if (listResult.kind === 'spawn-error') {
		return {
			error: { ok: false, stage: 'cli', reason: `cli-web-musicleague not on PATH: ${listResult.message}` },
			status: 500,
		};
	}
	if (listResult.kind === 'timeout') {
		return { error: { ok: false, stage: 'cli', reason: 'leagues list timed out' }, status: 504 };
	}
	let listPayload = null;
	try {
		listPayload = JSON.parse(listResult.stdout || 'null');
	} catch {
		return {
			error: {
				ok: false,
				stage: 'cli',
				reason: `leagues list emitted non-JSON: ${listResult.stderr.slice(0, 200) || 'unknown'}`
			},
			status: 500,
		};
	}
	if (listPayload && listPayload.error === true) {
		const code = listPayload.code ?? '';
		if (code === 'AUTH_EXPIRED') {
			return { error: { ok: false, stage: 'auth', reason: 'ml-auth required' }, status: 200 };
		}
		return {
			error: { ok: false, stage: 'cli', reason: listPayload.message ?? `leagues list failed: ${code || listResult.exitCode}` },
			status: 502,
		};
	}
	const leagues = Array.isArray(listPayload)
		? listPayload
		: Array.isArray(listPayload?.leagues)
		? listPayload.leagues
		: Array.isArray(listPayload?.data)
		? listPayload.data
		: [];
	const normalize = (s) =>
		String(s ?? '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, ' ')
			.trim();
	const needle = normalize(leagueName);
	const exact = leagues.find((l) => normalize(l?.name) === needle);
	let target = exact;
	if (!target) {
		const fuzzy = leagues.filter((l) => {
			const n = normalize(l?.name);
			return n.includes(needle) || needle.includes(n);
		});
		if (fuzzy.length === 1) target = fuzzy[0];
		else if (fuzzy.length > 1) {
			return {
				error: {
					ok: false,
					stage: 'cli',
					reason: `ambiguous league name "${leagueName}" — matches ${fuzzy.length}: ${fuzzy.map((l) => l?.name).join(', ')}`
				},
				status: 409,
			};
		}
	}
	if (!target) {
		return {
			error: {
				ok: false,
				stage: 'cli',
				reason: `league "${leagueName}" not found in leagues list (got ${leagues.length}: ${leagues.map((l) => l?.name).join(', ')})`
			},
			status: 404,
		};
	}
	const mlLeagueId = target.id ?? target.league_id ?? target.leagueId;
	if (!mlLeagueId || typeof mlLeagueId !== 'string') {
		return {
			error: { ok: false, stage: 'cli', reason: 'matched league has no usable id field' },
			status: 500,
		};
	}
	return { mlLeagueId };
}

function normalizeLiveRounds(payload) {
	const items = Array.isArray(payload)
		? payload
		: Array.isArray(payload?.rounds)
		? payload.rounds
		: Array.isArray(payload?.data)
		? payload.data
		: [];
	return items
		.map((r) => ({
			id: String(r?.id ?? r?.round_id ?? ''),
			number: Number(r?.number ?? r?.round_number ?? r?.seq ?? 0),
			name: String(r?.name ?? r?.title ?? ''),
			description: r?.description ?? r?.desc ?? '',
			playlistUrl: r?.playlist_id ? `https://open.spotify.com/playlist/${r.playlist_id}` : (r?.playlistUrl ?? null),
			submissionsDueUtc: r?.submissions_due_utc ?? r?.deadline_iso ?? r?.submissionsDueUtc ?? null,
			votesDueUtc: r?.votes_due_utc ?? r?.votesDueUtc ?? null,
		}))
		.filter((r) => r.id && Number.isFinite(r.number));
}

function writeJson(res, status, body) {
	if (res.headersSent) return;
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

function runCli(args, timeoutMs) {
	return new Promise((resolveP) => {
		let stdout = '';
		let stderr = '';
		let proc;
		try {
			proc = spawn(CLI, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
		} catch (err) {
			resolveP({ kind: 'spawn-error', message: err instanceof Error ? err.message : String(err) });
			return;
		}
		const t = setTimeout(() => {
			proc.kill('SIGTERM');
			resolveP({ kind: 'timeout' });
		}, timeoutMs);
		proc.stdout?.on('data', (c) => {
			stdout += c.toString();
		});
		proc.stderr?.on('data', (c) => {
			stderr += c.toString();
		});
		proc.on('error', (err) => {
			clearTimeout(t);
			resolveP({ kind: 'spawn-error', message: err.message });
		});
		proc.on('close', (code) => {
			clearTimeout(t);
			resolveP({ kind: 'ok', exitCode: code ?? -1, stdout, stderr });
		});
	});
}

server.listen(PORT, BIND, () => {
	const t = pickTerminal();
	console.log(`[ml-auth-trigger] listening on ${BIND}:${PORT}`);
	console.log(`[ml-auth-trigger] terminal=${t?.bin ?? 'NONE'} cli=${CLI} DISPLAY=${process.env.DISPLAY}`);
	console.log(`[ml-auth-trigger] data-dir=${DATA_DIR}`);
});
