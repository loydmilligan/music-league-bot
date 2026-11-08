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
import { helpText, makeIsOwner, tldrText, FORGET_FAILURE_TEXT, RECAP_FAILURE_TEXT } from '../../src/bot/cmuFlows.js';
import { openCmuSwitch, type CmuSwitch } from '../../src/bot/cmuSwitch.js';
import type { InteractionTrace } from '../../src/storage/interactionLog.js';
import { handleMessage, type WhatsAppMessage, type BotConfig } from '../../src/bot/handler.js';
import { openDb } from '../../src/storage/db.js';
import { createPromptTables } from '../../src/chat/prompts/store.js';
import { rulesConfigSchema } from '../../src/config/types.js';
import { memoryCmuPreview, type CmuPreview } from '../../src/bot/cmuPreview.js';
import type { RecapSub } from '../../src/bot/recapSubs.js';
import { ALL_COMMANDS, MENU_HEADING, PLAYER_MENU, menuHeading, playerMenu } from '../../src/bot/cmuMenu.js';

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
  preview?: CmuPreview;
  recapSubscription?: (dmTarget: string) => RecapSub;
  followUpTimeoutMs?: number;
  useCaption?: boolean;
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
  it.each(['catch me up', 'Catch up!', 'cmu', 'what did i miss?', '@12134198455 catch me up', '@Bot  CMU please', 'please catch me up'])(
    'is true for %j when the bot is mentioned',
    (text) => {
      expect(isCatchMeUpRequest(text, true)).toBe(true);
    },
  );

  it.each(["what's the theme", '@12134198455 what is the theme', 'cmuffin time'])(
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
    expect(catchMeUp).toHaveBeenCalledWith(msg, { kind: 'catchup' });
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

  it('links step takes topic ids from meta.topicIds for markup- links', async () => {
    const run = makeFakeRun({
      kind: 'card', html: '<p/>',
      links: ['Gear https://x/markup-m1.html', 'Food https://x/markup-m2.html'],
      meta: { topicIds: ['t3', 't9'] },
    });
    await runCatchMeUp(makeMsg(), run.deps);
    expect(run.t.step('links')).toMatchObject({ ok: true, count: 2, topics: ['t3', 't9'] });
    expect(run.t.step('companelist')).not.toHaveProperty('topicIds');
    const recorded = JSON.stringify(run.t.events);
    expect(recorded).not.toContain('markup-');
    expect(recorded).not.toContain('https://x');
    expect(recorded).not.toContain('Gear');
  });

  it('links step falls back to share- links when meta.topicIds is absent or malformed', async () => {
    for (const meta of [undefined, { topicIds: 'nope' }, { topicIds: [1, 2] }]) {
      const run = makeFakeRun({ kind: 'card', html: '<p/>', links: ['https://x/share-a1.html'], meta });
      await runCatchMeUp(makeMsg(), run.deps);
      expect(run.t.step('links')).toMatchObject({ topics: ['a1'] });
    }
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

// ── Task 4: owner check, full, forget and help ─────────────────────────────

const OWNER = '111222333@lid';
const PLAYER = '456@lid';
const BOT = 'Music League Bot';
const SENTINEL_NAME = 'ZZNAMEZZ';

function flowDeps(over: Partial<FakeDeps> & {
  owner?: boolean | 'reject';
  contactName?: AnyMock;
  helpThrottle?: Map<string, number>;
  helpCooldown?: { min: number };
  now?: () => number;
  cmuSwitch?: CmuSwitch;
  tldrThrottle?: Map<string, number>;
} = {}) {
  const { owner = true, contactName, helpThrottle, helpCooldown, now, cmuSwitch, tldrThrottle, ...rest } = over;
  const t = fakeTrace();
  const base = makeDeps({ trace: t.factory, ...rest });
  const deps = Object.assign(base.deps, {
    isOwner: owner === 'reject'
      ? vi.fn().mockRejectedValue(new Error('lookup'))
      : vi.fn().mockResolvedValue(owner),
    contactName: contactName ?? vi.fn().mockResolvedValue(SENTINEL_NAME),
    botName: () => BOT,
    helpThrottle: helpThrottle ?? new Map<string, number>(),
    helpCooldown: helpCooldown ?? { min: 5 },
    cmuSwitch: cmuSwitch ?? memSwitch(),
    tldrThrottle: tldrThrottle ?? new Map<string, number>(),
    ...(now ? { now } : {}),
  });
  return { deps, t, screenshots: base.screenshots };
}

function memSwitch(enabled = true): CmuSwitch & { sets: boolean[] } {
  const sets: boolean[] = [];
  return { sets, isEnabled: () => enabled, set: (e) => { enabled = e; sets.push(e); } };
}

const ownerMsg = (over: Partial<CmuMessage> = {}) => makeMsg({ author: OWNER, notifyName: 'Owen', ...over });
const sequence = (t: ReturnType<typeof fakeTrace>) =>
  t.events.map((e) => (e.ev === 'step' ? `${e.name}${e.name === 'owner' ? ` ok:${e.f!.ok}` : ''}` : e.ev === 'end' ? `end ${e.name}` : e.ev));
const sentBody = (deps: { fetchFn: AnyMock }, i = 0) => JSON.parse(deps.fetchFn.mock.calls[i][1].body);
const forgotRes = (o: Record<string, unknown>) => jsonResponse(200, { kind: 'forgot', left: 3, ...o });

describe('runCatchMeUp owner-only commands from a non-owner', () => {
  it.each([
    ['full', { kind: 'full' }, 'full'],
    ['forget all', { kind: 'forget', target: 'all' }, 'forget all'],
    ['forget', { kind: 'forget', target: 'self' }, 'forget'],
    ['forget @', { kind: 'forget', target: { id: PLAYER } }, 'forget @'],
  ] as const)('%s: no react, no fetch, no DM; start, owner ok:false, end not-allowed', async (_l, cmd, command) => {
    const { deps, t } = flowDeps({ owner: false });
    const msg = makeMsg();
    await expect(runCatchMeUp(msg, deps, cmd)).resolves.toBeUndefined();
    expect(msg.react).not.toHaveBeenCalled();
    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(deps.sendText).not.toHaveBeenCalled();
    expect(deps.sendImage).not.toHaveBeenCalled();
    expect(deps.isOwner).toHaveBeenCalledWith(AUTHOR);
    expect(sequence(t)).toEqual(['start', 'owner ok:false', 'end not-allowed']);
    expect(t.events[0].f).toMatchObject({ command });
  });

  it('fails closed: an isOwner that rejects is not-allowed', async () => {
    const { deps, t } = flowDeps({ owner: 'reject' });
    const msg = ownerMsg();
    await expect(runCatchMeUp(msg, deps, { kind: 'full' })).resolves.toBeUndefined();
    expect(msg.react).not.toHaveBeenCalled();
    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(t.ends().map((e) => e.name)).toEqual(['not-allowed']);
  });

  it('fails closed: no isOwner dep at all is not-allowed', async () => {
    const t = fakeTrace();
    const { deps } = makeDeps({ trace: t.factory });
    await runCatchMeUp(ownerMsg(), deps, { kind: 'forget', target: 'all' });
    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(t.ends().map((e) => e.name)).toEqual(['not-allowed']);
  });
});

describe('runCatchMeUp full (owner)', () => {
  it('sends mode:"full", runs the card path with 👍, command full', async () => {
    const { deps, t } = flowDeps({ fetchFn: vi.fn().mockResolvedValue(jsonResponse(200, cardBody(['https://x/share-f1.html']))) });
    const msg = ownerMsg();
    await runCatchMeUp(msg, deps, { kind: 'full' });
    expect(sentBody(deps)).toEqual({ notifyName: 'Owen', requestAt: REQUEST_AT, league: 'boarz-ii-men', requesterKey: OWNER, mode: 'full' });
    expect(msg.react.mock.calls.map((c) => c[0])).toEqual(['👍']);
    expect(deps.sendImage).toHaveBeenCalledTimes(1);
    expect(deps.sendText).toHaveBeenCalledWith(OWNER, 'https://x/share-f1.html');
    expect(t.events[0].f).toMatchObject({ command: 'full' });
    expect(sequence(t)).toEqual(['start', 'owner ok:true', 'trigger', 'react', 'name', 'companelist', 'screenshot', 'thumb', 'image', 'links', 'end card']);
  });

  it('a plain catch-up never sends a mode and never asks isOwner', async () => {
    const { deps } = flowDeps();
    await runCatchMeUp(makeMsg(), deps, { kind: 'catchup' });
    expect(sentBody(deps)).not.toHaveProperty('mode');
    expect(deps.isOwner).not.toHaveBeenCalled();
  });
});

describe('runCatchMeUp forget (owner)', () => {
  it('naked forget: mode forget, target self; 👍 then one DM; ends forgot', async () => {
    const { deps, t } = flowDeps({ fetchFn: vi.fn().mockResolvedValue(forgotRes({ target: 'self', resolved: true, forgotten: true, person: 'Owen B' })) });
    const msg = ownerMsg();
    await runCatchMeUp(msg, deps, { kind: 'forget', target: 'self' });
    expect(sentBody(deps)).toEqual({ notifyName: 'Owen', requestAt: REQUEST_AT, league: 'boarz-ii-men', requesterKey: OWNER, mode: 'forget', target: 'self' });
    expect(msg.react.mock.calls.map((c) => c[0])).toEqual(['👍']);
    expect(deps.sendText.mock.calls).toEqual([[OWNER, 'Forgot your last catch-up. You have 3 left today.']]);
    expect(sequence(t)).toEqual(['start', 'owner ok:true', 'trigger', 'react', 'forget', 'confirm-dm', 'end forgot']);
    expect(t.events[0].f).toMatchObject({ command: 'forget' });
  });

  it('naked forget with nothing to forget: resets the count', async () => {
    const { deps } = flowDeps({ fetchFn: vi.fn().mockResolvedValue(forgotRes({ target: 'self', resolved: true, forgotten: false })) });
    await runCatchMeUp(ownerMsg(), deps, { kind: 'forget', target: 'self' });
    expect(deps.sendText.mock.calls).toEqual([[OWNER, 'Reset your count; no recent catch-up to forget.']]);
  });

  it('forget all: the everyone DM', async () => {
    const { deps, t } = flowDeps({ fetchFn: vi.fn().mockResolvedValue(forgotRes({ target: 'all', resolved: true, forgotten: true })) });
    await runCatchMeUp(ownerMsg(), deps, { kind: 'forget', target: 'all' });
    expect(sentBody(deps)).toMatchObject({ mode: 'forget', target: 'all' });
    expect(deps.sendText.mock.calls).toEqual([[OWNER, "Forgot everyone's last catch-up and reset today's counts."]]);
    expect(t.events[0].f).toMatchObject({ command: 'forget all' });
    expect(t.ends().map((e) => e.name)).toEqual(['forgot']);
  });

  it.each([
    [{ resolved: true, forgotten: true, person: 'Pat Q' }, "Forgot Pat Q's last catch-up. They have 3 left today."],
    [{ resolved: true, forgotten: true }, `Forgot ${SENTINEL_NAME}'s last catch-up. They have 3 left today.`],
    [{ resolved: false, forgotten: false }, `Couldn't tell who ${SENTINEL_NAME} is; reset their count only.`],
    [{ resolved: true, forgotten: false, person: 'Pat Q' }, "Reset Pat Q's count; no recent catch-up to forget."],
  ])('forget @Player %j → the right owner DM; the id and name stay out of the trace', async (res, dm) => {
    const { deps, t } = flowDeps({ fetchFn: vi.fn().mockResolvedValue(forgotRes({ target: 'player', ...res })) });
    await runCatchMeUp(ownerMsg(), deps, { kind: 'forget', target: { id: PLAYER } });
    expect(deps.contactName).toHaveBeenCalledWith(PLAYER);
    expect(sentBody(deps)).toMatchObject({ mode: 'forget', target: { key: PLAYER, name: SENTINEL_NAME } });
    expect(deps.sendText.mock.calls).toEqual([[OWNER, dm]]);
    expect(t.events[0].f).toMatchObject({ command: 'forget @' });
    expect(t.step('forget')).toMatchObject({ ok: true, resolved: res.resolved });
    expect(t.ends().map((e) => e.name)).toEqual(['forgot']);
    const recorded = JSON.stringify(t.events);
    expect(recorded).not.toContain('456');
    expect(recorded).not.toContain(SENTINEL_NAME);
    expect(recorded).not.toContain('Pat Q');
    expect(deps.log.mock.calls.map((c) => String(c[0])).join('\n')).not.toMatch(/456|ZZNAMEZZ|Pat Q/);
  });

  it('forget @Player: the target key goes through dmTarget like requesterKey', async () => {
    const dmTarget = vi.fn(async (id: string) => (id === '15550001111@c.us' ? '777@lid' : id));
    const { deps } = flowDeps({ dmTarget, fetchFn: vi.fn().mockResolvedValue(forgotRes({ target: 'player', resolved: true, forgotten: true })) });
    await runCatchMeUp(ownerMsg(), deps, { kind: 'forget', target: { id: '15550001111@c.us' } });
    expect(sentBody(deps).target).toEqual({ key: '777@lid', name: SENTINEL_NAME });
  });

  it('forget @Player: a failing contactName sends an empty name and still resets', async () => {
    const { deps } = flowDeps({
      contactName: vi.fn().mockRejectedValue(new Error('nope')),
      fetchFn: vi.fn().mockResolvedValue(forgotRes({ target: 'player', resolved: false, forgotten: false })),
    });
    await runCatchMeUp(ownerMsg(), deps, { kind: 'forget', target: { id: PLAYER } });
    expect(sentBody(deps).target).toEqual({ key: PLAYER, name: '' });
    expect(deps.sendText.mock.calls).toEqual([[OWNER, "Couldn't tell who that player is; reset their count only."]]);
  });

  it('forget: a companelist failure ends failed and DMs the owner a short failure line', async () => {
    const { deps, t } = flowDeps({ fetchFn: vi.fn().mockResolvedValue(jsonResponse(500, { error: 'boom' })) });
    await expect(runCatchMeUp(ownerMsg(), deps, { kind: 'forget', target: 'all' })).resolves.toBeUndefined();
    expect(t.step('forget')).toMatchObject({ ok: false, status: 500 });
    expect(deps.sendText.mock.calls).toEqual([[OWNER, FORGET_FAILURE_TEXT]]);
    expect(t.ends()).toEqual([{ ev: 'end', name: 'failed', f: { error: 'http 500' } }]);
  });

  it.each([
    ['a network error', () => vi.fn().mockRejectedValue(new TypeError('fetch failed'))],
    ['a bad body', () => vi.fn().mockResolvedValue(jsonResponse(200, { kind: 'card' }))],
  ])('forget: a POST failure (%s) sends the failure DM', async (_l, fetchFn) => {
    const { deps, t } = flowDeps({ fetchFn: fetchFn() });
    await runCatchMeUp(ownerMsg(), deps, { kind: 'forget', target: 'self' });
    expect(deps.sendText.mock.calls).toEqual([[OWNER, FORGET_FAILURE_TEXT]]);
    expect(t.ends().map((e) => e.name)).toEqual(['failed']);
  });

  it('forget: the POST succeeded but the confirm DM failed: ends forgot, no contradictory failure DM', async () => {
    const { deps, t } = flowDeps({
      fetchFn: vi.fn().mockResolvedValue(forgotRes({ target: 'self', resolved: true, forgotten: true })),
      sendText: vi.fn().mockRejectedValue(new Error('send')),
    });
    await expect(runCatchMeUp(ownerMsg(), deps, { kind: 'forget', target: 'self' })).resolves.toBeUndefined();
    expect(deps.sendText).toHaveBeenCalledTimes(1);
    expect(deps.sendText.mock.calls[0][1]).not.toBe(FORGET_FAILURE_TEXT);
    expect(t.step('confirm-dm')).toMatchObject({ ok: false });
    expect(t.ends().map((e) => e.name)).toEqual(['forgot']);
  });
});

describe('help cooldown', () => {
  const res = (extra: Record<string, unknown>) => jsonResponse(200, { kind: 'status', used: 0, limit: 3, ...extra });
  const at = (clock: { t: number }) => ({ now: () => clock.t });

  it('a throttled help reacts ⏳ with no DM and one status fetch; a failing react is logged and never throws', async () => {
    const helpThrottle = new Map<string, number>([[AUTHOR, 1_000_000]]);
    const { deps, t } = flowDeps({ owner: false, helpThrottle, now: () => 1_000_000 + 60_000, fetchFn: vi.fn().mockResolvedValue(res({})) });
    const msg = makeMsg();
    msg.react.mockRejectedValue(new Error('react'));
    await expect(runCatchMeUp(msg, deps, { kind: 'help' })).resolves.toBeUndefined();
    expect(msg.react.mock.calls.map((c) => c[0])).toEqual(['⏳']);
    expect(t.step('react')).toMatchObject({ ok: false, emoji: '⏳' });
    expect(deps.fetchFn).toHaveBeenCalledTimes(1);
    expect(deps.sendText).not.toHaveBeenCalled();
    expect(t.ends().map((e) => e.name)).toEqual(['help-throttled']);
    expect(deps.log.mock.calls.flat().join('\n')).not.toContain('Alice');
  });

  it('the default is 5 minutes: throttled at +4m59s, not at +5m01s', async () => {
    const helpThrottle = new Map<string, number>([[AUTHOR, 1_000_000]]);
    const early = flowDeps({ owner: false, helpThrottle, now: () => 1_000_000 + 299_000, fetchFn: vi.fn().mockResolvedValue(res({})) });
    await runCatchMeUp(makeMsg(), early.deps, { kind: 'help' });
    expect(early.deps.sendText).not.toHaveBeenCalled();
    const late = flowDeps({ owner: false, helpThrottle, now: () => 1_000_000 + 301_000, fetchFn: vi.fn().mockResolvedValue(res({})) });
    await runCatchMeUp(makeMsg(), late.deps, { kind: 'help' });
    expect(late.deps.sendText).toHaveBeenCalledTimes(1);
  });

  it('helpCooldownMin: 2 from a status response sets the window for the next help, and the DM says 2', async () => {
    const clock = { t: 1_000_000 };
    const helpThrottle = new Map<string, number>();
    const helpCooldown = { min: 5 };
    const first = flowDeps({ owner: false, helpThrottle, helpCooldown, ...at(clock), fetchFn: vi.fn().mockResolvedValue(res({ helpCooldownMin: 2 })) });
    await runCatchMeUp(makeMsg(), first.deps, { kind: 'help' });
    expect(first.deps.sendText.mock.calls[0][1]).toContain('Once every 2 minutes;');
    clock.t += 119_000;
    const second = flowDeps({ owner: false, helpThrottle, helpCooldown, ...at(clock), fetchFn: vi.fn().mockResolvedValue(res({})) });
    await runCatchMeUp(makeMsg(), second.deps, { kind: 'help' });
    expect(second.deps.sendText).not.toHaveBeenCalled();
    clock.t += 2_000;
    const third = flowDeps({ owner: false, helpThrottle, helpCooldown, ...at(clock), fetchFn: vi.fn().mockResolvedValue(res({})) });
    await runCatchMeUp(makeMsg(), third.deps, { kind: 'help' });
    expect(third.deps.sendText).toHaveBeenCalledTimes(1);
  });

  it('the silent status of a throttled help also updates the cooldown', async () => {
    const helpThrottle = new Map<string, number>([[AUTHOR, 1_000_000]]);
    const helpCooldown = { min: 5 };
    const { deps } = flowDeps({ owner: false, helpThrottle, helpCooldown, now: () => 1_000_000 + 60_000, fetchFn: vi.fn().mockResolvedValue(res({ helpCooldownMin: 9 })) });
    await runCatchMeUp(makeMsg(), deps, { kind: 'help' });
    expect(helpCooldown.min).toBe(9);
  });

  it.each([[0], [61], ['x'], [2.5], [null]])('an invalid helpCooldownMin (%s) is ignored', async (bad) => {
    const helpCooldown = { min: 7 };
    const { deps } = flowDeps({ owner: false, helpCooldown, fetchFn: vi.fn().mockResolvedValue(res({ helpCooldownMin: bad })) });
    await runCatchMeUp(makeMsg(), deps, { kind: 'help' });
    expect(helpCooldown.min).toBe(7);
  });
});

describe('helpText', () => {
  it('shows the cooldown N, singular for 1', () => {
    expect(helpText({ botName: BOT, used: 0, limit: 3, cooldownMin: 12, owner: false })).toContain('\n  This message. Once every 12 minutes; ask again sooner and you get ⏳.');
    expect(helpText({ botName: BOT, used: 0, limit: 3, cooldownMin: 1, owner: false })).toContain('Once every 1 minute; ask again');
  });

  it('is the H2 copy, with the count', () => {
    expect(helpText({ botName: BOT, used: 2, limit: 3, cooldownMin: 5, owner: false })).toBe([
      'Catch-up bot — what you can ask',
      '',
      '@Music League Bot catch me up',
      '  A picture of what you missed since your last post (up to 48 hours),',
      '  plus links to the top topics. Also works: "what did I miss", "cmu",',
      '  "fill me in", "recap".',
      '',
      "You've used 2 of 3 today. Resets at midnight (LA time).",
      '',
      '@Music League Bot help',
      '  This message. Once every 5 minutes; ask again sooner and you get ⏳.',
    ].join('\n'));
  });

  it('an unknown count reads "3 a day (couldn\'t check your count just now)"', () => {
    const text = helpText({ botName: 'Bot', limit: 3, cooldownMin: 5, owner: false });
    expect(text).toContain("\n3 a day (couldn't check your count just now)\n");
    expect(text).not.toContain("You've used");
    expect(text).toContain('@Bot catch me up');
  });

  it('the owner copy adds one line each for full and the three forget forms', () => {
    const text = helpText({ botName: BOT, used: 0, limit: 3, cooldownMin: 5, owner: true });
    expect(text.startsWith(helpText({ botName: BOT, used: 0, limit: 3, cooldownMin: 5, owner: false }))).toBe(true);
    const extra = text.slice(helpText({ botName: BOT, used: 0, limit: 3, cooldownMin: 5, owner: false }).length);
    expect(extra).toContain('Owner only');
    for (const c of ['full', 'forget', 'forget @Player', 'forget all']) {
      expect(extra.split('\n').filter((l) => l.includes(`@${BOT} ${c} —`))).toHaveLength(1);
    }
  });
});

describe('runCatchMeUp help', () => {
  const statusRes = (used: number) => jsonResponse(200, { kind: 'status', used, limit: 3 });

  it('anyone: mode status, 👍, then the help DM with their count', async () => {
    const { deps, t } = flowDeps({ owner: false, fetchFn: vi.fn().mockResolvedValue(statusRes(2)) });
    const msg = makeMsg();
    await runCatchMeUp(msg, deps, { kind: 'help' });
    expect(sentBody(deps)).toEqual({ notifyName: 'Alice', requestAt: REQUEST_AT, league: 'boarz-ii-men', requesterKey: AUTHOR, mode: 'status' });
    expect(msg.react.mock.calls.map((c) => c[0])).toEqual(['👍']);
    expect(deps.sendText.mock.calls).toEqual([[AUTHOR, helpText({ botName: BOT, used: 2, limit: 3, cooldownMin: 5, owner: false })]]);
    expect(sequence(t)).toEqual(['start', 'trigger', 'react', 'status', 'help-dm', 'end help']);
    expect(t.events[0].f).toMatchObject({ command: 'help' });
  });

  it('the owner gets the owner copy', async () => {
    const { deps } = flowDeps({ owner: true, fetchFn: vi.fn().mockResolvedValue(statusRes(1)) });
    await runCatchMeUp(ownerMsg(), deps, { kind: 'help' });
    expect(deps.sendText.mock.calls).toEqual([[OWNER, helpText({ botName: BOT, used: 1, limit: 3, cooldownMin: 5, owner: true })]]);
  });

  it.each([
    ['a 500', () => vi.fn().mockResolvedValue(jsonResponse(500, {}))],
    ['a network error', () => vi.fn().mockRejectedValue(new TypeError('fetch failed'))],
    ['a bad body', () => vi.fn().mockResolvedValue(jsonResponse(200, { kind: 'card' }))],
  ])('a status failure (%s) still sends help with no count', async (_l, fetchFn) => {
    const { deps, t } = flowDeps({ owner: false, fetchFn: fetchFn() });
    await runCatchMeUp(makeMsg(), deps, { kind: 'help' });
    expect(deps.sendText.mock.calls).toEqual([[AUTHOR, helpText({ botName: BOT, limit: 3, cooldownMin: 5, owner: false })]]);
    expect(t.step('status')).toMatchObject({ ok: false });
    expect(t.ends().map((e) => e.name)).toEqual(['help']);
  });

  it('a second help within 5 minutes: ⏳ only, one status fetch, no DM, end help-throttled; after 5 minutes it works again', async () => {
    let clock = 1_000_000;
    const helpThrottle = new Map<string, number>();
    const first = flowDeps({ owner: false, helpThrottle, now: () => clock, fetchFn: vi.fn().mockResolvedValue(statusRes(0)) });
    await runCatchMeUp(makeMsg(), first.deps, { kind: 'help' });
    expect(first.deps.sendText).toHaveBeenCalledTimes(1);

    clock += 4 * 60_000 + 59_000;
    const second = flowDeps({ owner: false, helpThrottle, now: () => clock, fetchFn: vi.fn().mockResolvedValue(statusRes(0)) });
    const msg = makeMsg();
    await runCatchMeUp(msg, second.deps, { kind: 'help' });
    expect(msg.react.mock.calls.map((c) => c[0])).toEqual(['⏳']);
    expect(second.t.step('react')).toMatchObject({ ok: true, emoji: '⏳' });
    // One silent status POST keeps the help message out of the sender's window; nothing else is sent.
    expect(second.deps.fetchFn).toHaveBeenCalledTimes(1);
    expect(sentBody(second.deps)).toEqual({ notifyName: 'Alice', requestAt: REQUEST_AT, league: 'boarz-ii-men', requesterKey: AUTHOR, mode: 'status' });
    expect(second.deps.sendText).not.toHaveBeenCalled();
    expect(second.t.ends().map((e) => e.name)).toEqual(['help-throttled']);

    // Another person is not throttled by Alice's help.
    const other = flowDeps({ owner: false, helpThrottle, now: () => clock, fetchFn: vi.fn().mockResolvedValue(statusRes(0)) });
    await runCatchMeUp(makeMsg({ author: '999@lid' }), other.deps, { kind: 'help' });
    expect(other.deps.sendText).toHaveBeenCalledTimes(1);

    clock += 2_000;
    const third = flowDeps({ owner: false, helpThrottle, now: () => clock, fetchFn: vi.fn().mockResolvedValue(statusRes(0)) });
    await runCatchMeUp(makeMsg(), third.deps, { kind: 'help' });
    expect(third.deps.sendText).toHaveBeenCalledTimes(1);
  });

  it('a throttled help whose status POST fails still ends help-throttled, no DM, error logged without names', async () => {
    const helpThrottle = new Map<string, number>([[AUTHOR, 1_000_000]]);
    const { deps, t } = flowDeps({ owner: false, helpThrottle, now: () => 1_000_000 + 60_000, fetchFn: vi.fn().mockRejectedValue(new TypeError('fetch failed')) });
    const msg = makeMsg();
    await expect(runCatchMeUp(msg, deps, { kind: 'help' })).resolves.toBeUndefined();
    expect(deps.fetchFn).toHaveBeenCalledTimes(1);
    expect(msg.react.mock.calls.map((c) => c[0])).toEqual(['⏳']);
    expect(deps.sendText).not.toHaveBeenCalled();
    expect(t.ends().map((e) => e.name)).toEqual(['help-throttled']);
    expect(deps.log.mock.calls.flat().join('\n')).not.toContain('Alice');
  });

  it('a help DM that fails is not counted by the throttle', async () => {
    const helpThrottle = new Map<string, number>();
    const failing = flowDeps({ owner: false, helpThrottle, sendText: vi.fn().mockRejectedValue(new Error('send')), fetchFn: vi.fn().mockResolvedValue(statusRes(0)) });
    await expect(runCatchMeUp(makeMsg(), failing.deps, { kind: 'help' })).resolves.toBeUndefined();
    expect(failing.t.step('help-dm')).toMatchObject({ ok: false });
    expect(failing.t.ends()[0].name).toBe('failed');
    const retry = flowDeps({ owner: false, helpThrottle, fetchFn: vi.fn().mockResolvedValue(statusRes(0)) });
    await runCatchMeUp(makeMsg(), retry.deps, { kind: 'help' });
    expect(retry.deps.sendText).toHaveBeenCalledTimes(1);
  });

  it('a failing isOwner gives the player copy', async () => {
    const { deps } = flowDeps({ owner: 'reject', fetchFn: vi.fn().mockResolvedValue(statusRes(0)) });
    await runCatchMeUp(ownerMsg(), deps, { kind: 'help' });
    expect(deps.sendText.mock.calls[0][1]).toBe(helpText({ botName: BOT, used: 0, limit: 3, cooldownMin: 5, owner: false }));
  });

  it('unmapped group: help does nothing', async () => {
    const { deps, t } = flowDeps({ owner: false });
    const msg = makeMsg({ from: '555@g.us' });
    await runCatchMeUp(msg, deps, { kind: 'help' });
    expect(msg.react).not.toHaveBeenCalled();
    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(deps.sendText).not.toHaveBeenCalled();
    expect(t.ends().map((e) => e.name)).toEqual(['unsupported']);
  });
});

describe('runCatchMeUp privacy across the new flows', () => {
  it('the display name and target id appear in no trace field except who, and in no log line', async () => {
    const cases: Array<[Parameters<typeof runCatchMeUp>[2], unknown]> = [
      [{ kind: 'full' }, cardBody([])],
      [{ kind: 'forget', target: 'self' }, { kind: 'forgot', target: 'self', resolved: true, forgotten: true, person: SENTINEL_NAME, left: 3 }],
      [{ kind: 'forget', target: 'all' }, { kind: 'forgot', target: 'all', resolved: true, forgotten: true, left: 3 }],
      [{ kind: 'forget', target: { id: PLAYER } }, { kind: 'forgot', target: 'player', resolved: false, forgotten: false, left: 3 }],
      [{ kind: 'help' }, { kind: 'status', used: 1, limit: 3 }],
    ];
    for (const owner of [true, false]) {
      for (const [cmd, res] of cases) {
        const { deps, t } = flowDeps({ owner, fetchFn: vi.fn().mockResolvedValue(jsonResponse(200, res)) });
        await runCatchMeUp(ownerMsg({ notifyName: SENTINEL_NAME }), deps, cmd);
        expect(t.events[0].f!.who).toBe(SENTINEL_NAME);
        const rest = JSON.stringify([{ ...t.events[0].f, who: undefined }, ...t.events.slice(1)]);
        expect(rest).not.toContain(SENTINEL_NAME);
        expect(rest).not.toContain('456');
        expect(rest).not.toContain('111222333');
        expect(deps.log.mock.calls.map((c) => String(c[0])).join('\n')).not.toMatch(/ZZNAMEZZ|456|111222333/);
      }
    }
  });
});

describe('makeIsOwner', () => {
  const ownerPhone = '15550009999@c.us';
  it('matches the raw id or the dmTarget of both sides', async () => {
    const dmTarget = vi.fn(async (id: string) => (id === ownerPhone ? OWNER : id));
    const isOwner = makeIsOwner(dmTarget, ownerPhone);
    expect(await isOwner(OWNER)).toBe(true);
    expect(await isOwner(ownerPhone)).toBe(true);
    expect(await isOwner(AUTHOR)).toBe(false);
    expect(await isOwner('')).toBe(false);
  });

  it('fails closed when the mapping rejects or the owner has no LID', async () => {
    expect(await makeIsOwner(vi.fn().mockRejectedValue(new Error('x')), ownerPhone)(OWNER)).toBe(false);
    expect(await makeIsOwner(async (id) => id, ownerPhone)(OWNER)).toBe(false);
  });
});

describe('handleMessage passes mentioned and self ids to the parser', () => {
  it('forget @Player reaches catchMeUp with the first non-bot mentioned id', async () => {
    const catchMeUp = vi.fn().mockResolvedValue(undefined);
    const jevRespond = vi.fn();
    const db = openDb(':memory:');
    createPromptTables(db);
    const msg: WhatsAppMessage = {
      body: '@12134198455 forget @456', from: GROUP, chatName: 'G', author: OWNER, fromMe: false, capturedAt: REQUEST_AT,
      priorMessages: [], mentionsBot: true,
      mentionedIds: ['186428122255581@lid', PLAYER],
      selfIds: ['12134198455@c.us', '186428122255581@lid'],
      reply: vi.fn().mockResolvedValue(undefined),
      getContact: vi.fn().mockResolvedValue({ pushname: 'Owen' }),
    };
    await handleMessage(msg, {
      config: rulesConfigSchema.parse({ defaults: { requireCommandPrefix: true, commandPrefix: '!song' }, rules: [] }),
      spotify: { searchTrack: vi.fn(), getTrackById: vi.fn(), findOrCreatePlaylist: vi.fn(), isTrackInPlaylist: vi.fn(), addTrackToPlaylist: vi.fn() },
      db, allowedGroupIds: ['120363000000000001'], ownerPhone: '1@c.us', masterPlaylistName: 'M', sendDm: vi.fn(),
      catchMeUp, jevRespond,
    });
    expect(catchMeUp).toHaveBeenCalledWith(msg, { kind: 'forget', target: { id: PLAYER } });
    expect(jevRespond).not.toHaveBeenCalled();
  });
});

// ── Owner off/on switch and the group tldr ─────────────────────────────────

const OFF_DM = `Catch-up bot is off. Nobody gets reactions or DMs from catch-me-up commands until you send "@${BOT} on" in any group.`;
const ON_DM = 'Catch-up bot is back on.';

describe('tldrText', () => {
  it('is the K7 copy, verbatim', () => {
    expect(tldrText({ botName: BOT, limit: 3, cooldownMin: 5 })).toBe([
      "👋 Quick reminder: I'm the catch-up bot.",
      '',
      "Been away and the chat ran a few hundred messages deep? Skip the scroll. Tag me and I'll DM you what you missed.",
      '',
      '@Music League Bot catch me up',
      '  A picture of everything since your last post (up to 48 hours), plus links to the top topics. "what did I miss", "cmu" and "recap" work too.',
      '',
      '@Music League Bot help',
      '  The full list, sent to you privately.',
      '',
      'You get 3 a day, reset at midnight LA time. Everything comes by DM; nothing gets posted here but this.',
    ].join('\n'));
  });

  it('uses limit for the daily count', () => {
    expect(tldrText({ botName: 'B', limit: 5, cooldownMin: 5 })).toContain('\nYou get 5 a day,');
  });
});

describe('helpText owner switch lines', () => {
  it('the owner section ends with off, on and tldr after forget all', () => {
    const text = helpText({ botName: BOT, used: 0, limit: 3, cooldownMin: 5, owner: true });
    expect(text.split('\n').slice(-4)).toEqual([
      `  @${BOT} forget all — the same for every player.`,
      `  @${BOT} off — turn catch-me-up off everywhere (no reactions, no DMs).`,
      `  @${BOT} on — turn it back on.`,
      `  @${BOT} tldr — post a short how-to in this group.`,
    ]);
  });

  it('the player copy has none of them', () => {
    const text = helpText({ botName: BOT, used: 0, limit: 3, cooldownMin: 5, owner: false });
    expect(text).not.toMatch(/ (off|on|tldr) —/);
  });
});

describe('runCatchMeUp off/on/tldr from a non-owner', () => {
  it.each([
    ['off', { kind: 'off' }],
    ['on', { kind: 'on' }],
    ['tldr', { kind: 'tldr' }],
  ] as const)('%s: not-allowed, no react, DM, post or fetch, switch untouched', async (command, cmd) => {
    const sw = memSwitch();
    const { deps, t } = flowDeps({ owner: false, cmuSwitch: sw });
    const msg = makeMsg();
    await runCatchMeUp(msg, deps, cmd);
    expect(msg.react).not.toHaveBeenCalled();
    expect(deps.sendText).not.toHaveBeenCalled();
    expect(deps.sendImage).not.toHaveBeenCalled();
    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(sw.sets).toEqual([]);
    expect(sequence(t)).toEqual(['start', 'owner ok:false', 'end not-allowed']);
    expect(t.events[0].f).toMatchObject({ command });
  });
});

describe('runCatchMeUp off/on (owner)', () => {
  it('off: disables, DMs the owner K5, no reaction, no fetch; trace switch + confirm-dm, end off', async () => {
    const sw = memSwitch();
    const { deps, t } = flowDeps({ cmuSwitch: sw });
    const msg = ownerMsg();
    await runCatchMeUp(msg, deps, { kind: 'off' });
    expect(sw.isEnabled()).toBe(false);
    expect(msg.react).not.toHaveBeenCalled();
    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(deps.sendText.mock.calls).toEqual([[OWNER, OFF_DM]]);
    expect(sequence(t)).toEqual(['start', 'owner ok:true', 'trigger', 'switch', 'confirm-dm', 'end off']);
    expect(t.step('switch')).toMatchObject({ ok: true, enabled: false });
    expect(t.events[0].f).toMatchObject({ command: 'off' });
  });

  it('off while already off: the same DM, end off', async () => {
    const sw = memSwitch(false);
    const { deps, t } = flowDeps({ cmuSwitch: sw });
    await runCatchMeUp(ownerMsg(), deps, { kind: 'off' });
    expect(sw.isEnabled()).toBe(false);
    expect(deps.sendText.mock.calls).toEqual([[OWNER, OFF_DM]]);
    expect(t.ends().map((e) => e.name)).toEqual(['off']);
  });

  it('on (while off): enables, DMs K6, no reaction; the next catch-up works', async () => {
    const sw = memSwitch(false);
    const { deps, t } = flowDeps({ cmuSwitch: sw });
    const msg = ownerMsg();
    await runCatchMeUp(msg, deps, { kind: 'on' });
    expect(sw.isEnabled()).toBe(true);
    expect(msg.react).not.toHaveBeenCalled();
    expect(deps.sendText.mock.calls).toEqual([[OWNER, ON_DM]]);
    expect(t.ends().map((e) => e.name)).toEqual(['on']);
    expect(t.events[0].f).toMatchObject({ command: 'on' });

    const next = flowDeps({ owner: false, cmuSwitch: sw });
    const player = makeMsg();
    await runCatchMeUp(player, next.deps, { kind: 'catchup' });
    expect(player.react.mock.calls.map((c) => c[0])).toEqual(['👍']);
    expect(next.deps.fetchFn).toHaveBeenCalledTimes(1);
    expect(next.t.ends().map((e) => e.name)).toEqual(['quiet']);
  });

  it('on while already on: the same DM, end on', async () => {
    const { deps, t } = flowDeps({ cmuSwitch: memSwitch(true) });
    await runCatchMeUp(ownerMsg(), deps, { kind: 'on' });
    expect(deps.sendText.mock.calls).toEqual([[OWNER, ON_DM]]);
    expect(t.ends().map((e) => e.name)).toEqual(['on']);
  });

  it.each([
    ['off', true, 'on'],
    ['on', false, 'off'],
  ] as const)('a switch that fails to save (%s): switch ok:false, owner told the current state, end failed', async (kind, enabled, still) => {
    const sw: CmuSwitch = { isEnabled: () => enabled, set: () => { throw new Error('EACCES'); } };
    const { deps, t } = flowDeps({ cmuSwitch: sw });
    const msg = ownerMsg();
    await expect(runCatchMeUp(msg, deps, { kind })).resolves.toBeUndefined();
    expect(t.step('switch')).toMatchObject({ ok: false });
    expect(deps.sendText.mock.calls).toEqual([[OWNER, `Couldn't change the catch-up switch; it's still ${still}.`]]);
    expect(msg.react).not.toHaveBeenCalled();
    expect(t.ends().map((e) => e.name)).toEqual(['failed']);
  });

  describe('from a group outside CMU_GROUPS', () => {
    const UNMAPPED = '555@g.us';

    it('owner off: K5 DM to the owner only, switch off, nothing to the group', async () => {
      const sw = memSwitch();
      const { deps, t } = flowDeps({ cmuSwitch: sw });
      const msg = ownerMsg({ from: UNMAPPED });
      await runCatchMeUp(msg, deps, { kind: 'off' });
      expect(sw.isEnabled()).toBe(false);
      expect(deps.sendText.mock.calls).toEqual([[OWNER, OFF_DM]]);
      expect(msg.react).not.toHaveBeenCalled();
      expect(deps.fetchFn).not.toHaveBeenCalled();
      expect(t.ends().map((e) => e.name)).toEqual(['off']);
    });

    it('owner on: K6 DM', async () => {
      const sw = memSwitch(false);
      const { deps, t } = flowDeps({ cmuSwitch: sw });
      await runCatchMeUp(ownerMsg({ from: UNMAPPED }), deps, { kind: 'on' });
      expect(sw.isEnabled()).toBe(true);
      expect(deps.sendText.mock.calls).toEqual([[OWNER, ON_DM]]);
      expect(t.ends().map((e) => e.name)).toEqual(['on']);
    });

    it('non-owner off: not-allowed, nothing sent, switch untouched', async () => {
      const sw = memSwitch();
      const { deps, t } = flowDeps({ owner: false, cmuSwitch: sw });
      const msg = makeMsg({ from: UNMAPPED });
      await runCatchMeUp(msg, deps, { kind: 'off' });
      expect(sw.sets).toEqual([]);
      expect(msg.react).not.toHaveBeenCalled();
      expect(deps.sendText).not.toHaveBeenCalled();
      expect(sequence(t)).toEqual(['start', 'owner ok:false', 'end not-allowed']);
    });

    it.each([['tldr', { kind: 'tldr' }], ['help', { kind: 'help' }]] as const)('owner %s there is still unsupported', async (_l, cmd) => {
      const { deps, t } = flowDeps();
      await runCatchMeUp(ownerMsg({ from: UNMAPPED }), deps, cmd);
      expect(deps.sendText).not.toHaveBeenCalled();
      expect(t.ends().map((e) => e.name)).toEqual(['unsupported']);
    });
  });

  it('the file switch: owner off, then a fresh switch over the same file (restart) is still off', async () => {
    const file = path.join(os.tmpdir(), `cmu-switch-test-${process.pid}-${Date.now()}.json`);
    try {
      const { deps } = flowDeps({ cmuSwitch: openCmuSwitch(file) });
      await runCatchMeUp(ownerMsg(), deps, { kind: 'off' });
      expect(openCmuSwitch(file).isEnabled()).toBe(false);
    } finally {
      if (existsSync(file)) (await import('node:fs')).rmSync(file);
    }
  });
});

describe('runCatchMeUp while off', () => {
  it.each([
    ['catch me up', { kind: 'catchup' }, false],
    ['full', { kind: 'full' }, true],
    ['forget', { kind: 'forget', target: 'self' }, true],
    ['forget all', { kind: 'forget', target: 'all' }, true],
    ['forget @', { kind: 'forget', target: { id: PLAYER } }, true],
    ['help', { kind: 'help' }, false],
    ['help', { kind: 'help' }, true],
    ['tldr', { kind: 'tldr' }, true],
  ] as const)('%s (owner %s): start + end disabled, nothing sent, no fetch, no owner step', async (command, cmd, owner) => {
    const { deps, t } = flowDeps({ owner, cmuSwitch: memSwitch(false) });
    const msg = owner ? ownerMsg() : makeMsg();
    await runCatchMeUp(msg, deps, cmd);
    expect(msg.react).not.toHaveBeenCalled();
    expect(deps.sendText).not.toHaveBeenCalled();
    expect(deps.sendImage).not.toHaveBeenCalled();
    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(deps.isOwner).not.toHaveBeenCalled();
    expect(sequence(t)).toEqual(['start', 'end disabled']);
    expect(t.events[0].f).toMatchObject({ command });
  });
});

describe('runCatchMeUp tldr (owner)', () => {
  it('👍 then posts tldrText in the group, no fetch, no DM; trace group-post, end tldr', async () => {
    const { deps, t } = flowDeps();
    const msg = ownerMsg();
    await runCatchMeUp(msg, deps, { kind: 'tldr' });
    expect(msg.react.mock.calls.map((c) => c[0])).toEqual(['👍']);
    expect(deps.sendText.mock.calls).toEqual([[GROUP, tldrText({ botName: BOT, limit: 3, cooldownMin: 5 })]]);
    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(sequence(t)).toEqual(['start', 'owner ok:true', 'trigger', 'react', 'group-post', 'end tldr']);
    expect(t.events[0].f).toMatchObject({ command: 'tldr' });
  });

  it('a second tldr in the same group within 30 minutes: ⏳, no post, end tldr-throttled; another group and 30 minutes later work', async () => {
    let clock = 5_000_000;
    const tldrThrottle = new Map<string, number>();
    const OTHER = '120363000000000002@g.us';
    const groups = new Map([[GROUP, 'boarz-ii-men'], [OTHER, 'other']]);
    const first = flowDeps({ tldrThrottle, groups, now: () => clock });
    await runCatchMeUp(ownerMsg(), first.deps, { kind: 'tldr' });
    expect(first.deps.sendText).toHaveBeenCalledTimes(1);

    clock += 29 * 60_000 + 59_000;
    const second = flowDeps({ tldrThrottle, groups, now: () => clock });
    const msg = ownerMsg();
    await runCatchMeUp(msg, second.deps, { kind: 'tldr' });
    expect(msg.react.mock.calls.map((c) => c[0])).toEqual(['⏳']);
    expect(second.deps.sendText).not.toHaveBeenCalled();
    expect(second.deps.fetchFn).not.toHaveBeenCalled();
    expect(second.t.ends().map((e) => e.name)).toEqual(['tldr-throttled']);

    const other = flowDeps({ tldrThrottle, groups, now: () => clock });
    await runCatchMeUp(ownerMsg({ from: OTHER }), other.deps, { kind: 'tldr' });
    expect(other.deps.sendText.mock.calls[0][0]).toBe(OTHER);

    clock += 2_000;
    const third = flowDeps({ tldrThrottle, groups, now: () => clock });
    await runCatchMeUp(ownerMsg(), third.deps, { kind: 'tldr' });
    expect(third.deps.sendText).toHaveBeenCalledTimes(1);
    expect(third.t.ends().map((e) => e.name)).toEqual(['tldr']);
  });

  it('a failed group post: group-post ok:false, end failed, not counted by the throttle', async () => {
    const tldrThrottle = new Map<string, number>();
    const failing = flowDeps({ tldrThrottle, sendText: vi.fn().mockRejectedValue(new Error('send')) });
    await expect(runCatchMeUp(ownerMsg(), failing.deps, { kind: 'tldr' })).resolves.toBeUndefined();
    expect(failing.t.step('group-post')).toMatchObject({ ok: false });
    expect(failing.t.ends().map((e) => e.name)).toEqual(['failed']);
    const retry = flowDeps({ tldrThrottle });
    await runCatchMeUp(ownerMsg(), retry.deps, { kind: 'tldr' });
    expect(retry.deps.sendText).toHaveBeenCalledTimes(1);
  });

  it('no message text in the trace or the log', async () => {
    const { deps, t } = flowDeps();
    await runCatchMeUp(ownerMsg({ notifyName: SENTINEL_NAME }), deps, { kind: 'tldr' });
    await runCatchMeUp(ownerMsg(), deps, { kind: 'off' });
    const all = JSON.stringify(t.events) + deps.log.mock.calls.flat().join('\n');
    expect(all).not.toContain('Quick reminder');
    expect(all).not.toContain('Catch-up bot is off');
  });
});

describe('handleMessage with the switch off', () => {
  it('owner off, then a player catch me up and owner help: disabled, nothing sent, no fetch, Jev not called; owner on restores', async () => {
    const sw = memSwitch();
    const t = fakeTrace();
    const { deps } = makeDeps({ trace: t.factory });
    const fullDeps = Object.assign(deps, {
      isOwner: vi.fn(async (a: string) => a === OWNER),
      botName: () => BOT,
      helpThrottle: new Map<string, number>(),
      helpCooldown: { min: 5 },
      cmuSwitch: sw,
      tldrThrottle: new Map<string, number>(),
    });
    const catchMeUp = (msg: WhatsAppMessage, cmd: Parameters<typeof runCatchMeUp>[2]) => runCatchMeUp(msg, fullDeps, cmd);
    const jevRespond = vi.fn().mockResolvedValue('jev');
    const db = openDb(':memory:');
    createPromptTables(db);
    const cfg: BotConfig = {
      config: rulesConfigSchema.parse({ defaults: { requireCommandPrefix: true, commandPrefix: '!song' }, rules: [] }),
      spotify: { searchTrack: vi.fn(), getTrackById: vi.fn(), findOrCreatePlaylist: vi.fn(), isTrackInPlaylist: vi.fn(), addTrackToPlaylist: vi.fn() },
      db, allowedGroupIds: ['120363000000000001'], ownerPhone: '1@c.us', masterPlaylistName: 'M', sendDm: vi.fn(),
      catchMeUp, jevRespond,
    };
    const wa = (body: string, author: string): WhatsAppMessage => ({
      body, from: GROUP, chatName: 'G', author, fromMe: false, capturedAt: REQUEST_AT,
      priorMessages: [], mentionsBot: true,
      reply: vi.fn().mockResolvedValue(undefined),
      getContact: vi.fn().mockResolvedValue({ pushname: 'X' }),
      react: vi.fn().mockResolvedValue(undefined),
    });

    const off = wa('@12134198455 off', OWNER);
    await handleMessage(off, cfg);
    expect(sw.isEnabled()).toBe(false);
    expect(deps.sendText.mock.calls).toEqual([[OWNER, OFF_DM]]);
    expect(off.react).not.toHaveBeenCalled();
    deps.sendText.mockClear();

    const player = wa('@12134198455 catch me up', AUTHOR);
    const help = wa('@12134198455 help', OWNER);
    await handleMessage(player, cfg);
    await handleMessage(help, cfg);
    for (const m of [player, help]) {
      expect(m.react).not.toHaveBeenCalled();
      expect(m.reply).not.toHaveBeenCalled();
    }
    expect(deps.sendText).not.toHaveBeenCalled();
    expect(deps.sendImage).not.toHaveBeenCalled();
    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(jevRespond).not.toHaveBeenCalled();
    expect(t.ends().map((e) => e.name)).toEqual(['off', 'disabled', 'disabled']);

    await handleMessage(wa('@12134198455 on', OWNER), cfg);
    expect(sw.isEnabled()).toBe(true);
    expect(deps.sendText.mock.calls).toEqual([[OWNER, ON_DM]]);
  });
});

describe('runCatchMeUp recap-bot-calls', () => {
  const RECAP_TEXT = 'Synthetic recap line.';
  const recapRes = () => jsonResponse(200, { kind: 'recap', text: RECAP_TEXT });

  it('owner, mapped group: POSTs mode recap, DMs the text, no react; steps owner, companelist, confirm-dm', async () => {
    const { deps, t } = flowDeps({ fetchFn: vi.fn().mockResolvedValue(recapRes()) });
    const msg = ownerMsg();
    await runCatchMeUp(msg, deps, { kind: 'recap' });
    expect(sentBody(deps)).toMatchObject({ mode: 'recap', league: 'boarz-ii-men' });
    expect(deps.sendText.mock.calls).toEqual([[OWNER, RECAP_TEXT]]);
    expect(msg.react).not.toHaveBeenCalled();
    expect(sequence(t)).toEqual(['start', 'owner ok:true', 'trigger', 'companelist', 'confirm-dm', 'end recap']);
    expect(t.events[0].f).toMatchObject({ command: 'recap' });
  });

  it('owner, group not in groups: still POSTs without league and DMs', async () => {
    const { deps, t } = flowDeps({ groups: new Map(), fetchFn: vi.fn().mockResolvedValue(recapRes()) });
    await runCatchMeUp(ownerMsg(), deps, { kind: 'recap' });
    const body = sentBody(deps);
    expect(body.mode).toBe('recap');
    expect(body.league).toBeUndefined();
    expect(deps.sendText.mock.calls).toEqual([[OWNER, RECAP_TEXT]]);
    expect(t.ends().map((e) => e.name)).toEqual(['recap']);
  });

  it('owner, switch off: still runs', async () => {
    const { deps, t } = flowDeps({ cmuSwitch: memSwitch(false), fetchFn: vi.fn().mockResolvedValue(recapRes()) });
    await runCatchMeUp(ownerMsg(), deps, { kind: 'recap' });
    expect(deps.sendText.mock.calls).toEqual([[OWNER, RECAP_TEXT]]);
    expect(t.ends().map((e) => e.name)).toEqual(['recap']);
  });

  it('non-owner: no POST, no DM, no react; not-allowed', async () => {
    const { deps, t } = flowDeps({ owner: false });
    const msg = makeMsg();
    await runCatchMeUp(msg, deps, { kind: 'recap' });
    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(deps.sendText).not.toHaveBeenCalled();
    expect(msg.react).not.toHaveBeenCalled();
    expect(sequence(t)).toEqual(['start', 'owner ok:false', 'end not-allowed']);
  });

  it.each([
    ['a 500', () => vi.fn().mockResolvedValue(jsonResponse(500, { error: 'boom' }))],
    ['a bad body', () => vi.fn().mockResolvedValue(jsonResponse(200, { kind: 'card', html: '<p/>' }))],
    ['a non-string text', () => vi.fn().mockResolvedValue(jsonResponse(200, { kind: 'recap', text: 5 }))],
    ['a network error', () => vi.fn().mockRejectedValue(new TypeError('fetch failed'))],
  ])('%s: DMs the fixed failure line; recap-failed', async (_l, mk) => {
    const { deps, t } = flowDeps({ fetchFn: mk() });
    const msg = ownerMsg();
    await runCatchMeUp(msg, deps, { kind: 'recap' });
    expect(deps.sendText.mock.calls).toEqual([[OWNER, RECAP_FAILURE_TEXT]]);
    expect(msg.react).not.toHaveBeenCalled();
    expect(t.ends().map((e) => e.name)).toEqual(['recap-failed']);
  });

  it('timeout: the aborted fetch DMs the failure line', async () => {
    const fetchFn = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
      init.signal!.addEventListener('abort', () => rej(new Error('aborted')));
    }));
    const { deps, t } = flowDeps({ fetchFn, deadlineMs: 50 });
    await runCatchMeUp(ownerMsg(), deps, { kind: 'recap' });
    expect(deps.sendText.mock.calls).toEqual([[OWNER, RECAP_FAILURE_TEXT]]);
    expect(t.ends().map((e) => e.name)).toEqual(['recap-failed']);
  });

  it('keeps message text, ids and DM text out of the trace', async () => {
    const { deps, t } = flowDeps({ fetchFn: vi.fn().mockResolvedValue(recapRes()) });
    await runCatchMeUp(ownerMsg(), deps, { kind: 'recap' });
    expect(JSON.stringify(t.events)).not.toContain(RECAP_TEXT);
  });
});

