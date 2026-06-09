import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';

const TRIGGER_URL = process.env.ML_AUTH_TRIGGER_URL ?? 'http://localhost:7679';

export const POST: RequestHandler = async () => {
	try {
		const res = await fetch(`${TRIGGER_URL}/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});
		const body = await res.json().catch(() => ({}));
		return json(body, { status: res.status });
	} catch (err) {
		return json(
			{
				ok: false,
				error:
					err instanceof Error
						? `Host login trigger unreachable at ${TRIGGER_URL}: ${err.message}`
						: 'Host login trigger unreachable'
			},
			{ status: 502 }
		);
	}
};
