import { it, expect, beforeEach, describe } from 'vitest';
import { openLeagueDb } from './client.js';
import {
  listModels,
  insertModel,
  getModelById,
  getModelByModelId,
  patchModel,
  deleteModel,
} from './aiModels.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

describe('ai_models migration', () => {
  it('creates the ai_models table on fresh db', () => {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_models'").all() as { name: string }[]);
    expect(tables).toHaveLength(1);
  });

  it('table has expected columns', () => {
    const cols = (db.prepare('PRAGMA table_info(ai_models)').all() as { name: string }[]).map(c => c.name);
    for (const col of ['id', 'model_id', 'nickname', 'description', 'model_type', 'context_len',
      'price_in', 'price_out', 'is_free', 'cost_override',
      'cap_reason', 'cap_stream', 'cap_vision', 'cap_tools', 'cap_json',
      'favorite', 'sort_order', 'created_at']) {
      expect(cols).toContain(col);
    }
  });
});

describe('insertModel / listModels', () => {
  it('inserts a model and lists it', () => {
    insertModel(db, {
      model_id: 'anthropic/claude-haiku-4-5',
      nickname: 'Haiku',
      description: 'Fast model',
      model_type: 'text',
      context_len: 200000,
      price_in: 0.00000025,
      price_out: 0.00000125,
      is_free: 0,
      cost_override: null,
      cap_reason: 0, cap_stream: 1, cap_vision: 0, cap_tools: 1, cap_json: 1,
      favorite: 1, sort_order: 10,
    });
    const list = listModels(db);
    expect(list).toHaveLength(1);
    expect(list[0].model_id).toBe('anthropic/claude-haiku-4-5');
    expect(list[0].nickname).toBe('Haiku');
    expect(list[0].cap_json).toBe(1);
  });

  it('rejects duplicate model_id', () => {
    insertModel(db, { model_id: 'test/model', nickname: null, description: null, model_type: null, context_len: null, price_in: null, price_out: null, is_free: 0, cost_override: null, cap_reason: 0, cap_stream: 0, cap_vision: 0, cap_tools: 0, cap_json: 0, favorite: 0, sort_order: 0 });
    expect(() => insertModel(db, { model_id: 'test/model', nickname: null, description: null, model_type: null, context_len: null, price_in: null, price_out: null, is_free: 0, cost_override: null, cap_reason: 0, cap_stream: 0, cap_vision: 0, cap_tools: 0, cap_json: 0, favorite: 0, sort_order: 0 })).toThrow('already exists');
  });
});

describe('getModelById / getModelByModelId', () => {
  it('looks up by numeric id', () => {
    const inserted = insertModel(db, { model_id: 'x/y', nickname: null, description: null, model_type: null, context_len: null, price_in: null, price_out: null, is_free: 0, cost_override: null, cap_reason: 0, cap_stream: 0, cap_vision: 0, cap_tools: 0, cap_json: 0, favorite: 0, sort_order: 0 });
    expect(getModelById(db, inserted.id)?.model_id).toBe('x/y');
    expect(getModelById(db, 9999)).toBeNull();
  });

  it('looks up by model_id string', () => {
    insertModel(db, { model_id: 'openai/gpt-4o', nickname: null, description: null, model_type: null, context_len: null, price_in: null, price_out: null, is_free: 0, cost_override: null, cap_reason: 0, cap_stream: 0, cap_vision: 0, cap_tools: 0, cap_json: 0, favorite: 0, sort_order: 0 });
    expect(getModelByModelId(db, 'openai/gpt-4o')?.id).toBeTruthy();
    expect(getModelByModelId(db, 'no/such')).toBeNull();
  });
});

describe('patchModel', () => {
  it('patches individual fields without touching others', () => {
    const m = insertModel(db, { model_id: 'a/b', nickname: 'old', description: null, model_type: null, context_len: null, price_in: null, price_out: null, is_free: 0, cost_override: null, cap_reason: 0, cap_stream: 0, cap_vision: 0, cap_tools: 0, cap_json: 0, favorite: 0, sort_order: 0 });
    const updated = patchModel(db, m.id, { nickname: 'new', cap_json: 1 });
    expect(updated?.nickname).toBe('new');
    expect(updated?.cap_json).toBe(1);
    expect(updated?.model_id).toBe('a/b');
  });

  it('returns null for unknown id', () => {
    expect(patchModel(db, 9999, { nickname: 'x' })).toBeNull();
  });
});

describe('deleteModel', () => {
  it('deletes an existing model and returns true', () => {
    const m = insertModel(db, { model_id: 'del/me', nickname: null, description: null, model_type: null, context_len: null, price_in: null, price_out: null, is_free: 0, cost_override: null, cap_reason: 0, cap_stream: 0, cap_vision: 0, cap_tools: 0, cap_json: 0, favorite: 0, sort_order: 0 });
    expect(deleteModel(db, m.id)).toBe(true);
    expect(getModelById(db, m.id)).toBeNull();
  });

  it('returns false for unknown id', () => {
    expect(deleteModel(db, 9999)).toBe(false);
  });
});
