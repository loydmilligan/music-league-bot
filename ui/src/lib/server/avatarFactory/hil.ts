import { randomUUID } from 'node:crypto';
import { appBaseUrl } from '$lib/config/urls.js';
import { bearerOk } from '$lib/digest/callbackAuth.js';
import { publish, type NtfyAction, type NtfyConfig, type Notification } from '$lib/digest/ntfy.js';
import type { FetchLike } from './generate.js';
import type { StyleJob } from './store.js';

export const AVATAR_HIL_TOPIC = 'avatar-hil';

export function hilConfigFromEnv(env: Record<string, string | undefined> = process.env): NtfyConfig {
	const url = (env.NTFY_URL ?? '').replace(/\/+$/, '');
	if (!url) throw new Error('NTFY_URL is not set');
	return {
		url,
		topic: env.AVATAR_FACTORY_HIL_TOPIC?.trim() || AVATAR_HIL_TOPIC,
		token: env.NTFY_TOKEN,
	};
}

export function mintHilToken(): string {
	return randomUUID();
}

export function hilCallbackUrls(base = appBaseUrl()): { approveUrl: string; denyUrl: string; click: string } {
	const root = base.replace(/\/+$/, '');
	return {
		approveUrl: `${root}/api/avatar-factory/hil/approve`,
		denyUrl: `${root}/api/avatar-factory/hil/deny`,
		click: `${root}/avatar-factory`,
	};
}

function authedPost(url: string, token: string, bearer?: string): NtfyAction {
	return {
		action: 'http',
		label: '',
		url,
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
		body: JSON.stringify({ token }),
		clear: true,
	};
}

export function buildStyleHilNotification(o: {
	title: string;
	message: string;
	click: string;
	approveUrl: string;
	denyUrl: string;
	token: string;
	bearer?: string;
}): Notification {
	return {
		title: o.title,
		message: o.message,
		click: o.click,
		priority: 4,
		tags: ['busts_in_silhouette'],
		actions: [
			{ ...authedPost(o.approveUrl, o.token, o.bearer), label: 'Approve' },
			{ ...authedPost(o.denyUrl, o.token, o.bearer), label: 'Deny' },
			{ action: 'view', label: 'Factory', url: o.click, clear: false },
		],
	};
}

const BROWSER_UA =
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

export async function publishStyleHil(
	n: Notification,
	opts: { env?: Record<string, string | undefined>; fetchImpl?: FetchLike } = {},
): Promise<boolean> {
	const cfg = hilConfigFromEnv(opts.env ?? process.env);
	const inner = opts.fetchImpl ?? fetch;
	const fetchImpl: FetchLike = (input, init) => {
		const headers = new Headers(init?.headers);
		if (!headers.has('User-Agent')) headers.set('User-Agent', BROWSER_UA);
		return inner(input, { ...init, headers });
	};
	return publish(cfg, n, fetchImpl);
}

export function hilBearerOk(authHeader: string | null, env: Record<string, string | undefined> = process.env): boolean {
	return bearerOk(authHeader, env.NTFY_TOKEN);
}

export function jobHilGate(job: StyleJob): 'members' | 'group' | null {
	if (job.status === 'awaiting-members') return 'members';
	if (job.status === 'awaiting-group') return 'group';
	return null;
}
