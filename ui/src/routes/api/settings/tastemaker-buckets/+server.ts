import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getBucketBoundaries, updateBucketBoundaries } from '$lib/db/settings.js';

// GET /api/settings/tastemaker-buckets → { boundaries: { b1, b2, b3 } }
// Falls back to the shipped default (10/20/30) if unset or malformed.
export const GET: RequestHandler = () => {
  const db = getDb();
  return json({ boundaries: getBucketBoundaries(db) });
};

// PUT /api/settings/tastemaker-buckets  body: { boundaries: { b1, b2, b3 } }
// Requires integers with 1 <= b1 < b2 < b3 <= 100. Returns { boundaries } (the saved value).
export const PUT: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw error(400, 'JSON body required');

  const { boundaries } = body;
  if (!boundaries) throw error(400, 'body.boundaries required');

  const db = getDb();
  try {
    const saved = updateBucketBoundaries(db, boundaries as { b1: number; b2: number; b3: number });
    return json({ boundaries: saved });
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'invalid boundaries');
  }
};
