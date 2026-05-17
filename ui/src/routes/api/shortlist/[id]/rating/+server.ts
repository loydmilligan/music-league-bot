import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { patchShortlistRating } from '$lib/shortlist/shortlist.js';

const VALID_DIMENSIONS = ['discovery', 'theme_fit', 'nostalgia', 'personal'] as const;
type Dimension = typeof VALID_DIMENSIONS[number];

export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await request.json() as { dimension?: string; value?: number };
  if (!VALID_DIMENSIONS.includes(body.dimension as Dimension)) {
    throw error(400, 'dimension must be one of: discovery, theme_fit, nostalgia, personal');
  }
  if (typeof body.value !== 'number' || body.value < 0 || body.value > 5) {
    throw error(400, 'value must be a number 0–5');
  }
  patchShortlistRating(getDb(), params.id, body.dimension as Dimension, body.value);
  return json({ ok: true });
};
