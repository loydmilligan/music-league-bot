/**
 * ML auth heartbeat — file-backed.
 *
 * Architecture: a host-side worker (scripts/ml-auth-probe.mjs) runs the CLI
 * probe every 5 min and writes the result to `${DATA_DIR}/ml-auth.json`.
 * The UI container just reads that file. This keeps the container slim and
 * keeps the auth.json / playwright profile / browser launch on the host
 * where they actually belong.
 *
 * Dev fallback: if the file is missing or stale AND `cli-web-musicleague`
 * happens to be on PATH (e.g. when running `npm run dev` outside docker),
 * we spawn it directly so local development still works.
 */
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

export type MlAuthStatus = 'ok' | 'expired' | 'unknown' | 'cli-missing';

export interface MlAuthState {
	status: MlAuthStatus;
	lastCheckedAt: string | null;
	lastOkAt: string | null;
	message: string | null;
	source?: 'file' | 'spawn' | 'cache';
}

const DATA_DIR = process.env.DATA_DIR ?? resolve(process.cwd(), '../data');
const STATE_FILE = resolve(DATA_DIR, 'ml-auth.json');
const STALE_AFTER_MS = 15 * 60 * 1000; // file older than this → "unknown"
const POLL_INTERVAL_MS = 60 * 1000; // re-read file every minute
const PROBE_TIMEOUT_MS = 30_000;

let cached: MlAuthState = {
	status: 'unknown',
	lastCheckedAt: null,
	lastOkAt: null,
	message: null,
	source: 'cache'
};

let inFlight: Promise<MlAuthState> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function getMlAuthState(): MlAuthState {
	return { ...cached };
}

/**
 * Force a recheck. In dev (CLI on PATH) this spawns the CLI directly.
 * In prod, this reads the file (the host worker writes it on its own cadence).
 */
export async function probeMlAuth(): Promise<MlAuthState> {
	if (inFlight) return inFlight;
	inFlight = doRecheck().finally(() => {
		inFlight = null;
	});
	return inFlight;
}

async function doRecheck(): Promise<MlAuthState> {
	// 1. Always refresh from the file first (cheap)
	const fileState = await readStateFile();
	if (fileState) {
		cached = { ...fileState, source: 'file' };
		return { ...cached };
	}

	// 2. Dev fallback: spawn the CLI ourselves
	const spawned = await spawnProbe();
	if (spawned) {
		cached = { ...spawned, source: 'spawn' };
		return { ...cached };
	}

	// 3. Neither worked — keep prior cache but mark stale
	cached.source = 'cache';
	return { ...cached };
}

async function readStateFile(): Promise<MlAuthState | null> {
	try {
		const stats = await stat(STATE_FILE);
		const ageMs = Date.now() - stats.mtimeMs;
		const raw = await readFile(STATE_FILE, 'utf8');
		const parsed = JSON.parse(raw) as MlAuthState;
		if (ageMs > STALE_AFTER_MS) {
			return {
				...parsed,
				status: 'unknown',
				message: `Heartbeat file is stale (${Math.round(ageMs / 60000)}min old). Is the host worker running?`
			};
		}
		return parsed;
	} catch {
		return null;
	}
}

async function spawnProbe(): Promise<MlAuthState | null> {
	const startedAt = new Date().toISOString();
	const result = await execCli(['--json', 'users', 'me']);

	if (result.kind === 'spawn-error') {
		// CLI not on PATH — we're probably inside docker; that's expected
		return null;
	}
	if (result.kind === 'timeout') {
		return {
			status: 'unknown',
			lastCheckedAt: startedAt,
			lastOkAt: cached.lastOkAt,
			message: 'Auth probe timed out'
		};
	}

	let payload: unknown = null;
	try {
		payload = JSON.parse(result.stdout || '');
	} catch {
		// not JSON
	}

	if (payload && typeof payload === 'object' && (payload as { error?: boolean }).error === true) {
		const code = (payload as { code?: string }).code ?? '';
		if (code === 'AUTH_EXPIRED') {
			return {
				status: 'expired',
				lastCheckedAt: startedAt,
				lastOkAt: cached.lastOkAt,
				message: 'Session expired. Run: cli-web-musicleague auth login'
			};
		}
		return {
			status: 'unknown',
			lastCheckedAt: startedAt,
			lastOkAt: cached.lastOkAt,
			message:
				(payload as { message?: string }).message ?? `Probe failed: ${code || result.exitCode}`
		};
	}

	if (
		result.exitCode === 0 &&
		payload &&
		typeof payload === 'object' &&
		'id' in (payload as object)
	) {
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
		lastOkAt: cached.lastOkAt,
		message: result.stderr.trim().slice(0, 200) || `Unexpected exit ${result.exitCode}`
	};
}

type ExecResult =
	| { kind: 'ok'; exitCode: number; stdout: string; stderr: string }
	| { kind: 'timeout' }
	| { kind: 'spawn-error'; message: string };

function execCli(args: string[]): Promise<ExecResult> {
	return new Promise((resolve) => {
		let stdout = '';
		let stderr = '';
		let proc: ReturnType<typeof spawn>;
		try {
			proc = spawn('cli-web-musicleague', args, { stdio: ['ignore', 'pipe', 'pipe'] });
		} catch (err) {
			resolve({ kind: 'spawn-error', message: err instanceof Error ? err.message : String(err) });
			return;
		}

		const timeout = setTimeout(() => {
			proc.kill('SIGTERM');
			resolve({ kind: 'timeout' });
		}, PROBE_TIMEOUT_MS);

		proc.stdout?.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		proc.stderr?.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		proc.on('error', (err) => {
			clearTimeout(timeout);
			resolve({ kind: 'spawn-error', message: err.message });
		});
		proc.on('close', (code) => {
			clearTimeout(timeout);
			resolve({ kind: 'ok', exitCode: code ?? -1, stdout, stderr });
		});
	});
}

/** Start the periodic file poll. Idempotent. */
export function startMlAuthHeartbeat(): void {
	if (timer) return;
	void doRecheck().catch(() => {});
	timer = setInterval(() => {
		void doRecheck().catch(() => {});
	}, POLL_INTERVAL_MS);
	timer.unref?.();
}
