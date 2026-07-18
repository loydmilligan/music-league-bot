import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { notify } from './dispatch.js';
import { setNotificationsConfig, getNotificationsConfig } from './config.js';
import type { AlertPayload } from './channels/types.js';

const ENV = { NTFY_URL: 'https://n', NTFY_TOPIC: 't', NTFY_TOKEN: 'k', OWNER_PHONE_NUMBER: '1@c.us' };
function db(routing: Partial<Record<string, { ntfy: boolean; whatsapp: boolean }>>): Database.Database {
  const d = new Database(':memory:');
  d.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  const cfg = getNotificationsConfig(d, ENV);
  for (const [k, v] of Object.entries(routing)) cfg.routing[k as never] = v as never;
  setNotificationsConfig(d, cfg);
  return d;
}
const alert: AlertPayload = { alertType: 'pipeline_failure', title: 'T', message: 'M' };

describe('notify dispatch', () => {
  it('fans out only to channels routed AND configured', async () => {
    const d = db({ pipeline_failure: { ntfy: true, whatsapp: true } });
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    const res = await notify(d, alert, { fetchFn, botControlUrl: 'http://bot:3003' });
    expect(res.filter((r) => r.ok).map((r) => r.channel).sort()).toEqual(['ntfy', 'whatsapp']);
    expect(fetchFn).toHaveBeenCalledTimes(2); // one ntfy publish + one control /notify
  });
  it('skips a channel that is unrouted', async () => {
    const d = db({ pipeline_failure: { ntfy: true, whatsapp: false } });
    const res = await notify(d, alert, { fetchFn: vi.fn().mockResolvedValue({ ok: true }) });
    expect(res.find((r) => r.channel === 'whatsapp')?.skipped).toBe('unrouted');
  });
  it('skips a channel that is routed but unconfigured', async () => {
    const d = new Database(':memory:');
    d.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
    const cfg = getNotificationsConfig(d, { OWNER_PHONE_NUMBER: '1@c.us' }); // no NTFY_* → ntfy unconfigured
    cfg.routing.pipeline_failure = { ntfy: true, whatsapp: false };
    setNotificationsConfig(d, cfg);
    const res = await notify(d, alert, { fetchFn: vi.fn() });
    expect(res.find((r) => r.channel === 'ntfy')?.skipped).toBe('unconfigured');
  });
  it('one channel failing does not block the other, and notify never throws', async () => {
    const d = db({ pipeline_failure: { ntfy: true, whatsapp: true } });
    // ntfy publish (first call) rejects; whatsapp (second) ok
    const fetchFn = vi.fn().mockRejectedValueOnce(new Error('ntfy down')).mockResolvedValueOnce({ ok: true });
    const res = await notify(d, alert, { fetchFn, botControlUrl: 'http://bot:3003' });
    expect(res.find((r) => r.channel === 'ntfy')?.ok).toBe(false);
    expect(res.find((r) => r.channel === 'whatsapp')?.ok).toBe(true);
  });
});
