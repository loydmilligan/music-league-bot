import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CmuHttpError, runCatchMeUp, type CmuMessage } from '../../src/bot/catchMeUp.js';
import type { CmuCommand } from '../../src/bot/cmuCommand.js';
import { memoryCmuSwitch } from '../../src/bot/cmuSwitch.js';
import type { InteractionTrace } from '../../src/storage/interactionLog.js';
import { memoryCmuPreview } from '../../src/bot/cmuPreview.js';
import { FOOTER_MORNING, FOOTER_PLAYER, FOOTER_RETRY } from '../../src/bot/messageFrame.js';
import {
  RECAP_DM_SPACING_MS, RECAP_STORE_FAILURE_TEXT, makeFetchRecapToday, memoryRecapSubs, openRecapSubs,
  laNow, recapSubscription, servedLeague, setRecapSubsForTest, startRecapTick,
  type RecapSubs, type RecapToday,
} from '../../src/bot/recapSubs.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = Mock<(...args: any[]) => any>;

const GROUP = '120363000000000001@g.us';
const AUTHOR = '100000000000001@lid';
const KEY = '100000000000001@lid';
const AT = '2026-11-07T18:30:00.000Z';
const SENTINEL = 'SYNTHETIC-RECAP-BODY';

const ON = 'Morning recap: on, 7:30 AM (LA). morning-recap unsub to stop.';
const ON_8 = 'Morning recap: on, 8:00 AM (LA). morning-recap unsub to stop.';
const OFF = 'Morning recap: off.';
const BAD = 'Try "morning-recap 7:30".';

function makeMsg(): CmuMessage & { react: AnyMock } {
  return {
    from: GROUP, author: AUTHOR, capturedAt: AT, notifyName: 'Alice',
    getContact: vi.fn().mockResolvedValue({ pushname: 'Alice' }),
    react: vi.fn().mockResolvedValue(undefined),
  } as CmuMessage & { react: AnyMock };
}

function makeTrace() {
  const events: Array<{ ev: string; name?: string; f?: Record<string, unknown> }> = [];
  const trace: InteractionTrace = {
    id: 'abcdef012345',
    start: (f) => { events.push({ ev: 'start', f: { ...f } }); },
    step: (name, f) => { events.push({ ev: 'step', name, f: { ...f } }); },
    end: (outcome) => { events.push({ ev: 'end', name: outcome }); },
    thumbPath: () => '',
  };
  return { trace, events, ends: () => events.filter((e) => e.ev === 'end').map((e) => e.name) };
}

function cmdSetup(over: Record<string, unknown> = {}) {
  const t = makeTrace();
  const subs = memoryRecapSubs();
  const deps = {
    fetchFn: vi.fn() as AnyMock,
    groups: new Map([[GROUP, 'league-x']]),
    url: 'http://host.invalid/catchup/me',
    token: 'sekret',
    screenshot: vi.fn(),
    sendImage: vi.fn() as AnyMock,
    sendText: vi.fn().mockResolvedValue(undefined) as AnyMock,
    log: vi.fn() as AnyMock,
    trace: () => t.trace,
    dmTarget: vi.fn(async (id: string) => id) as AnyMock,
    recapSubs: subs as RecapSubs,
    playerThrottle: new Map<string, number>(),
    ...over,
  };
  return { deps, subs: deps.recapSubs, ...t };
}

const SUB: CmuCommand = { kind: 'recap-sub' };
const UNSUB: CmuCommand = { kind: 'recap-unsub' };
const TIME_730: CmuCommand = { kind: 'recap-time', time: '07:30' };
const BAD_TIME: CmuCommand = { kind: 'recap-time-bad' };

