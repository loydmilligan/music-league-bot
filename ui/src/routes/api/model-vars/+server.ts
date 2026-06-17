import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { buildBucketState } from '$lib/digest/bucketState.js';

// GET /api/model-vars → { predict: BucketState, digest: BucketState }
export const GET: RequestHandler = async () => {
  const db = getDb();
  return json({
    predict: buildBucketState('predict', db),
    digest: buildBucketState('digest', db),
  });
};
