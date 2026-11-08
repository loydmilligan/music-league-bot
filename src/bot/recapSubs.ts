import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import type { CmuCommand } from './cmuCommand.js';
import { CMU_ACK_EMOJI, CMU_FAILURE_DM_TIMEOUT_MS, CmuHttpError, describeError, msSince, react, timed, withDeadline } from './catchMeUp.js';
import type { CmuDeps, CmuMessage, SafeTrace } from './catchMeUp.js';
import { CMU_COMMAND_TIMEOUT_MS } from './cmuFlows.js';
import { formatTime } from './cmuFollowUp.js';
import { NOOP_TRACE, type InteractionTrace } from '../storage/interactionLog.js';

/**
 * Morning recap by DM (M1-M8, G4). The store is keyed by the DM target (`dmTarget(author)`), holds
 * raw ids because sending needs them, and is never logged or traced. Logs and traces carry counts,
 * outcomes and error classes only: no ids, no recap text.
 */

export type RecapSub = { subscribed: boolean; time?: string } | undefined;

/** M3: `time` is "HH:MM" (24 h, LA); `league` is the instance the sub was resolved under. */
export interface Sub { time: string; league: string; lastSentYmd?: string }

export interface RecapSubs {
  get(key: string): Sub | undefined;
  /** Throws when the file can't be written; the in-memory state is then unchanged. */
  set(key: string, sub: Sub): void;
  delete(key: string): void;
  all(): [string, Sub][];
}

/** M6: at most one recap DM every 10 s. */
export const RECAP_DM_SPACING_MS = 10_000;
export const RECAP_TICK_MS = 60_000;
/** M2: a new subscriber's time. */
export const RECAP_DEFAULT_TIME = '08:00';
/** M3, verbatim. */
export const RECAP_STORE_FAILURE_TEXT = "Couldn't set that up just now. Try again in a minute.";
export const RECAP_OFF_TEXT = 'Morning recap: off.';
export const RECAP_BAD_TIME_TEXT = 'Try "morning-recap 7:30".';
export const recapOnText = (time: string): string =>
  `Morning recap: on, ${formatTime(time) ?? time} (LA). morning-recap unsub to stop.`;

export function recapSubsPath(): string {
  return path.resolve(process.env.DATA_DIR ?? 'data', 'recap-subs.json');
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function parseSubs(text: string): Map<string, Sub> {
  const out = new Map<string, Sub>();
  try {
    const d = JSON.parse(text) as unknown;
    const subs = d && typeof d === 'object' ? (d as Record<string, unknown>).subs : undefined;
    if (!subs || typeof subs !== 'object') return out;
    for (const [k, v] of Object.entries(subs as Record<string, unknown>)) {
      if (!k || !v || typeof v !== 'object') continue;
      const r = v as Record<string, unknown>;
      if (typeof r.time !== 'string' || !HHMM.test(r.time) || typeof r.league !== 'string' || !r.league) continue;
      const sub: Sub = { time: r.time, league: r.league };
      if (typeof r.lastSentYmd === 'string' && YMD.test(r.lastSentYmd)) sub.lastSentYmd = r.lastSentYmd;
      out.set(k, sub);
    }
  } catch {
    // corrupt
  }
  return out;
}

function storeOver(map: Map<string, Sub>, persist: (m: Map<string, Sub>) => void): RecapSubs {
  // M5 once a day: an unsub keeps the key's lastSentYmd here (memory only, so an unsubscribed id is
  // never written back to the file), and a re-sub the same process seeds from it.
  const tombstones = new Map<string, string>();
  const apply = (next: Map<string, Sub>) => {
    persist(next);
    map.clear();
    for (const [k, v] of next) map.set(k, v);
  };
  return {
    get: (key) => {
      const s = map.get(key);
      return s ? { ...s } : undefined;
    },
    set(key, sub) {
      const next = new Map(map);
      const seeded = { ...sub };
      const last = tombstones.get(key);
      if (seeded.lastSentYmd === undefined && last !== undefined) seeded.lastSentYmd = last;
      next.set(key, seeded);
      apply(next);
      tombstones.delete(key);
    },
    delete(key) {
      const cur = map.get(key);
      if (!cur) return;
      const next = new Map(map);
      next.delete(key);
      apply(next);
      if (cur.lastSentYmd !== undefined) tombstones.set(key, cur.lastSentYmd);
    },
    all: () => [...map].map(([k, v]) => [k, { ...v }] as [string, Sub]),
  };
}

/** The file store: read once, every change written atomically with mode 0600. A missing or corrupt file reads empty. */
export function openRecapSubs(file: string): RecapSubs {
  let initial = new Map<string, Sub>();
  try {
    initial = parseSubs(readFileSync(file, 'utf8'));
  } catch {
    // missing
  }
  return storeOver(initial, (m) => {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ subs: Object.fromEntries(m) }) + '\n', { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  });
}

