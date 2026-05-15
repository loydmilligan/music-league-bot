import type { PageServerLoad, Actions } from './$types.js';
import { fail } from '@sveltejs/kit';
import { resolve } from 'node:path';
import { getDb } from '$lib/db/client.js';
import { getSettings, updateWeights } from '$lib/db/settings.js';
import { getImportLog, logImport } from '$lib/db/importLog.js';
import { getRoundsForSeason, updateDeadlines } from '$lib/db/rounds.js';
import { getAllLeagues, getActiveSeasonsWithLeague } from '$lib/db/leagues.js';
import { getQueueStatus, retryFailed } from '$lib/db/ytmQueue.js';
import { parseZip } from '$lib/import/zipParser.js';
import { importZipData } from '$lib/import/importer.js';
import { runStartupImport } from '$lib/import/startupScan.js';

const DATA_DIR = process.env.DATA_DIR ?? resolve(process.cwd(), '../data');

export const load: PageServerLoad = async () => {
  const db = getDb();
  const settings = getSettings(db);
  const importLog = getImportLog(db);
  const allLeagues = getAllLeagues(db);
  const activeRounds = getActiveSeasonsWithLeague(db).flatMap(s => {
    const rounds = getRoundsForSeason(db, s.id);
    return rounds.map(r => ({ ...r, leagueName: s.league.name, seasonNumber: s.seasonNumber }));
  });
  const queueStatus = getQueueStatus(db);
  return { settings, importLog, allLeagues, activeRounds, queueStatus };
};

export const actions: Actions = {
  updateWeights: async ({ request }) => {
    const db = getDb();
    const fd = await request.formData();
    const w = {
      weightDiscovery: Number(fd.get('weightDiscovery')),
      weightThemeFit:  Number(fd.get('weightThemeFit')),
      weightPersonal:  Number(fd.get('weightPersonal')),
      weightNostalgia: Number(fd.get('weightNostalgia')),
    };
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    if (Math.abs(total - 100) > 1) return fail(400, { error: 'Weights must sum to 100' });
    updateWeights(db, w);
    return { success: true };
  },

  importZip: async ({ request }) => {
    const db = getDb();
    const fd = await request.formData();
    const leagueSlug = fd.get('league') as string;
    const seasonNumber = Number(fd.get('season'));
    const file = fd.get('zip') as File;
    if (!file || !leagueSlug || !seasonNumber) return fail(400, { error: 'Missing fields' });
    const buf = Buffer.from(await file.arrayBuffer());
    const parsed = parseZip(buf);
    const result = importZipData(db, leagueSlug, seasonNumber, parsed);
    logImport(db, { leagueSlug, seasonNumber, filename: file.name, importedAt: new Date().toISOString(), ...result, error: result.error ?? null });
    return { success: true, ...result };
  },

  rescan: async () => {
    const db = getDb();
    await runStartupImport(db, DATA_DIR);
    return { success: true };
  },

  updateDeadline: async ({ request }) => {
    const db = getDb();
    const fd = await request.formData();
    const roundId = Number(fd.get('roundId'));
    // Empty inputs mean "don't change this column" — important because legacy
    // ML-imported deadlines are non-ISO strings (e.g. "22 June @ 12:00am")
    // which a datetime-local input renders empty. The previous code coerced
    // empty → null and wiped the existing value on every save.
    const subRaw  = ((fd.get('submissionDeadline') as string | null) ?? '').trim();
    const voteRaw = ((fd.get('votingDeadline')    as string | null) ?? '').trim();
    const sub  = subRaw  === '' ? undefined : subRaw;
    const vote = voteRaw === '' ? undefined : voteRaw;
    if (sub === undefined && vote === undefined) return { success: true, noop: true };
    updateDeadlines(db, roundId, sub, vote);
    return { success: true };
  },

  retryYtm: async ({ request }) => {
    const db = getDb();
    const fd = await request.formData();
    retryFailed(db, Number(fd.get('id')));
    return { success: true };
  },
};
