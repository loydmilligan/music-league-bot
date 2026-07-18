import { describe, it, expect, vi } from 'vitest';
import { whatsappChannel } from './whatsapp.js';
import type { AlertPayload } from './types.js';

describe('whatsappChannel', () => {
  it('declares alert-only capability', () => {
    expect(whatsappChannel.id).toBe('whatsapp');
    expect(whatsappChannel.capabilities).toEqual(['alert']);
  });
  it('isConfigured requires an ownerNumber', () => {
    expect(whatsappChannel.isConfigured({ ownerNumber: '1@c.us' })).toBe(true);
    expect(whatsappChannel.isConfigured({ ownerNumber: '' })).toBe(false);
    expect(whatsappChannel.isConfigured({})).toBe(false);
  });
  it('POSTs the bot control /notify with a composed text and returns ok on 2xx', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    const p: AlertPayload = { alertType: 'digest_ready', title: 'Fam-Jam — R12', message: 'Digest ready.', link: 'https://d/x' };
    const r = await whatsappChannel.sendAlert({ ownerNumber: '1@c.us' }, p, { fetchFn, botControlUrl: 'http://bot:3003' });
    expect(r.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://bot:3003/notify');
    const body = JSON.parse(init.body);
    expect(body.text).toContain('Fam-Jam — R12');
    expect(body.text).toContain('Digest ready.');
    expect(body.text).toContain('https://d/x');
  });
  it('returns ok:false (never throws) when the control POST fails or rejects', async () => {
    expect((await whatsappChannel.sendAlert({ ownerNumber: '1@c.us' }, { alertType: 'digest_sent', title: 'T', message: 'M' }, { fetchFn: vi.fn().mockResolvedValue({ ok: false, status: 500 }), botControlUrl: 'http://bot:3003' })).ok).toBe(false);
    expect((await whatsappChannel.sendAlert({ ownerNumber: '1@c.us' }, { alertType: 'digest_sent', title: 'T', message: 'M' }, { fetchFn: vi.fn().mockRejectedValue(new Error('net')), botControlUrl: 'http://bot:3003' })).ok).toBe(false);
  });
});
