import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { patchSubmittedElsewhere } from '$lib/shortlist/shortlist.js';

export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await request.json() as { value?: boolean };
  if (typeof body.value !== 'boolean') throw error(400, 'value must be boolean');
  patchSubmittedElsewhere(getDb(), params.id, body.value);
  return json({ ok: true });
};
