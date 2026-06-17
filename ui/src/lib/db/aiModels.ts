import type Database from 'better-sqlite3';

export interface AiModelRow {
  id: number;
  model_id: string;
  nickname: string | null;
  description: string | null;
  model_type: string | null;
  context_len: number | null;
  price_in: number | null;
  price_out: number | null;
  is_free: number;
  cost_override: number | null;
  cap_reason: number;
  cap_stream: number;
  cap_vision: number;
  cap_tools: number;
  cap_json: number;
  favorite: number;
  sort_order: number;
  created_at: string;
}

export type AiModelInsert = Omit<AiModelRow, 'id' | 'created_at'>;
export type AiModelPatch = Partial<AiModelInsert>;

export function listModels(db: Database.Database): AiModelRow[] {
  return db
    .prepare('SELECT * FROM ai_models ORDER BY sort_order, created_at')
    .all() as AiModelRow[];
}

export function getModelById(db: Database.Database, id: number): AiModelRow | null {
  return (db.prepare('SELECT * FROM ai_models WHERE id = ?').get(id) as AiModelRow | undefined) ?? null;
}

export function getModelByModelId(db: Database.Database, modelId: string): AiModelRow | null {
  return (db.prepare('SELECT * FROM ai_models WHERE model_id = ?').get(modelId) as AiModelRow | undefined) ?? null;
}

export function insertModel(db: Database.Database, data: AiModelInsert): AiModelRow {
  const existing = getModelByModelId(db, data.model_id);
  if (existing) throw new Error(`model_id already exists: ${data.model_id}`);

  const res = db
    .prepare(
      `INSERT INTO ai_models
         (model_id, nickname, description, model_type, context_len,
          price_in, price_out, is_free, cost_override,
          cap_reason, cap_stream, cap_vision, cap_tools, cap_json,
          favorite, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      data.model_id,
      data.nickname ?? null,
      data.description ?? null,
      data.model_type ?? null,
      data.context_len ?? null,
      data.price_in ?? null,
      data.price_out ?? null,
      data.is_free ? 1 : 0,
      data.cost_override ?? null,
      data.cap_reason ? 1 : 0,
      data.cap_stream ? 1 : 0,
      data.cap_vision ? 1 : 0,
      data.cap_tools ? 1 : 0,
      data.cap_json ? 1 : 0,
      data.favorite ? 1 : 0,
      data.sort_order ?? 0,
    );
  return db.prepare('SELECT * FROM ai_models WHERE id = ?').get(res.lastInsertRowid) as AiModelRow;
}

export function patchModel(db: Database.Database, id: number, patch: AiModelPatch): AiModelRow | null {
  const existing = getModelById(db, id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: unknown[] = [];

  const add = (col: string, val: unknown) => { fields.push(`${col} = ?`); values.push(val); };

  if (patch.model_id !== undefined) add('model_id', patch.model_id);
  if (patch.nickname !== undefined) add('nickname', patch.nickname);
  if (patch.description !== undefined) add('description', patch.description);
  if (patch.model_type !== undefined) add('model_type', patch.model_type);
  if (patch.context_len !== undefined) add('context_len', patch.context_len);
  if (patch.price_in !== undefined) add('price_in', patch.price_in);
  if (patch.price_out !== undefined) add('price_out', patch.price_out);
  if (patch.is_free !== undefined) add('is_free', patch.is_free ? 1 : 0);
  if (patch.cost_override !== undefined) add('cost_override', patch.cost_override);
  if (patch.cap_reason !== undefined) add('cap_reason', patch.cap_reason ? 1 : 0);
  if (patch.cap_stream !== undefined) add('cap_stream', patch.cap_stream ? 1 : 0);
  if (patch.cap_vision !== undefined) add('cap_vision', patch.cap_vision ? 1 : 0);
  if (patch.cap_tools !== undefined) add('cap_tools', patch.cap_tools ? 1 : 0);
  if (patch.cap_json !== undefined) add('cap_json', patch.cap_json ? 1 : 0);
  if (patch.favorite !== undefined) add('favorite', patch.favorite ? 1 : 0);
  if (patch.sort_order !== undefined) add('sort_order', patch.sort_order);

  if (!fields.length) return existing;

  values.push(id);
  db.prepare(`UPDATE ai_models SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return db.prepare('SELECT * FROM ai_models WHERE id = ?').get(id) as AiModelRow;
}

export function deleteModel(db: Database.Database, id: number): boolean {
  const res = db.prepare('DELETE FROM ai_models WHERE id = ?').run(id);
  return res.changes > 0;
}
