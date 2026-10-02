import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { saveJonReviewResponses } from '$lib/server/boarzJonReview.js';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const result = await saveJonReviewResponses(await request.json());
    return json({ ok: true, ...result }, { headers: { 'X-Robots-Tag': 'noindex, nofollow' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save review';
    return json({ ok: false, error: message }, { status: 400, headers: { 'X-Robots-Tag': 'noindex, nofollow' } });
  }
};
