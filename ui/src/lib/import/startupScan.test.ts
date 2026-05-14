import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { openLeagueDb } from '../db/client.js';
import { runStartupImport } from './startupScan.js';

it('skips non-directory entries like .gitkeep in the data dir', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'ml-scan-'));
  try {
    // Stray file at the league-slug level — the kind of thing git adds to keep
    // an otherwise-empty directory tracked. Must not crash the scan.
    writeFileSync(resolve(dir, '.gitkeep'), '');
    // A real league dir with a stray file at the season level too.
    mkdirSync(resolve(dir, 'fake-league'), { recursive: true });
    writeFileSync(resolve(dir, 'fake-league', '.DS_Store'), '');
    // And a non season-* subdir that should also be ignored.
    mkdirSync(resolve(dir, 'fake-league', 'notes'), { recursive: true });

    const db = openLeagueDb(':memory:');
    await expect(runStartupImport(db, dir)).resolves.toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('returns cleanly when the data dir does not exist', async () => {
  const db = openLeagueDb(':memory:');
  await expect(runStartupImport(db, '/nonexistent/ml-scan-path')).resolves.toBeUndefined();
});
