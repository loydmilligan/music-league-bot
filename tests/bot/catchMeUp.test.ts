import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isCatchMeUpRequest,
  parseCmuGroups,
  runCatchMeUp,
  CMU_FAILURE_TEXT,
  CMU_TIMEOUT_MS,
  CMU_DEADLINE_MS,
  type CmuMessage,
} from '../../src/bot/catchMeUp.js';
import type { InteractionTrace } from '../../src/storage/interactionLog.js';
import { handleMessage, type WhatsAppMessage, type BotConfig } from '../../src/bot/handler.js';
import { openDb } from '../../src/storage/db.js';
import { createPromptTables } from '../../src/chat/prompts/store.js';
import { rulesConfigSchema } from '../../src/config/types.js';

const GROUP = '120363000000000001@g.us';
const AUTHOR = '186428122255581@lid';
const REQUEST_AT = '2026-11-06T18:30:00.000Z';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function makeMsg(over: Partial<CmuMessage> = {}): CmuMessage & { react: ReturnType<typeof vi.fn> } {
  return {
    from: GROUP,
    author: AUTHOR,
    capturedAt: REQUEST_AT,
    notifyName: 'Alice',
    getContact: vi.fn().mockResolvedValue({ pushname: 'Alice' }),
    react: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as CmuMessage & { react: ReturnType<typeof vi.fn> };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = Mock<(...args: any[]) => any>;
interface FakeDeps {
  fetchFn: AnyMock;
  groups: Map<string, string>;
  url: string;
  token: string;
  screenshot: AnyMock;
  sendImage: AnyMock;
  sendText: AnyMock;
  log: AnyMock;
  dmTarget?: AnyMock;
  deadlineMs?: number;
  failureDmTimeoutMs?: number;
  trace?: () => InteractionTrace;
}

function makeDeps(over: Partial<FakeDeps> = {}) {
  const screenshots: string[] = [];
  const deps: FakeDeps = {
    fetchFn: vi.fn().mockResolvedValue(jsonResponse(200, { kind: 'quiet', text: 'Not much happened.' })),
    groups: new Map([[GROUP, 'boarz-ii-men']]),
    url: 'http://host.docker.internal:8798/catchup/me',
    token: 'sekret',
    screenshot: vi.fn(async (_html: string, outPath: string) => {
      screenshots.push(outPath);
      writeFileSync(outPath, 'png');
    }),
    sendImage: vi.fn().mockResolvedValue(undefined),
    sendText: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    ...over,
  };
  return { deps, screenshots };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isCatchMeUpRequest', () => {
  it.each(['catch me up', 'Catch up!', 'cmu', 'what did i miss?', '@12134198455 catch me up', '@Bot  CMU please'])(
    'is true for %j when the bot is mentioned',
    (text) => {
      expect(isCatchMeUpRequest(text, true)).toBe(true);
    },
  );

  it.each(["what's the theme", '@12134198455 what is the theme', 'cmuffin time', 'please catch me up'])(
    'is false for %j',
    (text) => {
      expect(isCatchMeUpRequest(text, true)).toBe(false);
    },
  );

  it('is false when the bot is not mentioned', () => {
    expect(isCatchMeUpRequest('catch me up', false)).toBe(false);
  });
});

describe('parseCmuGroups', () => {
  it('parses comma-separated groupId=instance pairs', () => {
    const map = parseCmuGroups(` ${GROUP}=boarz-ii-men , 999@g.us=other ,bad, =x, y@g.us=`);
    expect([...map.entries()]).toEqual([
      [GROUP, 'boarz-ii-men'],
      ['999@g.us', 'other'],
    ]);
  });

  it('is empty for undefined or blank', () => {
    expect(parseCmuGroups(undefined).size).toBe(0);
    expect(parseCmuGroups('  ').size).toBe(0);
  });
});

describe('runCatchMeUp', () => {
  it('unmapped group: no reaction, no fetch, one log line', async () => {
    const msg = makeMsg({ from: '555@g.us' });
    const { deps } = makeDeps();
    await runCatchMeUp(msg, deps);
    expect(msg.react).not.toHaveBeenCalled();
    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(deps.sendText).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledTimes(1);
    expect(deps.log.mock.calls[0][0]).toContain('555@g.us');
  });

  it('card: reacts 👍 before fetch, posts bearer + body, screenshots, DMs image then links, deletes the PNG', async () => {
    const order: string[] = [];
    const msg = makeMsg();
    msg.react.mockImplementation(async (e: string) => { order.push(`react ${e}`); });
    const { deps, screenshots } = makeDeps();
    deps.fetchFn.mockImplementation(async () => {
      order.push('fetch');
      return jsonResponse(200, { kind: 'card', html: '<html>card</html>', links: ['🎸 Gear: https://x/share-1.html', 'https://x/'] });
    });
    deps.screenshot.mockImplementation(async (_h: string, p: string) => { order.push('screenshot'); screenshots.push(p); writeFileSync(p, 'png'); });
    deps.sendImage.mockImplementation(async () => { order.push('image'); });
    deps.sendText.mockImplementation(async () => { order.push('text'); });

    await runCatchMeUp(msg, deps);

    expect(order).toEqual(['react 👍', 'fetch', 'screenshot', 'image', 'text']);
    const [url, init] = deps.fetchFn.mock.calls[0];
    expect(url).toBe(deps.url);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sekret', 'content-type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ notifyName: 'Alice', requestAt: REQUEST_AT, league: 'boarz-ii-men', requesterKey: AUTHOR });
    expect(init.signal).toBeInstanceOf(AbortSignal);

    expect(deps.screenshot).toHaveBeenCalledWith('<html>card</html>', screenshots[0]);
    expect(path.dirname(screenshots[0])).toBe(os.tmpdir());
    expect(deps.sendImage).toHaveBeenCalledWith(AUTHOR, screenshots[0]);
    expect(deps.sendText).toHaveBeenCalledWith(AUTHOR, '🎸 Gear: https://x/share-1.html\nhttps://x/');
    expect(existsSync(screenshots[0])).toBe(false);
  });

  it('falls back to getContact().pushname when the payload has no notifyName', async () => {
    const msg = makeMsg({ notifyName: undefined, getContact: vi.fn().mockResolvedValue({ pushname: 'Bob' }) });
    const { deps } = makeDeps();
    await runCatchMeUp(msg, deps);
    expect(JSON.parse(deps.fetchFn.mock.calls[0][1].body).notifyName).toBe('Bob');
  });

  it('quiet: sends only the text', async () => {
    const msg = makeMsg();
    const { deps } = makeDeps();
    await runCatchMeUp(msg, deps);
    expect(deps.screenshot).not.toHaveBeenCalled();
    expect(deps.sendImage).not.toHaveBeenCalled();
    expect(deps.sendText).toHaveBeenCalledTimes(1);
    expect(deps.sendText).toHaveBeenCalledWith(AUTHOR, 'Not much happened.');
  });

  it('limit: a 429 reacts ⏳ and sends nothing', async () => {
    const msg = makeMsg();
    const { deps } = makeDeps({ fetchFn: vi.fn().mockResolvedValue(jsonResponse(429, { error: 'limit' })) });
    await runCatchMeUp(msg, deps);
    expect(msg.react.mock.calls.map((c) => c[0])).toEqual(['👍', '⏳']);
    expect(deps.sendText).not.toHaveBeenCalled();
    expect(deps.sendImage).not.toHaveBeenCalled();
  });

  it.each([
    ['a 500', () => vi.fn().mockResolvedValue(jsonResponse(500, { error: 'boom' }))],
    ['a 401', () => vi.fn().mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }))],
    ['a network error', () => vi.fn().mockRejectedValue(new TypeError('fetch failed'))],
    ['a malformed body', () => vi.fn().mockResolvedValue(jsonResponse(200, { kind: 'nope' }))],
  ])('failure: %s sends the exact failure DM and resolves', async (_label, makeFetch) => {
    const msg = makeMsg();
    const { deps } = makeDeps({ fetchFn: makeFetch() });
    await expect(runCatchMeUp(msg, deps)).resolves.toBeUndefined();
    expect(deps.sendText).toHaveBeenCalledTimes(1);
    expect(deps.sendText).toHaveBeenCalledWith(AUTHOR, CMU_FAILURE_TEXT);
    expect(CMU_FAILURE_TEXT).toBe("Couldn't build your catch-up just now. Try again in a few minutes.");
  });

  it.each([
    ['missing', ''],
    ['a group id', '999@g.us'],
    ['the group itself', GROUP],
  ])('no DM target (author %s): no reaction, no fetch, no send, logged', async (_label, author) => {
    const msg = makeMsg({ author });
    const { deps } = makeDeps();
    await runCatchMeUp(msg, deps);
    expect(msg.react).not.toHaveBeenCalled();
    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(deps.sendText).not.toHaveBeenCalled();
    expect(deps.sendImage).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledTimes(1);
  });

  it('requesterKey: the dmTarget (LID) id when available, else the author; never logged', async () => {
    const cus = '15551234567@c.us';
    const { deps } = makeDeps({ dmTarget: vi.fn().mockResolvedValue('999888777@lid') });
    await runCatchMeUp(makeMsg({ author: cus }), deps);
    expect(deps.dmTarget).toHaveBeenCalledWith(cus);
    expect(JSON.parse(deps.fetchFn.mock.calls[0][1].body).requesterKey).toBe('999888777@lid');

    const failing = makeDeps({ dmTarget: vi.fn().mockRejectedValue(new Error('lookup')) }).deps;
    await runCatchMeUp(makeMsg({ author: cus }), failing);
    expect(JSON.parse(failing.fetchFn.mock.calls[0][1].body).requesterKey).toBe(cus);
    const logged = [...deps.log.mock.calls, ...failing.log.mock.calls].map((c) => String(c[0])).join('\n');
    expect(logged).not.toContain('999888777');
    expect(logged).not.toContain('15551234567');
  });

  it('timeouts: fetch 240 s, overall deadline 270 s', () => {
    expect(CMU_TIMEOUT_MS).toBe(240_000);
    expect(CMU_DEADLINE_MS).toBe(270_000);
  });

  it('failure: a 240 s timeout aborts the fetch and sends the failure DM', async () => {
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => realTimeout(5));
    const fetchFn = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
      init.signal!.addEventListener('abort', () => rej(init.signal!.reason));
    })) as AnyMock;
    const msg = makeMsg();
    const { deps } = makeDeps({ fetchFn });
    await runCatchMeUp(msg, deps);
    expect(spy).toHaveBeenCalledWith(240_000);
    expect(deps.sendText).toHaveBeenCalledWith(AUTHOR, CMU_FAILURE_TEXT);
  });

  it('failure after the screenshot still deletes the PNG and DMs the failure text', async () => {
    const msg = makeMsg();
    const { deps, screenshots } = makeDeps({
      fetchFn: vi.fn().mockResolvedValue(jsonResponse(200, { kind: 'card', html: '<p/>', links: [] })),
      sendImage: vi.fn().mockRejectedValue(new Error('send failed')),
    });
    await runCatchMeUp(msg, deps);
    expect(existsSync(screenshots[0])).toBe(false);
    expect(deps.sendText).toHaveBeenCalledWith(AUTHOR, CMU_FAILURE_TEXT);
  });

  it('never logs message text or names', async () => {
    const msg = makeMsg({ notifyName: 'Secret Person' });
    const { deps } = makeDeps({ fetchFn: vi.fn().mockRejectedValue(new Error('Secret Person leaked')) });
    await runCatchMeUp(msg, deps);
    const logged = deps.log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toContain('Secret Person');
    expect(logged).toContain(GROUP);
  });

  it('deadline: a never-resolving screenshot still sends the failure DM and resolves', async () => {
    const msg = makeMsg();
    const { deps } = makeDeps({
      fetchFn: vi.fn().mockResolvedValue(jsonResponse(200, { kind: 'card', html: '<p/>', links: ['l'] })),
      screenshot: vi.fn(() => new Promise<void>(() => {})),
      deadlineMs: 20,
    });
    await expect(runCatchMeUp(msg, deps)).resolves.toBeUndefined();
    expect(deps.sendImage).not.toHaveBeenCalled();
    expect(deps.sendText).toHaveBeenCalledTimes(1);
    expect(deps.sendText).toHaveBeenCalledWith(AUTHOR, CMU_FAILURE_TEXT);
    expect(deps.log.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')).toContain('Deadline');
  });

  it('deadline: the default overall budget is 270 s and the failure DM is bounded to 15 s', async () => {
    vi.useFakeTimers();
    try {
      const msg = makeMsg();
      const { deps } = makeDeps({
        fetchFn: vi.fn().mockResolvedValue(jsonResponse(200, { kind: 'card', html: '<p/>', links: [] })),
        screenshot: vi.fn(() => new Promise<void>(() => {})),
        sendText: vi.fn(() => new Promise<void>(() => {})),
      });
      let done = false;
      void runCatchMeUp(msg, deps).then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(269_000);
      expect(deps.sendText).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(deps.sendText).toHaveBeenCalledWith(AUTHOR, CMU_FAILURE_TEXT);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(15_000);
      vi.useRealTimers(); // the PNG cleanup in finally is real fs I/O
      await vi.waitFor(() => expect(done).toBe(true));
    } finally {
      vi.useRealTimers();
    }
  });

  it('partial success: image sent but links DM failed → no failure DM, logged', async () => {
    const msg = makeMsg();
    const { deps, screenshots } = makeDeps({
      fetchFn: vi.fn().mockResolvedValue(jsonResponse(200, { kind: 'card', html: '<p/>', links: ['l1', 'l2'] })),
      sendText: vi.fn().mockRejectedValue(new Error('links failed')),
    });
    await expect(runCatchMeUp(msg, deps)).resolves.toBeUndefined();
    expect(deps.sendImage).toHaveBeenCalledTimes(1);
    expect(deps.sendText).toHaveBeenCalledTimes(1);
    expect(deps.sendText).toHaveBeenCalledWith(AUTHOR, 'l1\nl2');
    expect(deps.sendText).not.toHaveBeenCalledWith(AUTHOR, CMU_FAILURE_TEXT);
    expect(existsSync(screenshots[0])).toBe(false);
    expect(deps.log.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')).toContain('links failed in');
  });

  it('partial success: a hung links DM past the deadline sends no failure DM', async () => {
    const msg = makeMsg();
    const { deps } = makeDeps({
      fetchFn: vi.fn().mockResolvedValue(jsonResponse(200, { kind: 'card', html: '<p/>', links: ['l1'] })),
      sendText: vi.fn(() => new Promise<void>(() => {})),
      deadlineMs: 20,
    });
    await expect(runCatchMeUp(msg, deps)).resolves.toBeUndefined();
    expect(deps.sendText).toHaveBeenCalledTimes(1);
    expect(deps.sendText).not.toHaveBeenCalledWith(AUTHOR, CMU_FAILURE_TEXT);
  });

  it('a failing failure-DM does not throw', async () => {
    const msg = makeMsg();
    const { deps } = makeDeps({
      fetchFn: vi.fn().mockRejectedValue(new Error('x')),
      sendText: vi.fn().mockRejectedValue(new Error('dm failed')),
    });
    await expect(runCatchMeUp(msg, deps)).resolves.toBeUndefined();
  });
});

