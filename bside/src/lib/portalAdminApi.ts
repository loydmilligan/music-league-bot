// Portal admin — b-side client over /api/portal-admin/<slug>/…
// Mirrors surveyApi.ts (same-origin credentials, 10 s timeout, same errors).

export type PortalAdminErrorCode = 'unauthorized' | 'forbidden' | 'conflict' | 'rate_limited' | 'http';

export class PortalAdminApiError extends Error {
	status: number;
	code: PortalAdminErrorCode;
	body: unknown;
	constructor(status: number, code: PortalAdminErrorCode, message: string, body: unknown) {
		super(message);
		this.status = status;
		this.code = code;
		this.body = body;
	}
}

function mapStatus(status: number): PortalAdminErrorCode {
	if (status === 401) return 'unauthorized';
	if (status === 403) return 'forbidden';
	if (status === 409) return 'conflict';
	if (status === 429) return 'rate_limited';
	return 'http';
}

// ── wire shapes (client-side DTOs; the server zod-validates) ──────────────

export type Frequency = 'on-event' | 'hourly' | 'daily' | 'weekly' | 'manual';

export type SectionId = 'thisWeek' | 'byNumbers' | 'pulse' | 'yearbook' | 'family' | 'moments';

export interface RunState {
	lastRunAt: string | null;
	lastStatus: 'ok' | 'error' | null;
	lastError: string | null;
}

export interface PortalAdminConfig {
	version: 1;
	sections: {
		thisWeek: {
			enabled: boolean;
			frequency: Frequency;
			cards: { latestDigest: boolean; currentRound: boolean; openPolls: boolean; themeSurvey: boolean };
			links: { spotify: boolean; ytm: boolean; youtube: boolean; musicLeague: boolean };
		};
		byNumbers: { enabled: boolean; frequency: Frequency; kpis: string[] };
		pulse: { enabled: boolean; frequency: Frequency; prompt: string | null };
		yearbook: { enabled: boolean; frequency: Frequency; season: number | null };
		family: { enabled: boolean; frequency: Frequency; players: Record<string, boolean> };
		moments: { enabled: boolean; frequency: Frequency; prompt: string | null };
	};
	runState: Record<string, RunState>;
}

/** Catalog + run status the B-side tab renders pickers from (GET /sections). */
export interface SectionCatalog {
	kpis: { id: string; label: string }[];
	members: { id: string; name: string }[];
	seasons: number[];
	runState: Record<string, RunState>;
	nextDue: Record<string, string | null>;
}

export interface RunJob {
	jobId: string;
}

export interface RunStatus {
	status: 'pending' | 'running' | 'done' | 'failed';
	updatedAt: string | null;
	error: string | null;
}

export interface PlanTask {
	/** `r3.capture-spotify` for derived rows; a generated key for custom ones. */
	key: string;
	round: number | null;
	kind: 'content' | 'ops' | 'review';
	label: string;
	notes: string | null;
	dueAt: string | null;
	/** Custom tasks have `source: 'custom'` at the server; the client just reads `status`. */
	source?: 'derived' | 'custom';
	status: 'open' | 'done' | 'skipped';
}

export interface PlanGroup {
	date: string | null;
	label: string;
	tasks: PlanTask[];
}

export interface PlanView {
	today: number;
	overdue: number;
	groups: PlanGroup[];
}

export function createPortalAdminApi(
	slug: string,
	fetchFn: typeof fetch = fetch,
	options: { timeoutMs?: number; token?: string } = {}
) {
	const base = `/api/portal-admin/${slug}`;
	const timeoutMs = options.timeoutMs ?? 10_000;

	async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const res = await fetchFn(`${base}/${path.replace(/^\//, '')}`, {
				method,
				credentials: 'same-origin',
				headers: {
					...(body !== undefined ? { 'content-type': 'application/json' } : {}),
					...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
				},
				body: body !== undefined ? JSON.stringify(body) : undefined,
				signal: controller.signal,
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				const message =
					typeof (json as { error?: string }).error === 'string'
						? (json as { error: string }).error
						: `HTTP ${res.status}`;
				throw new PortalAdminApiError(res.status, mapStatus(res.status), message, json);
			}
			return json as T;
		} finally {
			clearTimeout(timer);
		}
	}

	return {
		config: () => request<PortalAdminConfig>('GET', 'config'),
		saveConfig: (config: PortalAdminConfig) => request<PortalAdminConfig>('PUT', 'config', config),
		sections: () => request<SectionCatalog>('GET', 'sections'),
		run: (sectionId: string) => request<RunJob>('POST', 'run', { section: sectionId }),
		runStatus: (jobId: string) => request<RunStatus>('GET', `run/${jobId}`),
		plan: (days = 7) => request<PlanView>('GET', `plan?days=${days}`),
		derivePlan: () => request<{ ok: boolean }>('POST', 'plan/derive'),
		saveTask: (task: PlanTask) => request<{ ok: boolean }>('PATCH', 'plan/task', { task }),
		deleteTask: (key: string) => request<{ ok: boolean }>('DELETE', 'plan/task', { key }),
	};
}