// ── Task 7: captioned card and follow-up DM (preview groups only) ──────────

const CAPTION = '📖 Full catch-up: https://x/\n🎸 Gear — https://x/markup-m1.html';
const LINKS = ['🎸 Gear: https://x/markup-m1.html', 'https://x/'];
const FOLLOW_LINES = ['You asked 2 times today.'];
const OFF_LINE = 'Morning recap: off. Get it in your DMs: morning-recap sub';

function captionCard(over: Record<string, unknown> = {}) {
  return {
    kind: 'card', html: '<p/>', links: LINKS, caption: CAPTION,
    meta: { topicIds: ['m1', 'm2'], captionTopicIds: ['m1'] },
    ...over,
  };
}

function previewRun(body: unknown, over: Partial<FakeDeps> = {}) {
  const t = fakeTrace();
  const order: string[] = [];
  const { deps } = makeDeps({
    fetchFn: vi.fn().mockResolvedValue(jsonResponse(200, body)),
    trace: t.factory,
    preview: memoryCmuPreview([GROUP]),
    ...over,
  });
  deps.sendImage.mockImplementation(async () => { order.push('image'); });
  deps.sendText.mockImplementation(async () => { order.push('text'); });
  return { t, deps, order, body: () => JSON.parse(deps.fetchFn.mock.calls[0][1].body) };
}

