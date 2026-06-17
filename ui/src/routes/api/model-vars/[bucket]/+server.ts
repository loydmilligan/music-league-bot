import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { buildBucketState } from '$lib/digest/bucketState.js';

const VALID_BUCKETS = ['predict', 'digest'] as const;
type Bucket = (typeof VALID_BUCKETS)[number];

const SETTING_KEYS: Record<Bucket, string> = {
  predict: 'predict_model',
  digest: 'digest_model',
};

// PUT /api/model-vars/:bucket  body: { model_id: string | null }
// Sets the DB selection for the bucket. Passing null clears the selection (falls
// back to env → hardcoded). Returns the full BucketState after the update.
export const PUT: RequestHandler = async ({ params, request }) => {
  const bucket = params.bucket as Bucket;
  if (!VALID_BUCKETS.includes(bucket)) throw error(400, `bucket must be one of: ${VALID_BUCKETS.join(', ')}`);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw error(400, 'JSON body required');
  if (!('model_id' in body)) throw error(400, 'body.model_id required (string or null)');

  const modelId = body.model_id;
  if (modelId !== null && typeof modelId !== 'string') throw error(400, 'body.model_id must be a string or null');

  const db = getDb();
  const settingKey = SETTING_KEYS[bucket];

  if (modelId === null || (typeof modelId === 'string' && !modelId.trim())) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(settingKey);
  } else {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(settingKey, modelId.trim());
  }

  return json(buildBucketState(bucket, db));
};
