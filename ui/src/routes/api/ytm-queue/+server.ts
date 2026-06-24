import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getQueueStatus } from '$lib/db/metadataQueue.js';

export const GET: RequestHandler = async () => {
	const status = getQueueStatus(getDb());
	const ytm = status.byJobType['ytm'] ?? { pending: 0, processing: 0, done24h: 0, failed: 0, total: 0 };
	return json({
		pending: ytm.pending + ytm.processing,
		processing: ytm.processing,
		done24h: ytm.done24h,
		estimatedMinutes: Math.ceil((ytm.pending + ytm.processing) / 10),
		failures: status.failures.filter(f => f.job_type === 'ytm'),
	});
};
