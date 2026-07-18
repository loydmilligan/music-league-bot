import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { notify } from '$lib/notifications/dispatch.js';
import { parseNotifyBody } from '$lib/notifications/notifyEndpoint.js';

export const POST: RequestHandler = async ({ request }) => {
  const parsed = parseNotifyBody(await request.json().catch(() => ({})));
  if (!parsed.ok) return json({ ok: false, reason: parsed.reason }, { status: 400 });
  const results = await notify(getDb(), parsed.payload);
  return json({ ok: true, results });
};
