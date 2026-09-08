import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type { BandMember } from './bandStamp.js';
import { getReview, primaryVideoId } from './videoReview.js';

/**
 * Storage for what the group does on an MLB playlist page: thumbs and messages.
 *
 * The page is a static file on digest.mattmariani.com reached from a link in a
 * WhatsApp group, so every write arrives unauthenticated and every writer is
 * self-declared (the identity chip, D2). The slug is the only thing tying a
 * request to a round, and it is unlisted rather than secret. That makes this
 * module the whole trust boundary: nothing is taken on the caller's word except
 * WHO they claim to be, and even that has to be a player on the round's roster.
 *
 * Messages never reach the group on their own — they queue for Matt exactly like
 * the video review does, and only an approved one is public.
 */

export type MessageStatus = 'pending' | 'approved' | 'denied';
export type VoteDir = 'up' | 'down';

export interface VoteTally {
  videoId: string;
  up: number;
  down: number;
  /** Band members whose one stamp landed here — see stampers(). */
  stampers: BandMember[];
}

/** Someone allowed to write on this page. `id` is a players.id, as a string. */
export interface RosterEntry {
  id: string;
  name: string;
}

export interface Message {
  id: number;
  videoId: string;
  playerId: string;
  playerName: string;
  text: string;
  status: MessageStatus;
  createdAt: string;
  decidedAt: string | null;
}

/** What the page reads back: counts, stamps and the messages Matt has released. */
export interface PlaylistReadModel {
  slug: string;
  tallies: VoteTally[];
  messages: Message[];
}

/** A message longer than this is a WhatsApp post, not a reaction to a video. */
export const MAX_MESSAGE_CHARS = 500;

/**
 * Whose upvote carries a stamp, by players.name.
 *
 * Deliberately not read from BAND in bandStamp.ts: that module is the drawing
 * layer, and the page it draws for is generated in tests and scripts that never
 * open the database. Keeping the lookup here means storage depends on nothing
 * but its own tables — the shared thing between the two is the BandMember union,
 * which is a type and costs nothing at runtime.
 */
const STAMPERS: Record<string, BandMember> = {
  'Matt Mariani': 'matt',
  'Jon Black': 'jon',
  'Brian Pascoe': 'brian',
  'TJ Cook': 'tj',
};

