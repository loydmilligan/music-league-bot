import { describe, it, expect } from 'vitest';
import { seedRound } from './fixtures.js';
import { setMeCompetitorId } from './meCompetitor.js';
import { setGutPick, lockGut } from './state.js';
import { setCandidate } from './candidates.js';
import { buildWorkspaceData } from './workspaceData.js';

function setup(opts = {}) {
  const s = seedRound({ songCount: 4, playerCount: 4, mineIndex: 0, ...opts });
  setMeCompetitorId(s.db, 'boarz-ii-men', 1);
  return s;
}

describe('workspace payload', () => {
  it('returns null when the me-competitor is unset', () => {
    const { db } = seedRound();
    expect(buildWorkspaceData(db, 1)).toBeNull();
  });

  it('excludes my own song and me from the working set', () => {
    const { db, songs, players } = setup();
    const w = buildWorkspaceData(db, 1)!;
    expect(w.songs.map((s) => s.spotifyUri)).toEqual([songs[1], songs[2], songs[3]]);
    expect(w.roster.map((p) => p.id)).toEqual([players[1], players[2], players[3]]);
  });

  it('carries song text and roster names for display', () => {
    const { db } = setup();
    const w = buildWorkspaceData(db, 1)!;
    expect(w.songs[0].title).toBe('Song 1');
    expect(w.roster[0].name).toBe('P2');
  });

  it('reflects gut picks and validation as they are made', () => {
    const { db, songs, players } = setup();
    const before = buildWorkspaceData(db, 1)!;
    expect(before.validation.ok).toBe(false);
    expect(before.songs.every((s) => s.gutPickPlayerId === null)).toBe(true);

    setGutPick(db, 1, songs[1], players[1]);
    setGutPick(db, 1, songs[2], players[2]);
    setGutPick(db, 1, songs[3], players[3]);

    const after = buildWorkspaceData(db, 1)!;
    expect(after.validation.ok).toBe(true);
    expect(after.songs.find((s) => s.spotifyUri === songs[1])!.gutPickPlayerId).toBe(players[1]);
  });

  it('surfaces the lock so the UI can disable editing', () => {
    const { db } = setup();
    expect(buildWorkspaceData(db, 1)!.gutLockedAt).toBeNull();
    lockGut(db, 1, '2026-02-01T00:00:00Z');
    const w = buildWorkspaceData(db, 1)!;
    expect(w.gutLockedAt).toBe('2026-02-01T00:00:00Z');
    expect(w.phase).toBe('fetch');
  });

  it('hides a comment that was not visible to voters', () => {
    const { db, songs } = setup();
    db.prepare('UPDATE ml_submissions SET comment = ? WHERE spotify_uri = ?').run('shown', songs[1]);
    db.prepare('UPDATE ml_submissions SET comment = ?, visible_to_voters = 0 WHERE spotify_uri = ?')
      .run('hidden', songs[2]);
    const w = buildWorkspaceData(db, 1)!;
    expect(w.songs.find((s) => s.spotifyUri === songs[1])!.comment).toBe('shown');
    expect(w.songs.find((s) => s.spotifyUri === songs[2])!.comment).toBeNull();
  });
});

describe('WorkspaceData.mine', () => {
  it('is null when no song is marked', () => {
    const { db } = seedRound({ songCount: 4, playerCount: 4, mineIndex: null });
    setMeCompetitorId(db, 'boarz-ii-men', 1);
    expect(buildWorkspaceData(db, 1)!.mine).toBeNull();
  });

  // DISCRIMINATING: asserts BOTH that the marked song is reported in `mine`
  // AND that it is absent from `songs`. An implementation that just appends
  // the marked song back into `songs` would fail the second assertion.
  it('reports the marked song, and that song is not in the slate', () => {
    const { db, songs } = seedRound({ songCount: 4, playerCount: 4, mineIndex: 2 });
    setMeCompetitorId(db, 'boarz-ii-men', 1);
    const data = buildWorkspaceData(db, 1)!;
    expect(data.mine).toEqual({
      spotifyUri: songs[2], title: 'Song 2', artists: 'Artist 2',
    });
    expect(data.songs.map((s) => s.spotifyUri)).not.toContain(songs[2]);
    expect(data.songs).toHaveLength(3);
  });
});

describe('WorkspaceData candidates + availability', () => {
  it('attaches each song its own candidates and no others', () => {
    const { db, songs, players } = seedRound({ songCount: 3, playerCount: 4, mineIndex: null });
    setMeCompetitorId(db, 'boarz-ii-men', players[0]);
    setCandidate(db, 1, songs[1], players[1], { status: 'prime', certainty: 70 });
    setCandidate(db, 1, songs[2], players[2], { status: 'possible' });

    const data = buildWorkspaceData(db, 1)!;
    const bySong = new Map(data.songs.map((s) => [s.spotifyUri, s.candidates]));
    expect(bySong.get(songs[0])).toEqual([]);
    expect(bySong.get(songs[1])!.map((c) => c.playerId)).toEqual([players[1]]);
    expect(bySong.get(songs[2])!.map((c) => c.playerId)).toEqual([players[2]]);
    expect(bySong.get(songs[1])![0]).toMatchObject({ status: 'prime', certainty: 70 });
  });

  // DISCRIMINATING: locked outranks prime. An implementation that returns raw
  // per-song status instead of playerAvailability's grid-wide answer would
  // report this player as 'dimmed' (their status on song 1) and fail.
  it('exposes grid-wide availability, where locked outranks prime', () => {
    const { db, songs, players } = seedRound({ songCount: 3, playerCount: 4, mineIndex: null });
    setMeCompetitorId(db, 'boarz-ii-men', players[0]);
    setCandidate(db, 1, songs[1], players[1], { status: 'prime' });
    setCandidate(db, 1, songs[2], players[1], { status: 'locked' });

    const data = buildWorkspaceData(db, 1)!;
    expect(data.availability[players[1]]).toBe('taken');
    expect(data.availability[players[2]]).toBe('free');
  });

  it('serialises availability as a plain object, not a Map', () => {
    const { db, players } = seedRound({ songCount: 2, playerCount: 3, mineIndex: null });
    setMeCompetitorId(db, 'boarz-ii-men', players[0]);
    const data = buildWorkspaceData(db, 1)!;
    expect(data.availability).not.toBeInstanceOf(Map);
    expect(JSON.parse(JSON.stringify(data.availability))).toEqual(data.availability);
  });
});
