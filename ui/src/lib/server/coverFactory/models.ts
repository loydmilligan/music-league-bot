import type Database from 'better-sqlite3';
import { getModelByModelId, listModels } from '$lib/db/aiModels.js';
import { modelFitsJob, modelsForJob, type CoverJob } from '$lib/models/jobs.js';

export const COVER_JOB_KEYS: Record<CoverJob, string> = {
  reader: 'cover_factory_reader_model',
  generator: 'cover_factory_generator_model',
  pitch: 'cover_factory_pitch_model',
};

export function getPinnedSetting(db: Database.Database, job: CoverJob): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(COVER_JOB_KEYS[job]) as
    | { value: string }
    | undefined;
  return row?.value || null;
}

/** True when `id` exists in ai_models AND still fits the job. */
export function isUsablePin(db: Database.Database, job: CoverJob, id: string): boolean {
  const row = getModelByModelId(db, id);
  return !!row && modelFitsJob(row, job);
}

/**
 * Model id to use for a cover-factory job: the pinned id if it still exists
 * and still fits the job; otherwise the top fitting model (favorites first);
 * otherwise null.
 */
export function getPinnedCoverModel(db: Database.Database, job: CoverJob): string | null {
  const pinned = getPinnedSetting(db, job);
  if (pinned && isUsablePin(db, job, pinned)) return pinned;
  return modelsForJob(listModels(db), job)[0]?.model_id ?? null;
}
