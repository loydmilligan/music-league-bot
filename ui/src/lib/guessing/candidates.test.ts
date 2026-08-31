import { describe, it, expect } from 'vitest';
import { seedRound } from './fixtures.js';
import {
  setCandidate, removeCandidate, candidatesForSong, playerAvailability,
} from './candidates.js';

const ME = 1;

describe('candidate grid', () => {
  it('stores a pencil mark with certainty and notes', () => {
    const { db, roundId, songs, players } = seedRound();
    setCandidate(db, roundId, songs[1], players[2], {
      status: 'possible', certainty: 40, notes: 'feels like him', factors: 'genre',
    });
    const [c] = candidatesForSong(db, roundId, songs[1]);
    expect(c).toMatchObject({ playerId: players[2], status: 'possible', certainty: 40 });
  });

  it('prime dims that player elsewhere but does not remove them', () => {
    const { db, roundId, songs, players } = seedRound();
    setCandidate(db, roundId, songs[1], players[2], { status: 'prime' });
    const avail = playerAvailability(db, roundId, ME);
    expect(avail.get(players[2])).toBe('dimmed');
  });

  it('locked marks that player taken', () => {
    const { db, roundId, songs, players } = seedRound();
    setCandidate(db, roundId, songs[1], players[2], { status: 'locked' });
    expect(playerAvailability(db, roundId, ME).get(players[2])).toBe('taken');
  });

  it('locked outranks prime when a player is both somewhere', () => {
    const { db, roundId, songs, players } = seedRound();
    setCandidate(db, roundId, songs[1], players[2], { status: 'prime' });
    setCandidate(db, roundId, songs[2], players[2], { status: 'locked' });
    expect(playerAvailability(db, roundId, ME).get(players[2])).toBe('taken');
  });

  it('demoting a lock frees the player again', () => {
    const { db, roundId, songs, players } = seedRound();
    setCandidate(db, roundId, songs[1], players[2], { status: 'locked' });
    setCandidate(db, roundId, songs[1], players[2], { status: 'possible' });
    expect(playerAvailability(db, roundId, ME).get(players[2])).toBe('free');
  });

  it('removing a candidate frees the player', () => {
    const { db, roundId, songs, players } = seedRound();
    setCandidate(db, roundId, songs[1], players[2], { status: 'locked' });
    removeCandidate(db, roundId, songs[1], players[2]);
    expect(candidatesForSong(db, roundId, songs[1])).toEqual([]);
    expect(playerAvailability(db, roundId, ME).get(players[2])).toBe('free');
  });

  it('patches only the fields given', () => {
    const { db, roundId, songs, players } = seedRound();
    setCandidate(db, roundId, songs[1], players[2], { status: 'possible', certainty: 30 });
    setCandidate(db, roundId, songs[1], players[2], { status: 'prime' });
    const [c] = candidatesForSong(db, roundId, songs[1]);
    expect(c.certainty).toBe(30);
    expect(c.status).toBe('prime');
  });
});
