import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { bearerOk } from '$lib/digest/callbackAuth.js';
import { getNotificationsConfig } from '$lib/notifications/config.js';
import { ensureVideoReviewSchema, snoozeReview } from '$lib/ytm/videoReview.js';

// POST { token } — go quiet for four hours, then re-notify. The token stays
// valid: a snooze is "ask me later", not a decision.
export const POST: RequestHandler = async ({ request }) => {
  const db = getDb();
  ensureVideoReviewSchema(db);
  const expected = getNotificationsConfig(db).channels.ntfy.token || process.env.NTFY_TOKEN;
  if (!bearerOk(request.headers.get('authorization'), expected)) {
    return json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  const res = snoozeReview(db, typeof body.token === 'string' ? body.token : '', () => new Date());
  return json(res, { status: res.ok ? 200 : 400 });
};
