import type Database from 'better-sqlite3';

export interface ChatMessage {
  id: string;
  platform: string;
  group_name: string;
  sender: string;
  text: string;
  ts: string;
}

export interface RoundStats {
  messageCount: number;
  lastTs: string | null;
  snippet: string | null;
}

export interface ChatSettings {
  selfNames: string[];
  roundBoundary: 'strict' | 'buffer';
  bufferDays: number;
  leagueGroupMap: Record<string, string>;
}

type MediaType = 'spotify' | 'youtube' | 'ytmusic';

export function detectMedia(text: string): { hasMedia: boolean; mediaType: MediaType | null } {
  if (/music\.youtube\.com/i.test(text)) return { hasMedia: true, mediaType: 'ytmusic' };
  if (/(youtube\.com\/watch|youtu\.be\/)/i.test(text)) return { hasMedia: true, mediaType: 'youtube' };
  if (/open\.spotify\.com\/(track|album|playlist)\/|spotify:(track|album|playlist):/i.test(text)) return { hasMedia: true, mediaType: 'spotify' };
  return { hasMedia: false, mediaType: null };
}

export function getChatGroups(db: Database.Database): { group_name: string; platform: string }[] {
  return db.prepare(
    'SELECT DISTINCT group_name, platform FROM chat_messages ORDER BY group_name'
  ).all() as { group_name: string; platform: string }[];
}

export function getDistinctSenders(db: Database.Database, groupName: string): string[] {
  return (
    db.prepare('SELECT DISTINCT sender FROM chat_messages WHERE group_name = ? ORDER BY sender')
      .all(groupName) as { sender: string }[]
  ).map(r => r.sender);
}

export function getAllDistinctSenders(db: Database.Database): string[] {
  return (
    db.prepare('SELECT DISTINCT sender FROM chat_messages ORDER BY sender')
      .all() as { sender: string }[]
  ).map(r => r.sender);
}

export function getRoundMessages(
  db: Database.Database,
  groupName: string,
  fromIso: string,
  toIso: string,
  opts: { limit?: number; before?: string } = {},
): ChatMessage[] {
  const { limit, before } = opts;
  if (limit) {
    // Fetch last `limit` messages before `before` (or end of window), then reverse to ASC order
    const ceiling = before ?? toIso;
    const rows = db.prepare(`
      SELECT id, platform, group_name, sender, text, ts
      FROM chat_messages
      WHERE group_name = ? AND ts >= ? AND ts < ?
      ORDER BY ts DESC LIMIT ?
    `).all(groupName, fromIso, ceiling, limit) as ChatMessage[];
    return rows.reverse();
  }
  return db.prepare(`
    SELECT id, platform, group_name, sender, text, ts
    FROM chat_messages
    WHERE group_name = ? AND ts >= ? AND ts <= ?
    ORDER BY ts ASC
  `).all(groupName, fromIso, toIso) as ChatMessage[];
}

/**
 * Collapse a WhatsApp edit that the relay recorded as a second message.
 *
 * The relay cannot tell an edit from a new message, so a corrected typo arrives
 * as a near-identical follow-up from the same sender. R150's digest narrated one
 * of these as a joke ("Conor opened with a double-sent message"), which is the
 * bot reporting its own ingestion artifact back to the group.
 *
 * Only consecutive same-sender pairs are considered, and the later message wins
 * (it is the correction). The 20-character floor is what keeps real conversation
 * out of it: "Me ?" and "Umm" are two edits apart and are not the same message.
 */
const EDIT_MIN_LEN = 20;
const EDIT_MAX_DISTANCE = 2;

function normalizeForEdit(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function boundedDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr.push(
        Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)),
      );
    }
    if (Math.min(...curr) > max) return max + 1;
    prev = curr;
  }
  return prev[b.length];
}

