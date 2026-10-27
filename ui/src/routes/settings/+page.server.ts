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
import { getSeasonBudget } from '$lib/voting-lab/ballotDb.js';
import { buildDigestFaces, listDigestAvatarOptions, setDigestAvatarSet } from '$lib/server/digestAvatars.js';

const DATA_DIR = process.env.DATA_DIR ?? resolve(process.cwd(), '../data');

export const load: PageServerLoad = async () => {
  const db = getDb();
  const settings = getSettings(db);
  const importLog = getImportLog(db);
  const allLeagues = getAllLeagues(db);
  const hierarchy = getHierarchy(db);
  const emailPoller = getEmailPollerData(db);

  // Season-level default vote budgets (Voting Phase Lab, Task 10). Only seasons
  // with an explicit override are included — the client fills in the hardcoded
  // default (7/1/no cap) for everything else.
  const seasonBudgets: Record<number, { upTotal: number; downTotal: number; perSongCap: number | null }> = {};
  for (const league of hierarchy) {
    for (const season of league.seasons) {
      const b = getSeasonBudget(db, season.id);
      if (b) seasonBudgets[season.id] = b;
    }
  }

  let digestAvatars: ReturnType<typeof listDigestAvatarOptions> = [];
  try {
    digestAvatars = listDigestAvatarOptions(db);
  } catch {
    // No Avatar Factory state yet — the panel just shows nothing to choose.
  }

  return { settings, importLog, allLeagues, hierarchy, emailPoller, seasonBudgets, digestAvatars };
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

  // One Avatar Factory set per league's digests; choosing (or re-choosing) a set
  // cuts its 96px faces, so this is also the "rebuild faces" button.
  setDigestAvatars: async ({ request }) => {
    const db = getDb();
    const fd = await request.formData();
    const league = String(fd.get('league') ?? '');
    const theme = String(fd.get('theme') ?? '');
    if (!league) return fail(400, { digestAvatarError: 'league required' });
    if (!theme) {
      setDigestAvatarSet(db, league, null);
      return { digestAvatars: { league, theme: null, written: 0, missing: [] as string[] } };
    }
    try {
      const built = await buildDigestFaces(db, league, theme);
      setDigestAvatarSet(db, league, theme);
      return { digestAvatars: { league, theme, written: built.written.length, missing: built.missing } };
    } catch (e) {
      return fail(400, { digestAvatarError: (e as Error).message });
    }
  },

  rescan: async () => {
    const db = getDb();
    await runStartupImport(db, DATA_DIR);
    return { success: true };
  },

};
