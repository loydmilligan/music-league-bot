import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

const KEY_SETTING = 'openrouter_key';

// GET /api/settings/openrouter-key → { configured: boolean }
// Never echoes the raw key value — server-side only.
export const GET: RequestHandler = async () => {
  const db = getDb();
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(KEY_SETTING) as { value: string } | undefined;
  const configured = !!(row?.value);
  return json({ configured });
};

// PUT /api/settings/openrouter-key  body: { key: string }
// Stores the key server-side. Returns { configured: true } on success.
export const PUT: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw error(400, 'JSON body required');
  if (typeof body.key !== 'string' || !body.key.trim()) {
    throw error(400, 'body.key (non-empty string) required');
  }

  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(KEY_SETTING, body.key.trim());
  return json({ configured: true });
};
