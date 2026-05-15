import { resolve, join } from 'node:path';
import { getDb } from '$lib/db/client.js';
import {
  getAllAdoptedLeagues,
  getCrossLeagueUpcoming,
  getWatcherDiagnostics,
  type LeagueRailEntry,
  type CrossLeagueUpcoming,
  type WatcherDiagnostics,
} from '$lib/db/layout.js';
import type { LayoutServerLoad } from './$types.js';

export interface LayoutData {
  leagues: LeagueRailEntry[];
  crossLeagueUpcoming: CrossLeagueUpcoming[];
  watcher: WatcherDiagnostics;
}

export const load: LayoutServerLoad = async (): Promise<LayoutData> => {
  const db = getDb();
  const dataDir = process.env.DATA_DIR ?? resolve(process.cwd(), '../data');
  return {
    leagues: getAllAdoptedLeagues(db),
    crossLeagueUpcoming: getCrossLeagueUpcoming(db),
    watcher: getWatcherDiagnostics(db, join(dataDir, 'league.db')),
  };
};
