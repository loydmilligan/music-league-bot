/**
 * Pure view helpers for the email-poller status panel — formatting only, no I/O.
 */

export interface PollStatus {
  checkedAt: string;
  ok: boolean;
  fetched: number;
  events: number;
  error: string | null;
}

export type StatusTone = 'ok' | 'error' | 'idle';

/** The large status line: connected / failed / nothing-yet. */
export function statusLine(poll: PollStatus | null, nowMs: number): { tone: StatusTone; text: string } {
  if (!poll) return { tone: 'idle', text: 'No poll recorded yet' };
  const rel = relativeTime(poll.checkedAt, nowMs);
  if (!poll.ok) {
    return { tone: 'error', text: `Last poll failed · ${poll.error ?? 'unknown error'} · ${rel}` };
  }
  const evt = poll.events > 0 ? ` · ${poll.events} round event${poll.events === 1 ? '' : 's'}` : '';
  return { tone: 'ok', text: `Connected · ${poll.fetched} message${poll.fetched === 1 ? '' : 's'}${evt} · ${rel}` };
}

/** Glyph + tone for a per-email action outcome row. */
export function outcomeGlyph(actionStatus: string | null): { glyph: string; tone: string } {
  switch (actionStatus) {
    case 'recorded':
      return { glyph: '✓', tone: 'ok' };
    case 'unmapped':
      return { glyph: '⚠', tone: 'warn' };
    case 'error':
      return { glyph: '✕', tone: 'error' };
    default:
      return { glyph: '·', tone: 'muted' }; // archived / null
  }
}

/** Compact "Xs/m/h/d ago" relative time. */
export function relativeTime(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (isNaN(t)) return '';
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
