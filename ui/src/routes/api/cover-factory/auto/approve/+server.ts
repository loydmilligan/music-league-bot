import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { hilBearerOk } from '$lib/server/avatarFactory/hil.js';
import { resolveCoverAutoApproval } from '$lib/server/coverFactory/autoQueue.js';

// ntfy action callback for the Cover Factory round budget (topic mlb-alert). Body: { token }.
export const POST: RequestHandler = async ({ request }) => {
	if (!hilBearerOk(request.headers.get('authorization'))) {
		return json({ ok: false, reason: 'unauthorized' }, { status: 401 });
	}
	const body = (await request.json().catch(() => ({}))) as { token?: unknown };
	const token = typeof body.token === 'string' ? body.token : '';
	const r = resolveCoverAutoApproval(getDb(), token, 'approve');
	if (!r.ok) return json({ ok: false, reason: r.reason }, { status: 400 });
	return json({ ok: true, roundId: r.job.round_id, status: r.job.status, capUsd: r.job.cap_usd });
};