describe('runCatchMeUp captioned card and follow-up', () => {
  it('caption card: one image send with caption, no text send for links, image step has caption/count/topics', async () => {
    const run = previewRun(captionCard());
    await runCatchMeUp(makeMsg(), run.deps);
    expect(run.deps.sendImage).toHaveBeenCalledTimes(1);
    expect(run.deps.sendImage.mock.calls[0][0]).toBe(AUTHOR);
    expect(run.deps.sendImage.mock.calls[0][2]).toBe(CAPTION);
    expect(run.deps.sendText).not.toHaveBeenCalled();
    expect(run.t.step('image')).toMatchObject({ ok: true, caption: true, count: 1, topics: ['m1'] });
    expect(run.t.step('links')).toBeUndefined();
    expect(run.t.ends()[0].name).toBe('card');
  });

  it('caption card: topics fall back to meta.topicIds without captionTopicIds', async () => {
    const run = previewRun(captionCard({ meta: { topicIds: ['m1', 'm2'] } }));
    await runCatchMeUp(makeMsg(), run.deps);
    expect(run.t.step('image')).toMatchObject({ caption: true, count: 2, topics: ['m1', 'm2'] });
  });

  it('no caption (old companelist): image then links, no follow-up', async () => {
    const run = previewRun({ kind: 'card', html: '<p/>', links: LINKS });
    await runCatchMeUp(makeMsg(), run.deps);
    expect(run.order).toEqual(['image', 'text']);
    expect(run.deps.sendImage.mock.calls[0]).toHaveLength(2);
    expect(run.deps.sendText).toHaveBeenCalledWith(AUTHOR, LINKS.join('\n'));
    expect(run.t.step('followup')).toBeUndefined();
  });

  it('request body includes accepts followUp when isPreview returns true', async () => {
    const run = previewRun(captionCard());
    await runCatchMeUp(makeMsg(), run.deps);
    expect(run.body().accepts).toEqual(['followUp']);
  });

  it('outside preview: no accepts in the body, the caption is ignored (image, then links), and there is no follow-up', async () => {
    const throwing: CmuPreview = { isPreview: () => { throw new Error('boom'); }, isPreviewPerson: () => false };
    for (const preview of [memoryCmuPreview([]), undefined, throwing]) {
      const run = previewRun(captionCard({ followUp: { lines: FOLLOW_LINES } }), { preview });
      await runCatchMeUp(makeMsg(), run.deps);
      expect(run.body()).not.toHaveProperty('accepts');
      expect(run.order).toEqual(['image', 'text']);
      expect(run.deps.sendImage.mock.calls[0]).toHaveLength(2);
      expect(run.deps.sendText).toHaveBeenCalledWith(AUTHOR, LINKS.join('\n'));
      expect(run.t.step('followup')).toBeUndefined();
      expect(run.t.step('image')).not.toHaveProperty('caption');
      expect(run.t.ends()[0].name).toBe('card');
    }
  });

  it('previewPerson: true opens the gate when the group is not listed', async () => {
    const run = previewRun(captionCard({ followUp: { lines: FOLLOW_LINES } }), { preview: memoryCmuPreview([]) });
    await runCatchMeUp(makeMsg({ previewPerson: true }), run.deps);
    expect(run.body().accepts).toEqual(['followUp']);
    expect(run.order).toEqual(['image', 'text']);
    expect(run.deps.sendImage.mock.calls[0][2]).toBe(CAPTION);
    expect(run.t.step('followup')).toMatchObject({ ok: true });
  });

  it('followUp after card: one text DM after the image with stats, menu; followup step ok', async () => {
    const run = previewRun(captionCard({ followUp: { lines: FOLLOW_LINES } }));
    await runCatchMeUp(makeMsg(), run.deps);
    expect(run.order).toEqual(['image', 'text']);
    const text = run.deps.sendText.mock.calls[0][1] as string;
    expect(run.deps.sendText.mock.calls[0][0]).toBe(AUTHOR);
    expect(text).toContain(FOLLOW_LINES[0]);
    expect(text).toContain(MENU_HEADING);
    for (const e of playerMenu(false)) expect(text).toContain(`• ${e.command} — ${e.oneLine}`);
    expect(text).not.toContain('Morning recap');
    expect(run.t.step('followup')).toMatchObject({ ok: true, stats: true, menu: playerMenu(false).length });
    expect(typeof run.t.step('followup')!.ms).toBe('number');
    expect(run.t.ends()[0].name).toBe('card');
    expect(JSON.stringify(run.t.events)).not.toContain(FOLLOW_LINES[0]);
  });

  it('followUp: recapSubscription {subscribed:false} adds the off line, keyed by the requesterKey', async () => {
    const recapSubscription = vi.fn(() => ({ subscribed: false }));
    const run = previewRun(captionCard({ followUp: { lines: [] } }), {
      recapSubscription, dmTarget: vi.fn().mockResolvedValue('999@lid'),
      preview: memoryCmuPreview([GROUP], ['999@lid']),
    });
    await runCatchMeUp(makeMsg(), run.deps);
    expect(recapSubscription).toHaveBeenCalledWith('999@lid');
    expect(run.deps.sendText.mock.calls[0][1]).toContain(OFF_LINE);
    expect(run.t.step('followup')).toMatchObject({ ok: true, stats: false });
  });

  it('followUp after quiet: quiet text then follow-up', async () => {
    const run = previewRun({ kind: 'quiet', text: 'Not much happened.', followUp: { lines: FOLLOW_LINES } });
    await runCatchMeUp(makeMsg(), run.deps);
    expect(run.deps.sendText.mock.calls.map((c) => c[1].split('\n')[0])).toEqual(['Not much happened.', FOLLOW_LINES[0]]);
    expect(run.t.step('followup')).toMatchObject({ ok: true });
    expect(run.t.ends()[0].name).toBe('quiet');
  });

  it('useCaption false in preview: image then links, follow-up still sent', async () => {
    const run = previewRun(captionCard({ followUp: { lines: FOLLOW_LINES } }), { useCaption: false });
    await runCatchMeUp(makeMsg(), run.deps);
    expect(run.order).toEqual(['image', 'text', 'text']);
    expect(run.deps.sendImage.mock.calls[0]).toHaveLength(2);
    expect(run.deps.sendText.mock.calls[0][1]).toBe(LINKS.join('\n'));
    expect(run.deps.sendText.mock.calls[1][1]).toContain(MENU_HEADING);
    expect(run.t.step('followup')).toMatchObject({ ok: true });
  });

  it('follow-up send rejects: outcome card, followup step ok false, no failure DM', async () => {
    const run = previewRun(captionCard({ followUp: { lines: FOLLOW_LINES } }));
    run.deps.sendText.mockRejectedValue(new Error('nope'));
    await runCatchMeUp(makeMsg(), run.deps);
    expect(run.deps.sendText).toHaveBeenCalledTimes(1);
    expect(run.deps.sendText.mock.calls.some((c) => c[1] === CMU_FAILURE_TEXT)).toBe(false);
    expect(run.t.step('followup')).toMatchObject({ ok: false });
    expect(run.t.ends()[0].name).toBe('card');
    expect(run.deps.log).toHaveBeenCalledWith(`[cmu] follow-up failed in ${GROUP}: Error`);
  });

  it('follow-up send hangs: resolves after followUpTimeoutMs (set 50), outcome card', async () => {
    const run = previewRun(captionCard({ followUp: { lines: FOLLOW_LINES } }), { followUpTimeoutMs: 50 });
    run.deps.sendText.mockImplementation(() => new Promise(() => undefined));
    await runCatchMeUp(makeMsg(), run.deps);
    expect(run.t.step('followup')).toMatchObject({ ok: false });
    expect(run.t.ends()[0].name).toBe('card');
    expect(run.deps.log).toHaveBeenCalledWith(`[cmu] follow-up failed in ${GROUP}: Deadline`);
  });

  it('followUp: a non-preview person gets no recap line (G5)', async () => {
    const recapSubscription = vi.fn(() => ({ subscribed: false }));
    const run = previewRun(captionCard({ followUp: { lines: FOLLOW_LINES } }), {
      recapSubscription, dmTarget: vi.fn().mockResolvedValue('999@lid'),
    });
    await runCatchMeUp(makeMsg(), run.deps);
    expect(run.deps.sendText).toHaveBeenCalledTimes(1);
    expect(run.deps.sendText.mock.calls[0][1]).not.toContain('Morning recap');
  });

  it('followUp: a preview person gets the off line', async () => {
    const run = previewRun(captionCard({ followUp: { lines: FOLLOW_LINES } }), {
      recapSubscription: () => ({ subscribed: false }), dmTarget: vi.fn().mockResolvedValue('999@lid'),
      preview: memoryCmuPreview([GROUP], ['999@lid']),
    });
    await runCatchMeUp(makeMsg(), run.deps);
    expect(run.deps.sendText.mock.calls[0][1]).toContain(OFF_LINE);
  });

  it('recapSubscription throwing: no recap line, follow-up still sent', async () => {
    const run = previewRun(captionCard({ followUp: { lines: FOLLOW_LINES } }), {
      recapSubscription: () => { throw new Error('boom'); },
    });
    await runCatchMeUp(makeMsg(), run.deps);
    expect(run.deps.sendText).toHaveBeenCalledTimes(1);
    expect(run.deps.sendText.mock.calls[0][1]).not.toContain('Morning recap');
    expect(run.t.step('followup')).toMatchObject({ ok: true });
  });

  it('limit (429): no follow-up', async () => {
    const run = previewRun({});
    run.deps.fetchFn.mockResolvedValue(jsonResponse(429, { error: 'limit', followUp: { lines: FOLLOW_LINES } }));
    await runCatchMeUp(makeMsg(), run.deps);
    expect(run.deps.sendText).not.toHaveBeenCalled();
    expect(run.t.step('followup')).toBeUndefined();
    expect(run.t.ends()[0].name).toBe('limit');
  });
});

