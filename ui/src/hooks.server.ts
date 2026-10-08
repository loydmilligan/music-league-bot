import { resolve } from 'node:path';
import type { Handle } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { runStartupImport } from '$lib/import/startupScan.js';
import { startQueueWorker } from '$lib/queueWorker.js';
import { startDigestRunner } from '$lib/digest/runnerLoop.js';
import { startMlAuthHeartbeat } from '$lib/mlAuth.js';
import { startRolloutAppExecutor } from '$lib/rollout/appExecutor.js';
import { startSurveySync } from '$lib/surveySync/runner.js';
import { isPortalAdminMounted } from '$lib/portalAdmin/auth.js';

process.env.DATA_DIR ??= resolve(process.cwd(), '../data');
const DATA_DIR = process.env.DATA_DIR;

// Share instance (boarz-stats): serve the public stats page only — no startup
// imports, no queue workers, no digest runner, no background writers. The route
// guard below 404s everything that isn't the share site or its assets.
const STATS_ONLY = process.env.STATS_ONLY === '1';

if (!STATS_ONLY) {
	const db = getDb();

	runStartupImport(db, DATA_DIR).catch((err) =>
		console.error('[startup] import error:', err)
	);

	startQueueWorker();
	startDigestRunner();
	startRolloutAppExecutor();
	startMlAuthHeartbeat();
	startSurveySync();
}

export const handle: Handle = async ({ event, resolve }) => {
	if (STATS_ONLY) {
		const p = event.url.pathname;
		const allowed = p === '/boarz-stats'
			|| p.startsWith('/boarz-stats/')
			|| p === '/stats'
			|| p.startsWith('/stats/')
			|| p.startsWith('/_app/')
			|| p.startsWith('/favicon');
		if (!allowed) return new Response('Not found', { status: 404 });
	}

	// Portal admin (spec §8 mounting): the group is dead unless the operator
	// has configured PORTAL_ADMIN_TOKEN. No token → 404 the whole mount so the
	// routes are unreachable rather than reachable-but-unauthorized.
	if (event.url.pathname.startsWith('/api/portal-admin') && !isPortalAdminMounted()) {
		return new Response('Not found', { status: 404 });
	}

	return resolve(event);
};
