import { describe, it, expect } from 'vitest';
import { parseModelId, kindsFromArchitecture, parseKinds } from './kinds';

describe('parseModelId', () => {
  it('accepts plain ids and URLs', () => {
    const id = 'google/gemini-2.5-flash';
    expect(parseModelId(id)).toBe(id);
    expect(parseModelId('  https://openrouter.ai/google/gemini-2.5-flash  ')).toBe(id);
    expect(parseModelId('https://openrouter.ai/models/google/gemini-2.5-flash?tab=api')).toBe(id);
    expect(parseModelId('https://openrouter.ai/google/gemini-2.5-flash/')).toBe(id);
  });
  it('keeps leading ~', () => {
    expect(parseModelId('~google/gemini-pro-latest')).toBe('~google/gemini-pro-latest');
  });
  it('rejects junk', () => {
    expect(parseModelId('not a model')).toBeNull();
    expect(parseModelId('')).toBeNull();
  });
});

describe('kindsFromArchitecture', () => {
  it('image in/out', () => {
    const k = kindsFromArchitecture({ input_modalities: ['text', 'image'], output_modalities: ['text', 'image'] });
    expect(k).toEqual(expect.arrayContaining(['image', 'multimodal', 'vision']));
  });
  it('vision text', () => {
    const k = kindsFromArchitecture({ input_modalities: ['text', 'image'], output_modalities: ['text'] });
    expect(k).toEqual(expect.arrayContaining(['vision', 'multimodal', 'text']));
    expect(k).toHaveLength(3);
  });
  it('embedding', () => {
    expect(kindsFromArchitecture({ input_modalities: ['text'], output_modalities: ['embeddings'] })).toEqual(['embedding']);
  });
  it('modality string fallback', () => {
    expect(kindsFromArchitecture({ modality: 'text+image->image' })).toContain('image');
  });
  it('undefined', () => {
    expect(kindsFromArchitecture(undefined)).toEqual([]);
  });
});

describe('parseKinds', () => {
  it('filters', () => {
    expect(parseKinds('["image","bogus"]')).toEqual(['image']);
    expect(parseKinds(null)).toEqual([]);
    expect(parseKinds('nope')).toEqual([]);
  });
});
