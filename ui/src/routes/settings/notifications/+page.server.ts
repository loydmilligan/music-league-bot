import type { PageServerLoad } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { getNotificationsConfig, redactSecrets, ALERT_TYPES, CHANNEL_IDS } from '$lib/notifications/config.js';
import { CHANNELS } from '$lib/notifications/dispatch.js';

export const load: PageServerLoad = async () => {
  // Redact the ntfy token before it reaches SSR page data — the real secret
  // must never ship to the browser (the password field masks visually only).
  const { config, hasNtfyToken } = redactSecrets(getNotificationsConfig(getDb()));
  // capability map so the grid can disable a cell a channel can't service (future-proofing)
  const capabilities = Object.fromEntries(CHANNELS.map((c) => [c.id, c.capabilities]));
  return { config, hasNtfyToken, alertTypes: ALERT_TYPES, channelIds: CHANNEL_IDS, capabilities };
};
