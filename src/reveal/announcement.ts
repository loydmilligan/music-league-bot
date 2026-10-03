import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveSendTarget, type SendGuardEnv } from '../whatsapp/sendGuard.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/images';
const DEFAULT_MODEL = 'google/gemini-2.5-flash-image';

export interface RoundRevealRequest {
  leagueSlug: string;
  leagueName: string;
  leagueId: string;
  roundId: string;
  roundNumber: number;
  theme: string;
  description: string | null;
}

export interface GeneratedRevealImage {
  bytes: Uint8Array;
  extension: 'png' | 'jpg' | 'webp';
}

export interface RevealAnnouncementDeps {
  env: SendGuardEnv;
  dataDir: string;
  generate: (prompt: string) => Promise<GeneratedRevealImage>;
  sendMedia: (target: string, file: string, caption: string) => Promise<void>;
  sendText: (target: string, caption: string) => Promise<void>;
  now?: () => number;
}

export interface RevealAnnouncementResult {
  sent: boolean;
  media: boolean;
  reason: string;
  caption: string;
  file?: string;
  warning?: string;
}

export function roundSubmitUrl(req: RoundRevealRequest): string {
  return `https://app.musicleague.com/l/${req.leagueId}/${req.roundId}/submit/`;
}

export function revealCaption(req: RoundRevealRequest): string {
  const detail = req.description?.trim() ? `\n\n${req.description.trim()}` : '';
  return `🎉 ROUND ${req.roundNumber} THEME REVEAL\n\n*${req.theme.trim()}*${detail}\n\nSubmit your song in Music League:\n${roundSubmitUrl(req)}`;
}

export function revealImagePrompt(req: RoundRevealRequest): string {
  const detail = req.description?.trim() ? ` Theme brief: ${req.description.trim()}` : '';
  return [
    `Create a bold square editorial illustration for a friendly music competition's Round ${req.roundNumber} theme, “${req.theme.trim()}.”`,
    detail,
    'Make it feel like premium album artwork: expressive, visually immediate, high contrast, and readable as a small WhatsApp thumbnail.',
    'Do not include any words, letters, numbers, logos, app interfaces, watermarks, or recognizable people.',
  ].join('');
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'league';
}

export async function runRevealAnnouncement(
  req: RoundRevealRequest,
  deps: RevealAnnouncementDeps,
): Promise<RevealAnnouncementResult> {
  const caption = revealCaption(req);
  const decision = resolveSendTarget(deps.env, req.leagueSlug);
  if (decision.action === 'block') {
    return { sent: false, media: false, reason: decision.reason, caption };
  }

  let generated: GeneratedRevealImage;
  let file: string;
  try {
    generated = await deps.generate(revealImagePrompt(req));
    const dir = path.join(deps.dataDir, 'reveal-announcements');
    await mkdir(dir, { recursive: true });
    file = path.join(
      dir,
      `${safeName(req.leagueSlug)}-round-${req.roundNumber}-${deps.now?.() ?? Date.now()}.${generated.extension}`,
    );
    await writeFile(file, generated.bytes);
  } catch (error) {
    const warning = `thumbnail generation failed: ${error instanceof Error ? error.message : String(error)}`;
    await deps.sendText(decision.target, caption);
    return { sent: true, media: false, reason: decision.reason, caption, warning };
  }

  // Keep the send outside the generation fallback. A WhatsApp error is ambiguous:
  // the image may have left the account before the client rejected. Let the caller
  // record the failure and never retry automatically rather than risk a duplicate.
  await deps.sendMedia(decision.target, file, caption);
  return { sent: true, media: true, reason: decision.reason, caption, file };
}

function extensionFor(contentType: string | null): GeneratedRevealImage['extension'] {
  if (contentType?.includes('jpeg')) return 'jpg';
  if (contentType?.includes('webp')) return 'webp';
  return 'png';
}

export async function generateOpenRouterRevealImage(
  prompt: string,
  opts: {
    apiKey?: string;
    model?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<GeneratedRevealImage> {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const response = await fetchImpl(OPENROUTER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'X-Title': 'Music League Round Reveal' },
    body: JSON.stringify({
      model: opts.model ?? process.env.ROUND_REVEAL_IMAGE_MODEL ?? DEFAULT_MODEL,
      prompt,
      n: 1,
      aspect_ratio: '1:1',
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`OpenRouter image ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const json = (await response.json()) as { data?: { b64_json?: string; media_type?: string }[] };
  const image = json.data?.[0];
  if (!image?.b64_json) throw new Error('OpenRouter returned no image');
  return {
    bytes: new Uint8Array(Buffer.from(image.b64_json, 'base64')),
    extension: extensionFor(image.media_type ?? null),
  };
}
