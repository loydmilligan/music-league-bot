import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { listModels, insertModel } from '$lib/db/aiModels.js';

export const GET: RequestHandler = async () => {
  const db = getDb();
  return json(listModels(db));
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw error(400, 'JSON body required');
  if (typeof body.model_id !== 'string' || !body.model_id.trim()) {
    throw error(400, 'body.model_id (non-empty string) required');
  }

  const db = getDb();
  try {
    const row = insertModel(db, {
      model_id: body.model_id.trim(),
      nickname: typeof body.nickname === 'string' ? body.nickname : null,
      description: typeof body.description === 'string' ? body.description : null,
      model_type: typeof body.model_type === 'string' ? body.model_type : null,
      context_len: typeof body.context_len === 'number' ? body.context_len : null,
      price_in: typeof body.price_in === 'number' ? body.price_in : null,
      price_out: typeof body.price_out === 'number' ? body.price_out : null,
      is_free: body.is_free ? 1 : 0,
      cost_override: typeof body.cost_override === 'number' ? body.cost_override : null,
      cap_reason: body.cap_reason ? 1 : 0,
      cap_stream: body.cap_stream ? 1 : 0,
      cap_vision: body.cap_vision ? 1 : 0,
      cap_tools: body.cap_tools ? 1 : 0,
      cap_json: body.cap_json ? 1 : 0,
      favorite: body.favorite ? 1 : 0,
      sort_order: typeof body.sort_order === 'number' ? body.sort_order : 0,
    });
    return json(row, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('already exists')) throw error(409, msg);
    throw error(500, msg);
  }
};
