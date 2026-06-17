import { it, expect, beforeEach, afterEach, describe } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
import { modelFor, HARDCODED_MODEL } from './modelFor.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

describe('modelFor — resolution order', () => {
  const origPredict = process.env.OPENROUTER_PREDICT_MODEL;
  const origDigest = process.env.OPENROUTER_DIGEST_MODEL;

  afterEach(() => {
    if (origPredict === undefined) delete process.env.OPENROUTER_PREDICT_MODEL;
    else process.env.OPENROUTER_PREDICT_MODEL = origPredict;
    if (origDigest === undefined) delete process.env.OPENROUTER_DIGEST_MODEL;
    else process.env.OPENROUTER_DIGEST_MODEL = origDigest;
  });

  it('falls back to hardcoded when no DB setting and no env', () => {
    delete process.env.OPENROUTER_PREDICT_MODEL;
    delete process.env.OPENROUTER_DIGEST_MODEL;
    expect(modelFor('predict', db)).toBe(HARDCODED_MODEL);
    expect(modelFor('digest', db)).toBe(HARDCODED_MODEL);
  });

  it('uses env when set and no DB setting', () => {
    process.env.OPENROUTER_PREDICT_MODEL = 'openai/gpt-4o';
    process.env.OPENROUTER_DIGEST_MODEL = 'google/gemini-flash';
    expect(modelFor('predict', db)).toBe('openai/gpt-4o');
    expect(modelFor('digest', db)).toBe('google/gemini-flash');
  });

  it('DB setting overrides env — primary acceptance criterion', () => {
    process.env.OPENROUTER_PREDICT_MODEL = 'openai/gpt-4o';
    process.env.OPENROUTER_DIGEST_MODEL = 'google/gemini-flash';

    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('predict_model', 'anthropic/claude-opus-4-8');
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('digest_model', 'meta-llama/llama-3.1-405b');

    expect(modelFor('predict', db)).toBe('anthropic/claude-opus-4-8');
    expect(modelFor('digest', db)).toBe('meta-llama/llama-3.1-405b');
  });

  it('buckets are independent — predict setting does not affect digest', () => {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('predict_model', 'anthropic/claude-opus-4-8');
    delete process.env.OPENROUTER_DIGEST_MODEL;
    expect(modelFor('predict', db)).toBe('anthropic/claude-opus-4-8');
    expect(modelFor('digest', db)).toBe(HARDCODED_MODEL);
  });
});
