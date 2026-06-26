import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

const MODEL_KEY = 'avatar_image_model';
const SHIFT_KEY = 'avatar_age_shift';

// GET /api/settings/avatar-image → { model, ageShift }
export const GET: RequestHandler = async () => {
  const db = getDb();
  const modelRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(MODEL_KEY) as
    | { value: string }
    | undefined;
  const shiftRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(SHIFT_KEY) as
    | { value: string }
    | undefined;
  const shift = shiftRow?.value ? Number(shiftRow.value) : 0;
  return json({ model: modelRow?.value ?? null, ageShift: Number.isFinite(shift) ? shift : 0 });
};

// PUT /api/settings/avatar-image  body: { model_id?: string|null, age_shift?: number }
// Updates whichever fields are present. model_id null/empty clears the override.
export const PUT: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw error(400, 'JSON body required');

  const db = getDb();

  if ('model_id' in body) {
    const modelId = body.model_id;
    if (modelId !== null && typeof modelId !== 'string') {
      throw error(400, 'model_id must be a string or null');
    }
    if (modelId === null || !modelId.trim()) {
      db.prepare('DELETE FROM settings WHERE key = ?').run(MODEL_KEY);
    } else {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(MODEL_KEY, modelId.trim());
    }
  }

  if ('age_shift' in body) {
    const shift = body.age_shift;
    if (typeof shift !== 'number' || !Number.isInteger(shift) || shift < -50 || shift > 50) {
      throw error(400, 'age_shift must be an integer between -50 and 50');
    }
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(SHIFT_KEY, String(shift));
  }

  const modelRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(MODEL_KEY) as
    | { value: string }
    | undefined;
  const shiftRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(SHIFT_KEY) as
    | { value: string }
    | undefined;
  return json({ model: modelRow?.value ?? null, ageShift: shiftRow?.value ? Number(shiftRow.value) : 0 });
};
