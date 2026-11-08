import { describe, it, expect, vi } from 'vitest';
import { runWrongPlace, WRONG_PLACE_EMOJI, EXPLAIN_COOLDOWN_MS, WRONG_PLACE_COPY } from '../../src/bot/wrongPlace.js';
import { frameMessage, MESSAGE_NAMES, FOOTER_WRONG_PLACE } from '../../src/bot/messageFrame.js';

const GROUP = '120363000000000001@g.us';
let n = 0;
function setup(o: { person?: boolean; enabled?: () => boolean; sendFails?: boolean; reactFails?: boolean; target?: string } = {}) {
  const target = o.target ?? `target${++n}@lid`;
  const calls: Array<[string, Record<string, unknown>]> = [];
  const trace = {
    id: 'x', thumbPath: () => '',
    start: vi.fn((f) => calls.push(['start', f])),
    step: vi.fn((s, f) => calls.push([s, f])),
    end: vi.fn((out) => calls.push(['end', { out }])),
  };
  const sendDm = vi.fn(async () => { if (o.sendFails) throw new Error('boom SECRET'); });
  const react = vi.fn(async () => { if (o.reactFails) throw new Error('nope'); });
  const log = vi.fn();
  let t = 1_000_000;
  const deps = {
    sendDm, dmTarget: vi.fn(async () => target), isPreviewPerson: () => o.person !== false, isEnabled: o.enabled ?? (() => true),
    trace: () => trace, now: () => t, log,
  };
  const msg = { from: GROUP, author: '100000000000001@lid', body: '@bot top-pics', chatName: 'G', react } as never;
  return { deps, msg, sendDm, react, log, trace, calls, advance: (ms: number) => { t += ms; } };
}

describe('runWrongPlace', () => {
  it('non-preview person: not handled, nothing sent', async () => {
    const s = setup({ person: false });
    expect(await runWrongPlace(s.msg, s.deps)).toBe(false);
    expect(s.react).not.toHaveBeenCalled();
    expect(s.sendDm).not.toHaveBeenCalled();
  });

  it('reacts and sends one framed explainer', async () => {
    const s = setup();
    expect(await runWrongPlace(s.msg, s.deps)).toBe(true);
    expect(s.react).toHaveBeenCalledWith(WRONG_PLACE_EMOJI);
    expect(WRONG_PLACE_EMOJI).toBe('❌');
    expect(s.sendDm).toHaveBeenCalledTimes(1);
    expect((s.sendDm.mock.calls[0] as unknown as string[])[1]).toBe(
      frameMessage({ name: MESSAGE_NAMES.wrongPlace, body: WRONG_PLACE_COPY, footer: FOOTER_WRONG_PLACE }),
    );
    expect(s.calls.map((c) => c[0])).toEqual(['start', 'react', 'explain-dm', 'end']);
    expect((s.calls[0][1] as { command: string }).command).toBe('wrong-place');
    expect(s.trace.end).toHaveBeenCalledWith('wrong-place');
  });

  it('second within 10 min: react again, no DM, explain-throttled; after 10 min DM again', async () => {
    const s = setup();
    await runWrongPlace(s.msg, s.deps);
    s.advance(EXPLAIN_COOLDOWN_MS - 1);
    await runWrongPlace(s.msg, s.deps);
    expect(s.react).toHaveBeenCalledTimes(2);
    expect(s.sendDm).toHaveBeenCalledTimes(1);
    expect(s.calls.some((c) => c[0] === 'explain-throttled')).toBe(true);
    s.advance(1);
    await runWrongPlace(s.msg, s.deps);
    expect(s.sendDm).toHaveBeenCalledTimes(2);
  });

  it('DM failure: no throw, returns true, does not start cooldown, logs without text/ids', async () => {
    const s = setup({ sendFails: true });
    expect(await runWrongPlace(s.msg, s.deps)).toBe(true);
    await runWrongPlace(s.msg, s.deps);
    expect(s.sendDm).toHaveBeenCalledTimes(2);
    const logged = s.log.mock.calls.flat().join(' ');
    expect(logged).not.toContain('SECRET');
    expect(logged).not.toContain('100000000000001');
    expect(logged).not.toContain(GROUP);
  });

  it('react failure: no throw, still sends DM', async () => {
    const s = setup({ reactFails: true });
    expect(await runWrongPlace(s.msg, s.deps)).toBe(true);
    expect(s.sendDm).toHaveBeenCalledTimes(1);
  });

  it('traces carry no text or ids', async () => {
    const s = setup();
    await runWrongPlace(s.msg, s.deps);
    const dump = JSON.stringify(s.calls);
    expect(dump).not.toContain('top-pics');
    expect(dump).not.toContain('100000000000001');
    expect(dump).not.toContain('target');
  });

  it('switch off: no react, no DM, returns true, no cooldown started', async () => {
    let on = false;
    const s = setup({ enabled: () => on });
    expect(await runWrongPlace(s.msg, s.deps)).toBe(true);
    expect(s.react).not.toHaveBeenCalled();
    expect(s.sendDm).not.toHaveBeenCalled();
    expect(s.trace.end).toHaveBeenCalledWith('disabled');
    on = true;
    await runWrongPlace(s.msg, s.deps);
    expect(s.sendDm).toHaveBeenCalledTimes(1);
    expect(s.react).toHaveBeenCalledTimes(1);
  });
});
