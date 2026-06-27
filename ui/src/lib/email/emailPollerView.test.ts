import { describe, it, expect } from 'vitest';
import { statusLine, outcomeGlyph, relativeTime, type PollStatus } from './emailPollerView.js';

const NOW = Date.parse('2026-06-26T12:00:00Z');

describe('statusLine', () => {
  it('idle when no poll recorded', () => {
    expect(statusLine(null, NOW)).toEqual({ tone: 'idle', text: 'No poll recorded yet' });
  });

  it('ok shows connected + message count + relative time', () => {
    const p: PollStatus = { checkedAt: '2026-06-26T11:58:00Z', ok: true, fetched: 6, events: 2, error: null };
    const r = statusLine(p, NOW);
    expect(r.tone).toBe('ok');
    expect(r.text).toContain('Connected');
    expect(r.text).toContain('6 messages');
    expect(r.text).toContain('2 round events');
    expect(r.text).toContain('2m ago');
  });

  it('omits the round-events clause when there were none', () => {
    const p: PollStatus = { checkedAt: '2026-06-26T11:59:50Z', ok: true, fetched: 0, events: 0, error: null };
    expect(statusLine(p, NOW).text).not.toContain('round event');
  });

  it('failed poll is red with the error', () => {
    const p: PollStatus = { checkedAt: '2026-06-26T11:55:00Z', ok: false, fetched: 0, events: 0, error: 'auth failed' };
    const r = statusLine(p, NOW);
    expect(r.tone).toBe('error');
    expect(r.text).toContain('Last poll failed');
    expect(r.text).toContain('auth failed');
  });
});

describe('outcomeGlyph', () => {
  it('maps each action status to a glyph + tone', () => {
    expect(outcomeGlyph('recorded')).toEqual({ glyph: '✓', tone: 'ok' });
    expect(outcomeGlyph('unmapped')).toEqual({ glyph: '⚠', tone: 'warn' });
    expect(outcomeGlyph('error')).toEqual({ glyph: '✕', tone: 'error' });
    expect(outcomeGlyph('archived')).toEqual({ glyph: '·', tone: 'muted' });
    expect(outcomeGlyph(null)).toEqual({ glyph: '·', tone: 'muted' });
  });
});

describe('relativeTime', () => {
  it('formats seconds/minutes/hours/days ago', () => {
    expect(relativeTime('2026-06-26T11:59:30Z', NOW)).toBe('30s ago');
    expect(relativeTime('2026-06-26T11:30:00Z', NOW)).toBe('30m ago');
    expect(relativeTime('2026-06-26T09:00:00Z', NOW)).toBe('3h ago');
    expect(relativeTime('2026-06-24T12:00:00Z', NOW)).toBe('2d ago');
  });
});
