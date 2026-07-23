import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { buildThemeBrief, readCachedBrief } from './assemble.js';
import type { LlmFn } from './llmFn.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE leagues (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER);
    CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER, name TEXT, description TEXT);
    CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE competitors (id INTEGER PRIMARY KEY, name TEXT, player_id INTEGER);
    CREATE TABLE season_players (season_id INTEGER, player_id INTEGER);
    CREATE TABLE ml_submissions (id INTEGER PRIMARY KEY, round_id INTEGER, competitor_id INTEGER, spotify_uri TEXT, title TEXT, artists TEXT);
    CREATE TABLE votes (id INTEGER PRIMARY KEY, round_id INTEGER, voter_id INTEGER, spotify_uri TEXT, points INTEGER, comment TEXT);
    CREATE TABLE song_popularity (spotify_uri TEXT PRIMARY KEY, spotify_popularity INTEGER, listeners INTEGER);
    CREATE TABLE theme_tags (id INTEGER PRIMARY KEY, category TEXT, value TEXT);
    CREATE TABLE round_theme_tags (round_id INTEGER, tag_id INTEGER);
    CREATE TABLE theme_briefs (round_id INTEGER PRIMARY KEY, brief_json TEXT NOT NULL, model TEXT, cost_usd REAL, generated_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  db.prepare('INSERT INTO leagues VALUES (2,?),(5,?)').run('Fam-Jam', 'Boarz');
  db.prepare('INSERT INTO seasons VALUES (22,2,2),(55,5,1)').run();
  db.prepare('INSERT INTO rounds VALUES (39,22,?,?)').run('Nada de Ingles', 'Songs in a language other than English');
  db.prepare('INSERT INTO rounds VALUES (145,55,?,?)').run('No Entiendo', 'vocals in a language other than English');
  db.prepare('INSERT INTO players VALUES (1,?)').run('Matt');
  db.prepare('INSERT INTO competitors VALUES (3,?,1),(4,?,2)').run('Mashew', 'Other');
  db.prepare('INSERT INTO season_players VALUES (22,1),(55,1)').run();
  db.prepare('INSERT INTO ml_submissions VALUES (500,39,4,?,?,?)').run('u1', 'CAROLINA', 'Karol G');
  db.prepare('INSERT INTO votes VALUES (600,39,1,?,10,?)').run('u1', 'banger');
  db.prepare('INSERT INTO song_popularity VALUES (?,69,1000)').run('u1');
  db.prepare('INSERT INTO theme_tags VALUES (1,?,?)').run('semantic', 'non-english');
  db.prepare('INSERT INTO round_theme_tags VALUES (39,1),(145,1)').run();
  return db;
}

const stub: LlmFn = async (messages) => {
  const body = messages.map((m) => m.content).join(' ');
  if (body.includes('CANDIDATES') || body.includes('candidates')) {
    return JSON.stringify({ matches: [{ roundId: 39, exactness: 'exact', reason: 'same rule' }] });
  }
  return JSON.stringify({ winnerDna: 'familiar', cellarTraps: 'obscure', whatToSubmit: 'go familiar', songLanguages: { u1: 'Spanish' } });
};

describe('buildThemeBrief', () => {
  it('assembles matched runs, familiarity, synthesis and caches the result', async () => {
    const db = makeDb();
    const brief = await buildThemeBrief(db, 145, stub);
    expect(brief.runCount).toBe(2); // 1 prior + this run
    expect(brief.matches[0]).toMatchObject({ roundId: 39, leagueName: 'Fam-Jam', scoring: 'upvote-only' });
    expect(brief.matches[0].podium[0].title).toBe('CAROLINA');
    expect(brief.whatToSubmit).toBe('go familiar');
    expect(brief.songLanguages.u1).toBe('Spanish');
    // cached
    const cached = readCachedBrief(db, 145);
    expect(cached?.whatToSubmit).toBe('go familiar');
  });

  it('produces a graceful first-time brief when no matches', async () => {
    const noMatch: LlmFn = async () => JSON.stringify({ matches: [] });
    const brief = await buildThemeBrief(makeDb(), 145, noMatch);
    expect(brief.runCount).toBe(1);
    expect(brief.matches).toEqual([]);
    expect(brief.firstTime).toBe(true);
  });
});