export function dedupeRelayEdits<T extends { sender: string; text: string }>(messages: T[]): T[] {
  const out: T[] = [];
  for (const m of messages) {
    const prev = out[out.length - 1];
    if (prev && prev.sender === m.sender) {
      const a = normalizeForEdit(prev.text);
      const b = normalizeForEdit(m.text);
      const long = a.length >= EDIT_MIN_LEN && b.length >= EDIT_MIN_LEN;
      if (a === b || (long && boundedDistance(a, b, EDIT_MAX_DISTANCE) <= EDIT_MAX_DISTANCE)) {
        out[out.length - 1] = m; // the later message is the corrected one
        continue;
      }
    }
    out.push(m);
  }
  return out;
}

export function getRoundStats(
  db: Database.Database,
  groupName: string,
  fromIso: string,
  toIso: string,
): RoundStats {
  const row = db.prepare(`
    SELECT COUNT(*) as message_count, MAX(ts) as last_ts
    FROM chat_messages
    WHERE group_name = ? AND ts >= ? AND ts <= ?
  `).get(groupName, fromIso, toIso) as { message_count: number; last_ts: string | null } | undefined;

  const snipRow = db.prepare(`
    SELECT sender || ': ' || SUBSTR(text, 1, 80) as snip
    FROM chat_messages
    WHERE group_name = ? AND ts >= ? AND ts <= ?
    ORDER BY ts DESC LIMIT 1
  `).get(groupName, fromIso, toIso) as { snip: string } | undefined;

  return {
    messageCount: row?.message_count ?? 0,
    lastTs: row?.last_ts ?? null,
    snippet: snipRow?.snip ?? null,
  };
}

export function searchMessages(
  db: Database.Database,
  opts: {
    groupName: string;
    query: string;
    fromIso?: string;
    toIso?: string;
    sender?: string;
    mediaOnly?: boolean;
  },
): ChatMessage[] {
  const { groupName, query, fromIso, toIso, sender, mediaOnly } = opts;
  let sql = `
    SELECT id, platform, group_name, sender, text, ts
    FROM chat_messages
    WHERE group_name = ?
    AND LOWER(text) LIKE LOWER(?)
  `;
  const params: unknown[] = [groupName, `%${query}%`];

  if (fromIso) { sql += ' AND ts >= ?'; params.push(fromIso); }
  if (toIso)   { sql += ' AND ts <= ?'; params.push(toIso); }
  if (sender)  { sql += ' AND sender = ?'; params.push(sender); }

  sql += ' ORDER BY ts DESC LIMIT 200';

  let rows = db.prepare(sql).all(...params) as ChatMessage[];

  if (mediaOnly) {
    rows = rows.filter(r => detectMedia(r.text).hasMedia);
  }

  return rows;
}

export function getChatSettings(db: Database.Database): ChatSettings {
  const rows = db.prepare(
    "SELECT key, value FROM settings WHERE key LIKE 'chat_%'"
  ).all() as { key: string; value: string }[];
  const m = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    selfNames: JSON.parse(m.chat_self_names ?? '[]'),
    roundBoundary: (m.chat_round_boundary ?? 'strict') as 'strict' | 'buffer',
    bufferDays: parseInt(m.chat_buffer_days ?? '1', 10),
    leagueGroupMap: JSON.parse(m.chat_league_group_map ?? '{}'),
  };
}

export function saveChatSettings(db: Database.Database, settings: ChatSettings): void {
  const upsert = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  const tx = db.transaction(() => {
    upsert.run('chat_self_names', JSON.stringify(settings.selfNames));
    upsert.run('chat_round_boundary', settings.roundBoundary);
    upsert.run('chat_buffer_days', String(settings.bufferDays));
    upsert.run('chat_league_group_map', JSON.stringify(settings.leagueGroupMap));
  });
  tx();
}

