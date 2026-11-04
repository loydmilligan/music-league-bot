import { parseKinds } from './kinds.js';
import { tierFromPricing } from './qualify.js';

export type CoverJob = 'reader' | 'generator' | 'pitch';

export type JobModel = {
  model_id: string;
  nickname: string | null;
  model_type: string | null;
  kinds?: string | null;
  cap_vision: number;
  favorite: number;
  is_free: number;
  price_in: number | null;
  price_out: number | null;
  cost_override: string | null;
};

/** True when the legacy model_type says the model outputs image but not text. */
function imageOnlyOutput(type: string): boolean {
  if (type === 'image') return true;
  const m = type.match(/->(.*)$/);
  return !!m && m[1].includes('image') && !m[1].includes('text');
}

export function modelFitsJob(m: JobModel, job: CoverJob): boolean {
  const kinds = parseKinds(m.kinds);
  const type = m.model_type ?? '';
  switch (job) {
    case 'generator':
      return kinds.includes('image') || type === 'image' || /->.*image/.test(type);
    case 'reader':
      return (
        kinds.includes('vision') ||
        (kinds.includes('multimodal') && kinds.includes('text')) ||
        (kinds.length === 0 && m.cap_vision === 1 && !imageOnlyOutput(type))
      );
    case 'pitch':
      return kinds.includes('text') || (kinds.length === 0 && !imageOnlyOutput(type));
  }
}

const label = (m: JobModel) => m.nickname || m.model_id;

export function modelsForJob<T extends JobModel>(models: T[], job: CoverJob): T[] {
  return models
    .filter((m) => modelFitsJob(m, job))
    .sort((a, b) => b.favorite - a.favorite || label(a).localeCompare(label(b)));
}

export function jobOptionLabel(m: JobModel): string {
  const tier = m.is_free
    ? 'free'
    : (m.cost_override ??
        tierFromPricing(
          m.price_in != null ? m.price_in * 1e6 : null,
          m.price_out != null ? m.price_out * 1e6 : null,
        ) ??
        '');
  return `${m.favorite ? '★ ' : ''}${label(m)} ${tier}`.trimEnd();
}
