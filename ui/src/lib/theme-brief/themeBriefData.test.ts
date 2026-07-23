import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { standings, podiumCellar, familiarityBuckets, leagueScoringType } from './themeBriefData.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE leagues (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER);
    CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER, name TEXT, description TEXT);
    CREATE TABLE competitors (id INTEGER PRIMARY KEY, name TEXT, player_id INTEGER);
    CREATE TABLE ml_submissions (id INTEGER PRIMARY KEY, round_id INTEGER, competitor_id INTEGER, spotify_uri TEXT, title TEXT, artists TEXT);
    CREATE TABLE votes (id INTEGER PRIMARY KEY, round_id INTEGER, voter_id INTEGER, spotify_uri TEXT, points INTEGER, comment TEXT);
    CREATE TABLE song_popularity (spotify_uri TEXT PRIMARY KEY, spotify_popularity INTEGER, listeners INTEGER);
  `);
  db.prepare('INSERT INTO leagues VALUES (1,?)').run('Test League');
  db.prepare('INSERT INTO seasons VALUES (1,1,1)').run();
  db.prepare('INSERT INTO rounds VALUES (10,1,?,?)').run('R', 'theme');
  db.prepare('INSERT INTO competitors VALUES (3,?,1)').run('Mashew');
  db.prepare('INSERT INTO competitors VALUES (4,?,2)').run('Other');
  // Two songs: owner's (uri A, 5 pts, pop 80), other's (uri B, 1 pt, pop 20)
  db.prepare('INSERT INTO ml_submissions VALUES (100,10,3,?,?,?)').run('A', 'Song A', 'Artist A');
  db.prepare('INSERT INTO ml_submissions VALUES (101,10,4,?,?,?)').run('B', 'Song B', 'Artist B');
  db.prepare('INSERT INTO votes VALUES (200,10,4,?,3,?)').run('A', 'love it');
  db.prepare('INSERT INTO votes VALUES (201,10,3,?,2,NULL)').run('A');
  db.prepare('INSERT INTO votes VALUES (202,10,4,?,1,NULL)').run('B');
  db.prepare('INSERT INTO song_popularity VALUES (?,80,1000)').run('A');
  db.prepare('INSERT INTO song_popularity VALUES (?,20,50)').run('B');
  return db;
}

describe('standings', () => {
  it('ranks by summed points, marks owner picks, and joins popularity', () => {
    const rows = standings(makeDb(), 10, 3);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ rank: 1, points: 5, title: 'Song A', submitterIsOwner: true, popularity: 80 });
    expect(rows[1]).toMatchObject({ rank: 2, points: 1, title: 'Song B', submitterIsOwner: false, popularity: 20 });
  });
  it('degrades to null popularity when song_popularity is missing', () => {
    const db = makeDb();
    db.prepare('DELETE FROM song_popularity WHERE spotify_uri=?').run('B');
    const rows = standings(db, 10, 3);
    expect(rows.find((r) => r.title === 'Song B')?.popularity).toBeNull();
  });
});

describe('podiumCellar', () => {
  it('splits top (up to 3) and the single lowest', () => {
    const rows = standings(makeDb(), 10, 3);
    const { podium, cellar } = podiumCellar(rows);
    expect(podium.map((r) => r.title)).toEqual(['Song A', 'Song B']);
    expect(cellar.map((r) => r.title)).toEqual(['Song B']);
  });
});

describe('familiarityBuckets', () => {
  it('buckets by popularity and averages points', () => {
    const rows = standings(makeDb(), 10, 3);
    const b = familiarityBuckets(rows);
    expect(b.find((x) => x.key === 'mainstream')).toMatchObject({ n: 1, avgPoints: 5 });
    expect(b.find((x) => x.key === 'obscure')).toMatchObject({ n: 1, avgPoints: 1 });
  });
});

describe('leagueScoringType', () => {
  it('reports downvotes when any negative vote exists, else upvote-only', () => {
    const db = makeDb();
    expect(leagueScoringType(db, 1)).toBe('upvote-only');
    db.prepare('INSERT INTO votes VALUES (203,10,3,?,-1,NULL)').run('B');
    expect(leagueScoringType(db, 1)).toBe('downvotes');
  });
});
