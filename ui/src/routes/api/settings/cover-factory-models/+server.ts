import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getModelByModelId } from '$lib/db/aiModels.js';
import { modelFitsJob, type CoverJob } from '$lib/models/jobs.js';
import {
  COVER_JOB_KEYS,
  getPinnedCoverModel,
  getPinnedSetting,
  isUsablePin,
} from '$lib/server/coverFactory/models.js';

const JOBS = Object.keys(COVER_JOB_KEYS) as CoverJob[];

function snapshot() {
  const db = getDb();
  const out = {} as Record<CoverJob, { pinned: string | null; missing: boolean; resolved: string | null }>;
  for (const job of JOBS) {
    const pinned = getPinnedSetting(db, job);
    out[job] = {
      pinned,
      missing: pinned !== null && !isUsablePin(db, job, pinned),
      resolved: getPinnedCoverModel(db, job),
    };
  }
  return out;
}

// GET /api/settings/cover-factory-models → { reader, generator, pitch } slots
export const GET: RequestHandler = async () => json(snapshot());

// PUT body { job, model_id: string|null } — null/empty clears the pin.
export const PUT: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw error(400, 'JSON body required');
  const job = body.job;
  if (typeof job !== 'string' || !JOBS.includes(job as CoverJob)) throw error(400, 'unknown job');
  if (!('model_id' in body)) throw error(400, 'model_id required (string or null)');
  const modelId = body.model_id;
  if (modelId !== null && typeof modelId !== 'string') throw error(400, 'model_id must be a string or null');

  const db = getDb();
  const key = COVER_JOB_KEYS[job as CoverJob];
  if (modelId === null || !modelId.trim()) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  } else {
    const id = modelId.trim();
    const row = getModelByModelId(db, id);
    if (!row) throw error(400, 'model_id is not in the roster');
    if (!modelFitsJob(row, job as CoverJob)) throw error(400, `model does not fit the ${job} job`);
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, id);
  }
  return json(snapshot());
};
