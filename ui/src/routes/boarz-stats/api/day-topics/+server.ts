import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { buildSnapshotCached } from '$lib/server/boarzStats/data.js';
import { loadSummaries, summarizeMissingPeaks } from '$lib/server/boarzStats/summaries.js';

// single-flight so concurrent page loads don't double-spend LLM calls
let inflight: Promise<unknown> | null = null;

export const GET: RequestHandler = async () => {
	const snap = buildSnapshotCached();
	const db = getDb();
	if (!inflight) {
		inflight = summarizeMissingPeaks(db, snap.chat.peaks).finally(() => {
			inflight = null;
		});
	}
	const summaries = await inflight;
	return json({ peaks: snap.chat.peaks, summaries });
};
