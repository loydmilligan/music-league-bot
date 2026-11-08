import { describe, it, expect } from 'vitest';
import { recapLine, followUpText } from '../../src/bot/cmuFollowUp.js';
import { memoryRecapSubs, recapSubscription, setRecapSubsForTest } from '../../src/bot/recapSubs.js';
import { MENU_HEADING, playerMenu } from '../../src/bot/cmuMenu.js';

const TAIL = 'Change: morning-recap unsub · morning-recap 7:30';

describe('recapLine', () => {
  it('undefined gives undefined', () => {
    expect(recapLine(undefined)).toBeUndefined();
  });
  it('on with morning time', () => {
    expect(recapLine({ subscribed: true, time: '07:30' })).toBe(`Morning recap: on, 7:30 AM. ${TAIL}`);
  });
  it('on with evening time', () => {
    expect(recapLine({ subscribed: true, time: '19:05' })).toBe(`Morning recap: on, 7:05 PM. ${TAIL}`);
  });
  it('handles midnight and noon', () => {
    expect(recapLine({ subscribed: true, time: '00:10' })).toContain('12:10 AM');
    expect(recapLine({ subscribed: true, time: '12:00' })).toContain('12:00 PM');
  });
  it('off', () => {
    expect(recapLine({ subscribed: false })).toBe('Morning recap: off. Get it in your DMs: morning-recap sub');
  });
  it('on with missing or bad time omits the time', () => {
    const want = `Morning recap: on. ${TAIL}`;
    expect(recapLine({ subscribed: true })).toBe(want);
    expect(recapLine({ subscribed: true, time: 'soon' })).toBe(want);
    expect(recapLine({ subscribed: true, time: '25:00' })).toBe(want);
  });
});

describe('followUpText', () => {
  const menuBlock = [
    'Send any of these as @bot <command> in the group:',
    '• catch me up — What you missed, as a picture',
    '• help — Everything else I can do',
  ].join('\n');

  it('orders stats, recap, menu', () => {
    const t = followUpText({ lines: ['a', 'b'], sub: { subscribed: false } });
    expect(t).toBe(['a\nb', recapLine({ subscribed: false }), menuBlock].join('\n\n'));
  });
  it('omits recap block when sub undefined', () => {
    expect(followUpText({ lines: ['a'], sub: undefined })).toBe(`a\n\n${menuBlock}`);
  });
  it('omits stats block when lines empty', () => {
    const t = followUpText({ lines: [], sub: { subscribed: false } });
    expect(t).toBe(`${recapLine({ subscribed: false })}\n\n${menuBlock}`);
  });
  it('menu only when nothing else', () => {
    expect(followUpText({ lines: [], sub: undefined })).toBe(menuBlock);
  });
  it('custom menu and heading', () => {
    expect(followUpText({ lines: [], sub: undefined, heading: 'H', menu: [{ command: 'x', oneLine: 'y' }] })).toBe('H\n• x — y');
  });
});

describe('seed values', () => {
  it('heading and menu', () => {
    expect(MENU_HEADING).toBe('Send any of these as @bot <command> in the group:');
    expect(playerMenu(false)).toHaveLength(2);
  });
  it('recapSubscription over an empty store reads not subscribed', () => {
    setRecapSubsForTest(memoryRecapSubs());
    try {
      expect(recapSubscription('anyone')).toEqual({ subscribed: false });
    } finally {
      setRecapSubsForTest(undefined);
    }
  });
});
