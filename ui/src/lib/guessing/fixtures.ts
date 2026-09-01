import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';

export interface SeededRound {
  db: Database.Database;
  roundId: number;
  /** player ids 1..n, name "P1".."Pn". Player 1 is Matt (the guesser). */
  players: number[];
  /** spotify uris, one per song, in playlist order. */
  songs: string[];
}

/**
 * A round with `songCount` anonymous songs and `playerCount` roster players.
 * Song 0 is Matt's own (voting_lab_ballot.is_mine = 1) unless `mineIndex` is null.
 * Submissions are seeded WITHOUT player_id, mirroring a live round; call
 * `reveal()` to attach submitters the way a completed-round export would.
 */
export function seedRound(opts: {
  songCount?: number;
  playerCount?: number;
  mineIndex?: number | null;
} = {}): SeededRound {
  const songCount = opts.songCount ?? 4;
  const playerCount = opts.playerCount ?? 4;
  const mineIndex = opts.mineIndex === undefined ? 0 : opts.mineIndex;

  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec(`INSERT INTO leagues (id,slug,name) VALUES (1,'boarz-ii-men','Boarz');
           INSERT INTO seasons (id,league_id,season_number,status) VALUES (1,1,1,'active');
           INSERT INTO rounds (id,season_id,ml_round_id,name,created_at)
             VALUES (1,1,'ml-1','R1','2026-01-01T00:00:00Z');`);

  const players: number[] = [];
  for (let i = 1; i <= playerCount; i++) {
    db.prepare('INSERT INTO competitors (id,ml_competitor_id,name) VALUES (?,?,?)').run(i, `c${i}`, `P${i}`);
    db.prepare(
      `INSERT INTO season_standings (season_id, round_id, competitor_id, name, rank, updated_at)
       VALUES (1, 1, ?, ?, ?, '2026-01-01T00:00:00Z')`,
    ).run(i, `P${i}`, i);
    players.push(i);
  }

  const songs: string[] = [];
  for (let i = 0; i < songCount; i++) {
    const uri = `spotify:track:s${i}`;
    songs.push(uri);
    db.prepare(
      `INSERT INTO ml_submissions (round_id, spotify_uri, title, artists, created_at, visible_to_voters)
       VALUES (1, ?, ?, ?, '2026-01-01T00:00:00Z', 1)`,
    ).run(uri, `Song ${i}`, `Artist ${i}`);
    db.prepare(
      `INSERT INTO voting_lab_ballot (round_id, spotify_uri, is_mine, updated_at)
       VALUES (1, ?, ?, '2026-01-01T00:00:00Z')`,
    ).run(uri, mineIndex !== null && i === mineIndex ? 1 : 0);
  }

  return { db, roundId: 1, players, songs };
}

/** Attach real submitters, as a completed-round export would. */
export function reveal(db: Database.Database, assignments: Record<string, number>): void {
  for (const [uri, playerId] of Object.entries(assignments)) {
    db.prepare('UPDATE ml_submissions SET competitor_id = ? WHERE round_id = 1 AND spotify_uri = ?')
      .run(playerId, uri);
  }
}

/** Chat group name used by the fixtures. Real code resolves this per league. */
export const CHAT_GROUP = 'Boarz Test Group';

/**
 * Add an earlier round to the same season. `seedRound` only creates round 1;
 * horizon tests need neighbours to prove the strictly-prior rule.
 */
export function seedPriorRound(
  db: Database.Database,
  roundId: number,
  votingDeadline: string | null,
): void {
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at, voting_deadline)
     VALUES (?, 1, ?, ?, '2026-01-01T00:00:00Z', ?)`,
  ).run(roundId, `ml-${roundId}`, `R${roundId}`, votingDeadline);
}

export function seedVote(
  db: Database.Database,
  roundId: number,
  voterId: number,
  spotifyUri: string,
  comment: string,
  createdAt: string,
): void {
  db.prepare(
    `INSERT INTO votes (round_id, voter_id, spotify_uri, points, comment, created_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run(roundId, voterId, spotifyUri, comment, createdAt);
}

/**
 * `chat_messages` lives in the live database but NOT in the UI's SCHEMA constant —
 * the bot side (src/) owns it. Tests therefore create it themselves. The DDL below
 * mirrors the live table's shape for the columns this project reads.
 */
export function seedChat(
  db: Database.Database,
  groupName: string,
  sender: string,
  text: string,
  ts: string,
): void {
  db.exec(`CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY, platform TEXT NOT NULL, group_name TEXT NOT NULL,
    group_key TEXT, sender TEXT NOT NULL, text TEXT NOT NULL, ts TEXT NOT NULL,
    msg_hash TEXT NOT NULL, captured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    sender_handle TEXT, source_path TEXT
  )`);
  const id = `${groupName}|${sender}|${ts}`;
  db.prepare(
    `INSERT OR IGNORE INTO chat_messages (id, platform, group_name, sender, text, ts, msg_hash, captured_at)
     VALUES (?, 'whatsapp', ?, ?, ?, ?, ?, '2026-01-01T00:00:00Z')`,
  ).run(id, groupName, sender, text, ts, id);
}
