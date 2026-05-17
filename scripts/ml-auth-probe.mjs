#!/usr/bin/env node
/**
 * ml-auth-probe — host-side heartbeat for the Music League session.
 *
 * Spawns `cli-web-musicleague --json users me` and writes the result to
 * <data-dir>/ml-auth.json. The UI container reads that file via its mounted
 * `./data` volume and surfaces it in the sidebar badge.
 *
 * Run from a systemd user timer (or cron) every 5 min:
 *
 *   # ~/.config/systemd/user/mlb-auth-probe.service
 *   [Unit]
 *   Description=Music League auth heartbeat
 *   [Service]
 *   Type=oneshot
 *   WorkingDirectory=%h/Projects/music-league-bot
 *   ExecStart=/usr/bin/node scripts/ml-auth-probe.mjs
 *
 *   # ~/.config/systemd/user/mlb-auth-probe.timer
 *   [Unit]
 *   Description=Probe ML auth every 5 minutes
 *   [Timer]
 *   OnBootSec=30s
 *   OnUnitActiveSec=5m
 *   [Install]
 *   WantedBy=timers.target
 *
 *   systemctl --user enable --now mlb-auth-probe.timer
 *
 * Cron alternative:
 *   star/5 star star star star  cd ~/Projects/music-league-bot && /usr/bin/node scripts/ml-auth-probe.mjs
 *   (use the real cron syntax — the JS comment parser chokes on it)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR ?? resolve(REPO_ROOT, 'data');
const STATE_FILE = resolve(DATA_DIR, 'ml-auth.json');
const TMP_FILE = `${STATE_FILE}.tmp`;
const PROBE_TIMEOUT_MS = 30_000;

mkdirSync(DATA_DIR, { recursive: true });

const startedAt = new Date().toISOString();
const result = await execCli(['--json', 'users', 'me']);
const state = interpret(result, startedAt);

writeFileSync(TMP_FILE, JSON.stringify(state, null, 2), { mode: 0o644 });
renameSync(TMP_FILE, STATE_FILE);

console.log(`[ml-auth-probe] status=${state.status} ${state.message ?? ''}`);

function interpret(result, startedAt) {
	if (result.kind === 'spawn-error') {
		return {
			status: 'cli-missing',
			lastCheckedAt: startedAt,
			lastOkAt: null,
			message: `cli-web-musicleague not on PATH: ${result.message}`
		};
	}
	if (result.kind === 'timeout') {
		return {
			status: 'unknown',
			lastCheckedAt: startedAt,
			lastOkAt: null,
			message: 'Auth probe timed out'
		};
	}

	let payload = null;
	try { payload = JSON.parse(result.stdout || ''); } catch {}

	if (payload && typeof payload === 'object' && payload.error === true) {
		const code = payload.code ?? '';
		if (code === 'AUTH_EXPIRED') {
			return {
				status: 'expired',
				lastCheckedAt: startedAt,
				lastOkAt: null,
				message: 'Session expired. Run: cli-web-musicleague auth login'
			};
		}
		return {
			status: 'unknown',
			lastCheckedAt: startedAt,
			lastOkAt: null,
			message: payload.message ?? `Probe failed: ${code || result.exitCode}`
		};
	}

	if (result.exitCode === 0 && payload && typeof payload === 'object' && 'id' in payload) {
		return {
			status: 'ok',
			lastCheckedAt: startedAt,
			lastOkAt: startedAt,
			message: null
		};
	}

	return {
		status: 'unknown',
		lastCheckedAt: startedAt,
		lastOkAt: null,
		message: result.stderr.trim().slice(0, 200) || `Unexpected exit ${result.exitCode}`
	};
}

function execCli(args) {
	return new Promise((resolve) => {
		let stdout = '';
		let stderr = '';
		let proc;
		try {
			proc = spawn('cli-web-musicleague', args, { stdio: ['ignore', 'pipe', 'pipe'] });
		} catch (err) {
			resolve({ kind: 'spawn-error', message: err instanceof Error ? err.message : String(err) });
			return;
		}
		const t = setTimeout(() => { proc.kill('SIGTERM'); resolve({ kind: 'timeout' }); }, PROBE_TIMEOUT_MS);
		proc.stdout?.on('data', (c) => { stdout += c.toString(); });
		proc.stderr?.on('data', (c) => { stderr += c.toString(); });
		proc.on('error', (err) => { clearTimeout(t); resolve({ kind: 'spawn-error', message: err.message }); });
		proc.on('close', (code) => { clearTimeout(t); resolve({ kind: 'ok', exitCode: code ?? -1, stdout, stderr }); });
	});
}
