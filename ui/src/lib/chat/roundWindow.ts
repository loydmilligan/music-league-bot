/**
 * Resolve each round's chat time-window from the best available real boundary.
 *
 * Rounds are windowed on their actual voting span when known (from the Music
 * League email poller), so chat lands in the right round even when `created_at`
 * is mlbot's bulk-import time. Priority for a round's start:
 *   voting_started_at → submission_deadline → created_at
 * and for its end:
 *   voting_ended_at → voting_deadline → next round's start → now
 */

export interface RoundWindowInput {
  id: number;
  name: string;
  seasonNumber: number;
  votingStartedAt: string | null;
  votingEndedAt: string | null;
  submissionDeadline: string | null;
  votingDeadline: string | null;
  createdAt: string;
}

export interface RoundWindow {
  id: number;
  name: string;
  seasonNumber: number;
  fromIso: string;
  toIso: string;
  isLive: boolean;
}

export function resolveStart(r: RoundWindowInput): string {
  return r.votingStartedAt ?? r.submissionDeadline ?? r.createdAt;
}

export function buildRoundWindows(rounds: RoundWindowInput[], nowIso: string): RoundWindow[] {
  const sorted = [...rounds].sort((a, b) => Date.parse(resolveStart(a)) - Date.parse(resolveStart(b)));
  return sorted.map((r, i) => {
    const next = sorted[i + 1];
    const fromIso = resolveStart(r);
    const toIso = r.votingEndedAt ?? r.votingDeadline ?? (next ? resolveStart(next) : nowIso);
    const isLive = !r.votingEndedAt && !r.votingDeadline && !next;
    return { id: r.id, name: r.name, seasonNumber: r.seasonNumber, fromIso, toIso, isLive };
  });
}
