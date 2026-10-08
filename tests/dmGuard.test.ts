import { describe, it, expect } from 'vitest';
import { normalizeE164, resolveDmTarget } from '../src/whatsapp/dmGuard.js';
import { allowPlayerDm, collectOptedIn, OFF_REASON } from '../src/whatsapp/optIn.js';

describe('resolveDmTarget', () => {
  it('blocks empty numbers so the scheduler can run before Matt fills them in', () => {
    expect(resolveDmTarget(null)).toMatchObject({ action: 'block', reason: 'no WhatsApp number linked yet' });
    expect(resolveDmTarget('')).toMatchObject({ action: 'block' });
  });
  it('accepts E.164 and maps to a @c.us chat, never a group', () => {
    expect(normalizeE164('1 (661) 747-6822')).toBe('+16617476822');
    expect(resolveDmTarget('+16617476822')).toEqual({
      action: 'send',
      e164: '+16617476822',
      target: '16617476822@c.us',
      reason: 'DM +16617476822',
    });
    expect(resolveDmTarget('12025550123@g.us').action).toBe('block');
  });
});

describe('allowPlayerDm', () => {
  it('blocks a linked number until WhatsApp notifications are on', () => {
    const opted = collectOptedIn([{
      'Matt Mariani': { whatsapp: { enabled: false, e164: '+16617476822' } },
      'Jon Black': { whatsapp: { enabled: true, e164: '+17753381153' } },
    }]);
    expect([...opted]).toEqual(['+17753381153']);
    expect(allowPlayerDm('+16617476822', opted)).toMatchObject({ action: 'block', reason: OFF_REASON });
    expect(allowPlayerDm('+17753381153', opted).action).toBe('send');
  });
});
