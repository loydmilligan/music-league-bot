import { describe, expect, it, afterEach } from 'vitest';
import { verifyPortalAdmin, isPortalAdminMounted } from './auth.js';

const PREV = process.env.PORTAL_ADMIN_TOKEN;

function withToken(token: string | null, fn: () => void): void {
	if (token === null) delete process.env.PORTAL_ADMIN_TOKEN;
	else process.env.PORTAL_ADMIN_TOKEN = token;
	try {
		fn();
	} finally {
		if (PREV === undefined) delete process.env.PORTAL_ADMIN_TOKEN;
		else process.env.PORTAL_ADMIN_TOKEN = PREV;
	}
}

const h = (authorization: string | null) => {
	const headers = new Headers();
	if (authorization !== null) headers.set('authorization', authorization);
	return { headers };
};

describe('verifyPortalAdmin', () => {
	afterEach(() => {
		if (PREV === undefined) delete process.env.PORTAL_ADMIN_TOKEN;
		else process.env.PORTAL_ADMIN_TOKEN = PREV;
	});

	it('fails closed when no token is configured', () => {
		withToken(null, () => {
			expect(isPortalAdminMounted()).toBe(false);
			expect(verifyPortalAdmin(h('Bearer anything'))).toBe(false);
		});
	});

	it('rejects a missing, wrong-scheme, or malformed header', () => {
		withToken('sekret', () => {
			expect(verifyPortalAdmin(h(null))).toBe(false);
			expect(verifyPortalAdmin(h('sekret'))).toBe(false);
			expect(verifyPortalAdmin(h('Basic sekret'))).toBe(false);
			expect(verifyPortalAdmin(h('Bearer'))).toBe(false);
		});
	});

	it('accepts the exact bearer token', () => {
		withToken('sekret', () => {
			expect(isPortalAdminMounted()).toBe(true);
			expect(verifyPortalAdmin(h('Bearer sekret'))).toBe(true);
		});
	});

	it('rejects a wrong token even with the same length', () => {
		withToken('sekret', () => {
			expect(verifyPortalAdmin(h('Bearer sekres'))).toBe(false);
			expect(verifyPortalAdmin(h('Bearer          '))).toBe(false);
		});
	});
});