import { it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openLeagueDb } from '../db/client.js';
import { seedLeagues } from '../db/leagues.js';
import { parseZip } from './zipParser.js';
import { importZipData } from './importer.js';

const mk = () => { const db = openLeagueDb(':memory:'); seedLeagues(db); return db; };

function fixture(rel: string): string | null {
  for (const base of ['../data', '../../data']) {
    const p = resolve(base, rel);
    if (existsSync(p)) return p;
  }
  return null;
}

const hj = fixture('hip-jammers/season-1/export.zip');
const np = fixture('nostalgia-pit/season-1/export.zip');

(hj ? it : it.skip)('imports HJ S1 with rounds+submissions+votes', () => {
  const db = mk();
  const r = importZipData(db, 'hip-jammers', 1, parseZip(readFileSync(hj!)));
  expect(r.status).toBe('success');
  expect(r.roundsCount).toBeGreaterThan(0);
  expect(r.votesCount).toBeGreaterThan(0);
});

(hj ? it : it.skip)('idempotent', () => {
  const db = mk();
  const buf = readFileSync(hj!);
  importZipData(db, 'hip-jammers', 1, parseZip(buf));
  expect(importZipData(db, 'hip-jammers', 1, parseZip(buf)).status).toBe('success');
});

(np ? it : it.skip)('handles empty in-progress ZIP', () => {
  const db = mk();
  const r = importZipData(db, 'nostalgia-pit', 1, parseZip(readFileSync(np!)));
  expect(r.status).toBe('success');
});
