import { describe, expect, it, vi } from 'vitest';
import { BurstGuard, runReaction, type ReactionDeps, type ReactionMessage } from '../../src/bot/reactions.js';
import type { Palette } from '../../src/bot/reactionPalette.js';
import type { JevPicker } from '../../src/chat/jevPick.js';
import type { InteractionTrace } from '../../src/storage/interactionLog.js';

const palette: Palette = {
  categories: [
    { id: 'bigger-than', describe: 'one-up the joke', emojis: ['🍆', '🔥'] },
    { id: 'hype', describe: 'celebrate', emojis: ['🎉', '🙌'] },
  ],
  all: ['🍆', '🔥', '🎉', '🙌', '😂'],
  fallbackPool: ['😂', '🎉'],
};
const BODY = 'zzsecretbodyzz please';
const AUTHOR = 'author-1@lid';

function recTrace() {
  const calls: Array<[string, ...unknown[]]> = [];
  const trace: InteractionTrace = {
    id: 't',
    start: (f) => void calls.push(['start', f]),
    step: (n, f) => void calls.push(['step', n, f]),
    end: (o, f) => void calls.push(['end', o, f]),
    thumbPath: () => '',
  };
  const steps = (n: string) => calls.filter((c) => c[0] === 'step' && c[1] === n).map((c) => c[2] as Record<string, unknown>);
  const outcome = () => calls.find((c) => c[0] === 'end')?.[1];
  return { trace, calls, steps, outcome };
}

function setup(over: Partial<ReactionDeps> = {}, msgOver: Partial<ReactionMessage> = {}) {
  const t = recTrace();
  const react = vi.fn(async (_e: string) => {});
  const pick = vi.fn(async (_i: string, opts: string[]): Promise<{ choice: string | null; cost: number }> => ({
    choice: opts.includes('bigger-than') ? 'bigger-than' : opts[0],
    cost: 0.001,
  }));
  const picker: JevPicker = { pick };
  const msg: ReactionMessage = {
    from: 'group-1@g.us', author: AUTHOR, body: BODY, chatName: 'Test Group', notifyName: 'Sam',
    priorMessages: [{ sender: 'Sam', timeMs: 1, text: 'hello' }], react, ...msgOver,
  };
  const deps: ReactionDeps = {
    palette, picker, forceFallback: false, cmuSwitch: { isEnabled: () => true, set() {} },
    trace: () => t.trace, log: () => {}, now: () => 1000, random: () => 0, guard: new BurstGuard(), ...over,
  };
  return { t, react, pick, msg, deps };
}

