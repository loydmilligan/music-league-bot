import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { getNotificationsConfig, setNotificationsConfig, ALERT_TYPES, CHANNEL_IDS } from './config.js';

function db(): Database.Database {
  const d = new Database(':memory:');
  d.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  return d;
}
const ENV = { NTFY_URL: 'https://n', NTFY_TOPIC: 't', NTFY_TOKEN: 'k', OWNER_PHONE_NUMBER: '111@c.us' };

describe('notifications config', () => {
  it('exposes the four alert types and two channels', () => {
    expect(ALERT_TYPES).toEqual(['pipeline_failure', 'ml_auth_expired', 'digest_ready', 'digest_sent']);
    expect(CHANNEL_IDS).toEqual(['ntfy', 'whatsapp']);
  });
  it('seeds ntfy + whatsapp from env when unset, with a default routing grid', () => {
    const cfg = getNotificationsConfig(db(), ENV);
    expect(cfg.channels.ntfy).toEqual({ url: 'https://n', topic: 't', token: 'k' });
    expect(cfg.channels.whatsapp).toEqual({ ownerNumber: '111@c.us' });
    // every alert type has a routing entry for every channel
    for (const a of ALERT_TYPES) for (const c of CHANNEL_IDS) expect(typeof cfg.routing[a][c]).toBe('boolean');
    // default: the three real alerts go to ntfy; digest_sent is opt-in (all false)
    expect(cfg.routing.pipeline_failure.ntfy).toBe(true);
    expect(cfg.routing.digest_sent.ntfy).toBe(false);
  });
  it('round-trips a saved blob and it wins over env', () => {
    const d = db();
    const cfg = getNotificationsConfig(d, ENV);
    cfg.channels.ntfy.topic = 'saved-topic';
    cfg.routing.digest_sent.whatsapp = true;
    setNotificationsConfig(d, cfg);
    const reloaded = getNotificationsConfig(d, ENV);
    expect(reloaded.channels.ntfy.topic).toBe('saved-topic');
    expect(reloaded.routing.digest_sent.whatsapp).toBe(true);
  });
  it('deep-fills a partial stored blob (missing channel/routing keys) from defaults', () => {
    const d = db();
    d.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('notifications', JSON.stringify({ channels: { ntfy: { url: 'x', topic: 'y', token: 'z' } } }));
    const cfg = getNotificationsConfig(d, ENV);
    expect(cfg.channels.whatsapp.ownerNumber).toBe('111@c.us'); // filled from env
    expect(cfg.routing.digest_ready.ntfy).toBe(true);            // filled from default
  });
});
