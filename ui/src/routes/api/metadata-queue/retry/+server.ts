import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { retryJob } from '$lib/db/metadataQueue.js';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const id = body?.id;

	if (id == null || typeof id !== 'number' || !Number.isInteger(id)) {
		return json({ error: 'id is required and must be an integer' }, { status: 400 });
	}

	const db = getDb();
	retryJob(db, id);

	return json({ ok: true });
};
