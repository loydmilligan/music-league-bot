import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { denyJob } from '$lib/digest/approvals.js';
import { bearerOk } from '$lib/digest/callbackAuth.js';
import { getNotificationsConfig } from '$lib/notifications/config.js';

export const POST: RequestHandler = async ({ request }) => {
  const expected = getNotificationsConfig(getDb()).channels.ntfy.token || process.env.NTFY_TOKEN;
  if (!bearerOk(request.headers.get('authorization'), expected)) {
    return json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === 'string' ? body.token : '';
  const result = await denyJob(getDb(), token, () => new Date().toISOString());
  return json(result, { status: result.ok ? 200 : 400 });
};
