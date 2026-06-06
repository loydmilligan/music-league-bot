import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getTaxonomy, upsertVocabTag } from '$lib/db/themeTags.js';

// GET /api/theme-tags — the full taxonomy: { categories, tags } (the vocabulary).
export const GET: RequestHandler = async () => {
  return json(getTaxonomy(getDb()));
};

// POST /api/theme-tags — create (or get) a vocabulary tag. Body { category, value }.
// Auto-creates the category if new (the extensibility hook). Returns { tag }.
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { category?: unknown; value?: unknown };
  if (typeof body.category !== 'string' || body.category.trim() === '') {
    throw error(400, 'body.category (non-empty string) required');
  }
  if (typeof body.value !== 'string' || body.value.trim() === '') {
    throw error(400, 'body.value (non-empty string) required');
  }
  const tag = upsertVocabTag(getDb(), body.category, body.value);
  return json({ tag });
};
