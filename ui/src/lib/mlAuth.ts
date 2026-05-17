/**
 * ML auth heartbeat for the UI server.
 *
 * Periodically probes the live Music League server via `cli-web-musicleague`
 * to detect whether our saved session is still valid. Surfaces a cached result
 * to the layout badge.
 */
import { spawn } from 'node:child_process';

export type MlAuthStatus = 'ok' | 'expired' | 'unknown' | 'cli-missing';

export interface MlAuthState {
	status: MlAuthStatus;
	lastCheckedAt: string | null;
	lastOkAt: string | null;
	message: string | null;
}

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const PROBE_TIMEOUT_MS = 30_000;

let cached: MlAuthState = {
	status: 'unknown',
	lastCheckedAt: null,
	lastOkAt: null,
	message: null
};

let inFlight: Promise<MlAuthState> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function getMlAuthState(): MlAuthState {
	return { ...cached };
}

export async function probeMlAuth(): Promise<MlAuthState> {
	if (inFlight) return inFlight;
	inFlight = runProbe().finally(() => {
		inFlight = null;
	});
	return inFlight;
}

async function runProbe(): Promise<MlAuthState> {
	const startedAt = new Date().toISOString();
	const result = await execCli(['--json', 'users', 'me']);
	cached.lastCheckedAt = startedAt;

	if (result.kind === 'spawn-error') {
		cached.status = 'cli-missing';
		cached.message = `cli-web-musicleague not on PATH: ${result.message}`;
		return { ...cached };
	}

	if (result.kind === 'timeout') {
		cached.status = 'unknown';
		cached.message = 'Auth probe timed out';
		return { ...cached };
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
			cached.status = 'expired';
			cached.message = 'Session expired. Run: cli-web-musicleague auth login';
			return { ...cached };
		}
		cached.status = 'unknown';
		cached.message =
			(payload as { message?: string }).message ?? `Probe failed: ${code || result.exitCode}`;
		return { ...cached };
	}

	if (
		result.exitCode === 0 &&
		payload &&
		typeof payload === 'object' &&
		'id' in (payload as object)
	) {
		cached.status = 'ok';
		cached.lastOkAt = startedAt;
		cached.message = null;
		return { ...cached };
	}

	cached.status = 'unknown';
	cached.message = result.stderr.trim().slice(0, 200) || `Unexpected exit ${result.exitCode}`;
	return { ...cached };
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

export function startMlAuthHeartbeat(): void {
	if (timer) return;
	void probeMlAuth().catch(() => {});
	timer = setInterval(() => {
		void probeMlAuth().catch(() => {});
	}, HEARTBEAT_INTERVAL_MS);
	timer.unref?.();
}
