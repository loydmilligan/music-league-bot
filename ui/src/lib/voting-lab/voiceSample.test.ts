import { it, expect } from 'vitest';
import { openLeagueDb } from '../db/client.js';
import { getVoiceSample, getOwnerTasteFingerprint, getOwnerPlayerId } from './voiceSample.js';

// DEVIATION FROM THE ORIGINAL TASK BRIEF — read before touching this file:
//
// The brief assumed `players.is_owner`, `player_profiles.taste_fingerprint`,
// and a bare-`SCHEMA`-only fixture (players/votes.player_id living in the raw
// schema.ts constant). Verifying against the real DB found:
//
//   - `players`, `player_profiles`, `player_identities`, and the `player_id`
//     FK column on `votes` are NOT in schema.ts's SCHEMA constant at all —
//     they are created by the migration steps inside `openLeagueDb()`
//     (ui/src/lib/db/client.ts). A test built on `db.exec(SCHEMA)` alone (as
//     the brief's fixture did) has no `players` table and would fail on the
//     very first INSERT. Fixed by building the fixture with
//     `openLeagueDb(':memory:')` instead, which runs SCHEMA + every
//     migration and gives a real, complete schema.
//   - `players` has NO `is_owner` column (confirmed via
//     `sqlite3 data/league.db ".schema players"`) and no such flag exists
//     anywhere in the DB, including `settings`.
//   - `player_profiles.taste_fingerprint` DOES exist as named in the brief —
//     that part was correct.
//   - `votes` has `player_id` (added via migration, matches the brief) and
//     `comment`/`created_at` columns as named.
//
// Real owner-identity mechanism found instead: `OWNER_PHONE_NUMBER` (env var,
// used elsewhere only for WhatsApp notification routing — see
// ui/src/lib/notifications/config.ts) is matched against
// `players.chat_identifier` for the row with `chat_type = 'whatsapp'`, after
// normalizing both to digits-only (env is a bare "16617476822"; the DB stores
// "+16617476822"). This is implemented in voiceSample.ts's
// `getOwnerPlayerId`, which accepts an injectable `env` for testability.

function dbWithOwner() {
  const db = openLeagueDb(':memory:');
  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1, 'l1', 'L1')`).run();
  db.prepare(`INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 1, 'active')`).run();
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at, phase)
     VALUES (100, 10, 'ml-100', 'R1', '2026-07-01T00:00:00Z', 'complete')`,
  ).run();
  db.prepare(`INSERT INTO competitors (id, ml_competitor_id, name) VALUES (5, 'c5', 'Owner')`).run();
  db.prepare(
    `INSERT INTO players (id, name, chat_type, chat_identifier) VALUES (5, 'Owner', 'whatsapp', '+16617476822')`,
  ).run();
  return db;
}

const OWNER_ENV = { OWNER_PHONE_NUMBER: '16617476822' };

it('finds the owner player by matching OWNER_PHONE_NUMBER to chat_identifier', () => {
  const db = dbWithOwner();
  expect(getOwnerPlayerId(db, OWNER_ENV)).toBe(5);
  db.close();
});

it('returns null when OWNER_PHONE_NUMBER is unset or matches nobody', () => {
  const db = dbWithOwner();
  expect(getOwnerPlayerId(db, {})).toBeNull();
  expect(getOwnerPlayerId(db, { OWNER_PHONE_NUMBER: '15550001111' })).toBeNull();
  db.close();
});

it('returns the owner past comments, newest first, skipping empties, across all leagues', () => {
  const db = dbWithOwner();
  // A second league, to prove getVoiceSample is NOT scoped to one league.
  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (2, 'l2', 'L2')`).run();
  db.prepare(`INSERT INTO seasons (id, league_id, season_number, status) VALUES (20, 2, 1, 'active')`).run();
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at, phase)
     VALUES (200, 20, 'ml-200', 'R2', '2026-06-01T00:00:00Z', 'complete')`,
  ).run();

  const ins = db.prepare(
    `INSERT INTO votes (round_id, voter_id, spotify_uri, points, comment, created_at, player_id)
     VALUES (?, 5, ?, 1, ?, ?, 5)`,
  );
  ins.run(100, 'spotify:track:a', 'older take', '2026-07-01T00:00:00Z');
  ins.run(100, 'spotify:track:b', '   ', '2026-07-02T00:00:00Z');
  ins.run(200, 'spotify:track:c', 'newer take, other league', '2026-07-03T00:00:00Z');
  expect(getVoiceSample(db, 8, OWNER_ENV)).toEqual(['newer take, other league', 'older take']);
  db.close();
});

it('respects the limit', () => {
  const db = dbWithOwner();
  const ins = db.prepare(
    `INSERT INTO votes (round_id, voter_id, spotify_uri, points, comment, created_at, player_id)
     VALUES (100, 5, ?, 1, ?, ?, 5)`,
  );
  ins.run('spotify:track:a', 'first', '2026-07-01T00:00:00Z');
  ins.run('spotify:track:b', 'second', '2026-07-02T00:00:00Z');
  ins.run('spotify:track:c', 'third', '2026-07-03T00:00:00Z');
  expect(getVoiceSample(db, 2, OWNER_ENV)).toEqual(['third', 'second']);
  db.close();
});

it('returns [] and null/empty string when there is no owner', () => {
  const db = dbWithOwner();
  expect(getOwnerPlayerId(db, {})).toBeNull();
  expect(getOwnerTasteFingerprint(db, {})).toBe('');
  expect(getVoiceSample(db, 8, {})).toEqual([]);
  db.close();
});

it('returns an empty fingerprint when the owner has no stored fingerprint row', () => {
  const db = dbWithOwner();
  expect(getOwnerTasteFingerprint(db, OWNER_ENV)).toBe('');
  db.close();
});

it('returns the stored taste fingerprint when present', () => {
  const db = dbWithOwner();
  db.prepare(`INSERT INTO player_profiles (player_id, taste_fingerprint) VALUES (5, 'loves 90s indie')`).run();
  expect(getOwnerTasteFingerprint(db, OWNER_ENV)).toBe('loves 90s indie');
  db.close();
});
