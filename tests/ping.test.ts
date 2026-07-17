import { describe, it, expect } from 'vitest';
import { resolvePing } from '../src/digest/ping.js';

const TARGET = '120363426590199032@g.us';

describe('resolvePing', () => {
  it('is off unless DIGEST_PING_TARGET is set', () => {
    expect(resolvePing({})).toBeNull();
    expect(resolvePing({ DIGEST_PING_TARGET: '' })).toBeNull();
  });

  it('routes the ping through the guard in live mode so the @g.us check applies', () => {
    const p = resolvePing({ DIGEST_PING_TARGET: TARGET });
    expect(p?.env).toMatchObject({ mode: 'live', targets: { ping: TARGET } });
  });

  it('defaults to an inane, self-explaining message', () => {
    const p = resolvePing({ DIGEST_PING_TARGET: TARGET });
    expect(p?.text).toMatch(/\S/);
    expect(p?.text.length).toBeLessThan(80);
  });

  it('lets the message be overridden', () => {
    const p = resolvePing({ DIGEST_PING_TARGET: TARGET, DIGEST_PING_TEXT: '👍' });
    expect(p?.text).toBe('👍');
  });

  it('carries the slug the guard expects', () => {
    expect(resolvePing({ DIGEST_PING_TARGET: TARGET })?.leagueSlug).toBe('ping');
  });
});
