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

export function resolveStart(r: RoundWindowInput, nowIso?: string): string {
  if (r.votingStartedAt) return r.votingStartedAt;
  // submission_deadline is only a stand-in for "when voting started" once it has
  // passed. A round still taking submissions has one in the future — using it
  // would start the window ahead of now and hide the round's live chat.
  if (r.submissionDeadline && (!nowIso || Date.parse(r.submissionDeadline) <= Date.parse(nowIso))) {
    return r.submissionDeadline;
  }
  return r.createdAt;
}

export function buildRoundWindows(rounds: RoundWindowInput[], nowIso: string): RoundWindow[] {
  const sorted = [...rounds].sort(
    (a, b) => Date.parse(resolveStart(a, nowIso)) - Date.parse(resolveStart(b, nowIso)),
  );
  // Each round's END from the best available signal.
  const ends = sorted.map((r, i) => {
    const next = sorted[i + 1];
    return r.votingEndedAt ?? r.votingDeadline ?? (next ? resolveStart(next, nowIso) : nowIso);
  });
  return sorted.map((r, i) => {
    // Chain each round's START to the previous round's END so windows are
    // contiguous and a round owns its whole active span — including the
    // submission phase, which falls between the prior round's voting-end and
    // this round's voting-start. Without this, that submission-phase chat lands
    // in a gap between windows and shows under no round. The first round keeps
    // its own resolved start.
    const fromIso = i === 0 ? resolveStart(r, nowIso) : ends[i - 1];
    const toIso = ends[i];
    // The last round is live once it has actually opened and until it ends —
    // either the poller recorded a voting end, or its deadline passed. Leagues
    // pre-schedule whole slates, so the last round is often months out: it has
    // a future deadline but its window has not started, which is scheduled, not
    // live.
    const isLive =
      !sorted[i + 1] &&
      !r.votingEndedAt &&
      Date.parse(fromIso) <= Date.parse(nowIso) &&
      (!r.votingDeadline || Date.parse(r.votingDeadline) > Date.parse(nowIso));
    return { id: r.id, name: r.name, seasonNumber: r.seasonNumber, fromIso, toIso, isLive };
  });
}
