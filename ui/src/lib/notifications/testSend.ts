import type { NotificationsConfig } from './config.js';
import type { AlertPayload } from './channels/types.js';

export function buildTestPayload(): AlertPayload {
  return { alertType: 'pipeline_failure', title: '🔔 Test notification', message: 'This is a test from the notifications settings panel.' };
}

/** Merge incoming config over stored, but keep a stored secret when the incoming secret field is blank. */
export function mergePreservingSecrets(stored: NotificationsConfig, incoming: NotificationsConfig): NotificationsConfig {
  const token = incoming.channels.ntfy.token.trim() === '' ? stored.channels.ntfy.token : incoming.channels.ntfy.token;
  return {
    channels: {
      ntfy: { ...incoming.channels.ntfy, token },
      whatsapp: { ...incoming.channels.whatsapp },
    },
    routing: incoming.routing,
  };
}
