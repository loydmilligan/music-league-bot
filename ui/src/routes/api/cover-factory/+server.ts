import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { getState, runAction, runUpload, toApiError } from '$lib/server/coverFactory/service.js';

function fail(e: unknown): Response {
	const { status, body } = toApiError(e);
	return json(body, { status });
}

export const GET: RequestHandler = async ({ url }) => {
	try {
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
		return json(await runAction(getDb(), body as Record<string, unknown>));
	} catch (e) {
		return fail(e);
	}
};
