import type Database from 'better-sqlite3';

export type Match = { who: string; authorId: string | null; text: string; ts: string; msgId: string | null };

const PREFIX_MIN = 20;
const TS_WINDOW_MS = 120_000;

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Strip the leading "~" and any non-printing characters from a chat_messages sender. */
function cleanName(s: string): string {
  return s.replace(/[\p{C}\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '').replace(/^\s*~\s*/, '').replace(/\s+/g, ' ').trim();
}

const nameKey = (s: string): string => norm(cleanName(s)).replace(/[^\p{L}\p{N} ]/gu, '');

function sameAuthor(a: string, b: string): boolean {
  const x = nameKey(a);
  const y = nameKey(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x) || x.split(' ')[0] === y.split(' ')[0]);
}

interface WaRow { msg_id: string; author_id: string | null; author_name: string | null; snippet: string | null; ts: string }

function findWa(db: Database.Database, who: string, text: string, ts: string): { msgId: string | null; authorId: string | null } {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return { msgId: null, authorId: null };
  // Wider SQL bounds than the real window so ISO format variants never drop a row.
  const lo = new Date(t - 300_000).toISOString();
  const hi = new Date(t + 300_000).toISOString();
  const rows = db
    .prepare(`SELECT msg_id, author_id, author_name, snippet, ts FROM wa_messages WHERE ts >= ? AND ts <= ?`)
    .all(lo, hi) as WaRow[];
  const nt = norm(text);
  const cands = rows
    .map((r) => ({ r, dt: Math.abs(Date.parse(r.ts) - t), sn: norm(r.snippet ?? '') }))
    .filter((c) => c.dt <= TS_WINDOW_MS && c.sn !== '' && nt.startsWith(c.sn));
  if (cands.length === 0) return { msgId: null, authorId: null };
  cands.sort((a, b) => {
    const am = sameAuthor(who, a.r.author_name ?? '') ? 0 : 1;
    const bm = sameAuthor(who, b.r.author_name ?? '') ? 0 : 1;
    return am - bm || a.dt - b.dt;
  });
  return { msgId: cands[0].r.msg_id, authorId: cands[0].r.author_id ?? null };
}

/**
 * Find the group messages a forwarded text came from. Exact normalized match first;
 * a prefix match only when nothing is equal and the forward is long enough to mean something.
 */
export function matchForward(db: Database.Database, text: string, groupName: string, sinceIso: string): Match[] {
  const target = norm(text);
  if (!target) return [];
  const rows = db
    .prepare(`SELECT sender, text, ts FROM chat_messages WHERE group_name = ? AND ts >= ? ORDER BY ts ASC`)
    .all(groupName, sinceIso) as { sender: string; text: string | null; ts: string }[];
  const normed = rows.map((r) => ({ r, n: norm(r.text ?? '') }));
  let hits = normed.filter((x) => x.n === target);
  if (hits.length === 0 && target.length >= PREFIX_MIN) hits = normed.filter((x) => x.n.startsWith(target));
  return hits.map(({ r }) => {
    const who = cleanName(r.sender ?? '');
    const { msgId, authorId } = findWa(db, who, r.text ?? '', r.ts);
    return { who, authorId, text: r.text ?? '', ts: r.ts, msgId };
  });
}
