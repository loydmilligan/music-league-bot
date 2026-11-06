import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isCatchMeUpRequest,
  parseCmuGroups,
  runCatchMeUp,
  CMU_FAILURE_TEXT,
  type CmuMessage,
} from '../../src/bot/catchMeUp.js';
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
    expect(JSON.parse(init.body)).toEqual({ notifyName: 'Alice', requestAt: REQUEST_AT });
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

  it('failure: a 60 s timeout aborts the fetch and sends the failure DM', async () => {
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => realTimeout(5));
    const fetchFn = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
      init.signal!.addEventListener('abort', () => rej(init.signal!.reason));
    })) as AnyMock;
    const msg = makeMsg();
    const { deps } = makeDeps({ fetchFn });
    await runCatchMeUp(msg, deps);
    expect(spy).toHaveBeenCalledWith(60_000);
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
