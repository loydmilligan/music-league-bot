import { describe, expect, it, vi, afterEach } from 'vitest';
import {
	createPortalAdminApi,
	PortalAdminApiError
} from '../../../../bside/src/lib/portalAdminApi.ts';

const configOk = { version: 1, sections: { enabled: true }, runState: {} };

function mockFetch(body: unknown, status = 200) {
	const fn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
		await new Promise((r) => setTimeout(r, 1));
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' },
		});
	});
	return fn;
}

afterEach(() => vi.restoreAllMocks());

describe('portalAdminApi', () => {
	it('builds /api/portal-admin/<slug>/… URLs with no query leakage', async () => {
		const fn = mockFetch(configOk);
		const api = createPortalAdminApi('U7o8L06wfe1HILD1qzk-wg', fn);
		await api.config();
		expect(fn.mock.calls[0][0]?.toString()).toBe('/api/portal-admin/U7o8L06wfe1HILD1qzk-wg/config');

		await api.plan(3);
		const planUrl = fn.mock.calls[1][0] as URL;
		expect(planUrl.toString()).toBe('/api/portal-admin/U7o8L06wfe1HILD1qzk-wg/plan?days=3');

		const runFn = mockFetch({ jobId: 'j1' });
		await createPortalAdminApi('x', runFn).run('pulse');
		expect(runFn.mock.calls[0][0]?.toString()).toBe('/api/portal-admin/x/run');
		expect(runFn.mock.calls[0][1]?.body).toBe(JSON.stringify({ section: 'pulse' }));
	});

	it('maps POST bodies and sends the right method', async () => {
		const fn = mockFetch({ ok: true });
		const api = createPortalAdminApi('x', fn);
		await api.saveTask({
			key: 'r2-review', round: 2, kind: 'review', label: 'Review R2',
			notes: null, dueAt: '2026-10-20', status: 'open',
		});
		expect(fn.mock.calls[0][0]?.toString()).toBe('/api/portal-admin/x/plan/task');
		expect(fn.mock.calls[0][1]?.method).toBe('PATCH');
		await api.deleteTask('r2-review');
		expect(fn.mock.calls[1][1]?.method).toBe('DELETE');
	});

	it('sends the bearer token as an Authorization header', async () => {
		const fn = mockFetch(configOk);
		const api = createPortalAdminApi('x', fn, { token: 'sekret' });
		await api.config();
		expect(fn.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer sekret' });
	});

	it('omits the Authorization header when no token is configured', async () => {
		const fn = mockFetch(configOk);
		await createPortalAdminApi('x', fn).config();
		expect(fn.mock.calls[0][1]?.headers).toEqual({});
	});

	it('maps 401 to unauthorized', async () => {
		const api = createPortalAdminApi('x', mockFetch({ error: 'denied' }, 401));
		const err = await api.sections().catch((e) => e);
		expect(err).toBeInstanceOf(PortalAdminApiError);
		expect((err as PortalAdminApiError).status).toBe(401);
		expect((err as PortalAdminApiError).code).toBe('unauthorized');
	});

	it('maps 405 to http', async () => {
		const api = createPortalAdminApi('x', mockFetch({ error: 'method not allowed' }, 405));
		const err = await api.config().catch((e) => e);
		expect((err as PortalAdminApiError).code).toBe('http');
		expect((err as PortalAdminApiError).message).toBe('method not allowed');
	});

	it('aborts on timeout and surfaces it', async () => {
		const slow = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
			await new Promise((r) => setTimeout(r, 60));
			throw new Error('should not resolve');
		});
		const api = createPortalAdminApi('x', slow, { timeoutMs: 5 });
		await expect(api.config()).rejects.toThrow();
		expect(slow.mock.calls[0][1]?.signal as AbortSignal).toBeDefined();
	});
});