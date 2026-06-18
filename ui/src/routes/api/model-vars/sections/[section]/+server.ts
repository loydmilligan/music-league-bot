import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { buildSectionState, KNOWN_SECTIONS } from '$lib/digest/sectionState.js';

// PUT /api/model-vars/sections/:section
//   body: { model_id: string | null }
//   → SectionState  (400 on unknown section; null clears pin)
export const PUT: RequestHandler = async ({ params, request }) => {
  const section = params.section;
  if (!KNOWN_SECTIONS.includes(section)) {
    throw error(400, `unknown section "${section}"; valid sections: ${KNOWN_SECTIONS.join(', ')}`);
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw error(400, 'JSON body required');
  if (!('model_id' in body)) throw error(400, 'body.model_id required (string or null)');

  const modelId = body.model_id;
  if (modelId !== null && typeof modelId !== 'string') {
    throw error(400, 'body.model_id must be a string or null');
  }

  const db = getDb();
  const settingKey = `digest_model_${section}`;

  if (modelId === null || (typeof modelId === 'string' && !modelId.trim())) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(settingKey);
  } else {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(settingKey, modelId.trim());
  }

  return json(buildSectionState(section, db));
};
