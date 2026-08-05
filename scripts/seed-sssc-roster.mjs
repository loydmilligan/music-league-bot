#!/usr/bin/env node
/**
 * seed-sssc-roster — materialize the SSSC roster.
 *
 * For each SSSC person in Appendix A, upsert a `players` row (linked to their
 * ML competitor via `players.ml_competitor_id`) and write their `discord` +
 * `music-league` identities into `player_identities`, scoped to the `sssc`
 * league. The 3 ML-only people (Aniss, Kelly Jean, sparklepants13) get no
 * discord identity — only their music-league identity/player. Idempotent:
 * re-running creates 0 new rows.
 *
 * NOTE on the ml_id lookup: `competitors.id` is just the internal autoincrement
 * PK; the actual "ML competitor id" is `competitors.ml_competitor_id` (the hash
 * string), which is what existing `players.ml_competitor_id` rows already store
 * (verified against data/league.db). The query below joins on that column, not
 * `competitors.id`.
 *
 * Usage: DATA_DIR=/tmp/scr node scripts/seed-sssc-roster.mjs
 */
import Database from 'better-sqlite3';
import { resolve } from 'node:path';

// ML competitor name -> Discord sender (null = ML-only, no discord identity)
const MAP = {
  'Boonie Dogsweat': 'Dogsweat 🚂', 'Cherry': 'Libby/Cherry', 'KarBen': 'KarBen (MDR)',
  'Lexa Prole': 'lexa prole', 'Mouse Atreides': 'Mouse Atreides', 'PoetryinNoise': 'PoetryInNoise',
  'TekniKali.Mo': 'Kali', 'Tragically Skip': 'TragicallySkip', 'a1mrson': 'a1mrson',
  'antigravpjs': 'antigravpjs', 'bagimation': 'bagimation', 'bump versino': 'bump versino',
  'frankenberge': 'frankenberge', 'missmara': 'missmara', 'mrklorox': 'MrKlorox',
  'nateoeb': 'NateOEB', 'socalledbutton': 'socalledbutton',
  'Timmywhatup': 'timmyg (the g is for whatup)', 'GoodGollyMiss': '🌙✨good.golly.ms✨🌙',
  'jirafa': 'lithogiraffe', 'Dylan/Brannigans_L4w': "Brannigan's Law", 'dubs613': 'dubc_613',
  'Heath DG': 'FanonAndOn (AndOnAndOn)', 'Aidan': 'falseaidentity', 'nowlistenallison': 'zewskers',
  'Aniss': null, 'Kelly Jean': null, 'sparklepants13': null,
};

const db = new Database(resolve(process.env.DATA_DIR ?? 'data', 'league.db'));
db.pragma('foreign_keys = ON');

// Widen player_identities.identity_type to allow 'discord' if this DB copy
// predates the Task 1 migration (SQLite can't ALTER a CHECK; rebuild once).
const piSql = (db.prepare(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='player_identities'",
).get() ?? {}).sql ?? '';
if (piSql && !piSql.includes("'discord'")) {
  db.exec(`
    CREATE TABLE player_identities_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL,
      identity_type TEXT NOT NULL CHECK(identity_type IN ('whatsapp','google-chat','music-league','discord')),
      identifier TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO player_identities_new (id, player_id, league_id, identity_type, identifier, created_at)
      SELECT id, player_id, league_id, identity_type, identifier, created_at FROM player_identities;
    DROP TABLE player_identities;
    ALTER TABLE player_identities_new RENAME TO player_identities;
  `);
}

const league = db.prepare("SELECT id FROM leagues WHERE slug='sssc'").get();
if (!league) throw new Error('sssc league row missing');

// competitor name -> ml competitor id (competitors.ml_competitor_id, the hash string)
const comps = db.prepare(`
  SELECT DISTINCT c.ml_competitor_id AS ml_id, c.name
  FROM competitors c JOIN ml_submissions s ON s.competitor_id=c.id
  JOIN rounds r ON r.id=s.round_id JOIN seasons se ON se.id=r.season_id
  WHERE se.league_id=?`).all(league.id);
const byName = new Map(comps.map((c) => [c.name, c.ml_id]));

const findPlayer = db.prepare('SELECT id FROM players WHERE ml_competitor_id=?');
const insPlayer = db.prepare('INSERT INTO players (name, ml_competitor_id) VALUES (?, ?) RETURNING id');
const hasIdent = db.prepare(
  'SELECT 1 FROM player_identities WHERE player_id=? AND league_id=? AND identity_type=? AND identifier=?');
const insIdent = db.prepare(
  'INSERT INTO player_identities (player_id, league_id, identity_type, identifier) VALUES (?,?,?,?)');

let players = 0, idents = 0, missing = [];
const tx = db.transaction(() => {
  for (const [comp, discord] of Object.entries(MAP)) {
    const mlId = byName.get(comp);
    if (!mlId) { missing.push(comp); continue; }
    let p = findPlayer.get(mlId);
    if (!p) { p = insPlayer.get(comp, mlId); players++; }
    for (const [type, ident] of [['music-league', mlId], ['discord', discord]]) {
      if (!ident) continue;
      if (!hasIdent.get(p.id, league.id, type, ident)) { insIdent.run(p.id, league.id, type, ident); idents++; }
    }
  }
});
tx();
console.log(JSON.stringify({ playersCreated: players, identitiesCreated: idents, missingCompetitors: missing }));
