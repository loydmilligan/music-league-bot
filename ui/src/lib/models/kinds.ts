export const MODEL_KINDS = ['text', 'multimodal', 'vision', 'image', 'video', 'audio', 'embedding', 'classification'] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

const ID_RE = /^~?[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:+~-]*$/i;

export function parseModelId(raw: string): string | null {
  let s = (raw ?? '').trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\/(www\.)?openrouter\.ai\//i, '');
  s = s.replace(/[?#].*$/, '').replace(/^models\//i, '').replace(/\/+$/, '');
  return ID_RE.test(s) ? s : null;
}

type Arch = { modality?: string; input_modalities?: string[]; output_modalities?: string[] };

export function kindsFromArchitecture(arch: Arch | undefined): ModelKind[] {
  if (!arch) return [];
  let ins = arch.input_modalities;
  let outs = arch.output_modalities;
  if ((!ins || !outs) && arch.modality) {
    const [i, o] = arch.modality.split('->');
    ins = ins ?? (i ? i.split('+') : []);
    outs = outs ?? (o ? o.split('+') : []);
  }
  ins = (ins ?? []).map((m) => m.trim().toLowerCase());
  outs = (outs ?? []).map((m) => m.trim().toLowerCase());
  const kinds = new Set<ModelKind>();
  if (outs.includes('image')) kinds.add('image');
  if (outs.includes('video')) kinds.add('video');
  if (outs.includes('audio')) kinds.add('audio');
  if (outs.includes('embeddings')) kinds.add('embedding');
  if (outs.includes('text')) kinds.add('text');
  if (ins.includes('image') && outs.includes('text')) kinds.add('vision');
  if (new Set(ins).size >= 2) kinds.add('multimodal');
  return [...kinds];
}

export function parseKinds(raw: string | null | undefined): ModelKind[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((k): k is ModelKind => (MODEL_KINDS as readonly string[]).includes(k));
  } catch {
    return [];
  }
}
