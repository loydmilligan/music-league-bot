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

/**
 * Maps each of the 17 pinnable section/task keys to its bucket.
 * - digest (7): the SECTION_KINDS from llm.ts
 * - predict (10): narrative, profile, season-update, and the 3 static-env tasks
 *
 * season-update falls back to 'digest' per open question A: the task was originally
 * wired to modelFor('digest', db) in seasonUpdate.ts, confirming the digest bucket.
 */
export const SECTION_BUCKET_MAP: Record<string, 'predict' | 'digest'> = {
  // digest bucket (6)
  podium:                         'digest',
  villain:                        'digest',
  flow:                           'digest',
  consensus:                      'digest',
  quotes:                         'digest',
  chat:                           'digest',
  storylines:                     'digest',
  // predict bucket (10)
  'narrative-player-superlatives': 'predict',
  'narrative-fan-hater-blurbs':    'predict',
  'narrative-league-reel':         'predict',
  'narrative-moment-lines':        'predict',
  'profile-spectrum':              'predict',
  'profile-playlist':              'predict',
  'season-update':                 'digest',   // Open Q A: confirmed digest (was modelFor('digest',...))
  'submission-predict':            'predict',
  'vote-probe':                    'predict',
  'taste-fingerprint':             'predict',
};

/**
 * Per-section DB-first resolver.
 * Fallback chain: settings[digest_model_<section>] → modelFor(bucket, db)
 * For an unknown section key, falls through cleanly to the predict-bucket default.
 */
export function modelForSection(section: string, db: Database.Database): string {
  const sectionKey = `digest_model_${section}`;
  const pinRow = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(sectionKey) as { value: string } | undefined;
  if (pinRow?.value) return pinRow.value;

  const bucket: 'predict' | 'digest' = SECTION_BUCKET_MAP[section] ?? 'predict';
  return modelFor(bucket, db);
}
