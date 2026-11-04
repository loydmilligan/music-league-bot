import { it, expect, describe } from 'vitest';
import { modelFitsJob, modelsForJob, jobOptionLabel } from './jobs.js';
import type { JobModel } from './jobs.js';

function mk(o: Partial<JobModel> = {}): JobModel {
  return {
    model_id: 'x/y', nickname: 'Y', model_type: 'general', kinds: null,
    cap_vision: 0, favorite: 0, is_free: 0, price_in: null, price_out: null, cost_override: null,
    ...o,
  };
}

describe('modelFitsJob', () => {
  it('legacy image type fits generator, not pitch', () => {
    const m = mk({ kinds: null, model_type: 'image' });
    expect(modelFitsJob(m, 'generator')).toBe(true);
    expect(modelFitsJob(m, 'pitch')).toBe(false);
  });
  it('vision/text/multimodal fits reader and pitch, not generator', () => {
    const m = mk({ kinds: '["vision","text","multimodal"]' });
    expect(modelFitsJob(m, 'reader')).toBe(true);
    expect(modelFitsJob(m, 'pitch')).toBe(true);
    expect(modelFitsJob(m, 'generator')).toBe(false);
  });
  it('legacy cap_vision fits reader and pitch', () => {
    const m = mk({ kinds: null, cap_vision: 1, model_type: 'general' });
    expect(modelFitsJob(m, 'reader')).toBe(true);
    expect(modelFitsJob(m, 'pitch')).toBe(true);
  });
  it('embedding fits none', () => {
    const m = mk({ kinds: '["embedding"]' });
    expect(modelFitsJob(m, 'reader')).toBe(false);
    expect(modelFitsJob(m, 'generator')).toBe(false);
    expect(modelFitsJob(m, 'pitch')).toBe(false);
  });
  it('modality-string model_type fits generator', () => {
    expect(modelFitsJob(mk({ model_type: 'text+image->text+image' }), 'generator')).toBe(true);
  });
});

describe('modelsForJob', () => {
  it('puts favorites first even when alphabetically later', () => {
    const a = mk({ model_id: 'a/a', nickname: 'Aaa', kinds: '["image"]' });
    const z = mk({ model_id: 'z/z', nickname: 'Zzz', kinds: '["image"]', favorite: 1 });
    const other = mk({ model_id: 'o/o', kinds: '["text"]' });
    expect(modelsForJob([a, z, other], 'generator').map((m) => m.model_id)).toEqual(['z/z', 'a/a']);
  });
});

describe('jobOptionLabel', () => {
  it('formats favorite + nickname + tier', () => {
    expect(jobOptionLabel(mk({ favorite: 1, nickname: 'Nano', price_in: 0.0000001, price_out: 0.0000005 }))).toBe('★ Nano $');
  });
  it('shows free', () => {
    expect(jobOptionLabel(mk({ nickname: null, model_id: 'a/b', is_free: 1 }))).toBe('a/b free');
  });
});
