import { describe, it, expect } from 'vitest';
import { dueDeadline, planPlayerSends, skipIfDone } from '../src/reminders/core.js';
import { holdUntilQuietEnds, inQuietHours, TIME_ZONE } from '../src/reminders/quietHours.js';

function pt(isoLocal: string): number {
  const [day] = isoLocal.split('T');
  const start = Date.parse(`${day}T00:00:00Z`) - 14 * 3_600_000;
  for (let t = start; t <= start + 48 * 3_600_000; t += 60_000) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(t));
    const g = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    if (`${g.year}-${g.month}-${g.day}T${g.hour}:${g.minute}` === isoLocal) return t;
  }
  throw new Error(`could not resolve ${isoLocal} in ${TIME_ZONE}`);
}

describe('quiet hours', () => {
  it('holds 11pm–8am PT until 8am', () => {
    const eleven = pt('2026-10-08T23:10');
    expect(inQuietHours(eleven)).toBe(true);
    const held = holdUntilQuietEnds(eleven);
    expect(inQuietHours(held)).toBe(false);
    const eight = pt('2026-10-09T08:00');
    expect(held).toBe(eight);
  });
  it('does not hold 10pm PT', () => {
    const ten = pt('2026-10-08T22:00');
    expect(inQuietHours(ten)).toBe(false);
    expect(holdUntilQuietEnds(ten)).toBe(ten);
  });
});

describe('dueDeadline', () => {
  it('fires inside the 15-minute window 26h before a noon-PT-adjacent deadline', () => {
    const deadline = Date.parse('2026-10-09T07:00:00Z'); // midnight PT during PDT
    const fire = deadline - 26 * 3600_000;
    expect(dueDeadline(deadline, 'deadline_26h', fire, 15 * 60_000)).toBe(true);
    expect(dueDeadline(deadline, 'deadline_26h', fire - 60_000, 15 * 60_000)).toBe(false);
    expect(dueDeadline(deadline, 'deadline_4h', fire, 15 * 60_000)).toBe(false);
  });
});

describe('planPlayerSends', () => {
  const player = {
    name: 'Jon Black',
    ntfyTopic: 'mlb-jon',
    e164: null as string | null,
    events: { deadline_26h: true, digest_2: true },
  };
  it('sends ntfy only when WhatsApp has no number, with no fallback flag', () => {
    const sends = planPlayerSends({
      player, event: 'deadline_26h', key: 'r1:26h', title: 'Songs due', body: 'Tomorrow',
      click: 'https://digest.mattmariani.com/x', sendAt: 1, alreadySent: new Set(),
    });
    expect(sends.map((s) => s.channel)).toEqual(['ntfy']);
  });
  it('sends both channels independently when a number is linked', () => {
    const sends = planPlayerSends({
      player: { ...player, e164: '+16617476822' }, event: 'deadline_26h', key: 'r1:26h',
      title: 't', body: 'b', click: null, sendAt: 1, alreadySent: new Set(),
    });
    expect(sends.map((s) => s.channel).sort()).toEqual(['ntfy', 'whatsapp']);
  });
  it('skips a channel already recorded', () => {
    const sends = planPlayerSends({
      player: { ...player, e164: '+16617476822' }, event: 'deadline_26h', key: 'r1:26h',
      title: 't', body: 'b', click: null, sendAt: 1,
      alreadySent: new Set(['r1:26h:Jon Black:ntfy']),
    });
    expect(sends.map((s) => s.channel)).toEqual(['whatsapp']);
  });
});

describe('collectDueSends', () => {
  it('plans ntfy-only when WhatsApp has no number, and news once per id', async () => {
    const { collectDueSends, deadlineFires, newsFires, playersFromSettings } = await import('../src/reminders/runner.js');
    const deadline = Date.parse('2026-10-09T07:00:00Z');
    const now = deadline - 26 * 3600_000;
    const players = playersFromSettings({
      'Jon Black': { ntfy: { enabled: true, topic: 'mlb-jon' }, whatsapp: { enabled: true, e164: null }, events: { deadline_26h: true, news: true } },
    });
    const fires = [
      ...deadlineFires([{ key: 'r1:songs', at: deadline, title: 'Songs', body: 'soon', click: null }], now, 15 * 60_000),
      ...newsFires([{ id: 'n1', title: 'Hi', body: 'body', publishedAt: now - 1000, click: null }], now),
    ];
    const sends = collectDueSends({ players, fires, alreadySent: new Set() });
    expect(sends.every((s) => s.channel === 'ntfy')).toBe(true);
    expect(sends.map((s) => s.event).sort()).toEqual(['deadline_26h', 'news']);
  });
});

describe('skipIfDone', () => {
  it('skips players who already submitted or voted', () => {
    expect(skipIfDone(['Jon Black', 'Matt Mariani'], 'Grant Koziol')).toBe(true);
    expect(skipIfDone(['Jon Black'], 'jon black')).toBe(false);
    expect(skipIfDone(undefined, 'Jon Black')).toBe(false);
  });
});
