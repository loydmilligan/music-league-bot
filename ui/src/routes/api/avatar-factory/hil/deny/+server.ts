import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { hilBearerOk } from '$lib/server/avatarFactory/hil.js';
import { claimStyleHil } from '$lib/server/avatarFactory/implementStyle.js';

export const POST: RequestHandler = async ({ request }) => {
	if (!hilBearerOk(request.headers.get('authorization'))) {
		return json({ ok: false, reason: 'unauthorized' }, { status: 401 });
	}
	const body = (await request.json().catch(() => ({}))) as { token?: unknown };
	const token = typeof body.token === 'string' ? body.token : '';
	const claim = claimStyleHil(token, 'deny');
	if (!claim.ok || !claim.job) return json({ ok: false, reason: claim.reason ?? 'invalid token' }, { status: 400 });
	return json({ ok: true, jobId: claim.job.id, status: claim.job.status });
};
