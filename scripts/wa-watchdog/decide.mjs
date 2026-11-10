/**
 * Pure decision logic for scripts/wa-watchdog.mjs. No I/O, so it is unit-tested
 * (tests/waWatchdog.test.ts).
 *
 * Alert policy (Matt, 2026-11-10): push ONLY on a problem or a developing problem.
 *   silent   healthy; a single failed/slow check; one restart that recovers
 *   'slow'   SLOW_STREAK slow-but-ok checks in a row        (developing)
 *   'repeat' a restart that recovers, but it's the 2nd+ in 24h (developing)
 *   'down'   a restart that did NOT bring the session back   (problem)
 *   'limit'  failing, but MAX_RESTARTS in 6h already used    (problem)
 *   'recovered' one all-clear, only after a problem/developing alert was sent
 *
 * The watchdog only ever restarts the container. It never logs out, never
 * touches .wwebjs_auth, never touches the Pixel.
 */
export const FAILS_BEFORE_RESTART = 2;
export const SLOW_MS = 5000;
export const SLOW_STREAK = 3;
export const MAX_RESTARTS = 3;
export const RESTART_WINDOW_MS = 6 * 3600_000;
export const REPEAT_WINDOW_MS = 24 * 3600_000;

export function initialState() {
  return { consecFails: 0, slowStreak: 0, restarts: [], alerted: false, limitAlerted: false };
}

const recent = (ts, now, win) => ts.filter((t) => now - t < win);

/**
 * @param {ReturnType<typeof initialState>} state
 * @param {{ok:boolean, ms:number, reason?:string}} probe
 * @param {{now:number, preflight?:boolean}} opts
 * @returns {{restart:boolean, alerts:{kind:string,detail:string}[], state:object}}
 */
export function decide(state, probe, { now, preflight = false }) {
  const s = { ...initialState(), ...state, restarts: recent(state.restarts ?? [], now, REPEAT_WINDOW_MS) };
  const alerts = [];

  if (probe.ok) {
    s.consecFails = 0;
    s.limitAlerted = false;
    if (probe.ms >= SLOW_MS) {
      s.slowStreak += 1;
      if (s.slowStreak === SLOW_STREAK) {
        alerts.push({ kind: 'slow', detail: `${SLOW_STREAK} slow health checks in a row (last ${probe.ms}ms)` });
        s.alerted = true;
      }
    } else {
      // All-clear only on a fully healthy check, never on a slow one.
      if (s.alerted) alerts.push({ kind: 'recovered', detail: `healthy again (${probe.ms}ms)` });
      s.alerted = false;
      s.slowStreak = 0;
    }
    return { restart: false, alerts, state: s };
  }

  s.consecFails += 1;
  s.slowStreak = 0;
  const needed = preflight ? 1 : FAILS_BEFORE_RESTART;
  if (s.consecFails < needed) return { restart: false, alerts, state: s };

  if (recent(s.restarts, now, RESTART_WINDOW_MS).length >= MAX_RESTARTS) {
    if (!s.limitAlerted) {
      alerts.push({
        kind: 'limit',
        detail: `still failing (${probe.reason ?? 'unknown'}); ${MAX_RESTARTS} restarts in 6h already, not restarting again`,
      });
      s.limitAlerted = true;
      s.alerted = true;
    }
    return { restart: false, alerts, state: s };
  }
  return { restart: true, alerts, state: s };
}

/**
 * @param {ReturnType<typeof initialState>} state
 * @param {boolean} recovered  health came back ok after the restart
 * @param {{now:number, reason?:string}} opts
 */
export function afterRestart(state, recovered, { now, reason }) {
  const s = { ...initialState(), ...state };
  s.restarts = [...recent(s.restarts ?? [], now, REPEAT_WINDOW_MS), now];
  const alerts = [];
  if (!recovered) {
    alerts.push({ kind: 'down', detail: `restarted the bot but WhatsApp did not come back (${reason ?? 'no detail'})` });
    s.alerted = true;
    return { alerts, state: s };
  }
  s.consecFails = 0;
  if (s.restarts.length >= 2) {
    alerts.push({ kind: 'repeat', detail: `restarted and recovered, but that is ${s.restarts.length} restarts in 24h` });
    s.alerted = true;
  }
  return { alerts, state: s };
}
