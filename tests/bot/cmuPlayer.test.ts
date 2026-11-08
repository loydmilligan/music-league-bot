import { describe, it, expect, vi, type Mock } from 'vitest';
import { existsSync } from 'node:fs';
import { runCatchMeUp, type CmuMessage } from '../../src/bot/catchMeUp.js';
import { isPlayerKind, PLAYER_FAILURE_TEXT } from '../../src/bot/cmuPlayer.js';
import type { CmuCommand } from '../../src/bot/cmuCommand.js';
import { memoryCmuSwitch } from '../../src/bot/cmuSwitch.js';
import { memoryCmuPreview } from '../../src/bot/cmuPreview.js';
import type { InteractionTrace } from '../../src/storage/interactionLog.js';
import { handleMessage, type WhatsAppMessage, type BotConfig } from '../../src/bot/handler.js';
import { openDb } from '../../src/storage/db.js';
import { createPromptTables } from '../../src/chat/prompts/store.js';
import { rulesConfigSchema } from '../../src/config/types.js';

const GROUP = '120363000000000001@g.us';
const AUTHOR = '186428122255581@lid';
const AT = '2026-11-06T18:30:00.000Z';
const SENTINEL = 'SYNTHETIC-REPLY-BODY';
const URL_SENTINEL = 'https://example.invalid/secret-link';
const JPEG = Buffer.from('jpegbytes').toString('base64');

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = Mock<(...args: any[]) => any>;

function makeMsg() {
  return {
    from: GROUP, author: AUTHOR, capturedAt: AT, notifyName: 'Alice',
    getContact: vi.fn().mockResolvedValue({ pushname: 'Alice' }),
    react: vi.fn().mockResolvedValue(undefined),
  } as CmuMessage & { react: AnyMock };
}

function setup(reply: unknown = { kind: 'top', text: `${SENTINEL} ${URL_SENTINEL}`, images: [] }, over: Record<string, unknown> = {}) {
  const events: Array<{ ev: string; name?: string; f?: Record<string, unknown> }> = [];
  const trace: InteractionTrace = {
    id: 'abcdef012345',
    start: (f) => { events.push({ ev: 'start', f: { ...f } }); },
    step: (name, f) => { events.push({ ev: 'step', name, f: { ...f } }); },
    end: (outcome) => { events.push({ ev: 'end', name: outcome }); },
    thumbPath: () => '',
  };
  const files: string[] = [];
  const deps = {
    fetchFn: vi.fn().mockResolvedValue(json(200, reply)) as AnyMock,
    groups: new Map([[GROUP, 'league-x']]),
    url: 'http://host.invalid/catchup/me',
    token: 'sekret',
    screenshot: vi.fn(),
    sendImage: vi.fn(async (_c: string, f: string) => { files.push(f); }) as AnyMock,
    sendText: vi.fn().mockResolvedValue(undefined) as AnyMock,
    log: vi.fn() as AnyMock,
    trace: () => trace,
    playerThrottle: new Map<string, number>(),
    ...over,
  };
  const ends = () => events.filter((e) => e.ev === 'end').map((e) => e.name);
  const step = (n: string) => events.find((e) => e.name === n && e.ev === 'step')?.f;
  return { deps, events, files, ends, step, body: () => JSON.parse(deps.fetchFn.mock.calls[0][1].body) };
}

const TOP: CmuCommand = { kind: 'top', list: 'songs', days: 2 };
const images = (n: number) => Array.from({ length: n }, (_, i) => ({ caption: `cap ${i}`, jpegB64: JPEG }));

describe('isPlayerKind', () => {
  it('covers the player and recap-* kinds only', () => {
    for (const k of [TOP, { kind: 'pick' }, { kind: 'topics' }, { kind: 'topic', n: 2 }, { kind: 'dossier' },
      { kind: 'recap-sub' }, { kind: 'recap-unsub' }, { kind: 'recap-time', time: '08:00' }, { kind: 'recap-time-bad' }] as CmuCommand[]) {
      expect(isPlayerKind(k)).toBe(true);
    }
    for (const k of [{ kind: 'catchup' }, { kind: 'help' }, { kind: 'recap' }, { kind: 'off' }] as CmuCommand[]) {
      expect(isPlayerKind(k)).toBe(false);
    }
  });
});

