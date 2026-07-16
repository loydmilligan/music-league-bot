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

    // Live is the round being played right now: the one whose window contains
    // `now`. Not "the last round" — leagues pre-schedule whole slates, so the
    // last round is often months out. A window that has not opened is
    // scheduled; one that has closed is history; a season between rounds or
    // already finished has no live round at all.
    //
    // Windows are contiguous, so treating them as half-open [from, to) means at
    // most one can contain `now`.
    const now = Date.parse(nowIso);
    const started = Date.parse(fromIso) <= now;
    const containsNow = started && now < Date.parse(toIso);
    // The final round has no end signal yet, so its window is capped at `now`
    // and can never "contain" it — but it is the one running. Guarded by
    // `started` so a scheduled round can never qualify.
    const openEnded = started && !sorted[i + 1] && !r.votingEndedAt && !r.votingDeadline;
    const isLive = containsNow || openEnded;
    return { id: r.id, name: r.name, seasonNumber: r.seasonNumber, fromIso, toIso, isLive };
  });
}
