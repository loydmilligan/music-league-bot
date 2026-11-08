import { describe, expect, it, vi } from 'vitest';
import { BurstGuard, ReactionCap, REACTION_PER_AUTHOR_WINDOW_MS, REACTION_PER_GROUP_PER_HOUR, runReaction, type ReactionDeps, type ReactionMessage } from '../../src/bot/reactions.js';
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
    trace: () => t.trace, log: () => {}, now: () => 1000, random: () => 0, guard: new BurstGuard(), cap: new ReactionCap(), ...over,
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

  it('global burst: 31st pick in a minute falls back', async () => {
    const guard = new BurstGuard();
    const cap = new ReactionCap({ perAuthorWindowMs: 0, perGroupPerHour: 1000 });
    for (let i = 0; i < 30; i++) {
      const s = setup({ guard, cap }, { author: `a${i}@lid` });
      await runReaction(s.msg, s.deps);
      expect(s.t.outcome()).toBe('jev');
    }
    const last = setup({ guard, cap }, { author: 'a99@lid' });
    await runReaction(last.msg, last.deps);
    expect(last.t.steps('fallback')[0]).toMatchObject({ reason: 'burst' });
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

  describe('reaction cap', () => {
    const at = (t: number) => ({ now: () => t });
    const capped = (s: ReturnType<typeof setup>) => {
      expect(s.react).not.toHaveBeenCalled();
      expect(s.pick).not.toHaveBeenCalled();
      expect(s.t.outcome()).toBe('reaction-capped');
    };

    it('constants', () => {
      expect(REACTION_PER_AUTHOR_WINDOW_MS).toBe(60_000);
      expect(REACTION_PER_GROUP_PER_HOUR).toBe(30);
    });

    it('2nd mention from one author within 60 s: no react, no pick, scope author, logged without ids', async () => {
      const cap = new ReactionCap();
      const first = setup({ cap, ...at(0) });
      await runReaction(first.msg, first.deps);
      expect(first.react).toHaveBeenCalledTimes(1);
      const logs: string[] = [];
      const s = setup({ cap, ...at(30_000), log: (l) => void logs.push(l) });
      await runReaction(s.msg, s.deps);
      capped(s);
      expect(s.t.steps('cap')[0]).toEqual({ ok: true, scope: 'author' });
      expect(logs).toEqual(['[react] reaction-capped']);
    });

    it('reacts again after 60 s; a different author in the same minute still reacts', async () => {
      const cap = new ReactionCap();
      await runReaction(...(([s]) => [s.msg, s.deps] as const)([setup({ cap, ...at(0) })]));
      const other = setup({ cap, ...at(1) }, { author: 'author-2@lid' });
      await runReaction(other.msg, other.deps);
      expect(other.react).toHaveBeenCalledTimes(1);
      const later = setup({ cap, ...at(60_000) });
      await runReaction(later.msg, later.deps);
      expect(later.react).toHaveBeenCalledTimes(1);
    });

    it('capped calls are not recorded: capped at 0..59 s, reacts at 60 s', async () => {
      const cap = new ReactionCap();
      const first = setup({ cap, ...at(0) });
      await runReaction(first.msg, first.deps);
      for (const t of [1000, 20_000, 59_999]) {
        const s = setup({ cap, ...at(t) });
        await runReaction(s.msg, s.deps);
        capped(s);
      }
      const s = setup({ cap, ...at(60_000) });
      await runReaction(s.msg, s.deps);
      expect(s.react).toHaveBeenCalledTimes(1);
    });

    it('31st reaction in a group within an hour is capped (scope group); another group is unaffected', async () => {
      const cap = new ReactionCap();
      for (let i = 0; i < 30; i++) {
        const s = setup({ cap, ...at(i * 1000) }, { author: `a${i}@lid` });
        await runReaction(s.msg, s.deps);
        expect(s.react).toHaveBeenCalledTimes(1);
      }
      const over = setup({ cap, ...at(31_000) }, { author: 'a99@lid' });
      await runReaction(over.msg, over.deps);
      capped(over);
      expect(over.t.steps('cap')[0]).toEqual({ ok: true, scope: 'group' });
      const elsewhere = setup({ cap, ...at(31_000) }, { author: 'a98@lid', from: 'group-2@g.us' });
      await runReaction(elsewhere.msg, elsewhere.deps);
      expect(elsewhere.react).toHaveBeenCalledTimes(1);
      const hourLater = setup({ cap, ...at(3_600_000) }, { author: 'a97@lid' });
      await runReaction(hourLater.msg, hourLater.deps);
      expect(hourLater.react).toHaveBeenCalledTimes(1);
    });

    it('off switch wins over the cap', async () => {
      const cap = new ReactionCap();
      cap.allow(AUTHOR, 'group-1@g.us', 0);
      const s = setup({ cap, ...at(1), cmuSwitch: { isEnabled: () => false, set() {} } });
      await runReaction(s.msg, s.deps);
      expect(s.t.outcome()).toBe('disabled');
      expect(s.t.steps('cap')).toEqual([]);
    });

    it('a throwing logger cannot break a capped run, and no body or id is traced', async () => {
      const cap = new ReactionCap();
      cap.allow(AUTHOR, 'group-1@g.us', 0);
      const s = setup({ cap, ...at(1), log: () => { throw new Error('log'); } });
      await runReaction(s.msg, s.deps);
      capped(s);
      const text = JSON.stringify(s.t.calls);
      expect(text).not.toContain('zzsecretbodyzz');
      expect(text).not.toContain(AUTHOR);
    });
  });
});