describe('recap commands', () => {
  it('sub/unsub/time confirm copy exact', async () => {
    const s = cmdSetup();
    const msg = makeMsg();
    await runCatchMeUp(msg, s.deps, SUB);
    await runCatchMeUp(msg, s.deps, TIME_730);
    await runCatchMeUp(msg, s.deps, UNSUB);
    await runCatchMeUp(msg, s.deps, BAD_TIME);
    expect(s.deps.sendText.mock.calls).toEqual([[AUTHOR, ON_8], [AUTHOR, ON], [AUTHOR, OFF], [AUTHOR, BAD]]);
    expect(msg.react).toHaveBeenCalledWith('👍');
    expect(s.ends()).toEqual(['recap-sub', 'recap-time', 'recap-unsub', 'recap-time-bad']);
    expect(s.subs.get(KEY)).toBeUndefined();
    expect(s.deps.fetchFn).not.toHaveBeenCalled();
  });

  it('sub stores the league and 08:00', async () => {
    const s = cmdSetup();
    await runCatchMeUp(makeMsg(), s.deps, SUB);
    expect(s.subs.get(KEY)).toEqual({ time: '08:00', league: 'league-x' });
  });

  it('sub keeps existing time', async () => {
    const s = cmdSetup();
    s.subs.set(KEY, { time: '07:30', league: 'league-x' });
    await runCatchMeUp(makeMsg(), s.deps, SUB);
    expect(s.subs.get(KEY)?.time).toBe('07:30');
    expect(s.deps.sendText.mock.calls[0][1]).toBe(ON);
  });

  it('time subscribes', async () => {
    const s = cmdSetup();
    await runCatchMeUp(makeMsg(), s.deps, TIME_730);
    expect(s.subs.get(KEY)).toEqual({ time: '07:30', league: 'league-x' });
  });

  it('time keeps lastSentYmd so a changed time is not a second send today', async () => {
    const s = cmdSetup();
    s.subs.set(KEY, { time: '08:00', league: 'league-x', lastSentYmd: '2026-11-07' });
    await runCatchMeUp(makeMsg(), s.deps, { kind: 'recap-time', time: '09:15' });
    expect(s.subs.get(KEY)).toEqual({ time: '09:15', league: 'league-x', lastSentYmd: '2026-11-07' });
  });

  for (const [label, dmTarget] of [
    ['throws', vi.fn().mockRejectedValue(new Error('x'))],
    ['returns empty', vi.fn().mockResolvedValue('')],
    ['is absent', undefined],
  ] as const) {
    it(`fallback id stores nothing: dmTarget ${label}`, async () => {
      const s = cmdSetup({ dmTarget });
      await runCatchMeUp(makeMsg(), s.deps, SUB);
      expect(s.subs.all()).toEqual([]);
      expect(s.deps.sendText.mock.calls).toEqual([[AUTHOR, RECAP_STORE_FAILURE_TEXT]]);
      expect(s.ends()).toEqual(['failed']);
    });
  }

  it('M1: a failing strict lookup sends the M3 copy and stores nothing, even if dmTarget would fall back', async () => {
    const s = cmdSetup({ recapDmTarget: vi.fn().mockRejectedValue(new Error('x')), dmTarget: vi.fn(async (x: string) => x) });
    await runCatchMeUp(makeMsg(), s.deps, SUB);
    expect(s.subs.all()).toEqual([]);
    expect(s.deps.sendText.mock.calls).toEqual([[AUTHOR, RECAP_STORE_FAILURE_TEXT]]);
    expect(s.deps.dmTarget).not.toHaveBeenCalled();
  });

  it('M1: a successful strict lookup equal to the input is stored', async () => {
    const s = cmdSetup({ recapDmTarget: vi.fn(async (x: string) => x) });
    await runCatchMeUp(makeMsg(), s.deps, SUB);
    expect(s.subs.all().map(([k]) => k)).toEqual([AUTHOR]);
  });

  it('M3 copy verbatim', () => {
    expect(RECAP_STORE_FAILURE_TEXT).toBe("Couldn't set that up just now. Try again in a minute.");
  });

  it('dm author equal to dmTarget is stored', async () => {
    const s = cmdSetup({ dmTarget: vi.fn(async (x: string) => x) });
    await runCatchMeUp(makeMsg(), s.deps, SUB);
    expect(s.subs.all().map(([k]) => k)).toEqual([AUTHOR]);
  });

  it('stores under the dmTarget result, not the author form', async () => {
    const s = cmdSetup({ dmTarget: vi.fn(async () => '999@lid') });
    await runCatchMeUp(makeMsg(), s.deps, SUB);
    expect(s.subs.all().map(([k]) => k)).toEqual(['999@lid']);
  });

  it('a store write failure gets the M3 copy', async () => {
    const subs = memoryRecapSubs();
    subs.set = () => { throw new Error('EACCES'); };
    const s = cmdSetup({ recapSubs: subs });
    await runCatchMeUp(makeMsg(), s.deps, SUB);
    expect(s.deps.sendText.mock.calls).toEqual([[AUTHOR, RECAP_STORE_FAILURE_TEXT]]);
    expect(s.ends()).toEqual(['failed']);
  });

  it('off switch silences it', async () => {
    const s = cmdSetup({ cmuSwitch: memoryCmuSwitch(false) });
    const msg = makeMsg();
    await runCatchMeUp(msg, s.deps, SUB);
    expect(msg.react).not.toHaveBeenCalled();
    expect(s.deps.sendText).not.toHaveBeenCalled();
    expect(s.subs.all()).toEqual([]);
  });

  it('trace: command label and outcome, no id and no text', async () => {
    const s = cmdSetup();
    await runCatchMeUp(makeMsg(), s.deps, TIME_730);
    const start = s.events.find((e) => e.ev === 'start')!.f!;
    expect(start.command).toBe('morning-brief time');
    expect(s.ends()).toEqual(['recap-time']);
    const blob = JSON.stringify(s.events);
    expect(blob).not.toContain(AUTHOR);
    expect(blob).not.toContain('Morning recap');
  });
});

