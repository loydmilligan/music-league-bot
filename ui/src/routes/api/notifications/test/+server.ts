import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getNotificationsConfig, CHANNEL_IDS, type ChannelId } from '$lib/notifications/config.js';
import { CHANNELS } from '$lib/notifications/dispatch.js';
import { buildTestPayload } from '$lib/notifications/testSend.js';

const botControlUrl = process.env.BOT_CONTROL_URL ?? 'http://bot:3003';

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { channel?: string };
  if (!CHANNEL_IDS.includes(body.channel as ChannelId)) return json({ ok: false, reason: 'unknown channel' }, { status: 400 });
  const ch = CHANNELS.find((c) => c.id === body.channel)!;
  const cfg = getNotificationsConfig(getDb());
  const chCfg = cfg.channels[ch.id];
  if (!ch.isConfigured(chCfg)) return json({ ok: false, error: 'channel not configured' });
  const r = await ch.sendAlert(chCfg, buildTestPayload(), { botControlUrl });
  return json(r);
};
