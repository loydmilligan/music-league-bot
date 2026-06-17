import { it, expect, describe } from 'vitest';
import { tierFromPricing, effCost, qualifies, abbrOf, CAP_ORDER } from './qualify.js';
import type { Model } from './qualify.js';

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'test-id',
    model_id: 'openai/gpt-4o',
    nickname: 'GPT-4o',
    description: '',
    model_type: 'general',
    context_len: 128000,
    price_in: 2.5,
    price_out: 10,
    is_free: 0,
    cost_override: null,
    cap_reason: 0,
    cap_stream: 1,
    cap_vision: 1,
    cap_tools: 1,
    cap_json: 1,
    favorite: 0,
    sort_order: 0,
    created_at: '2026-06-17T00:00:00.000Z',
    ...overrides,
  };
}

describe('tierFromPricing', () => {
  it('returns null for zero pricing', () => expect(tierFromPricing(0, 0)).toBeNull());
  it('returns $ for avg < 1', () => expect(tierFromPricing(0.1, 0.4)).toBe('$'));
  it('returns $$ for avg < 10', () => expect(tierFromPricing(2.5, 10)).toBe('$$'));
  it('returns $$$ for avg >= 10', () => expect(tierFromPricing(15, 75)).toBe('$$$'));
});

describe('effCost', () => {
  it('free model always 0', () => {
    expect(effCost(makeModel({ is_free: 1, price_in: 0, price_out: 0 }))).toBe(0);
  });
  it('respects cost_override over pricing', () => {
    expect(effCost(makeModel({ cost_override: '$', price_in: 15, price_out: 75 }))).toBe(1);
  });
  it('derives from pricing when no override', () => {
    expect(effCost(makeModel({ price_in: 2.5, price_out: 10 }))).toBe(2);
  });
});

describe('qualifies', () => {
  it('passes when no requirements', () => {
    expect(qualifies(makeModel(), {})).toBe(true);
  });
  it('fails when required cap is missing', () => {
    expect(qualifies(makeModel({ cap_reason: 0 }), { reason: true })).toBe(false);
  });
  it('passes when required cap is present', () => {
    expect(qualifies(makeModel({ cap_json: 1 }), { json: true })).toBe(true);
  });
  it('fails when cost exceeds maxCost', () => {
    expect(qualifies(makeModel({ price_in: 15, price_out: 75 }), { maxCost: 2 })).toBe(false);
  });
  it('free model passes any maxCost', () => {
    expect(qualifies(makeModel({ is_free: 1, price_in: 0, price_out: 0 }), { maxCost: 1 })).toBe(true);
  });
  it('predict bucket v1 requirement: json only', () => {
    const m = makeModel({ cap_json: 1 });
    expect(qualifies(m, { json: true })).toBe(true);
  });
});

describe('abbrOf', () => {
  it('known providers map to 2-letter abbr', () => {
    expect(abbrOf('anthropic/claude-sonnet-4')).toBe('AN');
    expect(abbrOf('openai/gpt-4o')).toBe('AI');
    expect(abbrOf('google/gemini-2.0-flash')).toBe('GG');
  });
  it('unknown provider uses first 2 chars uppercased', () => {
    expect(abbrOf('mistralai/mistral-7b')).toBe('MI');
  });
});

describe('CAP_ORDER', () => {
  it('has exactly 5 entries in the canonical order', () => {
    expect(CAP_ORDER).toEqual(['reason', 'stream', 'vision', 'tools', 'json']);
  });
});
