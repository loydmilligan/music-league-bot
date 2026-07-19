import { describe, it, expect } from 'vitest';
import { parseNotifyBody } from './notifyEndpoint.js';

describe('parseNotifyBody', () => {
  it('accepts a valid alert body', () => {
    expect(parseNotifyBody({ alertType: 'digest_sent', title: 'T', message: 'M', link: 'https://x' }))
      .toEqual({ ok: true, payload: { alertType: 'digest_sent', title: 'T', message: 'M', link: 'https://x' } });
  });
  it('rejects an unknown alertType', () => {
    expect(parseNotifyBody({ alertType: 'nope', title: 'T', message: 'M' }).ok).toBe(false);
  });
  it('rejects missing title/message', () => {
    expect(parseNotifyBody({ alertType: 'digest_sent' }).ok).toBe(false);
  });
});