/** An in-memory store, for tests. */
export function memoryRecapSubs(): RecapSubs {
  return storeOver(new Map(), () => {});
}

let shared: RecapSubs | undefined;
/** The process-wide store over `recapSubsPath()`, opened on first use. */
export function defaultRecapSubs(): RecapSubs {
  return (shared ??= openRecapSubs(recapSubsPath()));
}
/** Test hook: inject a store (undefined restores lazy opening). */
export function setRecapSubsForTest(s: RecapSubs | undefined): void {
  shared = s;
}

/** M3, for sprint 2's follow-up: never throws; an error or a miss reads as not subscribed. */
export function recapSubscription(dmTarget: string): RecapSub {
  try {
    if (!dmTarget) return { subscribed: false };
    const s = defaultRecapSubs().get(dmTarget);
    return s ? { subscribed: true, time: s.time } : { subscribed: false };
  } catch {
    return { subscribed: false };
  }
}

/** M6 (review): the most frequent CMU_GROUPS value; on a tie, the first in insertion order. */
export function servedLeague(groups: Map<string, string>): string | undefined {
  const counts = new Map<string, number>();
  for (const v of groups.values()) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

type RecapCmd = Extract<CmuCommand, { kind: 'recap-sub' | 'recap-unsub' | 'recap-time' | 'recap-time-bad' }>;
type End = (outcome: string, error?: string) => void;

export function isRecapKind(cmd: CmuCommand): cmd is RecapCmd {
  return cmd.kind === 'recap-sub' || cmd.kind === 'recap-unsub' || cmd.kind === 'recap-time' || cmd.kind === 'recap-time-bad';
}

/** M3 key normalization: only a non-empty dmTarget result counts; absent, throwing or empty is unknown. */
async function recapKey(author: string, deps: CmuDeps): Promise<string | undefined> {
  if (!deps.dmTarget) return undefined;
  try {
    const k = await deps.dmTarget(author);
    return typeof k === 'string' && k !== '' ? k : undefined;
  } catch {
    return undefined;
  }
}

/** M2/M3: morning-recap sub / unsub / time, DM only. The confirm goes to msg.author. */
export async function runRecapCommand(msg: CmuMessage, deps: CmuDeps, cmd: RecapCmd, trace: SafeTrace, end: End): Promise<void> {
  let enabled = true;
  try {
    enabled = deps.cmuSwitch?.isEnabled() !== false;
  } catch {
    enabled = true;
  }
  if (!enabled) {
    end('disabled');
    return;
  }

  let outcome = 'failed';
  let error: string | undefined;
  try {
    await react(msg, CMU_ACK_EMOJI, deps, trace);
    let reply: string;
    if (cmd.kind === 'recap-time-bad') {
      reply = RECAP_BAD_TIME_TEXT;
      outcome = 'recap-time-bad';
    } else {
      const key = await recapKey(msg.author, deps);
      trace.step('key', { ok: key !== undefined });
      reply = RECAP_STORE_FAILURE_TEXT;
      if (key !== undefined) {
        try {
          const subs = deps.recapSubs ?? defaultRecapSubs();
          const existing = subs.get(key);
          const league = deps.groups.get(msg.from) ?? servedLeague(deps.groups) ?? existing?.league;
          if (cmd.kind === 'recap-unsub') {
            subs.delete(key);
            reply = RECAP_OFF_TEXT;
            outcome = 'recap-unsub';
          } else if (league) {
            const time = cmd.kind === 'recap-time' ? cmd.time : existing?.time ?? RECAP_DEFAULT_TIME;
            subs.set(key, { ...existing, time, league });
            reply = recapOnText(time);
            outcome = cmd.kind;
          } else {
            error = 'NoLeague';
          }
        } catch (err) {
          error = describeError(err);
          deps.log(`[cmu] recap store failed in ${msg.from}: ${error}`);
        }
      } else {
        error = 'NoKey';
      }
    }
    try {
      await timed(trace, 'text-dm', () => deps.sendText(msg.author, reply));
    } catch (err) {
      deps.log(`[cmu] recap reply failed in ${msg.from}: ${describeError(err)}`);
    }
  } finally {
    end(outcome, error);
  }
}

/** W1 `mode: "recap-today"`, as companelist answers it. */
export interface RecapToday {
  kind: 'recap-today';
  ymd: string;
  status: string;
  dryRun: boolean;
  sendable: boolean;
  text?: string;
}

function parseRecapToday(data: unknown): RecapToday {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (d.kind !== 'recap-today' || typeof d.ymd !== 'string' || typeof d.status !== 'string' || typeof d.sendable !== 'boolean') {
    throw new Error('BadResponse');
  }
  return {
    kind: 'recap-today',
    ymd: d.ymd,
    status: d.status,
    dryRun: d.dryRun === true,
    sendable: d.sendable,
    ...(typeof d.text === 'string' ? { text: d.text } : {}),
  };
}

/** POST CMU_URL `{mode:"recap-today", league, via:"dm"}`; non-2xx throws CmuHttpError. No requesterKey. */
export function makeFetchRecapToday(o: { fetchFn: typeof fetch; url: string; token: string; now?: () => Date }) {
  return async (league: string): Promise<RecapToday> => {
    const res = await o.fetchFn(o.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${o.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'recap-today', league, via: 'dm', requestAt: (o.now ?? (() => new Date()))().toISOString(), notifyName: '' }),
      signal: AbortSignal.timeout(CMU_COMMAND_TIMEOUT_MS),
    });
    if (!res.ok) throw new CmuHttpError(res.status);
    return parseRecapToday(await res.json());
  };
}

const laFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** LA date and HH:MM for an instant. */
export function laNow(d: Date): { ymd: string; hm: string } {
  const p = Object.fromEntries(laFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}

/** M4: today's recap, live and posted. Anything else stays due. */
function isSendable(r: RecapToday, today: string): r is RecapToday & { text: string } {
  return r.sendable === true && r.ymd === today && r.status === 'sent' && r.dryRun !== true && typeof r.text === 'string' && r.text.trim() !== '';
}

export interface RecapTickDeps {
  subs: RecapSubs;
  fetchRecapToday: (league: string) => Promise<RecapToday>;
  sendText(chatId: string, text: string): Promise<void>;
  /** K3: the owner's switch. Throwing counts as off. */
  isEnabled: () => boolean;
  /** G4: only preview people get recap DMs. Throwing counts as no. */
  isPreviewPerson: (key: string) => boolean;
  now?: () => Date;
  log(line: string): void;
  trace: () => InteractionTrace;
  spacingMs?: number;
  intervalMs?: number;
  /** false: no interval, tests drive tick(). Default true. */
  autoStart?: boolean;
}

const safeBool = (fn: () => boolean): boolean => {
  try {
    return fn() === true;
  } catch {
    return false;
  }
};

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

/** M4-M6: the once-a-minute recap DM tick. */
export function startRecapTick(deps: RecapTickDeps): { stop(): void; tick(): Promise<void> } {
  const spacing = deps.spacingMs ?? RECAP_DM_SPACING_MS;
  const now = deps.now ?? (() => new Date());
  let running = false;
  let lastSendAt = -Infinity;

  /** True only when the DM was actually sent. */
  async function sendOne(key: string, league: string, text: string, ymd: string): Promise<boolean> {
    // M5: mark first, so a crash or a failed send never double-sends.
    const cur = deps.subs.get(key);
    if (!cur || cur.lastSentYmd === ymd) return false;
    try {
      deps.subs.set(key, { ...cur, lastSentYmd: ymd });
    } catch (err) {
      deps.log(`[recap-dm] mark failed: ${describeError(err)}`);
      return false;
    }
    let raw: InteractionTrace = NOOP_TRACE;
    try {
      raw = deps.trace();
    } catch {
      raw = NOOP_TRACE;
    }
    const safe = (fn: () => void) => {
      try {
        fn();
      } catch {
        /* never throw */
      }
    };
    safe(() => raw.start({
      group: '', instance: league, who: '',
      authorKind: key.endsWith('@lid') ? 'lid' : key.endsWith('@c.us') ? 'c.us' : 'other',
      command: 'morning-recap dm',
    }));
    const t0 = performance.now();
    lastSendAt = Date.now();
    try {
      await withDeadline(Promise.resolve().then(() => deps.sendText(key, text)), CMU_FAILURE_DM_TIMEOUT_MS);
      safe(() => raw.step('text-dm', { ok: true, ms: msSince(t0) }));
      safe(() => raw.end('recap-dm'));
      return true;
    } catch (err) {
      const e = describeError(err);
      safe(() => raw.step('text-dm', { ok: false, ms: msSince(t0) }));
      safe(() => raw.end('recap-dm-failed', { error: e }));
      deps.log(`[recap-dm] send failed: ${e}`);
      return false;
    }
  }

  async function tick(): Promise<void> {
    if (running) return;
    if (!safeBool(deps.isEnabled)) return;
    running = true;
    let sent = 0;
    try {
      const { ymd, hm } = laNow(now());
      let all: [string, Sub][];
      try {
        all = deps.subs.all();
      } catch (err) {
        deps.log(`[recap-dm] store read failed: ${describeError(err)}`);
        return;
      }
      const due = all.filter(([k, s]) => s.lastSentYmd !== ymd && hm >= s.time && safeBool(() => deps.isPreviewPerson(k)));
      if (due.length === 0) return;
      const byLeague = new Map<string, string[]>();
      for (const [k, s] of due) byLeague.set(s.league, [...(byLeague.get(s.league) ?? []), k]);

      for (const [league, keys] of byLeague) {
        let recap: RecapToday;
        try {
          recap = await deps.fetchRecapToday(league);
        } catch (err) {
          deps.log(`[recap-dm] recap-today failed: ${describeError(err)}`);
          continue;
        }
        if (!isSendable(recap, ymd)) continue;
        for (const key of keys) {
          const wait = spacing - (Date.now() - lastSendAt);
          if (wait > 0) await sleep(wait);
          if (!safeBool(deps.isEnabled)) return;
          // The never-an-earlier-day guard is absolute: a tick that crossed LA midnight stops here.
          if (laNow(now()).ymd !== ymd) return;
          if (await sendOne(key, league, recap.text, ymd)) sent++;
        }
      }
    } catch (err) {
      deps.log(`[recap-dm] tick failed: ${describeError(err)}`);
    } finally {
      running = false;
      if (sent > 0) deps.log(`[recap-dm] tick: ${sent} sent`);
    }
  }

  const timer = deps.autoStart === false ? undefined : setInterval(() => void tick(), deps.intervalMs ?? RECAP_TICK_MS);
  timer?.unref?.();
  return {
    stop: () => {
      if (timer) clearInterval(timer);
    },
    tick,
  };
}
