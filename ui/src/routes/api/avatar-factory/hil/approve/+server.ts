import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { hilBearerOk } from '$lib/server/avatarFactory/hil.js';
import { claimStyleHil, continueStyleJob } from '$lib/server/avatarFactory/implementStyle.js';

export const POST: RequestHandler = async ({ request }) => {
	if (!hilBearerOk(request.headers.get('authorization'))) {
		return json({ ok: false, reason: 'unauthorized' }, { status: 401 });
	}
	const body = (await request.json().catch(() => ({}))) as { token?: unknown };
	const token = typeof body.token === 'string' ? body.token : '';
	const claim = claimStyleHil(token, 'approve');
	if (!claim.ok || !claim.job) return json({ ok: false, reason: claim.reason ?? 'invalid token' }, { status: 400 });
	if (claim.shouldContinue) {
		void continueStyleJob(claim.job.id).catch((e) =>
			console.error('[avatar-hil] continue failed:', e instanceof Error ? e.message : e),
		);
	}
	return json({ ok: true, jobId: claim.job.id, status: claim.job.status });
};
