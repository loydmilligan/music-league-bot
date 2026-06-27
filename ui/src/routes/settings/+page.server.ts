import type { PageServerLoad, Actions } from './$types.js';
import { fail } from '@sveltejs/kit';
import { resolve } from 'node:path';
import { getDb } from '$lib/db/client.js';
import { getSettings, updateWeights, updateUnicardWeights } from '$lib/db/settings.js';
import { getImportLog, logImport } from '$lib/db/importLog.js';
import { getAllLeagues } from '$lib/db/leagues.js';
import { parseZip } from '$lib/import/zipParser.js';
import { importZipData } from '$lib/import/importer.js';
import { runStartupImport } from '$lib/import/startupScan.js';
import { getHierarchy } from '$lib/db/metadataQueue.js';
import { getEmailPollerData } from '$lib/email/emailPollerQuery.js';

const DATA_DIR = process.env.DATA_DIR ?? resolve(process.cwd(), '../data');

export const load: PageServerLoad = async () => {
  const db = getDb();
  const settings = getSettings(db);
  const importLog = getImportLog(db);
  const allLeagues = getAllLeagues(db);
  const hierarchy = getHierarchy(db);
  const emailPoller = getEmailPollerData(db);
  return { settings, importLog, allLeagues, hierarchy, emailPoller };
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

  updateUnicardWeights: async ({ request }) => {
    const db = getDb();
    const fd = await request.formData();
    const w = {
      weightDiscovery:     Number(fd.get('weightDiscovery')),
      weightThemeFit:      Number(fd.get('weightThemeFit')),
      weightQuality:       Number(fd.get('weightQuality')),
      weightReplayability: Number(fd.get('weightReplayability')),
    };
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    if (Math.abs(total - 100) > 1) return fail(400, { error: 'Weights must sum to 100' });
    updateUnicardWeights(db, w);
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

};
