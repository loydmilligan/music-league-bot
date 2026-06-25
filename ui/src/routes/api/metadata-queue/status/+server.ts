import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getQueueStatus } from '$lib/db/metadataQueue.js';
import { getDigestReadiness, getCoverageMatrix } from '$lib/db/metadataQueue.js';
import type { Scope } from '$lib/db/metadataQueue.js';

const VALID_LEVELS = new Set(['all', 'league', 'season', 'round']);

export const GET: RequestHandler = async ({ url }) => {
	const db = getDb();

	const levelParam = url.searchParams.get('level');
	const idParam = url.searchParams.get('id');
	const roundIdParam = url.searchParams.get('roundId');

	let scope: Scope | undefined;

	if (levelParam != null) {
		// New-style: ?level=&id=
		if (!VALID_LEVELS.has(levelParam)) {
			return json({ error: 'level must be one of: all, league, season, round' }, { status: 400 });
		}

		if (levelParam === 'all') {
			// level=all needs no id; scope stays undefined (global)
			scope = undefined;
		} else {
			// league|season|round require a valid integer id
			if (idParam == null) {
				return json({ error: `id is required when level is ${levelParam}` }, { status: 400 });
			}
			const id = Number(idParam);
			if (isNaN(id) || !Number.isInteger(id)) {
				return json({ error: 'id must be an integer' }, { status: 400 });
			}
			scope = { level: levelParam as 'league' | 'season' | 'round', id };
		}
	} else if (roundIdParam != null) {
		// Back-compat: ?roundId= (treat as level=round)
		const roundId = Number(roundIdParam);
		if (isNaN(roundId) || !Number.isInteger(roundId)) {
			return json({ error: 'roundId must be an integer' }, { status: 400 });
		}
		scope = { level: 'round', id: roundId };
	}
	// else: no params → scope stays undefined → global

	const status = getQueueStatus(db, scope);

	if (scope?.level === 'round') {
		const roundId = scope.id as number;
		const digestReadiness = getDigestReadiness(db, roundId);
		const coverageMatrix = getCoverageMatrix(db, roundId);
		return json({ ...status, digestReadiness, coverageMatrix });
	}

	return json(status);
};