describe('store', () => {
  const dir = () => mkdtempSync(path.join(os.tmpdir(), 'recap-subs-'));

  it('file mode 0600, round trip', () => {
    const file = path.join(dir(), 'recap-subs.json');
    const a = openRecapSubs(file);
    a.set('k1@lid', { time: '07:30', league: 'l' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const b = openRecapSubs(file);
    expect(b.get('k1@lid')).toEqual({ time: '07:30', league: 'l' });
    b.delete('k1@lid');
    expect(openRecapSubs(file).all()).toEqual([]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('missing or corrupt file reads empty', () => {
    const d = dir();
    expect(openRecapSubs(path.join(d, 'none.json')).all()).toEqual([]);
    const bad = path.join(d, 'bad.json');
    writeFileSync(bad, '{nope');
    expect(openRecapSubs(bad).all()).toEqual([]);
  });

  it('drops misshapen entries', () => {
    const file = path.join(dir(), 'r.json');
    writeFileSync(file, JSON.stringify({ subs: { a: { time: '7', league: 'l' }, b: { time: '07:00', league: 'l' } } }));
    expect(openRecapSubs(file).all().map(([k]) => k)).toEqual(['b']);
  });

  it('the file holds only the subs', () => {
    const file = path.join(dir(), 'r.json');
    openRecapSubs(file).set('k', { time: '08:00', league: 'l', lastSentYmd: '2026-11-07' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ subs: { k: { time: '08:00', league: 'l', lastSentYmd: '2026-11-07' } } });
  });
});

describe('recapSubscription', () => {
  afterEach(() => setRecapSubsForTest(undefined));

  it('reads the injected store', () => {
    const subs = memoryRecapSubs();
    subs.set('k', { time: '07:30', league: 'l' });
    setRecapSubsForTest(subs);
    expect(recapSubscription('k')).toEqual({ subscribed: true, time: '07:30' });
    expect(recapSubscription('other')).toEqual({ subscribed: false });
    expect(recapSubscription('')).toEqual({ subscribed: false });
  });

  it('recapSubscription error reads false', () => {
    const subs = memoryRecapSubs();
    subs.get = () => { throw new Error('boom'); };
    setRecapSubsForTest(subs);
    expect(recapSubscription('k')).toEqual({ subscribed: false });
  });
});

describe('servedLeague', () => {
  it('most frequent value, first on a tie, undefined when empty', () => {
    expect(servedLeague(new Map())).toBeUndefined();
    expect(servedLeague(new Map([['a', 'x'], ['b', 'y'], ['c', 'y']]))).toBe('y');
    expect(servedLeague(new Map([['a', 'x'], ['b', 'y'], ['c', 'y'], ['d', 'x']]))).toBe('x');
    expect(servedLeague(new Map([['a', 'x'], ['b', 'x']]))).toBe('x');
  });
});

describe('makeFetchRecapToday', () => {
  it('posts recap-today with the bearer, no requesterKey', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      kind: 'recap-today', ymd: '2026-11-07', status: 'sent', dryRun: false, sendable: true, text: SENTINEL,
    }), { status: 200 }));
    const f = makeFetchRecapToday({ fetchFn, url: 'http://host.invalid/catchup/me', token: 'sekret', now: () => new Date(AT) });
    const r = await f('league-x');
    expect(r).toEqual({ kind: 'recap-today', ymd: '2026-11-07', status: 'sent', dryRun: false, sendable: true, text: SENTINEL });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://host.invalid/catchup/me');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sekret');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ mode: 'recap-today', league: 'league-x', via: 'dm', requestAt: AT, notifyName: '' });
  });

  it('a 400 throws', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 400 }));
    const f = makeFetchRecapToday({ fetchFn, url: 'u', token: 't' });
    await expect(f('l')).rejects.toThrow('http 400');
  });

  it('a wrong shape throws', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ kind: 'top' }), { status: 200 }));
    const f = makeFetchRecapToday({ fetchFn, url: 'u', token: 't' });
    await expect(f('l')).rejects.toThrow();
  });
});

