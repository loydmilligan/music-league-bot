/**
 * Pure helpers for the deadline-auto-fill flow. Kept out of the route handler
 * so they're trivially unit-testable and reusable.
 */

export interface AutoFillInput {
  daysToSubmit: number;
  daysToVote: number;
  startDate: string; // ISO date, e.g. "2026-05-20" or "2026-05-20T00:00"
}

export interface ComputedDeadline {
  submissionDeadline: string; // "YYYY-MM-DDT00:00" (compatible with datetime-local)
  votingDeadline: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function addDaysUTC(iso: string, days: number): Date {
  const base = new Date(iso);
  if (Number.isNaN(base.getTime())) throw new Error(`invalid startDate: ${iso}`);
  return new Date(base.getTime() + days * MS_PER_DAY);
}

function fmt(d: Date): string {
  // YYYY-MM-DDT00:00 — what <input type="datetime-local"> expects.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * Walk N rounds, each starting where the previous one ended (no buffer day —
 * round N+1's submission window opens the moment round N's voting closes,
 * matching how a Music League season runs back-to-back).
 */
export function computeDeadlines(roundCount: number, input: AutoFillInput): ComputedDeadline[] {
  if (!Number.isFinite(input.daysToSubmit) || input.daysToSubmit <= 0) {
    throw new Error('daysToSubmit must be > 0');
  }
  if (!Number.isFinite(input.daysToVote) || input.daysToVote <= 0) {
    throw new Error('daysToVote must be > 0');
  }
  const out: ComputedDeadline[] = [];
  let cursor = new Date(input.startDate);
  if (Number.isNaN(cursor.getTime())) throw new Error(`invalid startDate: ${input.startDate}`);
  for (let i = 0; i < roundCount; i++) {
    const submission = addDaysUTC(cursor.toISOString(), input.daysToSubmit);
    const voting = addDaysUTC(submission.toISOString(), input.daysToVote);
    out.push({ submissionDeadline: fmt(submission), votingDeadline: fmt(voting) });
    cursor = voting;
  }
  return out;
}
