import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { retryJob } from '$lib/db/metadataQueue.js';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();

	// --- Bulk path: {ids: number[], action?: 'retry'|'dismiss'} ---
	if (body?.ids !== undefined) {
		const ids: unknown[] = Array.isArray(body.ids) ? body.ids : [];

		// Validate all ids are integers — float or string → 400
		if (!ids.every((i) => typeof i === 'number' && Number.isInteger(i))) {
			return json({ error: 'all ids must be integers' }, { status: 400 });
		}

		const action: 'retry' | 'dismiss' = body?.action === 'dismiss' ? 'dismiss' : 'retry';

		if (ids.length === 0) return json({ updated: 0 });

		const placeholders = ids.map(() => '?').join(',');
		const db = getDb();

		if (action === 'retry') {
			const result = db
				.prepare(
					`UPDATE song_metadata_queue
					 SET status='pending', error=NULL, retries=0, started_at=NULL, done_at=NULL
					 WHERE id IN (${placeholders}) AND status='failed'`
				)
				.run(...(ids as number[]));
			return json({ updated: result.changes });
		} else {
			// dismiss: delete the failed rows
			const result = db
				.prepare(
					`DELETE FROM song_metadata_queue
					 WHERE id IN (${placeholders}) AND status='failed'`
				)
				.run(...(ids as number[]));
			return json({ dismissed: result.changes });
		}
	}

	// --- Back-compat single path: {id: number} ---
	const id = body?.id;

	if (id == null || typeof id !== 'number' || !Number.isInteger(id)) {
		return json({ error: 'id is required and must be an integer' }, { status: 400 });
	}

	const db = getDb();
	retryJob(db, id);

	return json({ ok: true });
};
