import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

// Append-only JSONL log of bot interactions (one file per America/Los_Angeles
// day, <date>.jsonl, plus img/<id>.jpg thumbnails). Each interaction writes a
// start line, step lines and an end line sharing one id. Read-only consumers
// (companelist) tail these files.
//
// No message text belongs here. The writer serializes whatever fields it is
// given; the 512-char value cap and 8 KB line cap are only a safety net.
// Nothing in this module may throw into callers.

export type InteractionKind = 'cmu' | 'song' | 'prompt';
type Scalar = string | number | boolean | string[] | null | undefined;

export interface InteractionTrace {
  readonly id: string;
  start(f: { group: string; groupName?: string; instance?: string; who: string; authorKind: 'lid' | 'c.us' | 'other'; command: string }): void;
  step(step: string, f: { ok: boolean; ms?: number } & Record<string, Scalar>): void;
  end(outcome: string, f?: { error?: string }): void;
  /** Absolute path for this interaction's thumbnail; creates img/ if needed. */
  thumbPath(): string;
}

export const RETENTION_DAYS = 30;
const MAX_VALUE_CHARS = 512;
const MAX_ARRAY_ITEMS = 20;
const MAX_LINE_BYTES = 8 * 1024;
const ERROR_LOG_INTERVAL_MS = 60_000;
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const IMG_FILE = /^[0-9a-f]{12}\.jpg$/;
const DAY_MS = 86_400_000;

const laFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
const laDate = (d: Date): string => laFmt.format(d);

function clampValue(v: unknown): unknown {
  if (typeof v === 'string') return v.length > MAX_VALUE_CHARS ? v.slice(0, MAX_VALUE_CHARS) : v;
  if (Array.isArray(v)) return v.slice(0, MAX_ARRAY_ITEMS).map((x) => clampValue(x));
  return v;
}

/** Serialize, dropping the largest optional fields until the line fits 8 KB. */
function serialize(core: Record<string, unknown>, extra: Record<string, unknown>): string {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) fields[k] = clampValue(v);
  const build = () => JSON.stringify({ ...fields, ...core });
  let line = build();
  while (Buffer.byteLength(line) + 1 > MAX_LINE_BYTES && Object.keys(fields).length > 0) {
    const biggest = Object.keys(fields).reduce((a, b) => (JSON.stringify(fields[b]).length > JSON.stringify(fields[a]).length ? b : a));
    delete fields[biggest];
    line = build();
  }
  return line;
}

export const NOOP_TRACE: InteractionTrace = {
  id: '000000000000',
  start() {},
  step() {},
  end() {},
  thumbPath: () => '',
};

export function openInteractionLog(o: { dir: string; now?: () => Date; log?: (l: string) => void }) {
  const now = o.now ?? (() => new Date());
  const logFn = o.log ?? ((l: string) => console.error(l));
  const imgDir = join(o.dir, 'img');
  let lastErrorAt = -Infinity;
  let lastPruneDay = '';

  function reportError(what: string, e: unknown): void {
    try {
      const t = now().getTime();
      if (t - lastErrorAt < ERROR_LOG_INTERVAL_MS) return;
      lastErrorAt = t;
      logFn(`[interactionLog] ${what}: ${e instanceof Error ? e.message : String(e)}`);
    } catch {
      /* never throw */
    }
  }

  function ensureDir(dir: string): void {
    if (existsSync(dir)) return;
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    chmodSync(dir, 0o755);
  }

  function append(file: string, line: string): void {
    try {
      ensureDir(o.dir);
      const created = !existsSync(file);
      appendFileSync(file, line + '\n', { mode: 0o644 });
      // The umask can narrow the create mode; readers run as another user.
      if (created) {
        try { chmodSync(file, 0o644); } catch (e) { reportError('chmod failed', e); }
      }
    } catch (e) {
      reportError('write failed', e);
    }
  }

  function prune(): { files: number; images: number } {
    const res = { files: 0, images: 0 };
    try {
      const cutoff = laDate(new Date(now().getTime() - RETENTION_DAYS * DAY_MS));
      if (existsSync(o.dir)) {
        for (const name of readdirSync(o.dir)) {
          const m = DAY_FILE.exec(name);
          if (m && m[1] < cutoff) {
            try { unlinkSync(join(o.dir, name)); res.files++; } catch (e) { reportError('prune failed', e); }
          }
        }
      }
      if (existsSync(imgDir)) {
        for (const name of readdirSync(imgDir)) {
          if (!IMG_FILE.test(name)) continue;
          try {
            const p = join(imgDir, name);
            if (laDate(statSync(p).mtime) < cutoff) { unlinkSync(p); res.images++; }
          } catch (e) { reportError('prune failed', e); }
        }
      }
    } catch (e) {
      reportError('prune failed', e);
    }
    return res;
  }

  function begin(kind: InteractionKind): InteractionTrace {
    try {
      const startMs = now().getTime();
      const day = laDate(new Date(startMs));
      if (day !== lastPruneDay) {
        lastPruneDay = day;
        prune();
      }
      const id = randomBytes(6).toString('hex');
      const file = join(o.dir, `${day}.jsonl`);
      const emit = (ev: 'start' | 'step' | 'end', extra: Record<string, unknown>) => {
        try {
          const at = now();
          append(file, serialize({ v: 1, id, kind, at: at.toISOString(), ev }, { ...extra, ...(ev === 'start' ? {} : { t: at.getTime() - startMs }) }));
        } catch (e) {
          reportError('emit failed', e);
        }
      };
      return {
        id,
        start: (f) => emit('start', { ...f }),
        step: (step, f) => emit('step', { ...f, step }),
        end: (outcome, f) => {
          const totalMs = now().getTime() - startMs;
          emit('end', { outcome, totalMs, error: f?.error });
        },
        thumbPath: () => {
          try { ensureDir(o.dir); ensureDir(imgDir); } catch (e) { reportError('mkdir failed', e); }
          return join(imgDir, `${id}.jpg`);
        },
      };
    } catch (e) {
      reportError('begin failed', e);
      return NOOP_TRACE;
    }
  }

  return { begin, prune };
}
