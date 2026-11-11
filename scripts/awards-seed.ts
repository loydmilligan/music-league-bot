/**
 * Seed BBB candidates from a spike-page shortlist export.
 * Usage: npx tsx scripts/awards-seed.ts <top10.json> [--award bbb] [--round <roundId>]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addCandidate } from '../src/awards/model.js';
import { openAwardStore, type AwardStore } from '../src/awards/store.js';

export interface SeedRow { rank: number; who: string; text: string; key: string; [k: string]: unknown }

export class SeedError extends Error {
  constructor(message: string, readonly exitCode = 1) {
    super(message);
    this.name = 'SeedError';
  }
}

function validateRows(top10: SeedRow[]): void {
  top10.forEach((row, i) => {
    const label = `row ${row && typeof row === 'object' && row.rank !== undefined ? row.rank : i}`;
    if (!row || typeof row !== 'object') throw new SeedError(`${label}: bad row`);
    if (typeof row.key !== 'string' || !/^\d+-\d+$/.test(row.key)) throw new SeedError(`${label}: bad key`);
    if (typeof row.who !== 'string' || !row.who.trim() || typeof row.text !== 'string' || !row.text.trim()) {
      throw new SeedError(`${label}: bad row`);
    }
  });
}

export function seedCandidates(store: AwardStore, roundId: number, award: string, top10: SeedRow[]): { added: number; duplicates: number } {
  validateRows(top10);
  if (top10.length === 0) return { added: 0, duplicates: 0 };
  let round = store.get(award, roundId);
  let added = 0;
  let duplicates = 0;
  for (const row of [...top10].sort((a, b) => a.rank - b.rank)) {
    const epoch = Number(row.key.split('-')[0]);
    const res = addCandidate(round, {
      who: row.who, authorId: null, text: row.text, ts: new Date(epoch * 1000).toISOString(),
      msgId: null, reactions: [{ emoji: '😂', who: ['Berto'] }],
    });
    if (res.duplicate) duplicates++;
    else { round = res.round; added++; }
  }
  store.put(round);
  return { added, duplicates };
}

/** Read and shape-check the export file. */
export function loadTop10(file: string): SeedRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new SeedError(`can't read ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const top10 = (parsed as { top10?: unknown } | null)?.top10;
  if (!Array.isArray(top10)) throw new SeedError(`no top10 list in ${file}`);
  return top10 as SeedRow[];
}

/** Parse and validate CLI args. `awardKeys` are the configured award keys. */
export function parseSeedArgs(args: string[], awardKeys: string[]): { file: string; award: string; roundId?: number } {
  const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  if (!file) throw new SeedError('usage: awards-seed.ts <top10.json> [--award bbb] [--round <roundId>]');
  let award = 'bbb';
  if (args.includes('--award')) {
    const raw = opt('--award');
    if (!raw || raw.startsWith('--')) throw new SeedError('bad --award');
    award = raw;
  }
  if (!awardKeys.includes(award)) throw new SeedError(`unknown award ${award}`);
  let roundId: number | undefined;
  if (args.includes('--round')) {
    const raw = opt('--round') ?? '';
    if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new SeedError('bad --round');
    roundId = Number(raw);
  }
  return { file, award, roundId };
}

async function run() {
  const args = process.argv.slice(2);
  const store = openAwardStore(path.resolve(process.env.DATA_DIR ?? 'data', 'awards'));
  const { file, award, roundId: given } = parseSeedArgs(args, store.config().awards.map((a) => a.key));
  const top10 = loadTop10(file);
  if (top10.length === 0) { console.log('nothing to seed'); return; }
  validateRows(top10);
  let roundId = given;
  if (roundId === undefined) {
    const { default: Database } = await import('better-sqlite3');
    const { targetRound } = await import('../src/awards/schedule.js');
    const def = store.config().awards.find((a) => a.key === award)!;
    const db = new Database(path.resolve(process.env.DATA_DIR ?? 'data', 'league.db'), { readonly: true });
    const cur = targetRound(db, store.config().leagueId, def, store.all(), new Date());
    db.close();
    if (!cur) throw new SeedError('no current round');
    roundId = cur.roundId;
  }
  const { added, duplicates } = seedCandidates(store, roundId, award, top10);
  console.log(`seeded ${added} (${duplicates} duplicates) into ${award} round ${roundId}`);
}

async function main() {
  try {
    await run();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(e instanceof SeedError ? e.exitCode : 1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
