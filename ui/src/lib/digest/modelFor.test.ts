import { it, expect, beforeEach, afterEach, describe } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
import { modelFor, modelForSection, HARDCODED_MODEL, SECTION_BUCKET_MAP } from './modelFor.js';
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

describe('modelForSection — resolution order', () => {
  const origPredict = process.env.OPENROUTER_PREDICT_MODEL;
  const origDigest = process.env.OPENROUTER_DIGEST_MODEL;

  afterEach(() => {
    if (origPredict === undefined) delete process.env.OPENROUTER_PREDICT_MODEL;
    else process.env.OPENROUTER_PREDICT_MODEL = origPredict;
    if (origDigest === undefined) delete process.env.OPENROUTER_DIGEST_MODEL;
    else process.env.OPENROUTER_DIGEST_MODEL = origDigest;
  });

  it('SECTION_BUCKET_MAP contains all 16 known sections', () => {
    const expectedSections = [
      'podium', 'villain', 'flow', 'consensus', 'quotes', 'chat',
      'narrative-player-superlatives', 'narrative-fan-hater-blurbs',
      'narrative-league-reel', 'narrative-moment-lines',
      'profile-spectrum', 'profile-playlist', 'season-update',
      'submission-predict', 'vote-probe', 'taste-fingerprint',
    ];
    for (const s of expectedSections) {
      expect(SECTION_BUCKET_MAP).toHaveProperty(s);
    }
    expect(Object.keys(SECTION_BUCKET_MAP)).toHaveLength(16);
  });

  it('season-update maps to digest bucket', () => {
    expect(SECTION_BUCKET_MAP['season-update']).toBe('digest');
  });

  it('section pin wins over bucket default', () => {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('digest_model_podium', 'openai/gpt-4o-mini');
    delete process.env.OPENROUTER_DIGEST_MODEL;
    expect(modelForSection('podium', db)).toBe('openai/gpt-4o-mini');
  });

  it('section pin wins over bucket DB setting', () => {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('digest_model', 'meta-llama/llama-3.1-405b');
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('digest_model_podium', 'openai/gpt-4o-mini');
    expect(modelForSection('podium', db)).toBe('openai/gpt-4o-mini');
  });

  it('falls through to bucket default when no section pin', () => {
    delete process.env.OPENROUTER_PREDICT_MODEL;
    delete process.env.OPENROUTER_DIGEST_MODEL;
    // podium is in the digest bucket; no pin, no env → hardcoded
    expect(modelForSection('podium', db)).toBe(HARDCODED_MODEL);
    // narrative-player-superlatives is in predict bucket
    expect(modelForSection('narrative-player-superlatives', db)).toBe(HARDCODED_MODEL);
  });

  it('bucket DB setting applies when no section pin', () => {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('predict_model', 'anthropic/claude-opus-4-8');
    delete process.env.OPENROUTER_PREDICT_MODEL;
    // taste-fingerprint is predict bucket; no section pin → bucket DB setting
    expect(modelForSection('taste-fingerprint', db)).toBe('anthropic/claude-opus-4-8');
  });

  it('unknown section falls through cleanly to predict-bucket default', () => {
    delete process.env.OPENROUTER_PREDICT_MODEL;
    // completely unknown key → 'predict' default → hardcoded
    expect(modelForSection('totally-unknown-section', db)).toBe(HARDCODED_MODEL);
  });

  it('section pin for one section does not affect another', () => {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('digest_model_podium', 'openai/gpt-4o-mini');
    delete process.env.OPENROUTER_DIGEST_MODEL;
    // villain is in the same digest bucket but has no pin
    expect(modelForSection('villain', db)).toBe(HARDCODED_MODEL);
  });
});
