import { describe, it, expect } from 'vitest';
import { seedRound } from './fixtures.js';
import { verifyRoundSync } from './sync.js';
import { getRoundState } from './state.js';
import { startRehearsal, archiveRehearsal } from './rehearsal.js';

const ME = 1;

function storeComment(db: any, uri: string, pid: number, comment: string) {
  db.prepare(
    `INSERT INTO guess_picks (round_id, spotify_uri, final_pick_player_id, comment, updated_at)
     VALUES (1, ?, ?, ?, '2026-01-01T00:00:00Z')`,
  ).run(uri, pid, comment);
}
function postedVote(db: any, uri: string, comment: string) {
  db.prepare(
    `INSERT INTO votes (round_id, voter_id, spotify_uri, points, comment, created_at)
     VALUES (1, ?, ?, 1, ?, '2026-01-02T00:00:00Z')`,
  ).run(ME, uri, comment);
}

describe('sync verification', () => {
  it('reports ok when the posted comment names the stored pick', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 3, playerCount: 3 });
    db.prepare('UPDATE competitors SET name = ? WHERE id = ?').run('Jensen', players[1]);
    storeComment(db, songs[1], players[1], 'close enough for me jensen');
    postedVote(db, songs[1], 'close enough for me jensen');

    const r = verifyRoundSync(db, roundId, ME, '2026-01-03T00:00:00Z');
    expect(r.state).toBe('ok');
    expect(getRoundState(db, roundId).syncState).toBe('ok');
  });

  it('flags a mismatch when the posted comment names someone else', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 3, playerCount: 3 });
    db.prepare('UPDATE competitors SET name = ? WHERE id = ?').run('Jensen', players[1]);
    db.prepare('UPDATE competitors SET name = ? WHERE id = ?').run('Steiny', players[2]);
    storeComment(db, songs[1], players[1], 'has to be jensen');
    postedVote(db, songs[1], 'changed my mind, steiny');

    const r = verifyRoundSync(db, roundId, ME, '2026-01-03T00:00:00Z');
    expect(r.state).toBe('mismatch');
    expect(r.songs[0]).toMatchObject({ storedPlayerId: players[1], postedPlayerId: players[2] });
  });

  it('never overwrites the stored pick — the report is advisory', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 3, playerCount: 3 });
    db.prepare('UPDATE competitors SET name = ? WHERE id = ?').run('Jensen', players[1]);
    db.prepare('UPDATE competitors SET name = ? WHERE id = ?').run('Steiny', players[2]);
    storeComment(db, songs[1], players[1], 'has to be jensen');
    postedVote(db, songs[1], 'changed my mind, steiny');

    verifyRoundSync(db, roundId, ME, '2026-01-03T00:00:00Z');
    const row = db.prepare(
      'SELECT final_pick_player_id AS p FROM guess_picks WHERE round_id=1 AND spotify_uri=?',
    ).get(songs[1]) as { p: number };
    expect(row.p).toBe(players[1]);
  });

  it('stays unverified while no votes have imported yet', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 3, playerCount: 3 });
    storeComment(db, songs[1], players[1], 'jensen');
    const r = verifyRoundSync(db, roundId, ME, '2026-01-03T00:00:00Z');
    expect(r.state).toBe('unverified');
  });
});

describe('sync is suppressed during a rehearsal (spec §14.6)', () => {
  it('returns unverified and inspects nothing while mode is rehearsal', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 3, playerCount: 3 });
    db.prepare('UPDATE competitors SET name = ? WHERE id = ?').run('Jensen', players[1]);
    storeComment(db, songs[1], players[1], 'has to be jensen');
    postedVote(db, songs[1], 'changed my mind, steiny');

    startRehearsal(db, roundId, '2026-01-02T00:00:00Z');

    const r = verifyRoundSync(db, roundId, ME, '2026-01-03T00:00:00Z');
    expect(r.state).toBe('unverified');
    expect(r.songs).toEqual([]);
  });

  it('does not overwrite a previously recorded sync_state', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 3, playerCount: 3 });
    db.prepare('UPDATE competitors SET name = ? WHERE id = ?').run('Jensen', players[1]);
    storeComment(db, songs[1], players[1], 'close enough for me jensen');
    postedVote(db, songs[1], 'close enough for me jensen');

    expect(verifyRoundSync(db, roundId, ME, '2026-01-03T00:00:00Z').state).toBe('ok');

    startRehearsal(db, roundId, '2026-01-02T00:00:00Z');
    verifyRoundSync(db, roundId, ME, '2026-01-04T00:00:00Z');

    expect(getRoundState(db, roundId).syncState).toBe('ok');
  });

  it('resumes normally once the rehearsal is archived', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 3, playerCount: 3 });
    db.prepare('UPDATE competitors SET name = ? WHERE id = ?').run('Jensen', players[1]);
    startRehearsal(db, roundId, '2026-01-02T00:00:00Z');
    archiveRehearsal(db, roundId);

    storeComment(db, songs[1], players[1], 'close enough for me jensen');
    postedVote(db, songs[1], 'close enough for me jensen');
    expect(verifyRoundSync(db, roundId, ME, '2026-01-05T00:00:00Z').state).toBe('ok');
  });
});
