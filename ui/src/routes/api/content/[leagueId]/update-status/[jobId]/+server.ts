import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { updateJobs } from '$lib/content/updateJobs.js';

export const GET: RequestHandler = ({ params }) => {
	const job = updateJobs.get(params.jobId);
	if (!job) throw error(404, 'job not found');

	if (job.status === 'running') return json({ status: 'running' });
	if (job.status === 'error') {
		updateJobs.delete(params.jobId);
		return json({ status: 'error', error: job.error });
	}

	updateJobs.delete(params.jobId);
	return json({ status: 'done', result: job.result });
};
