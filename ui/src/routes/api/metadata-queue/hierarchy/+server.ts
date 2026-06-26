import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getHierarchy } from '$lib/db/metadataQueue.js';

/**
 * GET /api/metadata-queue/hierarchy
 *
 * Returns the full league → season → round tree with roll-up counts — the same
 * shape the SSR load supplies as `data.hierarchy`. Exposed so the client can
 * refresh the HierarchyNavigator status chips after jobs complete (or after the
 * worker drains the queue) without a full page reload.
 */
export const GET: RequestHandler = async () => {
	const db = getDb();
	return json({ hierarchy: getHierarchy(db) });
};
