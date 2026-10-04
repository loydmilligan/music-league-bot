import { resolve, join } from 'node:path';
import { getDb } from '$lib/db/client.js';
import {
  getAllAdoptedLeagues,
  getCrossLeagueUpcoming,
  getWatcherDiagnostics,
  getContentPendingCount,
  type LeagueRailEntry,
  type CrossLeagueUpcoming,
  type WatcherDiagnostics,
} from '$lib/db/layout.js';
import { getUnassignedNotDismissedCount } from '$lib/chat/chat.js';
import type { LayoutServerLoad } from './$types.js';

export interface LayoutData {
  leagues: LeagueRailEntry[];
  crossLeagueUpcoming: CrossLeagueUpcoming[];
  watcher: WatcherDiagnostics;
  chatUnassignedCount: number;
  contentPendingCount: number;
}

// Share-mode pages (published digests, portal stats) are inlined to the public;
// the bare share layout reads only `page.data.share` (from the page's own load),
// so no admin data may be returned for them.
export const load: LayoutServerLoad = async ({ url }): Promise<LayoutData | Record<string, never>> => {
  if (url.searchParams.get('share') === '1' || url.pathname.startsWith('/portal-stats/')) return {};
  const db = getDb();
  const dataDir = process.env.DATA_DIR ?? resolve(process.cwd(), '../data');
  return {
    leagues: getAllAdoptedLeagues(db),
    crossLeagueUpcoming: getCrossLeagueUpcoming(db),
    watcher: getWatcherDiagnostics(db, join(dataDir, 'league.db')),
    chatUnassignedCount: getUnassignedNotDismissedCount(db),
    contentPendingCount: getContentPendingCount(db),
  };
};
