import type Database from 'better-sqlite3';
import type { GenParams } from '$lib/digest/llm.js';

// Seeded from the Generate modal's current defaults. Deferred block 2.1.1 will
// replace this flat default with a learned per-league house-style profile.
// An empty `sections` array is a valid GenParams (all fields optional) and
// signals llm.js's generateDraft to fall back to its built-in default section
// set — see llm.ts:89.
export const DEFAULT_GEN_PARAMS: GenParams = {
  sections: [],
};

export function getLeagueDigestConfig(
  db: Database.Database,
  leagueId: number,
): { mode: 'auto' | 'hil' | 'off'; genParams: GenParams } {
  const row = db
    .prepare(`SELECT digest_mode AS mode, digest_gen_params AS gp FROM leagues WHERE id=?`)
    .get(leagueId) as { mode: string | null; gp: string | null } | undefined;
  const mode = row?.mode === 'auto' || row?.mode === 'hil' ? row.mode : 'off';
  let genParams: GenParams = DEFAULT_GEN_PARAMS;
  if (row?.gp) {
    try {
      genParams = JSON.parse(row.gp) as GenParams;
    } catch {
      genParams = DEFAULT_GEN_PARAMS;
    }
  }
  return { mode, genParams };
}