export function ensurePlaylistSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS playlist_votes (
      slug       TEXT NOT NULL,
      video_id   TEXT NOT NULL,
      player_id  TEXT NOT NULL,
      dir        TEXT NOT NULL CHECK(dir IN ('up','down')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (slug, video_id, player_id)
    );
    CREATE TABLE IF NOT EXISTS playlist_messages (
      id         INTEGER PRIMARY KEY,
      slug       TEXT NOT NULL,
      video_id   TEXT NOT NULL,
      player_id  TEXT NOT NULL,
      text       TEXT NOT NULL,
      status     TEXT NOT NULL CHECK(status IN ('pending','approved','denied')),
      created_at TEXT NOT NULL,
      decided_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_playlist_messages_slug ON playlist_messages(slug, status);
  `);
  // Single-use approval token per message, added after the table shipped. It is
  // what makes the ntfy Approve/Deny buttons safe to expose: the callbacks are
  // public and bearer-gated, and the token scopes each tap to one message.
  const msgCols = new Set(
    (db.prepare('PRAGMA table_info(playlist_messages)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!msgCols.has('token')) db.exec('ALTER TABLE playlist_messages ADD COLUMN token TEXT');

}

export interface PlaylistPageRef {
  slug: string;
  roundId: number;
  leagueId: number;
  /** Videos that may be voted on: one per included song, the primary (D6). */
  votable: string[];
  /** Every video on the page — children are commentable but never votable. */
  commentable: string[];
}

/**
 * Resolve a slug to the round it belongs to, or null.
 *
 * A slug that is not on a review is simply unknown; callers turn that into a
 * plain 404 with no hint that other pages exist, because the URL is the only
 * credential and probing it must return nothing to learn from.
 */
export function pageForSlug(db: Database.Database, slug: string): PlaylistPageRef | null {
  if (!slug) return null;
  const row = db.prepare('SELECT round_id FROM ytm_video_reviews WHERE page_slug = ?').get(slug) as
    | { round_id: number }
    | undefined;
  if (!row) return null;
  const review = getReview(db, row.round_id);
  if (!review) return null;
  const included = review.picks.filter((p) => p.included);
  const votable: string[] = [];
  const commentable: string[] = [];
  for (const p of included) {
    const primary = primaryVideoId(p);
    if (primary && !votable.includes(primary)) votable.push(primary);
    for (const id of p.chosen) if (!commentable.includes(id)) commentable.push(id);
  }
  return { slug, roundId: review.roundId, leagueId: review.leagueId, votable, commentable };
}

/**
 * The people who may claim an identity on this round's page: the roster of the
 * season the round belongs to, not everyone who has ever played the league.
 */
export function pageRoster(db: Database.Database, roundId: number): RosterEntry[] {
  const rows = db
    .prepare(
      `SELECT p.id AS id, p.name AS name
         FROM rounds r
         JOIN season_players sp ON sp.season_id = r.season_id
         JOIN players p ON p.id = sp.player_id
        WHERE r.id = ?
        ORDER BY p.name`,
    )
    .all(roundId) as Array<{ id: number; name: string }>;
  return rows.map((r) => ({ id: String(r.id), name: r.name }));
}

export type Refusal = { status: 404 | 400; reason: string };
export type Authorized = { page: PlaylistPageRef; player: RosterEntry };

/**
 * Everything a public write has to earn before it touches a table: a real page,
 * a real player on that page's roster, and a video that this page actually
 * offers for what is being done to it.
 *
 * An unknown slug and an unknown video are both 404 — a video id from another
 * round is not a bad request, it is a request for a thing that does not exist
 * here, and answering it differently would leak which ids are live elsewhere.
 */
export function authorizeWrite(
  db: Database.Database,
  slug: string,
  videoId: string,
  playerId: string,
  need: 'votable' | 'commentable',
): Authorized | Refusal {
  const page = pageForSlug(db, slug);
  if (!page) return { status: 404, reason: 'no such page' };
  const player = pageRoster(db, page.roundId).find((p) => p.id === playerId);
  if (!player) return { status: 400, reason: 'not on this round’s roster' };
  const allowed = need === 'votable' ? page.votable : page.commentable;
  if (!videoId || !allowed.includes(videoId)) return { status: 404, reason: 'no such video on this page' };
  return { page, player };
}

/**
 * One row per person per video. `dir` null withdraws.
 *
 * Re-casting the SAME direction is left alone rather than rewritten, because
 * created_at is what the band stamp is derived from: a second tap on a vote
 * somebody already holds must not move their stamp forward in time. Changing
 * direction IS a new act — the upvote happened now — so it takes the new
 * timestamp, and an up→down flip correctly hands the stamp to whatever they
 * upvoted next.
 */
export function castVote(
  db: Database.Database,
  slug: string,
  videoId: string,
  playerId: string,
  dir: VoteDir | null,
  nowIso: string,
): void {
  if (dir === null) {
    db.prepare('DELETE FROM playlist_votes WHERE slug=? AND video_id=? AND player_id=?').run(slug, videoId, playerId);
    return;
  }
  db.prepare(
    `INSERT INTO playlist_votes (slug, video_id, player_id, dir, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(slug, video_id, player_id) DO UPDATE SET
       dir = excluded.dir, created_at = excluded.created_at
     WHERE playlist_votes.dir <> excluded.dir`,
  ).run(slug, videoId, playerId, dir, nowIso);
}

/**
 * Each stamping player's ONE stamp: their earliest surviving upvote on this
 * page. Derived, never stored — withdrawing that upvote has to move the stamp
 * to whatever they upvoted next, and a stored stamp would strand it on a video
 * nobody voted for.
 *
 * The tie-break is rowid, so two upvotes written in the same millisecond still
 * order deterministically instead of picking a stamp at random per render.
 */
export function stampers(db: Database.Database, slug: string): Map<string, BandMember[]> {
  const names = Object.keys(STAMPERS);
  const rows = db
    .prepare(`SELECT id, name FROM players WHERE name IN (${names.map(() => '?').join(',')})`)
    .all(...names) as Array<{ id: number; name: string }>;
  const byVideo = new Map<string, BandMember[]>();
  const first = db.prepare(
    `SELECT video_id FROM playlist_votes
      WHERE slug=? AND player_id=? AND dir='up'
      ORDER BY created_at, rowid LIMIT 1`,
  );
  // Reading order, not query order: the drawing layer stacks by its own stage
  // order, but the list has to be stable for a byte-identical re-render.
  for (const name of names) {
    const row = rows.find((r) => r.name === name);
    if (!row) continue;
    const hit = first.get(slug, String(row.id)) as { video_id: string } | undefined;
    if (!hit) continue;
    const list = byVideo.get(hit.video_id) ?? [];
    list.push(STAMPERS[name]);
    byVideo.set(hit.video_id, list);
  }
  return byVideo;
}

export function tallies(db: Database.Database, slug: string): VoteTally[] {
  const rows = db
    .prepare(
      `SELECT video_id AS videoId,
              SUM(dir = 'up') AS up,
              SUM(dir = 'down') AS down
         FROM playlist_votes WHERE slug = ?
        GROUP BY video_id ORDER BY video_id`,
    )
    .all(slug) as Array<{ videoId: string; up: number; down: number }>;
  const stamps = stampers(db, slug);
  return rows.map((r) => ({
    videoId: r.videoId,
    up: r.up,
    down: r.down,
    stampers: stamps.get(r.videoId) ?? [],
  }));
}

export class MessageRejected extends Error {}

/**
 * Queue a message for Matt. It is `pending` and therefore private: nothing here
 * is public until he releases it, which is the promise the page's "⏳ WITH MATT"
 * chip makes.
 */
export function submitMessage(
  db: Database.Database,
  slug: string,
  videoId: string,
  playerId: string,
  text: string,
  nowIso: string,
): { id: number; token: string } {
  const body = (text ?? '').trim();
  if (!body) throw new MessageRejected('empty message');
  if (body.length > MAX_MESSAGE_CHARS) throw new MessageRejected(`message over ${MAX_MESSAGE_CHARS} characters`);
  const token = randomBytes(18).toString('base64url');
  const info = db
    .prepare(
      `INSERT INTO playlist_messages (slug, video_id, player_id, text, status, created_at, token)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(slug, videoId, playerId, body, nowIso, token);
  return { id: Number(info.lastInsertRowid), token };
}

function messagesWithStatus(db: Database.Database, slug: string, status: MessageStatus): Message[] {
  const rows = db
    .prepare(
      `SELECT m.id, m.video_id, m.player_id, m.text, m.status, m.created_at, m.decided_at,
              p.name AS player_name
         FROM playlist_messages m
         LEFT JOIN players p ON CAST(p.id AS TEXT) = m.player_id
        WHERE m.slug = ? AND m.status = ?
        ORDER BY m.created_at, m.id`,
    )
    .all(slug, status) as Array<{
    id: number; video_id: string; player_id: string; text: string; status: string;
    created_at: string; decided_at: string | null; player_name: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    videoId: r.video_id,
    playerId: r.player_id,
    playerName: r.player_name ?? 'Someone',
    text: r.text,
    status: r.status as MessageStatus,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
  }));
}

