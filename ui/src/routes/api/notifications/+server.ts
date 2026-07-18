import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getNotificationsConfig, setNotificationsConfig, redactSecrets, type NotificationsConfig } from '$lib/notifications/config.js';
import { mergePreservingSecrets } from '$lib/notifications/testSend.js';

export const GET: RequestHandler = async () => {
  // Never ship the real ntfy token to the client — redact before serializing.
  return json(redactSecrets(getNotificationsConfig(getDb())));
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { config?: NotificationsConfig };
  if (!body.config?.channels || !body.config?.routing) return json({ ok: false, reason: 'config required' }, { status: 400 });
  const merged = mergePreservingSecrets(getNotificationsConfig(getDb()), body.config);
  setNotificationsConfig(getDb(), merged);
  return json({ ok: true });
};
