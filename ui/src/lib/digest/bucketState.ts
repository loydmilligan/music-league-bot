import type Database from 'better-sqlite3';
import { modelFor, HARDCODED_MODEL } from './modelFor.js';

export interface BucketState {
  key: 'predict' | 'digest';
  /** DB-saved model_id, or null if not set. */
  selected: string | null;
  /** Env var value for this bucket, or null if not set. */
  envValue: string | null;
  /** Always 'anthropic/claude-sonnet-4-5' — the hardcoded ultimate fallback. */
  hardcoded: string;
  /** What modelFor() actually resolves to (selected ?? envValue ?? hardcoded). */
  resolved: string;
  /** Qualifying capabilities required to use this bucket. */
  requires: { json: boolean };
  /** Tooltip text explaining the recommended model properties. */
  recommend: string;
  /** Task IDs that use this bucket. */
  usedBy: string[];
}

const ENV_KEYS = {
  predict: 'OPENROUTER_PREDICT_MODEL',
  digest: 'OPENROUTER_DIGEST_MODEL',
} as const;

const SETTING_KEYS = {
  predict: 'predict_model',
  digest: 'digest_model',
} as const;

const USED_BY: Record<'predict' | 'digest', string[]> = {
  predict: [
    'narrative-player-superlatives',
    'narrative-fan-hater-blurbs',
    'narrative-league-reel',
    'narrative-moment-lines',
    'profile-spectrum',
    'profile-playlist',
  ],
  digest: ['digest', 'season-update'],
};

const RECOMMEND: Record<'predict' | 'digest', string> = {
  predict: 'Structured JSON output required (cap_json). Used for player profiles and b-side narrative awards.',
  digest: 'Structured JSON output required (cap_json). Used for round digest generation and season updates.',
};

export function buildBucketState(bucket: 'predict' | 'digest', db: Database.Database): BucketState {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(SETTING_KEYS[bucket]) as { value: string } | undefined;
  const selected = row?.value ?? null;
  const envValue = process.env[ENV_KEYS[bucket]] ?? null;
  const resolved = modelFor(bucket, db);

  return {
    key: bucket,
    selected,
    envValue,
    hardcoded: HARDCODED_MODEL,
    resolved,
    requires: { json: true },
    recommend: RECOMMEND[bucket],
    usedBy: USED_BY[bucket],
  };
}