/** Matt's queue: what is waiting on him. Never served to the page. */
/**
 * The queue awaiting Matt's decision — NOT for the page.
 *
 * Deliberately not called `pendingMessages`: the spec used that name for the
 * approved-only list the page renders, and a module exporting the inverse under
 * the expected name is how unreleased messages end up public.
 */
export function queuedMessages(db: Database.Database, slug: string): Message[] {
  return messagesWithStatus(db, slug, 'pending');
}

/** The only messages that may be shown to anybody. */
export function approvedMessages(db: Database.Database, slug: string): Message[] {
  return messagesWithStatus(db, slug, 'approved');
}

export function decideMessage(
  db: Database.Database,
  id: number,
  status: 'approved' | 'denied',
  nowIso: string,
): boolean {
  const info = db
    .prepare(`UPDATE playlist_messages SET status=?, decided_at=?, token=NULL WHERE id=? AND status='pending'`)
    .run(status, nowIso, id);
  return info.changes > 0;
}

/** Resolve a single-use approval token to its still-pending message. */
export function messageByToken(db: Database.Database, token: string): Message | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT m.id, m.video_id AS videoId, m.player_id AS playerId,
              COALESCE(p.name, m.player_id) AS playerName, m.text, m.status,
              m.created_at AS createdAt, m.decided_at AS decidedAt, m.slug
         FROM playlist_messages m
         LEFT JOIN players p ON CAST(p.id AS TEXT) = m.player_id
        WHERE m.token = ? AND m.status = 'pending'`,
    )
    .get(token) as (Message & { slug: string }) | undefined;
  return row ?? null;
}

/**
 * Claim the token and mark the message decided in ONE statement, before any
 * side effect — so a double-tap on the notification cannot post twice.
 */
export function claimMessage(
  db: Database.Database, token: string, status: 'approved' | 'denied', nowIso: string,
): (Message & { slug: string }) | null {
  const msg = messageByToken(db, token) as (Message & { slug: string }) | null;
  if (!msg) return null;
  const info = db
    .prepare(`UPDATE playlist_messages SET status=?, decided_at=?, token=NULL WHERE id=? AND status='pending'`)
    .run(status, nowIso, msg.id);
  return info.changes > 0 ? { ...msg, status } : null;
}

/** Everything the page may read back, or null for an unknown slug. */
export function readModel(db: Database.Database, slug: string): PlaylistReadModel | null {
  const page = pageForSlug(db, slug);
  if (!page) return null;
  return { slug: page.slug, tallies: tallies(db, slug), messages: approvedMessages(db, slug) };
}