/**
 * Compute the chat-history window for a given round.
 *
 * Anchored on the round lifecycle (`voting_ended_at`/`voting_deadline`), NOT on
 * `rounds.created_at`. `created_at` is the row's insert time, so re-importing a
 * league rewrites it for every round at once: on 2026-09-10 every Boarz round
 * was re-stamped within 8ms of 04:03:18, which collapsed all ten windows onto
 * the same ±2-day buffer around that instant. Each round's chat section then saw
 * the same 102 messages — the last two days of the group — and R150's digest
 * reported one Monday-night thread as the whole week.
 *
 * The window runs from the previous round's end to this round's end, so chat
 * between two rounds is reported by exactly one of them. The buffer setting is
 * only applied on the `created_at` fallback: a gapless window needs no padding,
 * and padding it would report the same messages in two consecutive digests.
 *
 * Returns empty strings when the round or its league mapping is absent — callers
 * should skip fetching when `groupName` is empty.
 */
export function roundChatWindow(
  db: Database.Database,
  roundId: number,
): { groupName: string; fromIso: string; toIso: string } {
  const round = db
    .prepare(
      `SELECT r.created_at AS createdAt, r.round_started_at AS startedAt,
              r.voting_ended_at AS votingEndedAt, r.voting_deadline AS votingDeadline,
              l.slug AS slug, r.season_id AS seasonId
       FROM rounds r
       JOIN seasons s ON s.id = r.season_id
       JOIN leagues l ON l.id = s.league_id
       WHERE r.id = ?`,
    )
    .get(roundId) as
    | {
        createdAt: string;
        startedAt: string | null;
        votingEndedAt: string | null;
        votingDeadline: string | null;
        slug: string;
        seasonId: number;
      }
    | undefined;

  if (!round) return { groupName: '', fromIso: '', toIso: '' };

  const settings = getChatSettings(db);
  const groupName = settings.leagueGroupMap[round.slug] ?? '';

  // Rounds are ordered by voting_deadline, not round_number: every Boarz round
  // has a NULL round_number, and voting_deadline is populated league-wide
  // (sssc's were backfilled from its last vote timestamps).
  const end = round.votingEndedAt ?? round.votingDeadline;
  if (end) {
    const prev = db
      .prepare(
        `SELECT COALESCE(voting_ended_at, voting_deadline) AS prevEnd
         FROM rounds
         WHERE season_id = ? AND id <> ? AND voting_deadline IS NOT NULL
           AND voting_deadline < ?
         ORDER BY voting_deadline DESC, id DESC LIMIT 1`,
      )
      .get(round.seasonId, roundId, round.votingDeadline ?? end) as { prevEnd: string | null } | undefined;

    // First round of a season has no predecessor: fall back to when it started,
    // else the week before it ended.
    const start =
      prev?.prevEnd ??
      round.startedAt ??
      new Date(new Date(end).getTime() - 7 * 86_400_000).toISOString();

    return { groupName, fromIso: start, toIso: end };
  }

  // No lifecycle timestamps at all (a round row that was never started): the old
  // created_at formula, buffer included, is the only thing left to go on.
  const next = db
    .prepare(
      'SELECT created_at AS createdAt FROM rounds WHERE season_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT 1',
    )
    .get(round.seasonId, round.createdAt) as { createdAt: string } | undefined;

  let fromIso = round.createdAt;
  let toIso = next ? next.createdAt : new Date().toISOString();

  if (settings.roundBoundary === 'buffer') {
    const buf = settings.bufferDays * 86_400_000;
    fromIso = new Date(new Date(fromIso).getTime() - buf).toISOString();
    toIso = new Date(new Date(toIso).getTime() + buf).toISOString();
  }

  return { groupName, fromIso, toIso };
}

export function getTotalMessageCount(db: Database.Database, groupName?: string): number {
  if (groupName) {
    const row = db.prepare('SELECT COUNT(*) as n FROM chat_messages WHERE group_name = ?').get(groupName) as { n: number } | undefined;
    return row?.n ?? 0;
  }
  const row = db.prepare('SELECT COUNT(*) as n FROM chat_messages').get() as { n: number } | undefined;
  return row?.n ?? 0;
}
