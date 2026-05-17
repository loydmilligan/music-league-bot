import type { RequestHandler } from './$types.js';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { deleteShortlistSongById } from '$lib/shortlist/shortlist.js';

export const DELETE: RequestHandler = async ({ params }) => {
  if (!params.id) throw error(400, 'id required');
  deleteShortlistSongById(getDb(), params.id);
  return new Response(null, { status: 204 });
};