describe('runCatchMeUp player flows', () => {
  it('reacts 👍 then DMs text to author only', async () => {
    const msg = makeMsg();
    const { deps, ends } = setup();
    await runCatchMeUp(msg, deps, TOP);
    expect(msg.react).toHaveBeenCalledWith('👍');
    expect(deps.sendText).toHaveBeenCalledTimes(1);
    expect(deps.sendText.mock.calls[0][0]).toBe(AUTHOR);
    expect(deps.sendText.mock.calls[0][1]).toContain(SENTINEL);
    for (const c of deps.sendText.mock.calls) expect(c[0]).not.toBe(GROUP);
    expect(ends()).toEqual(['sent']);
  });

  it('body has via dm and the mode fields', async () => {
    const a = setup();
    await runCatchMeUp(makeMsg(), a.deps, { kind: 'top', list: 'pics', days: 7 });
    expect(a.body()).toMatchObject({ mode: 'top', list: 'pics', days: 7, via: 'dm', league: 'league-x' });
    const b = setup({ kind: 'topic', text: 't' });
    await runCatchMeUp(makeMsg(), b.deps, { kind: 'topic', n: 3 });
    expect(b.body()).toMatchObject({ mode: 'topic', n: 3, via: 'dm' });
    for (const [k, mode] of [['pick', 'pick'], ['topics', 'topics'], ['dossier', 'dossier']] as const) {
      const c = setup({ kind: k, text: 't' });
      await runCatchMeUp(makeMsg(), c.deps, { kind: k } as CmuCommand);
      expect(c.body()).toMatchObject({ mode, via: 'dm' });
    }
  });

  it('pics: text first then up to 3 captioned images, at most 4 DMs', async () => {
    const order: string[] = [];
    const s = setup({ kind: 'top', text: 'x', images: images(3) });
    s.deps.sendText.mockImplementation(async () => { order.push('text'); });
    s.deps.sendImage.mockImplementation(async (_c: string, f: string) => { s.files.push(f); order.push('image'); });
    await runCatchMeUp(makeMsg(), s.deps, { kind: 'top', list: 'pics', days: 2 });
    expect(order).toEqual(['text', 'image', 'image', 'image']);
    expect(s.deps.sendImage.mock.calls.map((c) => c[2])).toEqual(['cap 0', 'cap 1', 'cap 2']);
    expect(s.deps.sendText.mock.calls.length + s.deps.sendImage.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('media capped at 4 DMs even when the response has 5 images', async () => {
    const s = setup({ kind: 'top', text: 'x', images: images(5) });
    await runCatchMeUp(makeMsg(), s.deps, { kind: 'top', list: 'media', days: 2 });
    expect(s.deps.sendText.mock.calls.length + s.deps.sendImage.mock.calls.length).toBe(4);
  });

  it('cooldown gives ⏳ and nothing else; a different command is not throttled', async () => {
    const s = setup();
    await runCatchMeUp(makeMsg(), s.deps, TOP);
    s.deps.sendText.mockClear(); s.deps.fetchFn.mockClear();
    const again = makeMsg();
    await runCatchMeUp(again, s.deps, TOP);
    expect(again.react.mock.calls).toEqual([['⏳']]);
    expect(s.deps.fetchFn).not.toHaveBeenCalled();
    expect(s.deps.sendText).not.toHaveBeenCalled();
    expect(s.ends()).toEqual(['sent', 'throttled']);

    s.deps.fetchFn.mockResolvedValue(json(200, { kind: 'pick', text: 'p' }));
    const other = makeMsg();
    await runCatchMeUp(other, s.deps, { kind: 'pick' });
    expect(other.react).toHaveBeenCalledWith('👍');
    expect(s.deps.sendText).toHaveBeenCalledTimes(1);
  });

  it('throttle key: top-songs vs top-pics and topic 1 vs 2 are free; top-songs vs top-songs week is throttled', async () => {
    const s = setup({ kind: 'top', text: 'x', images: [] });
    const run = async (c: CmuCommand) => { const m = makeMsg(); await runCatchMeUp(m, s.deps, c); return m.react.mock.calls.map((x) => x[0]); };
    expect(await run({ kind: 'top', list: 'songs', days: 2 })).toEqual(['👍']);
    expect(await run({ kind: 'top', list: 'pics', days: 2 })).toEqual(['👍']);
    expect(await run({ kind: 'top', list: 'songs', days: 7 })).toEqual(['⏳']);
    s.deps.fetchFn.mockResolvedValue(json(200, { kind: 'topic', text: 't' }));
    expect(await run({ kind: 'topic', n: 1 })).toEqual(['👍']);
    expect(await run({ kind: 'topic', n: 2 })).toEqual(['👍']);
    expect(await run({ kind: 'topic', n: 1 })).toEqual(['⏳']);
  });

  it('deadline mid-delivery: no DM follows the failure DM and the temp dir is cleaned', async () => {
    const s = setup({ kind: 'top', text: 'x', images: images(2) }, { deadlineMs: 30 });
    const sent: string[] = [];
    s.deps.sendText.mockImplementation(async (_c: string, t: string) => {
      sent.push(t === PLAYER_FAILURE_TEXT ? 'failure' : 'text');
      if (t !== PLAYER_FAILURE_TEXT) await new Promise((r) => setTimeout(r, 80));
    });
    s.deps.sendImage.mockImplementation(async (_c: string, f: string) => { s.files.push(f); sent.push('image'); });
    await runCatchMeUp(makeMsg(), s.deps, TOP);
    await new Promise((r) => setTimeout(r, 150));
    expect(sent).toEqual(['text']);
    expect(s.files).toEqual([]);
  });

  it('deadline before the text: failure DM, then nothing else', async () => {
    const s = setup({ kind: 'top', text: 'x', images: images(2) }, { deadlineMs: 30 });
    s.deps.fetchFn.mockImplementation(() => new Promise((r) => setTimeout(() => r(json(200, { kind: 'top', text: 'x', images: images(2) })), 80)));
    await runCatchMeUp(makeMsg(), s.deps, TOP);
    await new Promise((r) => setTimeout(r, 150));
    expect(s.deps.sendText.mock.calls).toEqual([[AUTHOR, PLAYER_FAILURE_TEXT]]);
    expect(s.deps.sendImage).not.toHaveBeenCalled();
  });

  it('companelist 500 gives the failure DM and outcome failed', async () => {
    const s = setup();
    s.deps.fetchFn.mockResolvedValue(json(500, {}));
    await runCatchMeUp(makeMsg(), s.deps, TOP);
    expect(PLAYER_FAILURE_TEXT).toBe("Couldn't get that just now. Try again in a minute.");
    expect(s.deps.sendText.mock.calls).toEqual([[AUTHOR, PLAYER_FAILURE_TEXT]]);
    expect(s.ends()).toEqual(['failed']);
  });

  it('off switch: nothing at all', async () => {
    const sw = memoryCmuSwitch();
    sw.set(false, new Date());
    const msg = makeMsg();
    const s = setup(undefined, { cmuSwitch: sw });
    await runCatchMeUp(msg, s.deps, TOP);
    expect(msg.react).not.toHaveBeenCalled();
    expect(s.deps.fetchFn).not.toHaveBeenCalled();
    expect(s.deps.sendText).not.toHaveBeenCalled();
    expect(s.ends()).toEqual(['disabled']);
  });

  it('empty outcome when the reply starts Dead chat. or You were in every', async () => {
    for (const text of ['Dead chat. Nothing to rank.', 'You were in every conversation.']) {
      const s = setup({ kind: 'topics', text });
      await runCatchMeUp(makeMsg(), s.deps, { kind: 'topics' });
      expect(s.ends()).toEqual(['empty']);
      expect(s.deps.sendText).toHaveBeenCalledTimes(1);
    }
  });

  it('trace and log have no reply text or URLs', async () => {
    const s = setup({ kind: 'top', text: `${SENTINEL} ${URL_SENTINEL}`, images: images(2) });
    await runCatchMeUp(makeMsg(), s.deps, TOP);
    const all = JSON.stringify(s.events) + s.deps.log.mock.calls.flat().join('\n');
    expect(all).not.toContain(SENTINEL);
    expect(all).not.toContain('example.invalid');
    expect(all).not.toContain('cap 0');
    expect(s.step('companelist')).toMatchObject({ ok: true, images: 2 });
  });

  it('temp image files are removed', async () => {
    const s = setup({ kind: 'top', text: 'x', images: images(2) });
    s.deps.sendImage.mockImplementation(async (_c: string, f: string) => { s.files.push(f); expect(existsSync(f)).toBe(true); });
    await runCatchMeUp(makeMsg(), s.deps, TOP);
    expect(s.files).toHaveLength(2);
    for (const f of s.files) expect(existsSync(f)).toBe(false);
  });

  it('an image failure after the text sent gives no failure DM', async () => {
    const s = setup({ kind: 'top', text: 'x', images: images(1) });
    s.deps.sendImage.mockRejectedValue(new Error('boom'));
    await runCatchMeUp(makeMsg(), s.deps, TOP);
    expect(s.deps.sendText).toHaveBeenCalledTimes(1);
    expect(s.ends()).toEqual(['sent']);
  });
});

describe('handleMessage with a player command in the group', () => {
  it('reaches the non-command path and makes no companelist call', async () => {
    const s = setup(undefined, { preview: memoryCmuPreview([GROUP], [AUTHOR]) });
    const db = openDb(':memory:');
    createPromptTables(db);
    const jevRespond = vi.fn().mockResolvedValue(null);
    const reactToMention = vi.fn().mockResolvedValue(undefined);
    const cfg: BotConfig = {
      config: rulesConfigSchema.parse({ defaults: { requireCommandPrefix: true, commandPrefix: '!song' }, rules: [] }),
      spotify: { searchTrack: vi.fn(), getTrackById: vi.fn(), findOrCreatePlaylist: vi.fn(), isTrackInPlaylist: vi.fn(), addTrackToPlaylist: vi.fn() },
      db, allowedGroupIds: ['120363000000000001'], ownerPhone: '1@c.us', masterPlaylistName: 'M', sendDm: vi.fn(),
      preview: memoryCmuPreview([GROUP], [AUTHOR]),
      catchMeUp: (m, c) => runCatchMeUp(m, s.deps, c),
      jevRespond,
      reactToMention,
      reactGroupIds: new Set([GROUP]),
    };
    const msg: WhatsAppMessage = {
      body: '@12134198455 top-songs', from: GROUP, chatName: 'G', author: AUTHOR, fromMe: false, capturedAt: AT,
      priorMessages: [], mentionsBot: true,
      reply: vi.fn().mockResolvedValue(undefined),
      getContact: vi.fn().mockResolvedValue({ pushname: 'Alice' }),
      react: vi.fn().mockResolvedValue(undefined),
    };
    await handleMessage(msg, cfg);
    expect(reactToMention).toHaveBeenCalledWith(msg);
    expect(s.deps.fetchFn).not.toHaveBeenCalled();
    expect(s.deps.sendText).not.toHaveBeenCalled();
    expect(s.deps.sendImage).not.toHaveBeenCalled();
    expect(s.ends()).toEqual([]);
  });
});
