import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { credsFromEnv, searchVideos } from '$lib/ytm/youtube.js';

/**
 * POST { query } — search YouTube from the review page.
 *
 * In-app, same auth surface as the rest of the review routes. Each call spends
 * 100 quota units of the daily 10,000, which is why it is only ever triggered
 * by somebody typing — nothing here runs on a timer.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { query?: unknown } | null;
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (!query) throw error(400, 'query is required');

  const creds = credsFromEnv();
  if (!creds) throw error(503, 'YOUTUBE_* credentials are missing');
  try {
    return json({ ok: true, results: await searchVideos(creds, query) });
  } catch (e) {
    // A quota-exhausted or 403 search must read as a message, not a 500 page.
    return json({ ok: false, reason: e instanceof Error ? e.message : 'search failed' }, { status: 502 });
  }
};
