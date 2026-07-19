import type Database from 'better-sqlite3';

export type AlertType = 'pipeline_failure' | 'ml_auth_expired' | 'digest_ready' | 'digest_sent';
export type ChannelId = 'ntfy' | 'whatsapp';

export const ALERT_TYPES: AlertType[] = ['pipeline_failure', 'ml_auth_expired', 'digest_ready', 'digest_sent'];
export const CHANNEL_IDS: ChannelId[] = ['ntfy', 'whatsapp'];

export interface NtfyChannelConfig { url: string; topic: string; token: string }
export interface WhatsappChannelConfig { ownerNumber: string }
export interface NotificationsConfig {
  channels: { ntfy: NtfyChannelConfig; whatsapp: WhatsappChannelConfig };
  routing: Record<AlertType, Record<ChannelId, boolean>>;
}

const KEY = 'notifications';

type Env = Record<string, string | undefined>;

function defaults(env: Env): NotificationsConfig {
  const routing = {} as NotificationsConfig['routing'];
  for (const a of ALERT_TYPES) {
    // The three real alerts default to ntfy (today's behavior); digest_sent is opt-in.
    routing[a] = { ntfy: a !== 'digest_sent', whatsapp: false };
  }
  return {
    channels: {
      ntfy: { url: env.NTFY_URL ?? '', topic: env.NTFY_TOPIC ?? '', token: env.NTFY_TOKEN ?? '' },
      whatsapp: { ownerNumber: env.OWNER_PHONE_NUMBER ?? '' },
    },
    routing,
  };
}

export function getNotificationsConfig(
  db: Database.Database, env: Env = process.env,
): NotificationsConfig {
  const base = defaults(env);
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  if (!row?.value) return base;
  let stored: Partial<NotificationsConfig>;
  try {
    stored = JSON.parse(row.value) as Partial<NotificationsConfig>;
  } catch {
    return base;
  }
  // Deep-fill: stored values win, missing keys fall back to defaults.
  const merged: NotificationsConfig = {
    channels: {
      ntfy: { ...base.channels.ntfy, ...(stored.channels?.ntfy ?? {}) },
      whatsapp: { ...base.channels.whatsapp, ...(stored.channels?.whatsapp ?? {}) },
    },
    routing: {} as NotificationsConfig['routing'],
  };
  for (const a of ALERT_TYPES) {
    merged.routing[a] = { ...base.routing[a], ...(stored.routing?.[a] ?? {}) };
  }
  return merged;
}

export function setNotificationsConfig(db: Database.Database, cfg: NotificationsConfig): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(KEY, JSON.stringify(cfg));
}

/**
 * Strip the ntfy secret before a config leaves the server (SSR load props, GET
 * response body, etc). Never mutates the input. `hasNtfyToken` lets the client
 * show "a token is stored" without ever seeing it.
 */
export function redactSecrets(cfg: NotificationsConfig): { config: NotificationsConfig; hasNtfyToken: boolean } {
  const hasNtfyToken = cfg.channels.ntfy.token.trim() !== '';
  const config: NotificationsConfig = {
    channels: {
      ntfy: { ...cfg.channels.ntfy, token: '' },
      whatsapp: { ...cfg.channels.whatsapp },
    },
    routing: cfg.routing,
  };
  return { config, hasNtfyToken };
}
