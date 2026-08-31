import { describe, it, expect } from 'vitest';
import { seedRound } from './fixtures.js';
import { getRoundState, setGutPick, lockGut } from './state.js';

describe('guess round state', () => {
  it('creates a default state row on first read', () => {
    const { db, roundId } = seedRound();
    const s = getRoundState(db, roundId);
    expect(s.phase).toBe('gut');
    expect(s.gutLockedAt).toBeNull();
    expect(s.syncState).toBe('unverified');
  });

  it('records gut picks before the lock', () => {
    const { db, roundId, songs, players } = seedRound();
    setGutPick(db, roundId, songs[1], players[1]);
    const row = db.prepare(
      'SELECT gut_pick_player_id AS p FROM guess_picks WHERE round_id=? AND spotify_uri=?',
    ).get(roundId, songs[1]) as { p: number };
    expect(row.p).toBe(players[1]);
  });

  it('refuses to change a gut pick after the lock', () => {
    const { db, roundId, songs, players } = seedRound();
    setGutPick(db, roundId, songs[1], players[1]);
    lockGut(db, roundId, '2026-01-02T00:00:00Z');

    expect(() => setGutPick(db, roundId, songs[1], players[2])).toThrow(/locked/i);

    const row = db.prepare(
      'SELECT gut_pick_player_id AS p FROM guess_picks WHERE round_id=? AND spotify_uri=?',
    ).get(roundId, songs[1]) as { p: number };
    expect(row.p).toBe(players[1]);
  });

  it('lockGut advances the phase and stamps the time', () => {
    const { db, roundId } = seedRound();
    lockGut(db, roundId, '2026-01-02T00:00:00Z');
    const s = getRoundState(db, roundId);
    expect(s.gutLockedAt).toBe('2026-01-02T00:00:00Z');
    expect(s.phase).toBe('fetch');
  });

  it('a fresh round defaults to live mode with no as_of', () => {
    const { db, roundId } = seedRound();
    const s = getRoundState(db, roundId);
    expect(s.mode).toBe('live');
    expect(s.asOf).toBeNull();
  });

  it('reports rehearsal mode and as_of once the row is set', () => {
    const { db, roundId } = seedRound();
    getRoundState(db, roundId); // ensure the row exists
    db.prepare(
      `UPDATE guess_round_state SET mode='rehearsal', as_of='2026-08-20T06:30:00Z' WHERE round_id=?`,
    ).run(roundId);
    const s = getRoundState(db, roundId);
    expect(s.mode).toBe('rehearsal');
    expect(s.asOf).toBe('2026-08-20T06:30:00Z');
  });
});
