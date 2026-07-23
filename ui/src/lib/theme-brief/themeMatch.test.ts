import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { matchThemes } from './themeMatch.js';
import type { LlmFn } from './llmFn.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE leagues (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER);
    CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER, name TEXT, description TEXT);
    CREATE TABLE theme_tags (id INTEGER PRIMARY KEY, category TEXT, value TEXT);
    CREATE TABLE round_theme_tags (round_id INTEGER, tag_id INTEGER);
  `);
  db.prepare('INSERT INTO leagues VALUES (2,?),(5,?)').run('Fam-Jam', 'Boarz');
  db.prepare('INSERT INTO seasons VALUES (22,2,2),(55,5,1)').run();
  db.prepare('INSERT INTO rounds VALUES (39,22,?,?)').run('Nada de Ingles', 'Songs in a language other than English');
  db.prepare('INSERT INTO rounds VALUES (145,55,?,?)').run('No Entiendo', 'vocals in a language other than English');
  db.prepare('INSERT INTO theme_tags VALUES (1,?,?)').run('semantic', 'non-english');
  db.prepare('INSERT INTO round_theme_tags VALUES (39,1),(145,1)').run(); // shared tag

  // Untagged fixture: proves the fallback keys on a real significant word
  // ("karaoke"), not the hardcoded language/English terms, and correctly
  // ignores a round that shares only a stopword ("song"/"theme") with the
  // target's description.
  db.prepare('INSERT INTO leagues VALUES (7,?)').run('KaraokeLeague');
  db.prepare('INSERT INTO seasons VALUES (77,7,1)').run();
  db.prepare('INSERT INTO rounds VALUES (300,77,?,?)').run('Sing Along', 'Karaoke night song theme');
  db.prepare('INSERT INTO rounds VALUES (301,77,?,?)').run('Karaoke Classics', 'Best karaoke jams of the summer');
  db.prepare('INSERT INTO rounds VALUES (302,77,?,?)').run('Bring Your Own', 'Bring your own song this round');
  // 300, 301, 302 are all intentionally untagged (no round_theme_tags rows).

  return db;
}

// Stub LLM: echoes a confirmation for round 39 as exact.
const stubLlm: LlmFn = async () =>
  JSON.stringify({ matches: [{ roundId: 39, exactness: 'exact', reason: 'same foreign-language rule' }] });

describe('matchThemes', () => {
  it('returns confirmed matches enriched with league/season/title, excluding the target round', async () => {
    const out = await matchThemes(makeDb(), 145, stubLlm);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      roundId: 39, leagueName: 'Fam-Jam', title: 'Nada de Ingles', exactness: 'exact', reason: 'same foreign-language rule',
    });
  });

  it('drops LLM matches that are not in the candidate shortlist (no hallucinated rounds)', async () => {
    const liar: LlmFn = async () => JSON.stringify({ matches: [{ roundId: 999, exactness: 'exact', reason: 'nope' }] });
    const out = await matchThemes(makeDb(), 145, liar);
    expect(out).toEqual([]);
  });

  it('falls back to significant-word overlap for an untagged target (not hardcoded to language/English)', async () => {
    // The LLM "hallucinates" a match for round 302 too, but 302 only shares a
    // stopword ("song"/"theme") with the target's description, not a real
    // significant word — it must never reach the shortlist, so it's dropped
    // the same way an invented roundId would be.
    const stub: LlmFn = async () => JSON.stringify({
      matches: [
        { roundId: 301, exactness: 'related', reason: 'both karaoke rounds' },
        { roundId: 302, exactness: 'related', reason: 'false positive stopword overlap' },
      ],
    });
    const out = await matchThemes(makeDb(), 300, stub);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      roundId: 301, title: 'Karaoke Classics', exactness: 'related', reason: 'both karaoke rounds',
    });
  });
});
