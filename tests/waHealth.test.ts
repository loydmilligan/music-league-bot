import { describe, it, expect } from 'vitest';
import { probeHealth } from '../src/whatsapp/health.js';
import { parseControlRequest } from '../src/control/router.js';

describe('probeHealth', () => {
  it('is ok when WhatsApp Web reports CONNECTED', async () => {
    const r = await probeHealth(async () => 'CONNECTED', 1000);
    expect(r.ok).toBe(true);
    expect(r.state).toBe('CONNECTED');
    expect(typeof r.ms).toBe('number');
  });

  it('is not ok for any other state', async () => {
    const r = await probeHealth(async () => 'UNPAIRED', 1000);
    expect(r).toMatchObject({ ok: false, state: 'UNPAIRED' });
  });

  it('is not ok when the page call throws (crashed renderer)', async () => {
    const r = await probeHealth(async () => { throw new Error('Target closed'); }, 1000);
    expect(r).toMatchObject({ ok: false, state: null, reason: 'Target closed' });
  });

  it('times out when the page call hangs', async () => {
    const r = await probeHealth(() => new Promise<string>(() => {}), 50);
    expect(r).toMatchObject({ ok: false, state: null, reason: 'timeout after 50ms' });
  });
});

describe('GET /health route', () => {
  it('routes GET /health', () => {
    expect(parseControlRequest('GET', '/health', {})).toEqual({ action: 'health' });
  });

  it('still refuses GET on every other path', () => {
    expect(parseControlRequest('GET', '/say', {}).action).toBe('unknown');
  });
});
