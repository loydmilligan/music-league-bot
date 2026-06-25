import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getChildrenRollups } from '$lib/db/metadataQueue.js';
import type { Scope } from '$lib/db/metadataQueue.js';

const VALID_LEVELS = new Set(['all', 'league', 'season', 'round']);

/**
 * GET /api/metadata-queue/children?level=&id=
 *
 * Returns the CHILDREN of the given scope node with per-job-type counts,
 * suitable for rendering the heatmap grid.
 *
 * - level=all            → leagues as children (no id required)
 * - level=league&id=N    → seasons of that league
 * - level=season&id=N    → rounds of that season
 * - level=round&id=N     → empty array (songs served by coverageMatrix)
 *
 * Validation: 400 on missing/invalid level; 400 when id required but missing
 * or non-integer.
 */
export const GET: RequestHandler = async ({ url }) => {
	const levelParam = url.searchParams.get('level');
	const idParam = url.searchParams.get('id');

	if (levelParam == null || !VALID_LEVELS.has(levelParam)) {
		return json(
			{ error: 'level is required and must be one of: all, league, season, round' },
			{ status: 400 }
		);
	}

	let scope: Scope;

	if (levelParam === 'all') {
		scope = { level: 'all' };
	} else {
		// league | season | round — require a valid integer id
		if (idParam == null) {
			return json({ error: `id is required when level is ${levelParam}` }, { status: 400 });
		}
		const id = Number(idParam);
		if (isNaN(id) || !Number.isInteger(id)) {
			return json({ error: 'id must be an integer' }, { status: 400 });
		}
		scope = { level: levelParam as 'league' | 'season' | 'round', id };
	}

	const db = getDb();
	const children = getChildrenRollups(db, scope);
	return json({ children });
};
