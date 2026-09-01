import type { Candidate, CandidateStatus } from './candidates.js';
import type { WorkspaceData } from './workspaceData.js';

const STATUS_ORDER: Record<CandidateStatus, number> = {
  locked: 0,
  prime: 1,
  possible: 2,
};

/**
 * Row order for the candidate grid: locked first, then prime, then possible;
 * within a status, certainty descending with nulls last. Pure — returns a new
 * array, never mutates the input.
 */
export function sortCandidates(cs: Candidate[]): Candidate[] {
  return [...cs].sort((a, b) => {
    const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (statusDiff !== 0) return statusDiff;

    if (a.certainty === null && b.certainty === null) return 0;
    if (a.certainty === null) return 1;
    if (b.certainty === null) return -1;
    return b.certainty - a.certainty;
  });
}

/**
 * playerId -> the spotifyUris where they are locked, for players locked on
 * two or more songs at once (a conflict). Players locked on at most one song
 * are not conflicted and are omitted.
 */
export function findConflicts(data: WorkspaceData): Map<number, string[]> {
  const lockedUris = new Map<number, string[]>();
  for (const song of data.songs) {
    for (const cand of song.candidates) {
      if (cand.status !== 'locked') continue;
      const uris = lockedUris.get(cand.playerId) ?? [];
      uris.push(song.spotifyUri);
      lockedUris.set(cand.playerId, uris);
    }
  }

  const conflicts = new Map<number, string[]>();
  for (const [playerId, uris] of lockedUris) {
    if (uris.length >= 2) conflicts.set(playerId, uris);
  }
  return conflicts;
}

/** One-line status roll-up for the board header. */
export function rollup(data: WorkspaceData): { text: string; tone: 'progress' | 'conflict' | 'settled' } {
  const total = data.songs.length;
  const lockedCount = data.songs.filter((s) => s.candidates.some((c) => c.status === 'locked')).length;

  const conflicts = findConflicts(data);
  if (conflicts.size > 0) {
    const [, uris] = [...conflicts.entries()][0];
    const songRefs = uris
      .map((uri) => {
        const idx = data.songs.findIndex((s) => s.spotifyUri === uri);
        return `#${idx + 1}`;
      })
      .join(' & ');
    return {
      text: `${conflicts.size} conflict${conflicts.size === 1 ? '' : 's'} · locked on ${songRefs} — resolve before submit`,
      tone: 'conflict',
    };
  }

  if (lockedCount === total && total > 0) {
    return {
      text: `${lockedCount} of ${total} locked · no conflicts · ready to submit`,
      tone: 'settled',
    };
  }

  const noCandidateSongs = data.songs
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.candidates.length === 0);
  const noCandidatePart =
    noCandidateSongs.length > 0
      ? ` · ${noCandidateSongs.length} song${noCandidateSongs.length === 1 ? '' : 's'} no candidate (${noCandidateSongs
          .map(({ i }) => `#${i + 1}`)
          .join(', ')})`
      : '';

  return {
    text: `${lockedCount} of ${total} locked${noCandidatePart}`,
    tone: 'progress',
  };
}
