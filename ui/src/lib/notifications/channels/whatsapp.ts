import type { WhatsappChannelConfig } from '$lib/notifications/config.js';
import type { AlertPayload, Channel } from './types.js';

function asCfg(cfg: unknown): WhatsappChannelConfig {
  const c = (cfg ?? {}) as Partial<WhatsappChannelConfig>;
  return { ownerNumber: c.ownerNumber ?? '' };
}

function composeText(p: AlertPayload): string {
  const lines = [p.title, p.message];
  if (p.approval?.kind === 'review' && p.approval.reviewReason) lines.push(`(needs review: ${p.approval.reviewReason})`);
  if (p.link) lines.push(p.link);
  return lines.filter(Boolean).join('\n');
}

export const whatsappChannel: Channel = {
  id: 'whatsapp',
  capabilities: ['alert'],
  isConfigured(cfg) {
    return !!asCfg(cfg).ownerNumber;
  },
  async sendAlert(_cfg, p, deps) {
    const url = deps.botControlUrl ?? process.env.BOT_CONTROL_URL ?? 'http://bot:3003';
    const fetchFn = deps.fetchFn ?? fetch;
    try {
      const res = await fetchFn(`${url}/notify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: composeText(p) }),
      });
      return res.ok ? { ok: true } : { ok: false, error: `control /notify ${res.status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
