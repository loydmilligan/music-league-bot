import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { bearerOk } from '$lib/digest/callbackAuth.js';
import { getNotificationsConfig } from '$lib/notifications/config.js';
import { ensurePlaylistSchema } from '$lib/ytm/playlistVotes.js';
import { approveMessage, denyMessage } from '$lib/ytm/playlistRelease.js';

/**
 * POST { token } — the ntfy approve action for a playlist message.
 *
 * Public callback, so it carries the shared NTFY_TOKEN bearer as well as the
 * message's own single-use token. The token is consumed inside the claim, before
 * anything is posted, so a double-tap cannot send twice.
 */
export const POST: RequestHandler = async ({ request }) => {
  const db = getDb();
  ensurePlaylistSchema(db);
  const expected = getNotificationsConfig(db).channels.ntfy.token || process.env.NTFY_TOKEN;
  if (!bearerOk(request.headers.get('authorization'), expected)) {
    return json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === 'string' ? body.token : '';
  const res = await approveMessage(db, token);
  if (!res) return json({ ok: false, reason: 'invalid or already-decided token' }, { status: 400 });
  return json({ ok: true, id: res.message.id, posted: res.posted });
};
