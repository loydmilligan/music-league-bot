/**
 * Seed BBB candidates from a spike-page shortlist export.
 * Usage: npx tsx scripts/awards-seed.ts <top10.json> [--award bbb] [--round <roundId>]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addCandidate } from '../src/awards/model.js';
import type { AwardStore } from '../src/awards/store.js';

export interface SeedRow { rank: number; who: string; text: string; key: string; [k: string]: unknown }

export function seedCandidates(store: AwardStore, roundId: number, award: string, top10: SeedRow[]): { added: number; duplicates: number } {
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

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  if (!file) { console.error('usage: awards-seed.ts <top10.json> [--award bbb] [--round <roundId>]'); process.exit(1); }
  const award = opt('--award') ?? 'bbb';
  const { top10 } = JSON.parse(readFileSync(file, 'utf8')) as { top10: SeedRow[] };
  const { openAwardStore } = await import('../src/awards/store.js');
  const store = openAwardStore(path.resolve(process.env.DATA_DIR ?? 'data', 'awards'));
  let roundId = opt('--round') ? Number(opt('--round')) : undefined;
  if (roundId === undefined) {
    const { default: Database } = await import('better-sqlite3');
    const { currentRound } = await import('../src/awards/schedule.js');
    const db = new Database(path.resolve(process.env.DATA_DIR ?? 'data', 'league.db'), { readonly: true });
    const cur = currentRound(db, store.config().leagueId, new Date());
    db.close();
    if (!cur) { console.error('no current round'); process.exit(1); }
    roundId = cur.roundId;
  }
  const { added, duplicates } = seedCandidates(store, roundId, award, top10);
  console.log(`seeded ${added} (${duplicates} duplicates) into ${award} round ${roundId}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
