import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { patchShortlistNotes } from '$lib/shortlist/shortlist.js';

export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await request.json() as { notes?: string };
  if (typeof body.notes !== 'string') throw error(400, 'notes must be a string');
  patchShortlistNotes(getDb(), params.id, body.notes);
  return json({ ok: true });
};