// ── Task 13: menu and help ─────────────────────────────────────────────────
describe('player menu and help', () => {
  const base = { botName: 'Bot', used: 1, limit: 3, cooldownMin: 5, owner: false };
  const TODAY = [
    'Catch-up bot — what you can ask',
    '',
    '@Bot catch me up',
    '  A picture of what you missed since your last post (up to 48 hours),',
    '  plus links to the top topics. Also works: "what did I miss", "cmu",',
    '  "fill me in", "recap".',
    '',
    "You've used 1 of 3 today. Resets at midnight (LA time).",
    '',
    '@Bot help',
    '  This message. Once every 5 minutes; ask again sooner and you get ⏳.',
  ].join('\n');

  it('non-preview help unchanged', () => {
    expect(helpText(base)).toBe(TODAY);
    expect(helpText({ ...base, dmOk: false })).toBe(TODAY);
  });

  it('menu entries are exact and one-liners fit', () => {
    expect(PLAYER_MENU.map((e) => e.command)).toEqual(['catch me up', 'pick one', 'top-pics', 'top-songs', 'my-dossier', 'help']);
    expect(PLAYER_MENU.find((e) => e.command === 'top-pics')?.oneLine).toBe('Best pics of the last 48 h (add "week")');
    for (const e of PLAYER_MENU) expect(e.oneLine.length).toBeLessThanOrEqual(50);
    expect(playerMenu(true)).toEqual(PLAYER_MENU);
    expect(playerMenu(false).map((e) => e.command)).toEqual(['catch me up', 'help']);
  });

  it('menuHeading picks the DM or group wording', () => {
    expect(menuHeading(true)).toBe('DM me any of these (no @ needed):');
    expect(menuHeading(false)).toBe(MENU_HEADING);
    expect(MENU_HEADING).toBe('Send any of these as @bot <command> in the group:');
  });

  it('dm help lists every command, under 25 lines, DM heading first', () => {
    const t = helpText({ ...base, dmOk: true });
    const lines = t.split('\n');
    expect(lines[0]).toBe('DM me any of these (no @ needed):');
    for (const c of ALL_COMMANDS) expect(lines).toContain(c);
    expect(lines.length).toBeLessThanOrEqual(25);
    expect(t).toContain("You've used 1 of 3 today.");
    expect(t).toContain('Add "week" to any top-');
    expect(helpText({ ...base, dmOk: true, owner: true })).toContain('Owner only');
  });
});
