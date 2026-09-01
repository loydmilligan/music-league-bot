import type { Availability, Candidate, CandidateStatus } from './candidates.js';
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

/** 1-based playlist position — the `#n` every reference on the board uses. */
function songNumber(data: WorkspaceData, spotifyUri: string): number {
  return data.songs.findIndex((s) => s.spotifyUri === spotifyUri) + 1;
}

/**
 * Where a player is committed anywhere on the board, for the ledger's
 * roster-wide summary — no "current song" to skip, unlike
 * `commitmentElsewhere`.
 *
 * `data.availability` is still the authority on WHETHER a player is
 * committed (a 'free' verdict short-circuits without scanning, same as
 * `commitmentElsewhere`); this only LOCATES the commitment the server has
 * already asserted. Locked outranks prime regardless of scan order.
 */
export function ledgerEntry(
  data: WorkspaceData,
  playerId: number,
): { kind: 'free' | 'dimmed' | 'taken'; at: number | null } {
  const availability = data.availability[playerId] ?? 'free';
  if (availability === 'free') return { kind: 'free', at: null };

  let dimmed: number | null = null;
  for (const song of data.songs) {
    for (const c of song.candidates) {
      if (c.playerId !== playerId) continue;
      if (c.status === 'locked') return { kind: 'taken', at: songNumber(data, song.spotifyUri) };
      if (c.status === 'prime' && dimmed === null) dimmed = songNumber(data, song.spotifyUri);
    }
  }
  return dimmed === null ? { kind: 'free', at: null } : { kind: 'dimmed', at: dimmed };
}

/**
 * Where a player is committed OTHER than on the song being rendered, or null.
 *
 * Three interacting rules, which is why this is here and not in the component:
 *  1. The rendered song is skipped, so a row is never reported as committed on
 *     account of itself.
 *  2. `locked` outranks `prime` regardless of scan order — a lock returns
 *     immediately, a prime is only remembered and returned if no lock is found.
 *  3. `data.availability` — the server's verdict from `playerAvailability` — is
 *     the authority on WHETHER a player is committed. A player the server calls
 *     'free' returns null without scanning; this function only ever LOCATES a
 *     commitment the server has already asserted, it never recomputes one.
 *
 * Pure over the payload; needs no roster, so it does not reintroduce the name
 * lookup that rollup() is deliberately kept free of.
 */
export function commitmentElsewhere(
  data: WorkspaceData,
  playerId: number,
  spotifyUri: string,
): { kind: 'dimmed' | 'taken'; at: number } | null {
  if ((data.availability[playerId] ?? 'free') === 'free') return null;

  let dimmed: number | null = null;
  for (const song of data.songs) {
    if (song.spotifyUri === spotifyUri) continue;
    for (const c of song.candidates) {
      if (c.playerId !== playerId) continue;
      if (c.status === 'locked') return { kind: 'taken', at: songNumber(data, song.spotifyUri) };
      if (c.status === 'prime' && dimmed === null) dimmed = songNumber(data, song.spotifyUri);
    }
  }
  return dimmed === null ? null : { kind: 'dimmed', at: dimmed };
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

/**
 * Which players' availability actually CHANGED between two server verdicts.
 *
 * The propagation flash (README §"Availability propagation") is only honest if
 * it marks the rows that genuinely moved: a reload replaces the whole payload,
 * so "every id in the new map" or "every id in either map" would flash the
 * entire board on every write and say nothing.
 *
 * An id present in one map and absent from the other is compared as 'free' on
 * the missing side — the same `?? 'free'` reading the rest of this module and
 * the components already use for `data.availability`. So a player who appears
 * in the payload for the first time as 'free' has not changed, while one who
 * appears as 'taken' has.
 *
 * Returns ascending ids; pure, mutates neither argument.
 */
export function changedAvailability(
  before: Record<number, Availability>,
  after: Record<number, Availability>,
): number[] {
  const ids = new Set<number>();
  for (const k of Object.keys(before)) ids.add(Number(k));
  for (const k of Object.keys(after)) ids.add(Number(k));

  const changed: number[] = [];
  for (const id of ids) {
    if ((before[id] ?? 'free') !== (after[id] ?? 'free')) changed.push(id);
  }
  return changed.sort((a, b) => a - b);
}
