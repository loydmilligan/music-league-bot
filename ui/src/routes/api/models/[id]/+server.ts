import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getModelById, patchModel, deleteModel } from '$lib/db/aiModels.js';

export const PATCH: RequestHandler = async ({ params, request }) => {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) throw error(400, 'invalid id');

  const db = getDb();
  if (!getModelById(db, id)) throw error(404, 'not found');

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw error(400, 'JSON body required');

  const updated = patchModel(db, id, {
    model_id: typeof body.model_id === 'string' ? body.model_id : undefined,
    nickname: body.nickname !== undefined ? (typeof body.nickname === 'string' ? body.nickname : null) : undefined,
    description: body.description !== undefined ? (typeof body.description === 'string' ? body.description : null) : undefined,
    model_type: body.model_type !== undefined ? (typeof body.model_type === 'string' ? body.model_type : null) : undefined,
    context_len: body.context_len !== undefined ? (typeof body.context_len === 'number' ? body.context_len : null) : undefined,
    price_in: body.price_in !== undefined ? (typeof body.price_in === 'number' ? body.price_in : null) : undefined,
    price_out: body.price_out !== undefined ? (typeof body.price_out === 'number' ? body.price_out : null) : undefined,
    is_free: body.is_free !== undefined ? (body.is_free ? 1 : 0) : undefined,
    cost_override: body.cost_override !== undefined ? (typeof body.cost_override === 'number' ? body.cost_override : null) : undefined,
    cap_reason: body.cap_reason !== undefined ? (body.cap_reason ? 1 : 0) : undefined,
    cap_stream: body.cap_stream !== undefined ? (body.cap_stream ? 1 : 0) : undefined,
    cap_vision: body.cap_vision !== undefined ? (body.cap_vision ? 1 : 0) : undefined,
    cap_tools: body.cap_tools !== undefined ? (body.cap_tools ? 1 : 0) : undefined,
    cap_json: body.cap_json !== undefined ? (body.cap_json ? 1 : 0) : undefined,
    favorite: body.favorite !== undefined ? (body.favorite ? 1 : 0) : undefined,
    sort_order: body.sort_order !== undefined ? (typeof body.sort_order === 'number' ? body.sort_order : undefined) : undefined,
  });

  return json(updated);
};

export const DELETE: RequestHandler = async ({ params }) => {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) throw error(400, 'invalid id');

  const db = getDb();
  const row = getModelById(db, id);
  if (!row) throw error(404, 'not found');

  deleteModel(db, id);

  // Clear any bucket selection (predict/digest) that pointed at this model, so
  // resolution falls back to env → hardcoded instead of resolving to a model
  // that's no longer in the roster (sprint-38 UAT finding: orphaned override).
  db.prepare(
    "DELETE FROM settings WHERE key IN ('predict_model', 'digest_model') AND value = ?"
  ).run(row.model_id);

  return new Response(null, { status: 204 });
};
