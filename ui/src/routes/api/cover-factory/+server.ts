import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { getState, runAction, runUpload, toApiError } from '$lib/server/coverFactory/service.js';
import { getAutoState, runAutoUiAction } from '$lib/server/coverFactory/autoQueue.js';

function fail(e: unknown): Response {
	const { status, body } = toApiError(e);
	return json(body, { status });
}

export const GET: RequestHandler = async ({ url }) => {
	try {
		// ?autoLeagues=1 / ?autoRound=<id> live in autoQueue (service.ts must not import it).
		const auto = getAutoState(getDb(), url.searchParams);
		if (auto !== undefined) return json(auto);
		return json(await getState(getDb(), url.searchParams));
	} catch (e) {
		return fail(e);
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		if ((request.headers.get('content-type') ?? '').includes('multipart/form-data')) {
			return json(await runUpload(getDb(), await request.formData()));
		}
		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return json({ error: 'invalid JSON body' }, { status: 400 });
		}
		if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'JSON object required' }, { status: 400 });
		const b = body as Record<string, unknown>;
		// 'run-auto' / 'auto-leagues' live in autoQueue (service.ts must not import it: autoQueue → autoRun → service).
		const auto = runAutoUiAction(getDb(), b);
		if (auto !== undefined) return json(auto);
		return json(await runAction(getDb(), b));
	} catch (e) {
		return fail(e);
	}
};