describe('runReaction', () => {
  it('Jev path: category then emoji', async () => {
    const { t, react, pick, msg, deps } = setup();
    await runReaction(msg, deps);
    expect(react).toHaveBeenCalledTimes(1);
    expect(react).toHaveBeenCalledWith('🍆');
    expect(t.outcome()).toBe('jev');
    expect(pick.mock.calls[0][1]).toEqual(['bigger-than', 'hype']);
    expect(pick.mock.calls[0][0]).toContain('bigger-than — one-up the joke');
    expect(pick.mock.calls[0][0]).toContain('hype — celebrate');
    expect(pick.mock.calls[1][1]).toEqual(['🍆', '🔥']);
    expect(t.steps('pick-category')[0]).toMatchObject({ ok: true, category: 'bigger-than' });
    expect(t.steps('pick-emoji')[0]).toMatchObject({ ok: true, emoji: '🍆' });
    expect(t.calls[0][1]).toMatchObject({ who: 'Sam', command: 'reaction', authorKind: 'lid' });
  });

  it('no picker -> no-key; forceFallback -> forced-off without calling picker', async () => {
    const a = setup({ picker: null });
    await runReaction(a.msg, a.deps);
    expect(a.react).toHaveBeenCalledWith('😂');
    expect(a.t.steps('fallback')[0]).toMatchObject({ ok: true, reason: 'no-key' });
    expect(a.t.outcome()).toBe('fallback');
    const b = setup({ forceFallback: true });
    await runReaction(b.msg, b.deps);
    expect(b.pick).not.toHaveBeenCalled();
    expect(b.t.steps('fallback')[0]).toMatchObject({ reason: 'forced-off' });
  });

  it('error, timeout and bad-answer reasons', async () => {
    const err = setup();
    err.pick.mockRejectedValueOnce(new Error('boom'));
    await runReaction(err.msg, err.deps);
    expect(err.t.steps('fallback')[0]).toMatchObject({ reason: 'error' });
    for (const name of ['TimeoutError', 'AbortError']) {
      const s = setup();
      s.pick.mockRejectedValueOnce(Object.assign(new Error('x'), { name }));
      await runReaction(s.msg, s.deps);
      expect(s.t.steps('fallback')[0]).toMatchObject({ reason: 'timeout' });
      expect(s.react).toHaveBeenCalledTimes(1);
    }
    const bad1 = setup();
    bad1.pick.mockResolvedValueOnce({ choice: null, cost: 0 });
    await runReaction(bad1.msg, bad1.deps);
    expect(bad1.t.steps('fallback')[0]).toMatchObject({ reason: 'bad-answer' });
    const bad2 = setup();
    bad2.pick.mockResolvedValueOnce({ choice: 'hype', cost: 0 }).mockResolvedValueOnce({ choice: null, cost: 0 });
    await runReaction(bad2.msg, bad2.deps);
    expect(bad2.t.steps('fallback')[0]).toMatchObject({ reason: 'bad-answer' });
    expect(bad2.react).toHaveBeenCalledWith('😂');
  });

  it('switch off -> nothing happens', async () => {
    const { t, react, pick, msg, deps } = setup({ cmuSwitch: { isEnabled: () => false, set() {} } });
    await runReaction(msg, deps);
    expect(react).not.toHaveBeenCalled();
    expect(pick).not.toHaveBeenCalled();
    expect(t.outcome()).toBe('disabled');
  });

  it('no per-author or per-group cap: many authors 31+ mentions in a minute all react, 31st onward fall back with burst', async () => {
    const guard = new BurstGuard();
    for (let i = 0; i < 35; i++) {
      const s = setup({ guard, now: () => 1000 + i }, { author: `a${i}@lid` });
      await runReaction(s.msg, s.deps);
      expect(s.react).toHaveBeenCalledTimes(1);
      if (i < 30) {
        expect(s.t.outcome()).toBe('jev');
        expect(s.t.steps('fallback')).toEqual([]);
      } else {
        expect(s.pick).not.toHaveBeenCalled();
        expect(s.t.steps('fallback')).toEqual([{ ok: true, reason: 'burst' }]);
        expect(s.t.outcome()).toBe('fallback');
        expect(palette.fallbackPool).toContain(s.react.mock.calls[0][0]);
      }
    }
  });

  it('same author, 3 mentions in a minute: 3 reactions', async () => {
    const guard = new BurstGuard();
    for (const t of [0, 20_000, 40_000]) {
      const s = setup({ guard, now: () => t });
      await runReaction(s.msg, s.deps);
      expect(s.react).toHaveBeenCalledTimes(1);
      expect(s.t.outcome()).toBe('jev');
    }
  });

  it('only allowed calls fill the global window, which slides', () => {
    const guard = new BurstGuard({ global: 3 });
    expect([1, 2, 3, 4, 5].map((i) => guard.allow('a', 1000 + i))).toEqual([true, true, true, false, false]);
    expect(guard.allow('b', 1000 + 60_003)).toBe(true);
  });

  it('send-failure retry uses a different emoji than the one that failed', async () => {
    const a = setup({ forceFallback: true });
    a.react.mockRejectedValueOnce(new Error('send'));
    await runReaction(a.msg, a.deps);
    expect(a.react.mock.calls[0][0]).toBe(palette.fallbackPool[0]);
    expect(a.react.mock.calls[1][0]).not.toBe(palette.fallbackPool[0]);
    expect(a.t.outcome()).toBe('fallback');
  });

  it('send failure retries once with a fallback emoji; both failing does not throw', async () => {
    const a = setup();
    a.react.mockRejectedValueOnce(new Error('send'));
    await runReaction(a.msg, a.deps);
    expect(a.react).toHaveBeenCalledTimes(2);
    expect(a.react).toHaveBeenLastCalledWith('😂');
    expect(a.t.steps('react')[1]).toMatchObject({ ok: true, retry: true, emoji: '😂' });
    expect(a.t.steps('fallback')[0]).toMatchObject({ reason: 'send-failed' });
    expect(a.t.outcome()).toBe('fallback');
    const b = setup();
    b.react.mockRejectedValue(new Error('send'));
    await expect(runReaction(b.msg, b.deps)).resolves.toBeUndefined();
    expect(b.t.outcome()).toBe('failed');
  });

  it('a pick that throws or times out still writes a failed pick step with ms and no cost', async () => {
    const a = setup();
    a.pick.mockRejectedValueOnce(new Error('boom'));
    await runReaction(a.msg, a.deps);
    const c = a.t.steps('pick-category')[0];
    expect(c).toMatchObject({ ok: false });
    expect(typeof c.ms).toBe('number');
    expect(c).not.toHaveProperty('cost');
    expect(c).not.toHaveProperty('category');
    const b = setup();
    b.pick.mockResolvedValueOnce({ choice: 'hype', cost: 0.001 }).mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'TimeoutError' }));
    await runReaction(b.msg, b.deps);
    const e = b.t.steps('pick-emoji')[0];
    expect(e).toMatchObject({ ok: false });
    expect(typeof e.ms).toBe('number');
    expect(e).not.toHaveProperty('cost');
    expect(e).not.toHaveProperty('emoji');
    expect(b.t.steps('fallback')[0]).toMatchObject({ reason: 'timeout' });
  });

  it('outcome failed logs a bare line, and a throwing logger cannot add a second end', async () => {
    const log = vi.fn();
    const a = setup({ log });
    a.react.mockRejectedValue(new Error('send'));
    await runReaction(a.msg, a.deps);
    expect(log).toHaveBeenCalledWith('[react] failed');
    const b = setup({ log: () => { throw new Error('log'); } });
    b.react.mockRejectedValue(new Error('send'));
    await expect(runReaction(b.msg, b.deps)).resolves.toBeUndefined();
    expect(b.t.calls.filter((c) => c[0] === 'end')).toHaveLength(1);
    expect(b.t.outcome()).toBe('failed');
  });

  it('trace never contains the body or the author id', async () => {
    const s = setup();
    s.react.mockRejectedValueOnce(new Error('send'));
    await runReaction(s.msg, s.deps);
    const text = JSON.stringify(s.t.calls);
    expect(text).not.toContain('zzsecretbodyzz');
    expect(text).not.toContain(AUTHOR);
  });
});
