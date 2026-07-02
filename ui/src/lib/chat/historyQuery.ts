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
 * Mirrors the window formula from the round page server so both callers share
 * identical logic.  Returns empty strings when the round or its league mapping
 * is absent — callers should skip fetching when `groupName` is empty.
 */
export function roundChatWindow(
  db: Database.Database,
  roundId: number,
): { groupName: string; fromIso: string; toIso: string } {
  const round = db
    .prepare(
      `SELECT r.created_at AS createdAt, l.slug AS slug, r.season_id AS seasonId
       FROM rounds r
       JOIN seasons s ON s.id = r.season_id
       JOIN leagues l ON l.id = s.league_id
       WHERE r.id = ?`,
    )
    .get(roundId) as { createdAt: string; slug: string; seasonId: number } | undefined;

  if (!round) return { groupName: '', fromIso: '', toIso: '' };

  const next = db
    .prepare(
      'SELECT created_at AS createdAt FROM rounds WHERE season_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT 1',
    )
    .get(round.seasonId, round.createdAt) as { createdAt: string } | undefined;

  const settings = getChatSettings(db);
  const groupName = settings.leagueGroupMap[round.slug] ?? '';

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
