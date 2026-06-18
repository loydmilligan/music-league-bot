import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

const KEY_SETTING = 'debug_mode';

// GET /api/settings/debug-mode → { enabled: boolean }
// Returns false when the key has never been set (default off).
export const GET: RequestHandler = () => {
  const db = getDb();
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(KEY_SETTING) as { value: string } | undefined;
  const enabled = row?.value === 'true';
  return json({ enabled });
};

// PUT /api/settings/debug-mode  body: { enabled: boolean }
// Persists the debug_mode setting. Returns { enabled: boolean }.
export const PUT: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw error(400, 'JSON body required');
  if (typeof body.enabled !== 'boolean') {
    throw error(400, 'body.enabled (boolean) required');
  }

  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    KEY_SETTING,
    body.enabled ? 'true' : 'false',
  );
  return json({ enabled: body.enabled });
};
