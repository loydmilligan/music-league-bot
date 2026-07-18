import type { PageServerLoad } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { getNotificationsConfig, ALERT_TYPES, CHANNEL_IDS } from '$lib/notifications/config.js';
import { CHANNELS } from '$lib/notifications/dispatch.js';

export const load: PageServerLoad = async () => {
  const config = getNotificationsConfig(getDb());
  // capability map so the grid can disable a cell a channel can't service (future-proofing)
  const capabilities = Object.fromEntries(CHANNELS.map((c) => [c.id, c.capabilities]));
  return { config, alertTypes: ALERT_TYPES, channelIds: CHANNEL_IDS, capabilities };
};
