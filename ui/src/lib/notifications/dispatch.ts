import type Database from 'better-sqlite3';
import { getNotificationsConfig, type ChannelId } from './config.js';
import { ntfyChannel } from './channels/ntfy.js';
import { whatsappChannel } from './channels/whatsapp.js';
import type { AlertPayload, Channel, ChannelDeps } from './channels/types.js';

export const CHANNELS: Channel[] = [ntfyChannel, whatsappChannel];

export interface NotifyResult {
  channel: ChannelId;
  ok: boolean;
  error?: string;
  skipped?: 'unrouted' | 'unconfigured';
}

export async function notify(
  db: Database.Database, payload: AlertPayload, deps: ChannelDeps = {},
): Promise<NotifyResult[]> {
  const cfg = getNotificationsConfig(db);
  const routing = cfg.routing[payload.alertType] ?? ({} as Record<ChannelId, boolean>);
  const results: NotifyResult[] = [];
  for (const ch of CHANNELS) {
    if (!routing[ch.id]) { results.push({ channel: ch.id, ok: false, skipped: 'unrouted' }); continue; }
    const chCfg = cfg.channels[ch.id];
    if (!ch.isConfigured(chCfg)) { results.push({ channel: ch.id, ok: false, skipped: 'unconfigured' }); continue; }
    try {
      const r = await ch.sendAlert(chCfg, payload, deps);
      if (!r.ok) console.error(`[notify] ${ch.id} ${payload.alertType} failed: ${r.error ?? 'unknown'}`);
      results.push({ channel: ch.id, ...r });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[notify] ${ch.id} ${payload.alertType} threw: ${error}`);
      results.push({ channel: ch.id, ok: false, error });
    }
  }
  return results;
}
