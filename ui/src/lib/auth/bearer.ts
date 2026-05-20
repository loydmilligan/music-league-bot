import type Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import { error } from '@sveltejs/kit';

export interface ApiTokenRow {
  id: number;
  hash: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateToken(): { plaintext: string; hash: string } {
  const plaintext = randomBytes(32).toString('hex');
  return { plaintext, hash: hashToken(plaintext) };
}

// Reads `Authorization: Bearer <token>` from the request, SHA-256 hashes it,
// looks up an active (non-revoked) row in api_tokens, updates last_used_at,
// returns the row. Throws SvelteKit 401 on any failure mode.
export function requireBearerToken(request: Request, db: Database.Database): ApiTokenRow {
  const header = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!header) throw error(401, 'missing Authorization header');
  const match = header.match(/^Bearer\s+([A-Za-z0-9._\-+/=]+)$/);
  if (!match) throw error(401, 'malformed Authorization header (expected: Bearer <token>)');
  const hash = hashToken(match[1]);
  const row = db
    .prepare(
      `SELECT id, hash, label, created_at, last_used_at, revoked_at
       FROM api_tokens WHERE hash = ? AND revoked_at IS NULL`,
    )
    .get(hash) as ApiTokenRow | undefined;
  if (!row) throw error(401, 'invalid or revoked token');
  db.prepare(`UPDATE api_tokens SET last_used_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).run(row.id);
  return row;
}
