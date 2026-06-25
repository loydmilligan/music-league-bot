import type Database from 'better-sqlite3';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_AVATAR_MODEL = 'black-forest-labs/flux-1.1-pro';

/**
 * Call OpenRouter image generation endpoint and return the raw image bytes.
 * Handles both URL responses (http/https) and data-URI base64 responses.
 */
export async function callOpenRouterImage(
  prompt: string,
  model: string,
  opts?: { aspect_ratio?: string },
): Promise<Uint8Array> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    modalities: ['image', 'text'],
    image_config: { aspect_ratio: opts?.aspect_ratio ?? '1:1' },
  };

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

  // Handle data URI
  if (raw.startsWith('data:')) {
    const b64Match = raw.match(/^data:[^;]+;base64,(.+)$/);
    if (!b64Match) throw new Error('OpenRouter returned malformed data URI');
    return new Uint8Array(Buffer.from(b64Match[1], 'base64'));
  }

  // Handle URL
  const imgRes = await fetch(raw);
  if (!imgRes.ok) throw new Error(`Failed to fetch image from URL: ${imgRes.status}`);
  return new Uint8Array(await imgRes.arrayBuffer());
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
    avatar_hair: string | null;
    avatar_height: string | null;
    avatar_build: string | null;
    avatar_style: string | null;
    avatar_trait: string | null;
  },
  shift: number,
): string {
  const effectiveAge = Math.min(95, Math.max(5, (player.age ?? 40) + shift));
  const parts = [
    `Cartoon portrait illustration of a ${player.avatar_gender} person,`,
    `approximately ${effectiveAge} years old,`,
    player.avatar_height ? `${player.avatar_height} height,` : null,
    player.avatar_build ? `${player.avatar_build} build,` : null,
    player.avatar_style ? `${player.avatar_style} style,` : null,
    player.avatar_hair ? `${player.avatar_hair} hair.` : null,
    player.avatar_trait ? `Key trait: ${player.avatar_trait}.` : null,
    'Square format, warm friendly illustration style, no text, no background clutter.',
  ].filter(Boolean);
  return parts.join(' ');
}

/**
 * Resolve the model to use for avatar image generation.
 * Fallback chain: settings['avatar_image_model'] → env OPENROUTER_AVATAR_IMAGE_MODEL → hardcoded default.
 */
export function modelForAvatar(db: Database.Database): string {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('avatar_image_model') as { value: string } | undefined;
  if (row?.value) return row.value;
  return process.env.OPENROUTER_AVATAR_IMAGE_MODEL ?? DEFAULT_AVATAR_MODEL;
}
