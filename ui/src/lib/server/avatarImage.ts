import type Database from 'better-sqlite3';
import { logLlmCall } from '$lib/digest/llm.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// A real OpenRouter image-output model (verified present in /api/v1/models).
// The previous default ('black-forest-labs/flux-1.1-pro') is not a valid OpenRouter
// model ID and made every avatar generation 400 when no image model was configured.
const DEFAULT_AVATAR_MODEL = 'google/gemini-2.5-flash-image';

/** Image generation result: the bytes plus OpenRouter cost/usage accounting. */
export interface ImageGenResult {
  bytes: Uint8Array;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
}

/**
 * Call OpenRouter image generation endpoint and return the raw image bytes plus
 * cost/usage accounting. Handles both URL and data-URI base64 responses.
 * `usage: { include: true }` makes OpenRouter return the call's USD cost.
 */
export async function callOpenRouterImage(
  prompt: string,
  model: string,
  opts?: { aspect_ratio?: string },
): Promise<ImageGenResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    modalities: ['image', 'text'],
    image_config: { aspect_ratio: opts?.aspect_ratio ?? '1:1' },
    usage: { include: true },
  };

  const startMs = Date.now();
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://mlb.mattmariani.com',
      'X-Title': 'Music League Bot - Avatar',
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - startMs;

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenRouter image ${res.status}: ${text.slice(0, 500)}`);
  }

  const json = (await res.json()) as {
    choices?: {
      message?: {
        images?: { image_url: { url: string } | string }[];
        image_url?: string;
      };
    }[];
    usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const images = json.choices?.[0]?.message?.images;
  if (!images || images.length === 0) {
    throw new Error('OpenRouter returned no image');
  }

  // Extract the URL/data-URI from the image object
  const imageEntry = images[0];
  const raw =
    typeof imageEntry === 'string'
      ? imageEntry
      : typeof imageEntry.image_url === 'string'
        ? imageEntry.image_url
        : imageEntry.image_url?.url;

  if (!raw) {
    throw new Error('OpenRouter returned no image');
  }

  const cost = {
    costUsd: typeof json.usage?.cost === 'number' ? json.usage.cost : 0,
    promptTokens: typeof json.usage?.prompt_tokens === 'number' ? json.usage.prompt_tokens : 0,
    completionTokens: typeof json.usage?.completion_tokens === 'number' ? json.usage.completion_tokens : 0,
    totalTokens: typeof json.usage?.total_tokens === 'number' ? json.usage.total_tokens : 0,
    latencyMs,
  };

  // Handle data URI
  if (raw.startsWith('data:')) {
    const b64Match = raw.match(/^data:[^;]+;base64,(.+)$/);
    if (!b64Match) throw new Error('OpenRouter returned malformed data URI');
    return { bytes: new Uint8Array(Buffer.from(b64Match[1], 'base64')), ...cost };
  }

  // Handle URL
  const imgRes = await fetch(raw);
  if (!imgRes.ok) throw new Error(`Failed to fetch image from URL: ${imgRes.status}`);
  return { bytes: new Uint8Array(await imgRes.arrayBuffer()), ...cost };
}

/**
 * Record an avatar image generation into the shared llm_cost_log ledger, so its
 * cost shows up in the debug cost dashboard alongside text LLM calls. Passing a
 * runId folds the cost into that generation's whole-run total (e.g. a digest).
 * Fire-and-forget via logLlmCall (its own try/catch shields the call path).
 */
export function logImageGen(
  db: Database.Database,
  result: ImageGenResult,
  model: string,
  meta: { label: 'base' | 'themed'; playerId: number; roundId?: number; runId?: string; outputKey: string },
): void {
  logLlmCall(
    {
      content: meta.outputKey,
      costUsd: result.costUsd,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
      latencyMs: result.latencyMs,
    },
    { model },
    {
      db,
      category: 'avatar',
      label: `avatar-${meta.label}`,
      artifactType: 'player',
      artifactId: String(meta.playerId),
      roundId: meta.roundId,
      runId: meta.runId,
    },
  );
}

/**
 * Upload image bytes to Cloudflare R2 via the REST API.
 */
export async function uploadToR2(key: string, bytes: Uint8Array): Promise<void> {
  const accountId = process.env.CF_ACCOUNT_ID;
  const bucket = process.env.CF_R2_BUCKET;
  const token = process.env.CF_R2_API_TOKEN;

  if (!accountId) throw new Error('CF_ACCOUNT_ID is not set');
  if (!bucket) throw new Error('CF_R2_BUCKET is not set');
  if (!token) throw new Error('CF_R2_API_TOKEN is not set');

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'image/png',
    },
    body: Buffer.from(bytes),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`R2 upload failed ${res.status}: ${text.slice(0, 500)}`);
  }
}

/**
 * Build a text-to-image prompt for a player's base avatar.
 * Optional trait fields are omitted when null/empty.
 * Age is clamped to [5, 95] after applying the shift.
 */
export function buildBasePrompt(
  player: {
    age: number | null;
    avatar_gender: string | null;
    avatar_race?: string | null;
    avatar_hair?: string | null;          // legacy freeform (fallback)
    avatar_hair_style?: string | null;
    avatar_hair_color?: string | null;
    avatar_height: string | null;
    avatar_build: string | null;
    avatar_style: string | null;
    avatar_trait: string | null;
  },
  shift: number,
): string {
  const effectiveAge = Math.min(95, Math.max(5, (player.age ?? 40) + shift));
  // Prefer the new colour + style fields; fall back to legacy freeform hair.
  const hair =
    [player.avatar_hair_color, player.avatar_hair_style].filter(Boolean).join(' ') ||
    player.avatar_hair ||
    null;
  // "White male" / "male" / "White" / "" → "a White male person," etc.
  const descriptor = [player.avatar_race, player.avatar_gender].filter(Boolean).join(' ');
  const parts = [
    `Cartoon portrait illustration of a ${descriptor || 'person'}${descriptor ? ' person' : ''},`,
    `approximately ${effectiveAge} years old,`,
    player.avatar_height ? `${player.avatar_height} height,` : null,
    player.avatar_build ? `${player.avatar_build} build,` : null,
    player.avatar_style ? `${player.avatar_style} style,` : null,
    hair ? `${hair} hair.` : null,
    player.avatar_trait ? `Key trait: ${player.avatar_trait}.` : null,
    'Square format, warm friendly illustration style, no text, no background clutter.',
  ].filter(Boolean);
  return parts.join(' ');
}

/**
 * Resolve the model to use for avatar image generation.
 * Priority:
 *   1. settings['avatar_image_model'] — explicit override (no UI yet, kept for compat)
 *   2. an image-capable model from the Models screen (ai_models) — favorite first, so the
 *      operator picks which one by starring it. Matches the manual 'image' model_type or an
 *      OpenRouter modality that outputs image (e.g. 'text+image->text+image').
 *   3. env OPENROUTER_AVATAR_IMAGE_MODEL
 *   4. hardcoded valid default
 */
export function modelForAvatar(db: Database.Database): string {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('avatar_image_model') as { value: string } | undefined;
  if (row?.value) return row.value;

  // ai_models may not exist on a fresh DB — guard the lookup.
  try {
    const model = db
      .prepare(
        `SELECT model_id FROM ai_models
         WHERE model_type = 'image' OR model_type LIKE '%->%image%'
         ORDER BY favorite DESC, sort_order ASC, id ASC
         LIMIT 1`,
      )
      .get() as { model_id: string } | undefined;
    if (model?.model_id) return model.model_id;
  } catch {
    // table absent — fall through to env/default
  }

  return process.env.OPENROUTER_AVATAR_IMAGE_MODEL ?? DEFAULT_AVATAR_MODEL;
}
