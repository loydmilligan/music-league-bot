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
  // Each round's END from the best available signal.
  const ends = sorted.map((r, i) => {
    const next = sorted[i + 1];
    return r.votingEndedAt ?? r.votingDeadline ?? (next ? resolveStart(next) : nowIso);
  });
  return sorted.map((r, i) => {
    // Chain each round's START to the previous round's END so windows are
    // contiguous and a round owns its whole active span — including the
    // submission phase, which falls between the prior round's voting-end and
    // this round's voting-start. Without this, that submission-phase chat lands
    // in a gap between windows and shows under no round. The first round keeps
    // its own resolved start.
    const fromIso = i === 0 ? resolveStart(r) : ends[i - 1];
    const toIso = ends[i];
    const isLive = !r.votingEndedAt && !r.votingDeadline && !sorted[i + 1];
    return { id: r.id, name: r.name, seasonNumber: r.seasonNumber, fromIso, toIso, isLive };
  });
}
