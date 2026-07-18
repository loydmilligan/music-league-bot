import { ALERT_TYPES } from './config.js';
import type { AlertPayload } from './channels/types.js';

export function parseNotifyBody(body: unknown): { ok: true; payload: AlertPayload } | { ok: false; reason: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!ALERT_TYPES.includes(b.alertType as never)) return { ok: false, reason: 'invalid alertType' };
  if (typeof b.title !== 'string' || !b.title) return { ok: false, reason: 'title required' };
  if (typeof b.message !== 'string' || !b.message) return { ok: false, reason: 'message required' };
  const payload: AlertPayload = {
    alertType: b.alertType as AlertPayload['alertType'],
    title: b.title, message: b.message,
    link: typeof b.link === 'string' ? b.link : undefined,
  };
  return { ok: true, payload };
}
