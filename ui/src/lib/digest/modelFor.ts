import type Database from 'better-sqlite3';

export const HARDCODED_MODEL = 'anthropic/claude-sonnet-4-5';

const ENV_KEYS = {
  predict: 'OPENROUTER_PREDICT_MODEL',
  digest: 'OPENROUTER_DIGEST_MODEL',
} as const;

const SETTING_KEYS = {
  predict: 'predict_model',
  digest: 'digest_model',
} as const;

/**
 * DB-first model resolver: settings table → env → hardcoded fallback.
 * The DB setting is written via PUT /api/model-vars/:bucket.
 */
export function modelFor(bucket: 'predict' | 'digest', db: Database.Database): string {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(SETTING_KEYS[bucket]) as { value: string } | undefined;
  return row?.value ?? process.env[ENV_KEYS[bucket]] ?? HARDCODED_MODEL;
}
