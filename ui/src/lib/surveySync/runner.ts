// Runs the survey → bot sync for every survey league and records the outcome
// in settings.survey_sync_status. Background loop is env-gated on SURVEY_DATA_DIR.
import type Database from 'better-sqlite3';
import { getDb } from '../db/client.js';
import { LEAGUE_DEFS, readSurveyLeague } from './parse.js';
import { applySurveyLeague } from './apply.js';

export const SURVEY_SYNC_STATUS_KEY = 'survey_sync_status';
const INTERVAL_MS = 5 * 60_000;

export interface LeagueSyncStatus {
  slug: string;
  at: string;
  ok: boolean;
  error?: string;
  seasonNumber?: number;
  mlLeagueId?: string;
  rounds?: number;
  inserted?: number;
  updated?: number;
  warnings: string[];
}
export type SurveySyncStatus = Record<string, LeagueSyncStatus>;

export function getSurveySyncStatus(db: Database.Database): SurveySyncStatus {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SURVEY_SYNC_STATUS_KEY) as { value: string } | undefined;
  try { return row ? JSON.parse(row.value) : {}; } catch { return {}; }
}

export function runSurveySync(db: Database.Database, dir: string, now = Date.now()): SurveySyncStatus {
  const at = new Date(now).toISOString();
  const status: SurveySyncStatus = {};
  for (const def of LEAGUE_DEFS) {
    const parsed = readSurveyLeague(dir, def, now);
    if (!parsed.ok) {
      status[def.slug] = { slug: def.slug, at, ok: false, error: parsed.error, warnings: [] };
      continue;
    }
    try {
      const res = applySurveyLeague(db, parsed.league, at);
      status[def.slug] = {
        slug: def.slug, at, ok: true, seasonNumber: parsed.league.seasonNumber, mlLeagueId: parsed.league.mlLeagueId,
        rounds: parsed.league.rounds.length, inserted: res.inserted, updated: res.updated, warnings: res.warnings,
      };
    } catch (e) {
      status[def.slug] = { slug: def.slug, at, ok: false, error: (e as Error).message, warnings: [] };
    }
  }
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(SURVEY_SYNC_STATUS_KEY, JSON.stringify(status));
  return status;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startSurveySync(): void {
  const dir = process.env.SURVEY_DATA_DIR;
  if (!dir || timer) return;
  const tick = () => {
    try {
      const status = runSurveySync(getDb(), dir);
      for (const s of Object.values(status)) {
        if (!s.ok) console.warn(`[survey-sync] ${s.slug}: ${s.error}`);
        else if (s.inserted || s.updated) console.log(`[survey-sync] ${s.slug} S${s.seasonNumber}: +${s.inserted} new, ${s.updated} changed`);
      }
    } catch (e) {
      console.error('[survey-sync] run failed:', e);
    }
  };
  tick();
  timer = setInterval(tick, INTERVAL_MS);
  timer.unref?.();
}
