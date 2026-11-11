import type Database from 'better-sqlite3';
import { postedOk } from './model.js';
import type { AwardDef, AwardRound } from './types.js';

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

export interface RoundInfo { roundId: number; releasedAt: string | null; windowStart: string }

const iso = (d: Date) => d.toISOString().replace('.000Z', 'Z');
const DAY_MS = 86400000;

/**
 * R14: the 08:00 LA an approved award posts at: its scheduled day, or the first 08:00 after the
 * approval if that is later. null when that would be after the next day's 08:00 (too late; skip).
 */
export function postAtFor(releasedAt: string, day: number, approvedAt: string): Date | null {
  const at = Math.max(dayAt(releasedAt, day).getTime(), dayAt(approvedAt, 1).getTime());
  return at > dayAt(releasedAt, day + 1).getTime() ? null : new Date(at);
}

/**
 * R13: the round an award's DMs act on. The earliest round of the league's active season (by
 * round_number) that has no successful post for this award and is either unreleased (no
 * digest2_shares row yet) or still before its award day's 08:00 + 24h.
 * windowStart = release of the latest earlier round in that season, else season start
 * (earliest submission_deadline of the season minus 7 days).
 */
export function targetRound(
  db: Database.Database, leagueId: number, def: AwardDef, rounds: AwardRound[], now: Date,
): RoundInfo | null {
  const season = db.prepare(
    `SELECT id FROM seasons WHERE league_id = ? AND status = 'active' ORDER BY season_number DESC LIMIT 1`,
  ).get(leagueId) as { id: number } | undefined;
  if (!season) return null;
  const rows = db.prepare(
    `SELECT r.id AS id, r.submission_deadline AS deadline, d.created_at AS releasedAt
       FROM rounds r LEFT JOIN digest2_shares d ON d.round_id = r.id
      WHERE r.season_id = ? ORDER BY r.round_number ASC, r.id ASC`,
  ).all(season.id) as { id: number; deadline: string | null; releasedAt: string | null }[];
  let prevRelease: string | null = null;
  for (const row of rows) {
    const rec = rounds.find((r) => r.award === def.key && r.roundId === row.id);
    const done = rec !== undefined && postedOk(rec);
    const open = !row.releasedAt || now.getTime() < dayAt(row.releasedAt, def.day).getTime() + DAY_MS;
    if (!done && open) {
      let windowStart = prevRelease;
      if (!windowStart) {
        const deadlines = rows.map((r) => r.deadline).filter((d): d is string => !!d).map((d) => Date.parse(d)).filter((t) => !Number.isNaN(t));
        const base = deadlines.length ? Math.min(...deadlines) : Date.parse(row.releasedAt ?? now.toISOString());
        windowStart = iso(new Date(base - 7 * DAY_MS));
      }
      return { roundId: row.id, releasedAt: row.releasedAt ?? null, windowStart };
    }
    if (row.releasedAt) prevRelease = row.releasedAt;
  }
  return null;
}

export function windowStartFor(def: AwardDef, round: RoundInfo, now: Date): string {
  return def.window === 'round' ? round.windowStart : new Date(now.getTime() - 7 * 86400000).toISOString();
}
