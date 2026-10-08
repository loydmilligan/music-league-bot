/** Quiet hours 11pm–8am America/Los_Angeles. Sends that land inside hold until 8am. */

export const TIME_ZONE = 'America/Los_Angeles';
export const QUIET_START_HOUR = 23;
export const QUIET_END_HOUR = 8;

function pacificParts(ms: number): { year: string; month: string; day: string; hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  return Object.fromEntries(parts.map((p) => [p.type, p.value])) as {
    year: string; month: string; day: string; hour: string; minute: string;
  };
}

export function pacificHour(ms: number): number {
  return Number(pacificParts(ms).hour);
}

export function inQuietHours(ms: number): boolean {
  const hour = pacificHour(ms);
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

/** If `ms` is in quiet hours, push it to the next 08:00 PT. */
export function holdUntilQuietEnds(ms: number): number {
  if (!inQuietHours(ms)) return ms;
  const start = ms;
  for (let t = ms; t <= start + 12 * 3_600_000; t += 60_000) {
    const p = pacificParts(t);
    if (p.hour === '08' && p.minute === '00') return t;
  }
  return ms;
}
