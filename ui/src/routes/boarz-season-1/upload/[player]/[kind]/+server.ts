import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { saveStillUpload } from '$lib/server/boarzReview.js';

export const POST: RequestHandler = async ({ params, request }) => {
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) error(400, 'Missing file field');
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  const result = await saveStillUpload(params.player, params.kind as 'person' | 'inspiration', await file.arrayBuffer(), ext);
  if (!result.ok) error(400, result.error);
  return json(result);
};
