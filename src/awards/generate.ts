import { readFileSync } from 'node:fs';

export type GeneratePoster = (model: string, prompt: string, files: string[]) => Promise<{ mimetype: string; data: string }>;

const mimeOf = (f: string): string => (/\.jpe?g$/i.test(f) ? 'image/jpeg' : /\.webp$/i.test(f) ? 'image/webp' : 'image/png');

/** Generate a poster through OpenRouter: the prompt plus the reference images, in order. */
export function makeOpenRouterPoster(apiKey: string, fetchFn: typeof fetch = fetch): GeneratePoster {
  return async (model, prompt, files) => {
    const images = files.map((f) => ({ type: 'image_url', image_url: { url: `data:${mimeOf(f)};base64,${readFileSync(f).toString('base64')}` } }));
    const res = await fetchFn('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, modalities: ['image', 'text'], messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...images] }] }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`openrouter ${res.status}`);
    const j = (await res.json()) as { choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[] };
    const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    const m = url ? /^data:([^;]+);base64,(.+)$/s.exec(url) : null;
    if (!m) throw new Error('openrouter returned no image');
    return { mimetype: m[1], data: m[2] };
  };
}
