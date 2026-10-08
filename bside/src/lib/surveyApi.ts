export type SurveyCode = 'unauthorized' | 'forbidden' | 'conflict' | 'rate_limited' | 'http';

export class SurveyApiError extends Error {
	status: number;
	code: SurveyCode;
	body: unknown;
	constructor(status: number, code: SurveyCode, message: string, body: unknown) {
		super(message);
		this.status = status;
		this.code = code;
		this.body = body;
	}
}

function mapStatus(status: number): SurveyCode {
	if (status === 401) return 'unauthorized';
	if (status === 403) return 'forbidden';
	if (status === 409) return 'conflict';
	if (status === 429) return 'rate_limited';
	return 'http';
}

export interface AuthMe {
	authenticated: boolean;
	voterName?: string;
	submitted?: boolean;
	codeRequiredToSwitch?: boolean;
}

export interface Hub {
	ok: boolean;
	voterName: string;
	submitted: boolean;
	tabs: { survey?: boolean; mine?: boolean; lineup?: boolean; polls?: boolean };
	myThemes?: { title: string; description: string; usedIn?: string | null }[];
}

export interface PlayerSettings {
	ntfy: { enabled: boolean; topic: string | null; server: string };
	whatsapp: { enabled: boolean; linked: boolean; e164: null };
	events: Record<string, boolean>;
}

export interface NewsItem {
	id: string; title: string; body: string; author: string | null; publishedAt: string;
}

export function createSurveyApi(apiBase: string, fetchFn: typeof fetch = fetch) {
	const base = apiBase.replace(/\/+$/, '');

	async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 10_000);
		try {
			const res = await fetchFn(`${base}/${path.replace(/^\//, '')}`, {
				method,
				credentials: 'same-origin',
				headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
				body: body !== undefined ? JSON.stringify(body) : undefined,
				signal: controller.signal,
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				const message = typeof (json as { error?: string }).error === 'string'
					? (json as { error: string }).error
					: `HTTP ${res.status}`;
				throw new SurveyApiError(res.status, mapStatus(res.status), message, json);
			}
			return json as T;
		} finally {
			clearTimeout(timer);
		}
	}

	return {
		me: () => request<AuthMe>('GET', 'auth/me'),
		roster: () => request<{ names: string[] }>('GET', 'roster'),
		select: (voterName: string, code?: string) =>
			request<{ ok: boolean; voterName: string; submitted: boolean; codeRequired?: boolean }>(
				'POST', 'auth/select', code ? { voterName, code } : { voterName },
			),
		logout: () => request<{ ok: boolean }>('POST', 'auth/logout'),
		hub: () => request<Hub>('GET', 'hub'),
		feed: () => request<unknown>('GET', 'feed'),
		schema: () => request<unknown>('GET', 'survey/schema'),
		submit: (body: unknown) => request<{ ok: boolean }>('POST', 'submit', body),
		addThemes: (themes: unknown) => request<{ ok: boolean }>('POST', 'themes', { themes }),
		vote: (pollId: string, optionId: string) =>
			request<{ ok: boolean }>('PUT', `polls/${pollId}/vote`, { optionId }),
		settings: () => request<{ ok: boolean; settings: PlayerSettings }>('GET', 'settings'),
		saveSettings: (body: unknown) => request<{ ok: boolean; settings: PlayerSettings }>('PUT', 'settings', body),
		news: () => request<{ ok: boolean; items: NewsItem[] }>('GET', 'news'),
		postNews: (body: { title: string; body: string }) => request<{ ok: boolean }>('POST', 'news', body),
		unpublishNews: (id: string) => request<{ ok: boolean }>('PUT', `news/${id}`, { unpublished: true }),
		switchRequest: (voterName: string) => request<{ ok: boolean }>('POST', 'auth/switch-request', { voterName }),
		switchRequests: () => request<{ ok: boolean; requests: { id: string; playerName: string; status: string; code: string | null }[] }>('GET', 'switch-requests'),
		actSwitch: (id: string, action: 'activate' | 'deny' | 'send') =>
			request<{ ok: boolean; sent?: boolean; reason?: string }>('PUT', `switch-requests/${id}`, { action }),
		adminSession: () => request<{ authenticated: boolean; admin: boolean; steppedUp: boolean; voterName?: string }>('GET', 'session/admin'),
		stepUp: () => request<{ ok: boolean; sent: string[]; devCode?: string; reason?: string }>('POST', 'step-up'),
		verifyStepUp: (code: string) => request<{ ok: boolean }>('POST', 'step-up/verify', { code }),
		roles: () => request<{ ok: boolean; names: string[] }>('GET', 'roles'),
		saveRoles: (names: string[]) => request<{ ok: boolean; names: string[] }>('PUT', 'roles', { names }),
	};
}

export type SurveyApi = ReturnType<typeof createSurveyApi>;
