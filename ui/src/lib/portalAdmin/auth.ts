// Portal admin — bearer-token auth (spec §8). Self-hosted single-operator bot:
// a shared secret from `PORTAL_ADMIN_TOKEN` beats a JWKS stack nobody can issue
// tokens for. Verification is lazy (env re-read per call so tests and live
// reloads pick up changes) and fail-closed: no env, no token, no pass.
import { timingSafeEqual } from 'node:crypto';

export function portalAdminToken(): string | null {
	return process.env.PORTAL_ADMIN_TOKEN || null;
}

export function isPortalAdminMounted(): boolean {
	return portalAdminToken() !== null;
}

export function verifyPortalAdmin(request: {
	headers: { get(name: string): string | null } | Headers;
}): boolean {
	const token = portalAdminToken();
	if (!token) return false;
	const header = request.headers.get('authorization');
	if (!header) return false;
	const match = /^Bearer (.+)$/i.exec(header.trim());
	if (!match?.[1]) return false;
	const a = Buffer.from(match[1]);
	const b = Buffer.from(token);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}