describe('handleMessage catch-me-up routing', () => {
  const config = rulesConfigSchema.parse({
    defaults: { requireCommandPrefix: true, commandPrefix: '!song' },
    rules: [],
  });

  function botConfig(over: Partial<BotConfig> = {}): BotConfig {
    const db = openDb(':memory:');
    createPromptTables(db);
    return {
      config,
      spotify: {
        searchTrack: vi.fn(), getTrackById: vi.fn(), findOrCreatePlaylist: vi.fn(),
        isTrackInPlaylist: vi.fn(), addTrackToPlaylist: vi.fn(),
      },
      db,
      allowedGroupIds: ['120363000000000001'],
      ownerPhone: '1@c.us',
      masterPlaylistName: 'M',
      sendDm: vi.fn(),
      ...over,
    };
  }

  function waMsg(body: string, mentionsBot: boolean): WhatsAppMessage {
    return {
      body, from: GROUP, chatName: 'G', author: AUTHOR, fromMe: false, capturedAt: REQUEST_AT,
      priorMessages: [], mentionsBot,
      reply: vi.fn().mockResolvedValue(undefined),
      getContact: vi.fn().mockResolvedValue({ pushname: 'Alice' }),
      react: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('a catch-me-up mention goes to catchMeUp, not Jev', async () => {
    const catchMeUp = vi.fn().mockResolvedValue(undefined);
    const jevRespond = vi.fn().mockResolvedValue('jev');
    const msg = waMsg('@12134198455 catch me up', true);
    await handleMessage(msg, botConfig({ catchMeUp, jevRespond }));
    expect(catchMeUp).toHaveBeenCalledWith(msg);
    expect(jevRespond).not.toHaveBeenCalled();
    expect(msg.reply).not.toHaveBeenCalled();
  });

  it('a non-trigger mention still reaches Jev unchanged', async () => {
    const catchMeUp = vi.fn().mockResolvedValue(undefined);
    const jevRespond = vi.fn().mockResolvedValue('jev says');
    const msg = waMsg("@12134198455 what's the theme", true);
    await handleMessage(msg, botConfig({ catchMeUp, jevRespond }));
    expect(catchMeUp).not.toHaveBeenCalled();
    expect(jevRespond).toHaveBeenCalledWith(expect.objectContaining({ prompt: "what's the theme" }));
    expect(msg.reply).toHaveBeenCalledWith('jev says');
  });

  it('"catch me up" without a mention is not a request', async () => {
    const catchMeUp = vi.fn().mockResolvedValue(undefined);
    await handleMessage(waMsg('catch me up', false), botConfig({ catchMeUp }));
    expect(catchMeUp).not.toHaveBeenCalled();
  });
});

type Ev = { ev: 'start' | 'step' | 'end'; name?: string; f?: Record<string, unknown> };

function fakeTrace() {
  const events: Ev[] = [];
  const trace: InteractionTrace = {
    id: 'abcdef012345',
    start: (f) => { events.push({ ev: 'start', f: { ...f } }); },
    step: (name, f) => { events.push({ ev: 'step', name, f: { ...f } }); },
    end: (outcome, f) => { events.push({ ev: 'end', name: outcome, f: f ? { ...f } : undefined }); },
    thumbPath: () => path.join(os.tmpdir(), 'abcdef012345.jpg'),
  };
  const steps = () => events.filter((e) => e.ev === 'step');
  const step = (name: string) => steps().find((e) => e.name === name)?.f;
  const ends = () => events.filter((e) => e.ev === 'end');
  return { trace, events, steps, step, ends, factory: vi.fn(() => trace) };
}

const cardBody = (links: string[]) => ({
  kind: 'card',
  html: '<html>card</html>',
  links,
  meta: { costUsd: 0.0123, windowStart: '2026-11-06T04:40:00.000Z', windowReason: 'last-post', person: 'Alice B' },
});

describe('runCatchMeUp interaction trace', () => {
  it('card: start, trigger, react 👍, name, companelist, screenshot, thumb, image, links, end card', async () => {
    const t = fakeTrace();
    const msg = makeMsg({ chatName: 'Test Group' });
    const { deps } = makeDeps({
      fetchFn: vi.fn().mockResolvedValue(jsonResponse(200, cardBody(['🎸 Gear: https://x/share-t1.html', 'Food https://x/share-t2.html', 'https://x/']))),
      trace: t.factory,
    });
    deps.screenshot.mockImplementation(async (_h: string, p: string) => { writeFileSync(p, 'png!'); return { thumbBytes: 4321 }; });

    await runCatchMeUp(msg, deps);

    expect(t.factory).toHaveBeenCalledTimes(1);
    expect(t.events[0]).toEqual({ ev: 'start', f: {
      group: GROUP, groupName: 'Test Group', instance: 'boarz-ii-men', who: 'Alice', authorKind: 'lid', command: 'catch me up',
    } });
    expect(t.events.map((e) => (e.ev === 'step' && e.name === 'react' ? `react ${e.f!.emoji}` : e.ev === 'step' ? e.name : e.ev === 'end' ? `end ${e.name}` : e.ev)))
      .toEqual(['start', 'trigger', 'react 👍', 'name', 'companelist', 'screenshot', 'thumb', 'image', 'links', 'end card']);
    expect(t.step('trigger')).toMatchObject({ ok: true, mapped: true });
    expect(t.step('react')).toMatchObject({ ok: true, emoji: '👍' });
    expect(t.step('name')).toMatchObject({ ok: true, source: 'payload' });
    expect(t.step('companelist')).toMatchObject({
      ok: true, status: 200, result: 'card', costUsd: 0.0123, windowStart: '2026-11-06T04:40:00.000Z', windowReason: 'last-post', person: 'Alice B',
    });
    expect(typeof t.step('companelist')!.ms).toBe('number');
    expect(t.step('screenshot')).toMatchObject({ ok: true, bytes: 4 });
    expect(t.step('thumb')).toEqual({ ok: true, bytes: 4321 });
    expect(t.step('image')).toMatchObject({ ok: true });
    expect(t.step('links')).toMatchObject({ ok: true, count: 3, topics: ['t1', 't2'] });
    expect(t.ends()).toHaveLength(1);
    expect(t.ends()[0].f).toBeUndefined();
    expect(deps.screenshot.mock.calls[0][2]).toBe(path.join(os.tmpdir(), 'abcdef012345.jpg'));
  });

  it('card: an old companelist (no meta) and a screenshot without a thumbnail still trace', async () => {
    const t = fakeTrace();
    const { deps } = makeDeps({
      fetchFn: vi.fn().mockResolvedValue(jsonResponse(200, { kind: 'card', html: '<p/>', links: [] })),
      trace: t.factory,
    });
    await runCatchMeUp(makeMsg(), deps);
    expect(t.step('companelist')).toMatchObject({ ok: true, status: 200, result: 'card' });
    expect(t.step('companelist')).not.toHaveProperty('costUsd', expect.anything());
    expect(t.step('thumb')).toMatchObject({ ok: false });
    expect(t.step('links')).toBeUndefined();
    expect(t.ends()[0].name).toBe('card');
  });

  it('unmapped group: start + end unsupported, no react or fetch', async () => {
    const t = fakeTrace();
    const msg = makeMsg({ from: '555@g.us' });
    const { deps } = makeDeps({ trace: t.factory });
    await runCatchMeUp(msg, deps);
    expect(t.events[0].ev).toBe('start');
    expect(t.events[0].f).toMatchObject({ group: '555@g.us', who: 'Alice', command: 'catch me up' });
    expect(t.step('trigger')).toMatchObject({ mapped: false });
    expect(t.step('react')).toBeUndefined();
    expect(t.ends().map((e) => e.name)).toEqual(['unsupported']);
    expect(msg.react).not.toHaveBeenCalled();
    expect(deps.fetchFn).not.toHaveBeenCalled();
  });

  it('429 gate busy: companelist limit, limit step, react ⏳, end limit', async () => {
    const t = fakeTrace();
    const { deps } = makeDeps({ fetchFn: vi.fn().mockResolvedValue(jsonResponse(429, { error: 'busy', gate: 'busy' })), trace: t.factory });
    await runCatchMeUp(makeMsg(), deps);
    expect(t.step('companelist')).toMatchObject({ ok: true, status: 429, result: 'limit' });
    expect(t.step('limit')).toMatchObject({ gate: 'busy' });
    expect(t.steps().filter((e) => e.name === 'react').map((e) => e.f!.emoji)).toEqual(['👍', '⏳']);
    expect(t.ends().map((e) => e.name)).toEqual(['limit']);
  });

  it('500: companelist ok:false status 500, failure-dm ok, end failed with error "http 500"', async () => {
    const t = fakeTrace();
    const { deps } = makeDeps({ fetchFn: vi.fn().mockResolvedValue(jsonResponse(500, { error: 'boom' })), trace: t.factory });
    await runCatchMeUp(makeMsg(), deps);
    expect(t.step('companelist')).toMatchObject({ ok: false, status: 500 });
    expect(t.step('failure-dm')).toMatchObject({ ok: true });
    expect(t.ends()).toEqual([{ ev: 'end', name: 'failed', f: { error: 'http 500' } }]);
  });

  it('links DM throws after the image: end card-partial', async () => {
    const t = fakeTrace();
    const { deps } = makeDeps({
      fetchFn: vi.fn().mockResolvedValue(jsonResponse(200, cardBody(['l1']))),
      sendText: vi.fn().mockRejectedValue(new Error('links failed')),
      trace: t.factory,
    });
    await runCatchMeUp(makeMsg(), deps);
    expect(t.step('image')).toMatchObject({ ok: true });
    expect(t.step('links')).toMatchObject({ ok: false, count: 1 });
    expect(t.ends().map((e) => e.name)).toEqual(['card-partial']);
  });

  it('quiet: quiet-dm then end quiet', async () => {
    const t = fakeTrace();
    const { deps } = makeDeps({ trace: t.factory });
    await runCatchMeUp(makeMsg(), deps);
    expect(t.step('companelist')).toMatchObject({ ok: true, result: 'quiet' });
    expect(t.step('quiet-dm')).toMatchObject({ ok: true });
    expect(t.ends().map((e) => e.name)).toEqual(['quiet']);
  });

  it('deadline during a hung screenshot: end failed with error Deadline', async () => {
    const t = fakeTrace();
    const { deps } = makeDeps({
      fetchFn: vi.fn().mockResolvedValue(jsonResponse(200, cardBody(['l']))),
      screenshot: vi.fn(() => new Promise<void>(() => {})),
      deadlineMs: 20,
      trace: t.factory,
    });
    await runCatchMeUp(makeMsg(), deps);
    expect(t.step('failure-dm')).toMatchObject({ ok: true });
    expect(t.ends()).toEqual([{ ev: 'end', name: 'failed', f: { error: 'Deadline' } }]);
  });

  it('a trace that throws on every call still delivers the image and links', async () => {
    const boom = () => { throw new Error('log broken'); };
    const broken: InteractionTrace = { id: 'x', start: boom, step: boom, end: boom, thumbPath: boom };
    const { deps } = makeDeps({
      fetchFn: vi.fn().mockResolvedValue(jsonResponse(200, cardBody(['https://x/share-a.html']))),
      trace: () => broken,
    });
    await expect(runCatchMeUp(makeMsg(), deps)).resolves.toBeUndefined();
    expect(deps.sendImage).toHaveBeenCalledTimes(1);
    expect(deps.sendText).toHaveBeenCalledWith(AUTHOR, 'https://x/share-a.html');

    const throwingFactory = makeDeps({
      fetchFn: vi.fn().mockResolvedValue(jsonResponse(200, cardBody(['l']))),
      trace: boom as () => InteractionTrace,
    }).deps;
    await runCatchMeUp(makeMsg(), throwingFactory);
    expect(throwingFactory.sendImage).toHaveBeenCalledTimes(1);
  });

  it('never records the request text, DM text or link text', async () => {
    const SENTINEL = 'ZZSENTINELZZ';
    const body = { body: `@bot catch me up ${SENTINEL}` };
    const card = makeFakeRun({ kind: 'card', html: `<p>${SENTINEL}</p>`, links: [`${SENTINEL} Gear https://x/share-g1.html`] });
    const quiet = makeFakeRun({ kind: 'quiet', text: `${SENTINEL} quiet` });
    for (const run of [card, quiet]) {
      await runCatchMeUp(makeMsg(body as Partial<CmuMessage>), run.deps);
      const recorded = JSON.stringify(run.t.events);
      expect(recorded).not.toContain(SENTINEL);
      expect(recorded).not.toContain(AUTHOR);
    }
    expect(card.t.step('links')).toMatchObject({ topics: ['g1'] });
  });

  it('who is the notifyName; authorKind comes from the author suffix', async () => {
    for (const [author, kind] of [['15551234567@c.us', 'c.us'], [AUTHOR, 'lid'], ['weird-id', 'other']] as const) {
      const t = fakeTrace();
      const { deps } = makeDeps({ trace: t.factory });
      await runCatchMeUp(makeMsg({ author, notifyName: 'Zed' }), deps);
      expect(t.events[0].f).toMatchObject({ who: 'Zed', authorKind: kind });
      expect(JSON.stringify(t.events)).not.toContain('15551234567');
    }
    const t = fakeTrace();
    const { deps } = makeDeps({ trace: t.factory });
    await runCatchMeUp(makeMsg({ notifyName: undefined, getContact: vi.fn().mockResolvedValue({ pushname: 'Bob' }) }), deps);
    expect(t.events[0].f).toMatchObject({ who: '' });
    expect(t.step('name')).toMatchObject({ ok: true, source: 'contact', who: 'Bob' });
  });

  it('a hung getContact() still reacts 👍 first, then hits the deadline: failure DM, end failed Deadline', async () => {
    const t = fakeTrace();
    const msg = makeMsg({ notifyName: undefined, getContact: vi.fn(() => new Promise<{ pushname: string }>(() => {})) });
    const { deps } = makeDeps({ deadlineMs: 20, trace: t.factory });
    await expect(runCatchMeUp(msg, deps)).resolves.toBeUndefined();
    expect(msg.react.mock.calls.map((c) => c[0])).toEqual(['👍']);
    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(deps.sendText).toHaveBeenCalledWith(AUTHOR, CMU_FAILURE_TEXT);
    expect(t.step('react')).toMatchObject({ ok: true, emoji: '👍' });
    expect(t.step('failure-dm')).toMatchObject({ ok: true });
    expect(t.ends()).toEqual([{ ev: 'end', name: 'failed', f: { error: 'Deadline' } }]);
  });
});

function makeFakeRun(result: unknown) {
  const t = fakeTrace();
  const { deps } = makeDeps({ fetchFn: vi.fn().mockResolvedValue(jsonResponse(200, result)), trace: t.factory });
  return { t, deps };
}
