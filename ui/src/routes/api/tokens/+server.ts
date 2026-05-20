import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { generateToken } from '$lib/auth/bearer.js';

interface TokenRowPublic {
  id: number;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function toPublic(row: TokenRowPublic) {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

// GET /api/tokens — list (no plaintext, ever).
export const GET: RequestHandler = async () => {
  const db = getDb();
  const rows = db
    .prepare('SELECT id, label, created_at, last_used_at, revoked_at FROM api_tokens ORDER BY id DESC')
    .all() as TokenRowPublic[];
  return json(rows.map(toPublic));
};

// POST /api/tokens — generate; plaintext returned ONCE.
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { label?: unknown };
  if (typeof body.label !== 'string' || !body.label.trim()) throw error(400, 'body.label (non-empty string) required');
  const label = body.label.trim();

  const { plaintext, hash } = generateToken();
  const db = getDb();
  const res = db.prepare('INSERT INTO api_tokens (hash, label) VALUES (?, ?)').run(hash, label);
  const row = db
    .prepare('SELECT id, label, created_at, last_used_at, revoked_at FROM api_tokens WHERE id = ?')
    .get(res.lastInsertRowid) as TokenRowPublic;
  return json({ ...toPublic(row), token: plaintext }, { status: 201 });
};
