import type Database from 'better-sqlite3';
import type { AwardDef } from './types.js';

const TZ = 'America/Los_Angeles';
const laFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function laParts(d: Date): { y: number; m: number; d: number; h: number } {
  const p = Object.fromEntries(laFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour };
}

/** The UTC instant of 08:00 LA on the given calendar date (month overflow is normalised by Date.UTC). */
function eightAmLa(y: number, m: number, d: number): Date {
  for (const utcHour of [15, 16]) {
    const t = new Date(Date.UTC(y, m - 1, d, utcHour));
    if (laParts(t).h === 8) return t;
  }
  return new Date(Date.UTC(y, m - 1, d, 16));
}

/** Day 1 = first 08:00 LA strictly after release; day N = N-1 calendar days later. */
export function dayAt(releasedAt: string, day: number): Date {
  const rel = new Date(releasedAt);
  const la = laParts(rel);
  let first = eightAmLa(la.y, la.m, la.d);
  let { y, m, d } = la;
  if (first.getTime() <= rel.getTime()) {
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    y = next.getUTCFullYear(); m = next.getUTCMonth() + 1; d = next.getUTCDate();
    first = eightAmLa(y, m, d);
  }
  const t = new Date(Date.UTC(y, m - 1, d + (day - 1)));
  return eightAmLa(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export interface RoundInfo { roundId: number; releasedAt: string; windowStart: string }

const iso = (d: Date) => d.toISOString().replace('.000Z', 'Z');

/**
 * Latest round of the league's active season that has a digest2_shares row.
 * windowStart = previous shared round's release, else the season start
 * (earliest submission_deadline of the season minus 7 days).
 */
export function currentRound(db: Database.Database, leagueId: number, _now: Date): RoundInfo | null {
  const shared = db.prepare(
    `SELECT r.id AS id, s.id AS seasonId, d.created_at AS releasedAt
       FROM rounds r
       JOIN seasons s ON s.id = r.season_id
       JOIN digest2_shares d ON d.round_id = r.id
      WHERE s.league_id = ? AND s.status = 'active'
      ORDER BY s.season_number DESC, r.round_number DESC
      LIMIT 2`,
  ).all(leagueId) as { id: number; seasonId: number; releasedAt: string }[];
  const cur = shared[0];
  if (!cur) return null;
  const prev = shared[1]?.seasonId === cur.seasonId ? shared[1] : undefined;
  if (prev) return { roundId: cur.id, releasedAt: cur.releasedAt, windowStart: prev.releasedAt };
  const row = db.prepare(`SELECT MIN(submission_deadline) AS d FROM rounds WHERE season_id = ?`).get(cur.seasonId) as { d: string | null };
  const base = row.d ? new Date(row.d) : new Date(cur.releasedAt);
  return { roundId: cur.id, releasedAt: cur.releasedAt, windowStart: iso(new Date(base.getTime() - 7 * 86400000)) };
}

export function windowStartFor(def: AwardDef, round: RoundInfo, now: Date): string {
  return def.window === 'round' ? round.windowStart : new Date(now.getTime() - 7 * 86400000).toISOString();
}
