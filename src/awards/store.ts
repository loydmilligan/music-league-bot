import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AwardRound, AwardsConfig } from './types.js';

export class AwardsConfigMissing extends Error {
  constructor(file: string) {
    super(`awards config missing: ${file}`);
    this.name = 'AwardsConfigMissing';
  }
}

export interface AwardStore {
  config(): AwardsConfig;
  get(award: string, roundId: number): AwardRound;
  put(r: AwardRound): void;
  all(): AwardRound[];
}

function readRounds(file: string): AwardRound[] {
  try {
    const d = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return Array.isArray(d) ? (d as AwardRound[]) : [];
  } catch {
    return [];
  }
}

/** File store: `<dir>/config.json` (read each call) and `<dir>/rounds.json` (atomic writes, mode 0600). */
export function openAwardStore(dir: string): AwardStore {
  const configFile = path.join(dir, 'config.json');
  const roundsFile = path.join(dir, 'rounds.json');
  return {
    config() {
      let text: string;
      try {
        text = readFileSync(configFile, 'utf8');
      } catch {
        throw new AwardsConfigMissing(configFile);
      }
      return JSON.parse(text) as AwardsConfig;
    },
    get(award, roundId) {
      const found = readRounds(roundsFile).find((r) => r.award === award && r.roundId === roundId);
      return found ?? { award, roundId, candidates: [], picks: {}, approvals: [] };
    },
    put(r) {
      const rest = readRounds(roundsFile).filter((x) => !(x.award === r.award && x.roundId === r.roundId));
      mkdirSync(dir, { recursive: true });
      const tmp = `${roundsFile}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify([...rest, r], null, 2) + '\n', { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, roundsFile);
    },
    all: () => readRounds(roundsFile),
  };
}
