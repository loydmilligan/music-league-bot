import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

const KEY = 'auto_analyze_audio';

export const GET: RequestHandler = async () => {
	const db = getDb();
	const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined;
	return json({ enabled: row?.value === '1' });
};

export const PUT: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body.enabled !== 'boolean') throw error(400, 'body.enabled (boolean) required');

	const db = getDb();
	db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(KEY, body.enabled ? '1' : '0');
	return json({ enabled: body.enabled });
};
