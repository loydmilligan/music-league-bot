import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { synthesize, gatherComments } from './themeBriefLlm.js';
import type { LlmFn } from './llmFn.js';
import type { SynthesisInput } from './types.js';

const input: SynthesisInput = {
  themeText: 'vocals in a language other than English',
  runs: [{
    label: 'Hip Jammers S1',
    standings: [
      { rank: 1, points: 29, spotifyUri: 'x', title: '99 Luftballons', artist: 'Nena', submitterIsOwner: false, popularity: 78, listeners: 1 },
      { rank: 2, points: 4, spotifyUri: 'y', title: 'Faufile', artist: 'Charlotte Cardin', submitterIsOwner: false, popularity: 49, listeners: 1 },
    ],
    comments: [{ title: '99 Luftballons', points: 4, comment: 'Bomb' }],
  }],
};

const stub: LlmFn = async (messages) => {
  // Assert the prompt only references supplied songs.
  const body = messages.map((m) => m.content).join(' ');
  if (!body.includes('99 Luftballons')) throw new Error('prompt missing supplied data');
  return JSON.stringify({
    winnerDna: 'Familiar, upbeat.', cellarTraps: 'Obscure and abrasive.',
    whatToSubmit: 'Pick a recognizable dance-pop track with real vocals.',
    songLanguages: { x: 'German', y: 'French' },
  });
};

describe('synthesize', () => {
  it('returns the four synthesis fields from the model', async () => {
    const out = await synthesize(input, stub);
    expect(out.winnerDna).toContain('Familiar');
    expect(out.whatToSubmit).toContain('recognizable');
    expect(out.songLanguages.x).toBe('German');
  });

  it('degrades to empty strings when the model returns malformed JSON', async () => {
    const bad: LlmFn = async () => 'not json';
    const out = await synthesize(input, bad);
    expect(out).toEqual({ winnerDna: '', cellarTraps: '', whatToSubmit: '', songLanguages: {} });
  });
});

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE rounds (id INTEGER PRIMARY KEY);
    CREATE TABLE ml_submissions (id INTEGER PRIMARY KEY, round_id INTEGER, spotify_uri TEXT, title TEXT);
    CREATE TABLE votes (id INTEGER PRIMARY KEY, round_id INTEGER, voter_id INTEGER, spotify_uri TEXT, points INTEGER, comment TEXT);
  `);
  db.prepare('INSERT INTO rounds VALUES (10)').run();
  db.prepare('INSERT INTO ml_submissions VALUES (100,10,?,?)').run('x', '99 Luftballons');
  db.prepare('INSERT INTO ml_submissions VALUES (101,10,?,?)').run('y', 'Faufile');
  db.prepare('INSERT INTO votes VALUES (200,10,1,?,4,?)').run('x', 'Bomb');
  db.prepare('INSERT INTO votes VALUES (201,10,2,?,1,NULL)').run('y');
  db.prepare('INSERT INTO votes VALUES (202,10,1,?,0,?)').run('y', '');
  return db;
}

describe('gatherComments', () => {
  it('returns only non-empty vote comments joined to submission titles, ordered by points desc', () => {
    const rows = gatherComments(makeDb(), 10);
    expect(rows).toEqual([{ title: '99 Luftballons', points: 4, comment: 'Bomb' }]);
  });
});
