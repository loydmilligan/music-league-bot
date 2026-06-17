import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import type { AiModelInsert } from '$lib/db/aiModels.js';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry { data: OpenRouterModel[]; fetchedAt: number }
let _cache: CacheEntry | null = null;

interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { modality?: string };
}

async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  const now = Date.now();
  if (_cache && now - _cache.fetchedAt < CACHE_TTL_MS) return _cache.data;

  const apiKey = process.env.OPENROUTER_API_KEY;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const res = await fetch(OPENROUTER_MODELS_URL, { headers });
  if (!res.ok) throw new Error(`OpenRouter models fetch failed: ${res.status}`);
  const body = (await res.json()) as { data?: OpenRouterModel[] };
  const data = body.data ?? [];
  _cache = { data, fetchedAt: now };
  return data;
}

function orModelToDraft(m: OpenRouterModel): Partial<AiModelInsert> {
  const priceIn = parseFloat(m.pricing?.prompt ?? '') || null;
  const priceOut = parseFloat(m.pricing?.completion ?? '') || null;
  const isFree = priceIn === 0 && priceOut === 0 ? 1 : 0;
  const hasVision = (m.architecture?.modality ?? '').includes('image');

  return {
    model_id: m.id,
    nickname: null,
    description: m.description ?? null,
    model_type: m.architecture?.modality ?? null,
    context_len: m.context_length ?? null,
    price_in: priceIn,
    price_out: priceOut,
    is_free: isFree,
    cost_override: null,
    cap_reason: 0,
    cap_stream: 1,
    cap_vision: hasVision ? 1 : 0,
    cap_tools: 0,
    cap_json: 1,
    favorite: 0,
    sort_order: 0,
  };
}

// GET /api/models/lookup?id=<model_id>
// Returns { found: boolean, estimated: boolean, draft: Partial<AiModelInsert> }
export const GET: RequestHandler = async ({ url }) => {
  const modelId = url.searchParams.get('id');
  if (!modelId?.trim()) throw error(400, 'id query param required');

  let models: OpenRouterModel[];
  try {
    models = await fetchOpenRouterModels();
  } catch (e) {
    throw error(502, `OpenRouter lookup failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const match = models.find((m) => m.id === modelId.trim());

  if (match) {
    return json({ found: true, estimated: false, draft: orModelToDraft(match) });
  }

  // Not found in OpenRouter list — return an estimated draft from the model_id itself.
  const estimated: Partial<AiModelInsert> = {
    model_id: modelId.trim(),
    nickname: null,
    description: null,
    model_type: null,
    context_len: null,
    price_in: null,
    price_out: null,
    is_free: 0,
    cost_override: null,
    cap_reason: 0,
    cap_stream: 0,
    cap_vision: 0,
    cap_tools: 0,
    cap_json: 1,
    favorite: 0,
    sort_order: 0,
  };
  return json({ found: false, estimated: true, draft: estimated });
};
