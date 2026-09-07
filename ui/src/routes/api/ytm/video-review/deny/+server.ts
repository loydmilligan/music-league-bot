import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { bearerOk } from '$lib/digest/callbackAuth.js';
import { getNotificationsConfig } from '$lib/notifications/config.js';
import { ensureVideoReviewSchema, denyReview } from '$lib/ytm/videoReview.js';

// POST { token } — drop the video playlist for this round. Posts nothing and
// undoes nothing already posted; the picks are kept so the page stays readable.
export const POST: RequestHandler = async ({ request }) => {
  const db = getDb();
  ensureVideoReviewSchema(db);
  const expected = getNotificationsConfig(db).channels.ntfy.token || process.env.NTFY_TOKEN;
  if (!bearerOk(request.headers.get('authorization'), expected)) {
    return json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  const res = denyReview(db, typeof body.token === 'string' ? body.token : '', () => new Date().toISOString());
  return json(res, { status: res.ok ? 200 : 400 });
};
