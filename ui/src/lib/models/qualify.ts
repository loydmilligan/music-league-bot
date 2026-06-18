// qualify.ts — capability vocabulary + cost-tier logic + qualifier predicate.
// Shared by ModelsScreen and any consumer that needs to filter the model roster.

export const CAP_ORDER = ['reason', 'stream', 'vision', 'tools', 'json'] as const;
export type Cap = (typeof CAP_ORDER)[number];

export const CAP_META: Record<Cap, { g: string; label: string; short: string }> = {
  reason: { g: '∴',  label: 'Deep reasoning',          short: 'reasoning' },
  stream: { g: '⇉',  label: 'Streaming',               short: 'streaming' },
  vision: { g: '◉',  label: 'Image input (vision)',     short: 'vision' },
  tools:  { g: 'ƒ',  label: 'Tool / function calling', short: 'tools' },
  json:   { g: '{}', label: 'Structured JSON output',   short: 'json' },
};

// Sprint-38 contract: the DB row shape returned by GET /api/models.
export type Model = {
  id: string;
  model_id: string;
  nickname: string;
  description: string;
  model_type: string;
  context_len: number | null;
  price_in: number | null;
  price_out: number | null;
  is_free: number;          // 0|1 SQLite boolean
  cost_override: string | null; // null | '$' | '$$' | '$$$'
  cap_reason: number;
  cap_stream: number;
  cap_vision: number;
  cap_tools: number;
  cap_json: number;
  favorite: number;
  sort_order: number;
  created_at: string;
};

// Sprint-38 contract: GET /api/model-vars returns { predict, digest }.
export type BucketState = {
  key: string;
  selected: string | null;   // DB-saved model_id
  envValue: string | null;   // from process.env at server time
  hardcoded: string;         // 'anthropic/claude-sonnet-4-5'
  resolved: string | null;   // db ?? env ?? hardcoded
  requires: BucketReq;
  recommend: string;
  usedBy: string[];
};

export type BucketReq = Partial<Record<Cap, boolean> & { maxCost: number }>;

// Auto-derive cost tier from avg $/1M input+output. Null when both are zero.
export function tierFromPricing(inPerM: number | null, outPerM: number | null): string | null {
  const avg = ((inPerM ?? 0) + (outPerM ?? 0)) / 2;
  if (avg <= 0) return null;
  if (avg < 1) return '$';
  if (avg < 10) return '$$';
  return '$$$';
}

// Effective cost as 0–3 integer (0 = free, 1 = $, 2 = $$, 3 = $$$).
// price_in/price_out are stored per-token; tierFromPricing expects per-million.
export function effCost(m: Model): number {
  if (m.is_free) return 0;
  const tier = m.cost_override ?? tierFromPricing(
    m.price_in != null ? m.price_in * 1e6 : null,
    m.price_out != null ? m.price_out * 1e6 : null,
  );
  const map: Record<string, number> = { '$': 1, '$$': 2, '$$$': 3 };
  return map[tier ?? ''] ?? 3;
}

// Returns true when model satisfies every constraint in req.
export function qualifies(m: Model, req: BucketReq): boolean {
  for (const c of CAP_ORDER) {
    if (req[c] && !m[`cap_${c}` as keyof Model]) return false;
  }
  if (req.maxCost != null && effCost(m) > req.maxCost) return false;
  return true;
}

const PROVIDER_ABBR: Record<string, string> = {
  anthropic: 'AN', openai: 'AI', google: 'GG', deepseek: 'DS',
  'meta-llama': 'ML', 'x-ai': 'XAI', mistralai: 'MI', qwen: 'QW',
};

export function providerOf(modelId: string): string {
  return modelId.split('/')[0];
}

export function abbrOf(modelId: string): string {
  const p = providerOf(modelId);
  return PROVIDER_ABBR[p] || p.slice(0, 2).toUpperCase();
}
