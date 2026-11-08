import { describe, it, expect } from 'vitest';
import {
  frameMessage,
  frameCaption,
  lastVisitFact,
  dailyCountFact,
  MESSAGE_NAMES,
  FRAME_DIVIDER,
  FOOTER_RETRY,
} from '../../src/bot/messageFrame.js';

describe('frameMessage', () => {
  it('frames name, facts, body, divider, footer', () => {
    const out = frameMessage({
      name: MESSAGE_NAMES.catchup,
      facts: ['Last Visit = none (last 24 h)', 'Daily Count 1 of 3'],
      body: 'Body line.',
      footer: FOOTER_RETRY,
    });
    expect(out).toBe(
      [
        '── Catchup ──',
        'Last Visit = none (last 24 h)',
        'Daily Count 1 of 3',
        'Body line.',
        '──────────',
        'Try again in a minute.',
      ].join('\n'),
    );
    expect(FRAME_DIVIDER).toBe('──────────');
  });

  it('goes name line to body when no facts', () => {
    expect(frameMessage({ name: 'Help', body: 'B', footer: 'F' })).toBe(
      '── Help ──\nB\n──────────\nF',
    );
    expect(frameMessage({ name: 'Help', facts: [], body: 'B', footer: 'F' })).toBe(
      '── Help ──\nB\n──────────\nF',
    );
  });

  it('names', () => {
    expect(MESSAGE_NAMES.topic(3)).toBe('Topic 3');
    expect(MESSAGE_NAMES.morningBriefSettings).toBe('Morning Brief Settings');
  });
});

describe('frameCaption', () => {
  const base = { name: 'Top Pics', facts: ['F1'], footer: 'FOOT' };

  it('keeps everything when it fits', () => {
    const o = { ...base, body: 'body' };
    expect(frameCaption(o)).toBe(frameMessage(o));
  });

  it('drops footer and its divider first', () => {
    const body = 'x'.repeat(100);
    const o = { ...base, body };
    const full = frameMessage(o);
    const noFooter = `── Top Pics ──\nF1\n${body}`;
    expect(frameCaption(o, noFooter.length)).toBe(noFooter);
    expect(frameCaption(o, full.length)).toBe(full);
    expect(frameCaption(o, full.length - 1)).toBe(noFooter);
  });

  it('then drops facts, never the body', () => {
    const body = 'x'.repeat(100);
    const o = { ...base, body };
    const noFacts = `── Top Pics ──\n${body}`;
    expect(frameCaption(o, noFacts.length)).toBe(noFacts);
    expect(frameCaption(o, 10)).toBe(noFacts);
  });

  it('defaults to 1024', () => {
    const o = { ...base, body: 'y'.repeat(1010) };
    expect(frameCaption(o)).toBe(`── Top Pics ──\n${o.body}`);
  });
});

describe('lastVisitFact', () => {
  it('formats last-post in LA time at a DST date', () => {
    const iso = '2026-11-01T09:30:00Z';
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(iso));
    const g = (t: string) => parts.find((p) => p.type === t)!.value;
    const expected = `${g('month')}/${g('day')}/${g('year')} ${g('hour')}:${g('minute')}`;
    expect(lastVisitFact({ windowStart: iso, windowReason: 'last-post' })).toBe(
      `Last Visit = ${expected}`,
    );
    expect(lastVisitFact({ windowStart: iso, windowReason: 'last-dm' })).toBe(
      `Last Visit = ${expected}`,
    );
    expect(expected).toMatch(/^11\/01\/2026 \d{2}:30$/);
  });

  it('other reasons', () => {
    expect(lastVisitFact({ windowReason: 'unknown-24h' })).toBe('Last Visit = none (last 24 h)');
    expect(lastVisitFact({})).toBe('Last Visit = none (last 24 h)');
    expect(lastVisitFact({ windowReason: 'capped-48h' })).toBe('Last Visit = none (last 48 h)');
    expect(lastVisitFact({ windowReason: 'full-48h' })).toBe('Last Visit = full 48 h');
  });
});

describe('dailyCountFact', () => {
  it('normal, full, missing', () => {
    expect(dailyCountFact({ used: 2, limit: 3 })).toBe('Daily Count 2 of 3');
    expect(dailyCountFact({ used: 3, limit: 3, full: true })).toBe(
      'Daily Count 3 of 3 (full, not counted)',
    );
    expect(dailyCountFact({ limit: 3 })).toBeUndefined();
    expect(dailyCountFact({ used: 1 })).toBeUndefined();
  });
});
