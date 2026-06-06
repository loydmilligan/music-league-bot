import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getRoundTags, setRoundTags, addRoundTag, type TagRef } from '$lib/db/themeTags.js';

function requireRound(roundIdParam: string | undefined): number {
  const roundId = Number(roundIdParam);
  if (!roundId) throw error(400, 'invalid roundId');
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM rounds WHERE id = ?').get(roundId)) {
    throw error(404, `round not found: ${roundId}`);
  }
  return roundId;
}

function parseTagRef(raw: unknown, i: number): TagRef {
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o.id === 'number' && Number.isInteger(o.id)) return { id: o.id };
    if (typeof o.category === 'string' && typeof o.value === 'string'
        && o.category.trim() && o.value.trim()) {
      return { category: o.category, value: o.value };
    }
  }
  throw error(400, `tags[${i}] must be { id } or { category, value }`);
}

// GET /api/rounds/:roundId/tags — the round's attached tags.
export const GET: RequestHandler = async ({ params }) => {
  const roundId = requireRound(params.roundId);
  return json({ roundId, tags: getRoundTags(getDb(), roundId) });
};

// PUT /api/rounds/:roundId/tags — replace the round's full tag set.
// Body { tags: Array<{ id } | { category, value }> }. Upserts vocab as needed.
export const PUT: RequestHandler = async ({ params, request }) => {
  const roundId = requireRound(params.roundId);
  const body = (await request.json().catch(() => ({}))) as { tags?: unknown };
  if (!Array.isArray(body.tags)) throw error(400, 'body.tags (array) required');
  const refs = body.tags.map(parseTagRef);
  try {
    return json({ roundId, tags: setRoundTags(getDb(), roundId, refs) });
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'failed to set tags');
  }
};

// POST /api/rounds/:roundId/tags — add a single tag. Body { category, value }.
export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = requireRound(params.roundId);
  const body = (await request.json().catch(() => ({}))) as { category?: unknown; value?: unknown };
  if (typeof body.category !== 'string' || body.category.trim() === '') {
    throw error(400, 'body.category (non-empty string) required');
  }
  if (typeof body.value !== 'string' || body.value.trim() === '') {
    throw error(400, 'body.value (non-empty string) required');
  }
  const db = getDb();
  const tag = addRoundTag(db, roundId, body.category, body.value);
  return json({ roundId, tag, tags: getRoundTags(db, roundId) }, { status: 201 });
};
