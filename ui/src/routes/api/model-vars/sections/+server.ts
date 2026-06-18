import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { buildAllSectionStates } from '$lib/digest/sectionState.js';

// GET /api/model-vars/sections → Record<string, SectionState> (all 16)
export const GET: RequestHandler = async () => {
  const db = getDb();
  return json(buildAllSectionStates(db));
};
