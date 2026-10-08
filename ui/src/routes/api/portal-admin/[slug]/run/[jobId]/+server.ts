import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { requirePortalAdmin } from '$lib/portalAdmin/api.js';
import { getRunStatus } from '$lib/portalAdmin/runner.js';

export const GET: RequestHandler = async (event) => {
	const { db } = requirePortalAdmin(event);
	const jobId = event.params.jobId ?? '';
	const status = getRunStatus(db, jobId);
	if (!status) throw error(404, 'unknown run job');
	return json(status);
};