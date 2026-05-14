import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import type Database from 'better-sqlite3';
import { parseZip } from './zipParser.js';
import { importZipData } from './importer.js';
import { logImport } from '../db/importLog.js';
import { seedLeagues } from '../db/leagues.js';

export async function runStartupImport(db: Database.Database, dataDir: string): Promise<void> {
  seedLeagues(db);
  if (!existsSync(dataDir)) return;
  for (const leagueSlug of readdirSync(dataDir)) {
    const leagueDir = resolve(dataDir, leagueSlug);
    if (!existsSync(leagueDir)) continue;
    for (const seasonDir of readdirSync(leagueDir)) {
      const zipPath = resolve(leagueDir, seasonDir, 'export.zip');
      if (!existsSync(zipPath)) continue;
      const seasonNumber = parseInt(seasonDir.replace('season-', ''), 10);
      if (isNaN(seasonNumber)) continue;
      try {
        const result = importZipData(db, leagueSlug, seasonNumber, parseZip(readFileSync(zipPath)));
        logImport(db, { leagueSlug, seasonNumber, filename: basename(zipPath), importedAt: new Date().toISOString(), ...result, error: result.error ?? null });
      } catch (err) {
        logImport(db, { leagueSlug, seasonNumber, filename: basename(zipPath), importedAt: new Date().toISOString(), roundsCount: 0, submissionsCount: 0, votesCount: 0, status: 'error', error: String(err) });
      }
    }
  }
}
