import { describe, it, expect } from 'vitest';
import { seedRound } from './fixtures.js';
import { setGutPick } from './state.js';
import { eligibleSongs, eligiblePlayers, validateGutSlate } from './assignment.js';

const ME = 1;

describe('assignment rules', () => {
  it('excludes my own song and me from the pool', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 4, playerCount: 4, mineIndex: 0 });
    expect(eligibleSongs(db, roundId)).toEqual([songs[1], songs[2], songs[3]]);
    expect(eligiblePlayers(db, roundId, ME)).toEqual([players[1], players[2], players[3]]);
  });

  it('is incomplete until every eligible song has a pick', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 4, playerCount: 4 });
    setGutPick(db, roundId, songs[1], players[1]);
    const v = validateGutSlate(db, roundId, ME);
    expect(v.ok).toBe(false);
    expect(v.missingSongs).toEqual([songs[2], songs[3]]);
  });

  it('reports duplicates but still lets them be stored while editing', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 4, playerCount: 4 });
    setGutPick(db, roundId, songs[1], players[1]);
    setGutPick(db, roundId, songs[2], players[1]); // same person twice — allowed in-flight
    setGutPick(db, roundId, songs[3], players[3]);
    const v = validateGutSlate(db, roundId, ME);
    expect(v.ok).toBe(false);
    expect(v.duplicatePlayerIds).toEqual([players[1]]);
  });

  it('passes when every song has a pick and nobody repeats', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 4, playerCount: 4 });
    setGutPick(db, roundId, songs[1], players[1]);
    setGutPick(db, roundId, songs[2], players[2]);
    setGutPick(db, roundId, songs[3], players[3]);
    expect(validateGutSlate(db, roundId, ME)).toEqual({
      ok: true, missingSongs: [], duplicatePlayerIds: [],
    });
  });

  // spec §6: the rule that would otherwise deadlock 2 of the last 10 real rounds
  it('is satisfiable when a player skipped the round (more players than songs)', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 3, playerCount: 4 });
    setGutPick(db, roundId, songs[1], players[1]);
    setGutPick(db, roundId, songs[2], players[2]);
    // players[3] submitted nothing and is simply left over
    expect(validateGutSlate(db, roundId, ME).ok).toBe(true);
  });
});