// LA is PST (UTC-8) from 2026-11-01 02:00 local onward, PDT (UTC-7) before.
const la = (ymd: string, hm: string, offsetH = 8) => {
  const [h, m] = hm.split(':').map(Number);
  const d = new Date(`${ymd}T00:00:00.000Z`);
  return new Date(d.getTime() + ((h + offsetH) * 60 + m) * 60_000);
};

const laNowYmd = (d: Date) => laNow(d).ymd;
const sendable = (ymd: string, over: Partial<RecapToday> = {}): RecapToday => ({
  kind: 'recap-today', ymd, status: 'sent', dryRun: false, sendable: true, text: SENTINEL, ...over,
});

function tickSetup(o: {
  subs?: Array<[string, { time: string; league: string; lastSentYmd?: string }]>;
  now: Date;
  recap?: RecapToday | ((league: string) => Promise<RecapToday>);
  people?: string[];
  enabled?: boolean;
  sendText?: AnyMock;
  isFormatLeague?: (league: string) => boolean;
}) {
  const subs = memoryRecapSubs();
  for (const [k, s] of o.subs ?? []) subs.set(k, s);
  let now = o.now;
  let enabled = o.enabled ?? true;
  const t = makeTrace();
  const people = new Set(o.people ?? (o.subs ?? []).map(([k]) => k));
  const recap = o.recap;
  const fetchRecapToday = vi.fn(typeof recap === 'function' ? recap : async () => recap ?? sendable('2026-11-07')) as AnyMock;
  const sendAt: number[] = [];
  const sendText = o.sendText ?? (vi.fn(async () => { sendAt.push(Date.now()); }) as AnyMock);
  const log = vi.fn() as AnyMock;
  const tick = startRecapTick({
    subs,
    fetchRecapToday,
    sendText,
    isEnabled: () => enabled,
    isPreviewPerson: (k) => people.has(k),
    now: () => now,
    log,
    trace: () => t.trace,
    autoStart: false,
    ...(o.isFormatLeague ? { isFormatLeague: o.isFormatLeague } : {}),
  });
  return {
    subs, tick, fetchRecapToday, sendText, sendAt, log, ...t,
    setNow: (d: Date) => { now = d; },
    setEnabled: (e: boolean) => { enabled = e; },
  };
}

/** Run one tick to completion under fake timers (the spacing sleeps are timers). */
async function runTick(s: ReturnType<typeof tickSetup>) {
  const p = s.tick.tick();
  await vi.runAllTimersAsync();
  await p;
}

