import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs module without types
import { decide, afterRestart, initialState } from '../scripts/wa-watchdog/decide.mjs';

const H = 3600_000;
const T0 = Date.parse('2026-11-10T12:00:00Z');
const ok = { ok: true, ms: 200 };
const slow = { ok: true, ms: 7000 };
const fail = { ok: false, ms: 10000, reason: 'timeout' };

describe('decide', () => {
  it('healthy: nothing to do, no alert', () => {
    const r = decide(initialState(), ok, { now: T0 });
    expect(r.restart).toBe(false);
    expect(r.alerts).toEqual([]);
  });

  it('a single failure only counts; no restart, no alert', () => {
    const r = decide(initialState(), fail, { now: T0 });
    expect(r.restart).toBe(false);
    expect(r.alerts).toEqual([]);
    expect(r.state.consecFails).toBe(1);
  });

  it('two failures in a row restart, silently', () => {
    const s1 = decide(initialState(), fail, { now: T0 }).state;
    const r = decide(s1, fail, { now: T0 + 5 * 60_000 });
    expect(r.restart).toBe(true);
    expect(r.alerts).toEqual([]);
  });

  it('preflight window restarts on the first failure', () => {
    const r = decide(initialState(), fail, { now: T0, preflight: true });
    expect(r.restart).toBe(true);
  });

  it('three slow checks in a row raise one developing-problem alert', () => {
    let s = initialState();
    const alerts: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      const r = decide(s, slow, { now: T0 + i * 300_000 });
      alerts.push(...r.alerts);
      s = r.state;
    }
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'slow' });
  });

  it('three failures without a restart (limit hit) alert once', () => {
    let s = { ...initialState(), restarts: [T0 - 3 * H, T0 - 2 * H, T0 - 1 * H] };
    const alerts: { kind: string }[] = [];
    for (let i = 0; i < 6; i++) {
      const r = decide(s, fail, { now: T0 + i * 300_000 });
      expect(r.restart).toBe(false);
      alerts.push(...r.alerts);
      s = r.state;
    }
    expect(alerts.map((a) => a.kind)).toEqual(['limit']);
  });

  it('recovery after an alert sends one all-clear; recovery without one is silent', () => {
    const alerted = { ...initialState(), consecFails: 3, alerted: true };
    expect(decide(alerted, ok, { now: T0 }).alerts.map((a: { kind: string }) => a.kind)).toEqual(['recovered']);
    const quiet = { ...initialState(), consecFails: 1 };
    expect(decide(quiet, ok, { now: T0 }).alerts).toEqual([]);
  });
});

describe('afterRestart', () => {
  it('first restart in 24h that recovers is silent', () => {
    const r = afterRestart(initialState(), true, { now: T0 });
    expect(r.alerts).toEqual([]);
    expect(r.state.restarts).toEqual([T0]);
    expect(r.state.consecFails).toBe(0);
  });

  it('second restart within 24h is a developing problem', () => {
    const s = { ...initialState(), restarts: [T0 - 20 * H] };
    const r = afterRestart(s, true, { now: T0 });
    expect(r.alerts.map((a: { kind: string }) => a.kind)).toEqual(['repeat']);
  });

  it('restart that does not recover is a problem', () => {
    const r = afterRestart(initialState(), false, { now: T0 });
    expect(r.alerts.map((a: { kind: string }) => a.kind)).toEqual(['down']);
    expect(r.state.alerted).toBe(true);
  });

  it('forgets restarts older than 24h', () => {
    const s = { ...initialState(), restarts: [T0 - 30 * H] };
    expect(afterRestart(s, true, { now: T0 }).state.restarts).toEqual([T0]);
  });
});
