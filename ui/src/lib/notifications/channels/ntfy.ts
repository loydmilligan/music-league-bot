import {
  publish, buildApprovalNotification, buildReviewNotification,
  type NtfyConfig, type Notification,
} from '$lib/digest/ntfy.js';
import type { NtfyChannelConfig } from '$lib/notifications/config.js';
import type { AlertPayload, Channel } from './types.js';

function asNtfyConfig(cfg: unknown): NtfyChannelConfig {
  const c = (cfg ?? {}) as Partial<NtfyChannelConfig>;
  return { url: c.url ?? '', topic: c.topic ?? '', token: c.token ?? '' };
}

export const ntfyChannel: Channel = {
  id: 'ntfy',
  capabilities: ['alert', 'approval'],
  isConfigured(cfg) {
    const c = asNtfyConfig(cfg);
    return !!c.url && !!c.topic;
  },
  async sendAlert(cfg, p: AlertPayload, deps) {
    const c = asNtfyConfig(cfg);
    const ntfyCfg: NtfyConfig = { url: c.url, topic: c.topic, token: c.token };
    let notif: Notification;
    if (p.approval?.kind === 'approve') {
      notif = buildApprovalNotification({
        league: p.title, round: p.message, reviewUrl: p.link ?? '',
        approveUrl: p.approval.approveUrl ?? '', denyUrl: p.approval.denyUrl, editUrl: p.approval.editUrl,
        token: p.approval.token, bearer: c.token,
      });
    } else if (p.approval?.kind === 'review') {
      notif = buildReviewNotification({
        league: p.title, round: p.message, reviewUrl: p.link ?? '',
        editUrl: p.approval.editUrl, denyUrl: p.approval.denyUrl,
        token: p.approval.token, reason: p.approval.reviewReason ?? '', bearer: c.token,
      });
    } else {
      // plain alert
      notif = { title: p.title, message: p.message, click: p.link, priority: 4 };
    }
    const ok = await publish(ntfyCfg, notif, deps.fetchFn);
    return ok ? { ok: true } : { ok: false, error: 'ntfy publish failed' };
  },
};
