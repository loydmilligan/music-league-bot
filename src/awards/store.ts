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

/** A missing file is an empty store; any other read or parse problem throws so nothing overwrites it. */
function readRounds(file: string): AwardRound[] {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const d = JSON.parse(text) as unknown;
  if (!Array.isArray(d)) throw new Error(`awards rounds file is not a list: ${file}`);
  return d as AwardRound[];
}

/** Startup check: the log line for a disabled awards feature, or null when the config reads fine. */
export function awardsDisabledReason(store: AwardStore): string | null {
  try {
    store.config();
    return null;
  } catch (e) {
    if (e instanceof AwardsConfigMissing) return '[awards] disabled: no config';
    return `[awards] disabled: bad config (${e instanceof Error ? e.name : 'error'})`;
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