describe('startRecapTick', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('spacing constant', () => {
    expect(RECAP_DM_SPACING_MS).toBe(10_000);
  });

  it('not due before time', async () => {
    vi.useFakeTimers();
    const s = tickSetup({ subs: [['a@lid', { time: '08:00', league: 'l' }]], now: la('2026-11-07', '07:59') });
    await runTick(s);
    expect(s.fetchRecapToday).not.toHaveBeenCalled();
    expect(s.sendText).not.toHaveBeenCalled();
  });

  it('due after time and sent once', async () => {
    vi.useFakeTimers();
    const s = tickSetup({ subs: [['a@lid', { time: '08:00', league: 'l' }]], now: la('2026-11-07', '08:00') });
    await runTick(s);
    expect(s.sendText.mock.calls).toEqual([['a@lid', SENTINEL]]);
    expect(s.subs.get('a@lid')?.lastSentYmd).toBe('2026-11-07');
    s.setNow(la('2026-11-07', '08:01'));
    await runTick(s);
    expect(s.sendText).toHaveBeenCalledTimes(1);
    expect(s.fetchRecapToday).toHaveBeenCalledTimes(1);
  });

  it('one fetch per tick for 3 due subs', async () => {
    vi.useFakeTimers();
    const s = tickSetup({
      subs: [['a@lid', { time: '07:00', league: 'l' }], ['b@lid', { time: '07:30', league: 'l' }], ['c@lid', { time: '08:00', league: 'l' }]],
      now: la('2026-11-07', '09:00'),
    });
    await runTick(s);
    expect(s.fetchRecapToday).toHaveBeenCalledTimes(1);
    expect(s.fetchRecapToday).toHaveBeenCalledWith('l');
    expect(s.sendText.mock.calls.map((c) => c[0])).toEqual(['a@lid', 'b@lid', 'c@lid']);
  });

  it('one fetch per distinct league; a failing league is logged and skipped', async () => {
    vi.useFakeTimers();
    const s = tickSetup({
      subs: [['a@lid', { time: '07:00', league: 'l1' }], ['b@lid', { time: '07:00', league: 'l2' }], ['c@lid', { time: '07:00', league: 'l1' }]],
      now: la('2026-11-07', '09:00'),
      recap: async (league) => {
        if (league === 'l2') throw new CmuHttpError(400);
        return sendable('2026-11-07');
      },
    });
    await runTick(s);
    expect(s.fetchRecapToday.mock.calls).toEqual([['l1'], ['l2']]);
    expect(s.sendText.mock.calls.map((c) => c[0])).toEqual(['a@lid', 'c@lid']);
    expect(s.subs.get('b@lid')?.lastSentYmd).toBeUndefined();
    expect(s.log.mock.calls.some((c) => String(c[0]).includes('http 400'))).toBe(true);
  });

  it('no fetch when none due', async () => {
    vi.useFakeTimers();
    const s = tickSetup({ subs: [['a@lid', { time: '08:00', league: 'l', lastSentYmd: '2026-11-07' }]], now: la('2026-11-07', '09:00') });
    await runTick(s);
    const e = tickSetup({ now: la('2026-11-07', '09:00') });
    await runTick(e);
    expect(s.fetchRecapToday).not.toHaveBeenCalled();
    expect(e.fetchRecapToday).not.toHaveBeenCalled();
  });

  it('not sendable keeps due, retried next tick', async () => {
    vi.useFakeTimers();
    let r: RecapToday = sendable('2026-11-07', { status: 'held', sendable: false });
    const s = tickSetup({ subs: [['a@lid', { time: '08:00', league: 'l' }]], now: la('2026-11-07', '08:00'), recap: async () => r });
    await runTick(s);
    expect(s.sendText).not.toHaveBeenCalled();
    expect(s.subs.get('a@lid')?.lastSentYmd).toBeUndefined();
    r = sendable('2026-11-07');
    s.setNow(la('2026-11-07', '08:01'));
    await runTick(s);
    expect(s.fetchRecapToday).toHaveBeenCalledTimes(2);
    expect(s.sendText).toHaveBeenCalledTimes(1);
  });

  it('dry run never sends', async () => {
    vi.useFakeTimers();
    for (const recap of [
      sendable('2026-11-07', { dryRun: true }),
      sendable('2026-11-07', { status: 'pending' }),
      sendable('2026-11-07', { text: '' }),
    ]) {
      const s = tickSetup({ subs: [['a@lid', { time: '08:00', league: 'l' }]], now: la('2026-11-07', '08:00'), recap });
      await runTick(s);
      expect(s.sendText).not.toHaveBeenCalled();
      expect(s.subs.get('a@lid')?.lastSentYmd).toBeUndefined();
    }
  });

  it('spacing ≥ 10 s between sends', async () => {
    vi.useFakeTimers();
    const s = tickSetup({
      subs: [['a@lid', { time: '07:00', league: 'l' }], ['b@lid', { time: '07:00', league: 'l' }], ['c@lid', { time: '07:00', league: 'l' }]],
      now: la('2026-11-07', '09:00'),
    });
    await runTick(s);
    expect(s.sendAt).toHaveLength(3);
    for (let i = 1; i < s.sendAt.length; i++) expect(s.sendAt[i] - s.sendAt[i - 1]).toBeGreaterThanOrEqual(RECAP_DM_SPACING_MS);
  });

  it('spacing holds across back-to-back ticks', async () => {
    vi.useFakeTimers();
    const s = tickSetup({ subs: [['a@lid', { time: '07:00', league: 'l' }]], now: la('2026-11-07', '09:00'), people: ['a@lid', 'b@lid'] });
    await runTick(s);
    s.subs.set('b@lid', { time: '07:00', league: 'l' });
    await runTick(s);
    expect(s.sendAt).toHaveLength(2);
    expect(s.sendAt[1] - s.sendAt[0]).toBeGreaterThanOrEqual(RECAP_DM_SPACING_MS);
  });

  it('marks before send so a throwing send is not retried', async () => {
    vi.useFakeTimers();
    const sendText = vi.fn().mockRejectedValue(new Error('net')) as AnyMock;
    const s = tickSetup({ subs: [['a@lid', { time: '08:00', league: 'l' }]], now: la('2026-11-07', '08:00'), sendText });
    let markedBeforeSend: string | undefined;
    sendText.mockImplementation(async () => { markedBeforeSend = s.subs.get('a@lid')?.lastSentYmd; throw new Error('net'); });
    await runTick(s);
    expect(markedBeforeSend).toBe('2026-11-07');
    s.setNow(la('2026-11-07', '08:01'));
    await runTick(s);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(s.ends()).toEqual(['recap-dm-failed']);
  });

  it('a never-resolving sendText times out as a failed send and does not block the next tick', async () => {
    vi.useFakeTimers();
    const sendText = vi.fn(() => new Promise<void>(() => {})) as AnyMock;
    const s = tickSetup({
      subs: [['a@lid', { time: '08:00', league: 'l' }], ['b@lid', { time: '08:30', league: 'l' }]],
      now: la('2026-11-07', '08:00'), sendText,
    });
    await runTick(s);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(s.ends()).toEqual(['recap-dm-failed']);
    expect(s.subs.get('a@lid')?.lastSentYmd).toBe('2026-11-07');
    // running was released: the next tick sends to the next due subscriber.
    s.setNow(la('2026-11-07', '08:31'));
    await runTick(s);
    expect(sendText).toHaveBeenCalledTimes(2);
  });

  it('off pauses tick', async () => {
    vi.useFakeTimers();
    const s = tickSetup({ subs: [['a@lid', { time: '08:00', league: 'l' }]], now: la('2026-11-07', '08:00'), enabled: false });
    await runTick(s);
    expect(s.fetchRecapToday).not.toHaveBeenCalled();
    expect(s.sendText).not.toHaveBeenCalled();
    s.setEnabled(true);
    await runTick(s);
    expect(s.sendText).toHaveBeenCalledTimes(1);
  });

  it('off mid-tick stops the remaining sends, which stay due', async () => {
    vi.useFakeTimers();
    const s = tickSetup({
      subs: [['a@lid', { time: '07:00', league: 'l' }], ['b@lid', { time: '07:00', league: 'l' }]],
      now: la('2026-11-07', '09:00'),
    });
    s.sendText.mockImplementation(async () => { s.setEnabled(false); });
    await runTick(s);
    expect(s.sendText).toHaveBeenCalledTimes(1);
    expect(s.subs.get('b@lid')?.lastSentYmd).toBeUndefined();
  });

  it('skips while the previous tick is still running', async () => {
    vi.useFakeTimers();
    let release!: (r: RecapToday) => void;
    const s = tickSetup({
      subs: [['a@lid', { time: '08:00', league: 'l' }]],
      now: la('2026-11-07', '08:00'),
      recap: () => new Promise<RecapToday>((res) => { release = res; }),
    });
    const first = s.tick.tick();
    await vi.advanceTimersByTimeAsync(0);
    await s.tick.tick();
    expect(s.fetchRecapToday).toHaveBeenCalledTimes(1);
    release(sendable('2026-11-07'));
    await vi.runAllTimersAsync();
    await first;
    expect(s.sendText).toHaveBeenCalledTimes(1);
  });

  it('unsub then sub the same day: no second send, and a send again tomorrow (M5)', async () => {
    vi.useFakeTimers();
    const t = makeTrace();
    const subs = memoryRecapSubs();
    const deps = {
      fetchFn: vi.fn() as AnyMock, groups: new Map([[GROUP, 'l']]), url: 'u', token: 't',
      screenshot: vi.fn(), sendImage: vi.fn() as AnyMock, sendText: vi.fn().mockResolvedValue(undefined) as AnyMock,
      log: vi.fn() as AnyMock, trace: () => t.trace, dmTarget: vi.fn(async (id: string) => id) as AnyMock,
      recapSubs: subs, playerThrottle: new Map<string, number>(),
    };
    let now = la('2026-11-07', '09:00');
    const sendText = vi.fn().mockResolvedValue(undefined) as AnyMock;
    const tick = startRecapTick({
      subs, fetchRecapToday: async () => sendable(laNowYmd(now)), sendText, isEnabled: () => true,
      isPreviewPerson: () => true, now: () => now, log: vi.fn(), trace: () => t.trace, autoStart: false,
    });
    const run = async () => { const p = tick.tick(); await vi.runAllTimersAsync(); await p; };
    await runCatchMeUp(makeMsg(), deps, SUB);
    await run();
    expect(sendText).toHaveBeenCalledTimes(1);
    await runCatchMeUp(makeMsg(), deps, UNSUB);
    expect(subs.get(KEY)).toBeUndefined();
    await runCatchMeUp(makeMsg(), deps, SUB);
    now = la('2026-11-07', '09:05');
    await run();
    expect(sendText).toHaveBeenCalledTimes(1);
    now = la('2026-11-08', '09:00');
    await run();
    expect(sendText).toHaveBeenCalledTimes(2);
  });

  it('a tick that crosses LA midnight stops before sending yesterday', async () => {
    vi.useFakeTimers();
    const s = tickSetup({
      subs: [['a@lid', { time: '23:00', league: 'l' }], ['b@lid', { time: '23:00', league: 'l' }]],
      now: la('2026-11-07', '23:59'),
      recap: sendable('2026-11-07'),
    });
    // The first send lands, then the clock crosses midnight during the spacing wait.
    s.sendText.mockImplementation(async () => { s.sendAt.push(Date.now()); s.setNow(la('2026-11-08', '00:00')); });
    await runTick(s);
    expect(s.sendText).toHaveBeenCalledTimes(1);
    expect(s.subs.get('b@lid')?.lastSentYmd).toBeUndefined();
  });

  it('the tick log counts real sends only', async () => {
    vi.useFakeTimers();
    const s = tickSetup({ subs: [['a@lid', { time: '07:00', league: 'l' }]], now: la('2026-11-07', '09:00') });
    s.subs.set = () => { throw new Error('EACCES'); };
    await runTick(s);
    expect(s.log.mock.calls.some((c) => String(c[0]).includes('sent'))).toBe(false);
  });

  it('midnight rollover', async () => {
    vi.useFakeTimers();
    const s = tickSetup({
      subs: [['a@lid', { time: '23:59', league: 'l' }]],
      now: la('2026-11-07', '23:58'),
      people: ['a@lid', 'b@lid'],
      recap: sendable('2026-11-07'),
    });
    await runTick(s);
    expect(s.sendText).not.toHaveBeenCalled();
    s.setNow(la('2026-11-07', '23:59'));
    await runTick(s);
    expect(s.sendText.mock.calls).toEqual([['a@lid', SENTINEL]]);
    // Next LA day: yesterday's sendable response is never sent, and stays due.
    s.subs.set('b@lid', { time: '00:00', league: 'l' });
    s.setNow(la('2026-11-08', '00:00'));
    await runTick(s);
    expect(s.sendText).toHaveBeenCalledTimes(1);
    expect(s.subs.get('b@lid')?.lastSentYmd).toBeUndefined();
    expect(s.subs.get('a@lid')?.lastSentYmd).toBe('2026-11-07');
  });

  it('dst day', async () => {
    vi.useFakeTimers();
    const s = tickSetup({ subs: [['a@lid', { time: '08:00', league: 'l' }]], now: la('2026-11-01', '00:00', 7), recap: sendable('2026-11-01') });
    // 2026-11-01 LA runs 07:00Z to 08:00Z the next day (25 h): tick every minute.
    const start = Date.parse('2026-11-01T07:00:00.000Z');
    for (let t = start; t < start + 25 * 3_600_000; t += 60_000) {
      s.setNow(new Date(t));
      await runTick(s);
    }
    expect(s.sendText).toHaveBeenCalledTimes(1);
    expect(s.subs.get('a@lid')?.lastSentYmd).toBe('2026-11-01');
    // It went at 08:00 PST (16:00Z), not 08:00 PDT.
    expect(s.fetchRecapToday).toHaveBeenCalledTimes(1);
  });

  it('non-preview subscriber gets nothing (G4)', async () => {
    vi.useFakeTimers();
    const s = tickSetup({
      subs: [['a@lid', { time: '07:00', league: 'l' }], ['b@lid', { time: '07:00', league: 'l' }]],
      now: la('2026-11-07', '09:00'),
      people: ['b@lid'],
    });
    await runTick(s);
    expect(s.sendText.mock.calls.map((c) => c[0])).toEqual(['b@lid']);
    expect(s.subs.get('a@lid')).toEqual({ time: '07:00', league: 'l' });
  });

  it('trace per send: morning-recap dm, recap-dm, no id and no text', async () => {
    vi.useFakeTimers();
    const s = tickSetup({ subs: [['a@lid', { time: '07:00', league: 'l' }]], now: la('2026-11-07', '09:00') });
    await runTick(s);
    const start = s.events.find((e) => e.ev === 'start')!.f!;
    expect(start).toMatchObject({ command: 'morning-recap dm', who: '' });
    expect(s.ends()).toEqual(['recap-dm']);
    const blob = JSON.stringify(s.events) + JSON.stringify(s.log.mock.calls);
    expect(blob).not.toContain('a@lid');
    expect(blob).not.toContain(SENTINEL);
  });

  it('a throwing store mark skips the send', async () => {
    vi.useFakeTimers();
    const s = tickSetup({ subs: [['a@lid', { time: '07:00', league: 'l' }]], now: la('2026-11-07', '09:00') });
    s.subs.set = () => { throw new Error('EACCES'); };
    await runTick(s);
    expect(s.sendText).not.toHaveBeenCalled();
  });

  it('stop clears the interval', () => {
    vi.useFakeTimers();
    const subs = memoryRecapSubs();
    const fetchRecapToday = vi.fn();
    const h = startRecapTick({
      subs, fetchRecapToday, sendText: vi.fn(), isEnabled: () => true, isPreviewPerson: () => true,
      log: vi.fn(), trace: () => makeTrace().trace,
    });
    expect(vi.getTimerCount()).toBe(1);
    h.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ── Sprint 4 Task 6: Morning Brief settings replies and the framed Morning Brief DM ──────────
describe('Morning Brief settings replies', () => {
  const frame = (body: string, footer = FOOTER_PLAYER) => `── Morning Brief Settings ──\n${body}\n──────────\n${footer}`;
  const dmMsg = () => Object.assign(makeMsg(), { previewPerson: true, via: 'dm' as const });

  it('ON: framed, Morning Brief wording', async () => {
    const s = cmdSetup({ preview: memoryCmuPreview([], [], [], [GROUP]) });
    const msg = dmMsg();
    await runCatchMeUp(msg, s.deps, SUB);
    await runCatchMeUp(msg, s.deps, TIME_730);
    await runCatchMeUp(msg, s.deps, UNSUB);
    await runCatchMeUp(msg, s.deps, BAD_TIME);
    expect(s.deps.sendText.mock.calls.map((c) => c[1])).toEqual([
      frame('Morning Brief: on, 8:00 AM (LA). morning-brief unsub to stop.'),
      frame('Morning Brief: on, 7:30 AM (LA). morning-brief unsub to stop.'),
      frame('Morning Brief: off.'),
      frame('Try "morning-brief 7:30".'),
    ]);
  });

  it('ON: a store failure is framed with the retry footer', async () => {
    const s = cmdSetup({ preview: memoryCmuPreview([], [], [], [GROUP]), dmTarget: vi.fn().mockRejectedValue(new Error('x')) });
    await runCatchMeUp(dmMsg(), s.deps, SUB);
    expect(s.deps.sendText.mock.calls[0][1]).toBe(frame("Couldn't set that up just now.", FOOTER_RETRY));
  });

  it('OFF: byte-identical (no format; or format without the person gate)', async () => {
    for (const [preview, msg] of [
      [memoryCmuPreview([GROUP], [AUTHOR]), dmMsg()],
      [memoryCmuPreview([], [], [], [GROUP]), makeMsg()],
    ] as const) {
      const s = cmdSetup({ preview });
      await runCatchMeUp(msg, s.deps, SUB);
      await runCatchMeUp(msg, s.deps, TIME_730);
      await runCatchMeUp(msg, s.deps, UNSUB);
      await runCatchMeUp(msg, s.deps, BAD_TIME);
      expect(s.deps.sendText.mock.calls.map((c) => c[1])).toEqual([ON_8, ON, OFF, BAD]);
    }
  });
});

describe('Morning Brief DM (tick)', () => {
  afterEach(() => { vi.useRealTimers(); });
  const FRAMED = `── Morning Brief ──\n${SENTINEL}\n──────────\n${FOOTER_MORNING}`;

  it('ON: framed for a format league only', async () => {
    vi.useFakeTimers();
    const s = tickSetup({
      subs: [['a@lid', { time: '07:00', league: 'fmt' }], ['b@lid', { time: '07:00', league: 'plain' }]],
      now: la('2026-11-07', '09:00'),
      recap: sendable('2026-11-07'),
      isFormatLeague: (l) => l === 'fmt',
    });
    await runTick(s);
    expect(s.sendText.mock.calls).toEqual([['a@lid', FRAMED], ['b@lid', SENTINEL]]);
  });

  it('OFF: no isFormatLeague dep, or a throwing one, sends the bare text', async () => {
    for (const isFormatLeague of [undefined, () => { throw new Error('x'); }]) {
      vi.useFakeTimers();
      const s = tickSetup({ subs: [['a@lid', { time: '07:00', league: 'fmt' }]], now: la('2026-11-07', '09:00'), isFormatLeague });
      await runTick(s);
      expect(s.sendText.mock.calls).toEqual([['a@lid', SENTINEL]]);
      vi.useRealTimers();
    }
  });
});
