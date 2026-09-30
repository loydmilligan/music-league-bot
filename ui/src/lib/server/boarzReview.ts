import { appendFile, mkdir, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join, relative, sep, extname } from 'node:path';

const localRoots = [resolve(process.cwd(), '../boarz-season-1-cinematic'), resolve(process.cwd(), '../../boarz-season-1-cinematic')];
export const BOARZ_ROOT = process.env.BOARZ_REVIEW_DIR ?? localRoots.find(existsSync) ?? localRoots[0];
const MEDIA_DIRS = ['generations', 'selects', 'stills', 'card'] as const;
const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime'
};

export type Candidate = {
  id: string;
  name: string;
  hook: string;
  fields: { label: string; text: string }[];
};
export type ReviewMedia = { path: string; url: string; name: string; kind: 'image' | 'video' };
export type ReviewPlayer = { slug: string; name: string; candidates: Candidate[]; media: ReviewMedia[] };

function plain(text: string): string {
  return text.trim()
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

export function parseCandidates(markdown: string): Candidate[] {
  const chunks = markdown.split(/^## Candidate ([A-Z])(?:\s*[—–-]\s*(.+))?\s*$/m).slice(1);
  const candidates: Candidate[] = [];
  for (let i = 0; i < chunks.length; i += 3) {
    const id = chunks[i];
    const title = chunks[i + 1]?.trim() ?? '';
    const body = (chunks[i + 2] ?? '').split(/^## /m)[0];
    const fields: Candidate['fields'] = [];
    const regex = /^\*\*([^*]+?):\*\*\s*([\s\S]*?)(?=^\*\*[^*]+?:\*\*|$(?![\s\S]))/gm;
    for (const match of body.matchAll(regex)) {
      const value = plain(match[2]);
      if (value) fields.push({ label: match[1].trim(), text: value });
    }
    const workingName = fields.find(field => field.label.toLowerCase() === 'working name')?.text;
    const name = title || workingName || `Candidate ${id}`;
    const hook = fields.find(field => /^core (character )?hook$/i.test(field.label))?.text ?? '';
    if (fields.length && (title || workingName || hook)) {
      candidates.push({ id, name, hook, fields: fields.filter(field => field.label.toLowerCase() !== 'working name') });
    }
  }
  return candidates;
}

async function collectMedia(playerDir: string, slug: string): Promise<ReviewMedia[]> {
  const media: ReviewMedia[] = [];
  async function walk(directory: string, prefix: string, depth: number): Promise<void> {
    if (depth > 5) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const path = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(join(directory, entry.name), path, depth + 1);
      else if (entry.isFile()) {
        const mime = MIME[extname(entry.name).toLowerCase()];
        if (mime) media.push({
          path, url: `/boarz-season-1/media/${encodeURIComponent(slug)}/${path.split('/').map(encodeURIComponent).join('/')}`,
          name: entry.name, kind: mime.startsWith('video/') ? 'video' : 'image'
        });
      }
    }
  }
  for (const folder of MEDIA_DIRS) await walk(join(playerDir, folder), folder, 0);
  return media.sort((a, b) => a.path.localeCompare(b.path));
}

export async function getReviewPlayers(): Promise<ReviewPlayer[]> {
  const playersDir = join(BOARZ_ROOT, 'players');
  const entries = await readdir(playersDir, { withFileTypes: true }).catch(() => []);
  const players = await Promise.all(entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('_')).map(async entry => {
    const slug = entry.name;
    const dir = join(playersDir, slug);
    const profileText = await readFile(join(dir, 'dossier/player-profile.json'), 'utf8').catch(() => '{}');
    const profile = JSON.parse(profileText) as { player_name?: string };
    const markdown = await readFile(join(dir, 'concept-candidates.md'), 'utf8').catch(() => '');
    return { slug, name: profile.player_name ?? slug, candidates: parseCandidates(markdown), media: await collectMedia(dir, slug) };
  }));
  return players.sort((a, b) => a.name.localeCompare(b.name));
}

export async function resolveReviewMedia(slug: string, path: string): Promise<{ path: string; mime: string; size: number } | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const segments = path.split('/');
  if (!MEDIA_DIRS.includes(segments[0] as typeof MEDIA_DIRS[number]) || segments.some(s => !s || s === '.' || s === '..' || s.startsWith('.'))) return null;
  const mime = MIME[extname(path).toLowerCase()];
  if (!mime) return null;
  const base = await realpath(join(BOARZ_ROOT, 'players', slug, segments[0])).catch(() => null);
  if (!base) return null;
  const candidate = await realpath(join(base, ...segments.slice(1))).catch(() => null);
  if (!candidate || !relative(base, candidate) || relative(base, candidate).startsWith(`..${sep}`) || relative(base, candidate) === '..') return null;
  const info = await stat(candidate).catch(() => null);
  return info?.isFile() ? { path: candidate, mime, size: info.size } : null;
}

export type StillShot = 'frontal' | 'profile' | 'face_closeup';
export type StillOutputInfo = { path: string; exists: boolean; run: string | null; provider: string | null; model: string | null };
export type StillSpecInfo = {
  dirName: string;
  spec: { player: string; candidate: string; heroName: string; descriptionFile: string };
  personPath: string;
  inspirationPath: string;
  hasPerson: boolean;
  hasInspiration: boolean;
  outputs: Record<StillShot, StillOutputInfo>;
  description: string;
};
export type StillShotResult = { shot: StillShot; ok: boolean; error?: string };
export type StillGenerationResult = { ok: boolean; error?: string; shots?: StillShotResult[] };

const STILL_SHOTS: StillShot[] = ['frontal', 'profile', 'face_closeup'];
const MAX_STILL_UPLOAD = 12 * 1024 * 1024;
const AVOID_LIST = 'No text, no letters, no words, no logos, no watermarks, no duplicate people, no extra limbs, no recognizable existing superhero costumes, photorealistic live-action style.';
const SHOT_PROMPTS: Record<StillShot, string> = {
  frontal: 'Full-body neutral frontal view facing the camera, standing pose, plain dark studio background, cinematic lighting, entire head-to-toe costume visible.',
  profile: 'Full-body side profile view, same character, plain dark studio background, cinematic lighting.',
  face_closeup: 'Close-up portrait of the same character\'s face and upper chest, neutral expression with a slight grin, same costume details visible at the collar.'
};

type RawStillSpec = {
  dir: string;
  dirName: string;
  spec: StillSpecInfo['spec'];
  personPath: string;
  inspirationPath: string;
  hasPerson: boolean;
  hasInspiration: boolean;
  outputs: Record<StillShot, StillOutputInfo>;
  description: string;
};

function tolerantKey(obj: Record<string, unknown>, ...keys: string[]): unknown {
  const lowered = new Map(Object.keys(obj).map(key => [key.toLowerCase().replace(/[^a-z0-9]/g, ''), key]));
  for (const key of keys) {
    const found = lowered.get(key.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (found !== undefined && obj[found] != null) return obj[found];
  }
  return undefined;
}

function tolerantString(obj: Record<string, unknown>, keys: string[], fallback: string): string {
  const value = tolerantKey(obj, ...keys);
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function tolerantOutputs(raw: Record<string, unknown>): Record<StillShot, StillOutputInfo> {
  const rawOutputs = (tolerantKey(raw, 'outputs') ?? {}) as Record<string, unknown>;
  const outputs = {} as Record<StillShot, StillOutputInfo>;
  for (const shot of STILL_SHOTS) {
    const entry = (tolerantKey(rawOutputs, shot, shot.replace('_', '')) ?? {}) as Record<string, unknown>;
    const path = typeof entry.path === 'string' && entry.path ? entry.path : `${shot}.png`;
    outputs[shot] = {
      path,
      exists: false,
      run: typeof entry.run === 'string' ? entry.run : null,
      provider: typeof entry.provider === 'string' ? entry.provider : null,
      model: typeof entry.model === 'string' ? entry.model : null
    };
  }
  return outputs;
}

async function readStillSpecs(slug: string): Promise<RawStillSpec[]> {
  if (!/^[a-z0-9-]+$/.test(slug)) return [];
  const stillsDir = join(BOARZ_ROOT, 'players', slug, 'stills');
  const entries = await readdir(stillsDir, { withFileTypes: true }).catch(() => []);
  const specs: RawStillSpec[] = [];
  for (const entry of entries.filter(candidate => candidate.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = join(stillsDir, entry.name);
    const specText = await readFile(join(dir, 'spec.json'), 'utf8').catch(() => null);
    if (!specText) continue;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(specText) as Record<string, unknown>;
    } catch {
      continue;
    }
    const descriptionFile = tolerantString(raw, ['description_file', 'descriptionFile', 'description'], 'hero_description.md');
    const outputs = tolerantOutputs(raw);
    for (const shot of STILL_SHOTS) outputs[shot].exists = existsSync(join(dir, outputs[shot].path));
    const personPath = tolerantString(tolerantKey(raw, 'person_reference', 'personReference', 'person') as Record<string, unknown> ?? {}, ['path'], 'person.png');
    const inspirationPath = tolerantString(tolerantKey(raw, 'inspiration', 'inspiration_reference', 'inspirationReference') as Record<string, unknown> ?? {}, ['path'], 'inspiration.jpg');
    specs.push({
      dir,
      dirName: entry.name,
      spec: {
        player: tolerantString(raw, ['player'], slug),
        candidate: tolerantString(raw, ['candidate'], ''),
        heroName: tolerantString(raw, ['hero_name', 'heroName', 'hero'], entry.name),
        descriptionFile
      },
      personPath,
      inspirationPath,
      hasPerson: existsSync(join(dir, personPath)),
      hasInspiration: existsSync(join(dir, inspirationPath)),
      outputs,
      description: await readFile(join(dir, descriptionFile), 'utf8').catch(() => '')
    });
  }
  return specs;
}

export async function getStillSpecs(slug: string): Promise<StillSpecInfo[]> {
  const specs = await readStillSpecs(slug);
  return specs.map(({ dir, ...info }) => info);
}

export async function saveStillUpload(slug: string, kind: 'person' | 'inspiration', data: ArrayBuffer, ext: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (!/^[a-z0-9-]+$/.test(slug)) return { ok: false, error: 'invalid player' };
  if (kind !== 'person' && kind !== 'inspiration') return { ok: false, error: 'invalid upload kind' };
  const allowed = kind === 'person' ? ['png', 'jpg', 'jpeg', 'webp'] : ['jpg', 'jpeg', 'png', 'webp', 'gif'];
  if (!allowed.includes(ext.toLowerCase())) return { ok: false, error: `unsupported ${kind} format — use ${allowed.join('/')}` };
  if (data.byteLength > MAX_STILL_UPLOAD) return { ok: false, error: 'file too large — max 12MB' };
  const specs = await readStillSpecs(slug);
  const pack = specs[0];
  if (!pack) return { ok: false, error: 'no stills folder scaffolded for this player yet' };
  const canonical = kind === 'person' ? 'person.png' : 'inspiration.jpg';
  await writeFile(join(pack.dir, canonical), Buffer.from(data));
  return { ok: true, path: `stills/${pack.dirName}/${canonical}` };
}

function loadBoarzEnv(): Record<string, string> {
  const candidates = [join(BOARZ_ROOT, '.env'), '/app/boarz-season-1-cinematic/.env', resolve(process.cwd(), '../boarz-season-1-cinematic/.env')];
  for (const file of candidates) {
    const text = existsSync(file) ? readFileSync(file, 'utf8') : null;
    if (!text) continue;
    const env: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
    }
    return env;
  }
  return {};
}

function stripMarkdownHeaders(markdown: string): string {
  return markdown.trim().replace(/^#{1,6}\s+/gm, '').replace(/<!--[\s\S]*?-->/g, '').trim();
}

function extractImageDataUrl(payload: { choices?: { message?: { images?: { image_url?: { url?: string } }[]; content?: unknown } }[] }): string {
  const message = payload.choices?.[0]?.message;
  const fromImages = message?.images?.[0]?.image_url?.url;
  if (fromImages && fromImages.startsWith('data:image/')) return fromImages;
  if (typeof message?.content === 'string') {
    const match = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/.exec(message.content);
    if (match) return match[0];
  }
  throw new Error('no image in model response');
}

type StillReferenceImage = { label: string; dataURL: string };

async function requestStillImage(key: string, model: string, prompt: string, referenceImages: StillReferenceImage[]): Promise<string> {
  const content: Record<string, unknown>[] = [{ type: 'text', text: prompt }];
  for (const reference of referenceImages) {
    content.push(
      { type: 'text', text: reference.label },
      { type: 'image_url', image_url: { url: reference.dataURL } }
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content }] }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${model}`);
    return extractImageDataUrl(await res.json());
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new Error('request timed out after 120s');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function runStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

async function updateStillSpecOutputs(pack: RawStillSpec, shot: StillShot, run: string, model: string): Promise<void> {
  const specFile = join(pack.dir, 'spec.json');
  const raw = await readFile(specFile, 'utf8').then(text => JSON.parse(text) as Record<string, unknown>).catch(() => ({}) as Record<string, unknown>);
  const rawOutputs = (tolerantKey(raw, 'outputs') ?? {}) as Record<string, Record<string, unknown>>;
  const key = Object.keys(rawOutputs).find(name => name.toLowerCase().replace(/[^a-z0-9]/g, '') === shot.replace('_', '')) ?? shot;
  rawOutputs[key] = { ...(rawOutputs[key] ?? { path: pack.outputs[shot].path }), run, provider: 'openrouter', model, seed: null };
  raw.outputs = rawOutputs;
  await writeFile(specFile, `${JSON.stringify(raw, null, 2)}\n`);
}

export async function runStillGeneration(slug: string): Promise<StillGenerationResult> {
  if (!/^[a-z0-9-]+$/.test(slug)) return { ok: false, error: 'invalid player' };
  const env = loadBoarzEnv();
  const key = env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, error: 'no OPENROUTER_API_KEY' };
  const model = env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image';
  const specs = await readStillSpecs(slug);
  const pack = specs[0];
  if (!pack) return { ok: false, error: 'no stills folder scaffolded for this player yet' };
  const personFile = join(pack.dir, 'person.png');
  if (!existsSync(personFile)) return { ok: false, error: 'upload a person image first' };
  const personDataURL = `data:image/png;base64,${(await readFile(personFile)).toString('base64')}`;
  const inspirationFile = join(pack.dir, pack.inspirationPath);
  const inspirationURL = existsSync(inspirationFile)
    ? `data:${MIME[extname(inspirationFile).toLowerCase()] ?? 'image/jpeg'};base64,${(await readFile(inspirationFile)).toString('base64')}`
    : null;
  const bible = stripMarkdownHeaders(await readFile(join(BOARZ_ROOT, 'prompts', 'shared', 'visual_bible.md'), 'utf8').catch(() => ''));
  const stamp = runStamp(new Date());
  const runDir = join(pack.dir, `run-${stamp}`);
  const shots: StillShotResult[] = [];
  const generatedReferences: { shot: StillShot; dataURL: string }[] = [];
  for (const shot of STILL_SHOTS) {
    const continuityPrompt = generatedReferences.length === 0
      ? 'SERIES CONTINUITY: This is the first and authoritative image in a three-image character reference set. Establish one definitive person and one definitive costume. Later views will receive this image and must copy its identity, face, hair, body proportions, costume construction, materials, colors, props, and small details exactly.'
      : `STRICT SERIES CONTINUITY: Generate the same person in the same costume as the successful earlier image${generatedReferences.length === 1 ? '' : 's'} supplied below. The FIRST GENERATED STILL is the primary authority for both identity and costume. Preserve the exact face, hair, apparent age, body proportions, garment construction, materials, colors, seams, marks, props, and accessory placement. Use the original person photo to preserve likeness and the earlier generated stills to preserve the established costume. Change only the camera angle and pose requested for this shot. Do not redesign, simplify, add, remove, recolor, or relocate costume details.`;
    const prompt = [bible, pack.description, continuityPrompt, SHOT_PROMPTS[shot], AVOID_LIST].filter(Boolean).join('\n\n');
    const referenceImages: StillReferenceImage[] = [
      { label: 'ORIGINAL PERSON REFERENCE — authoritative source for the person’s identity and facial likeness:', dataURL: personDataURL }
    ];
    if (inspirationURL) {
      referenceImages.push({ label: 'ORIGINAL INSPIRATION REFERENCE — mood and rendering style only; it must not replace the person or established costume:', dataURL: inspirationURL });
    }
    for (const [index, reference] of generatedReferences.entries()) {
      referenceImages.push({
        label: index === 0
          ? `PRIMARY GENERATED COSTUME AND IDENTITY AUTHORITY (${reference.shot}) — reproduce this exact person and costume:`
          : `ADDITIONAL GENERATED CONTINUITY REFERENCE (${reference.shot}) — preserve these same details from another angle:`,
        dataURL: reference.dataURL
      });
    }
    try {
      const dataURL = await requestStillImage(key, model, prompt, referenceImages);
      await mkdir(runDir, { recursive: true });
      const outputPath = join(pack.dir, pack.outputs[shot].path);
      if (existsSync(outputPath)) await rename(outputPath, join(runDir, pack.outputs[shot].path));
      await writeFile(outputPath, Buffer.from(dataURL.slice(dataURL.indexOf(',') + 1), 'base64'));
      await writeFile(join(runDir, `metadata-${shot}.json`), `${JSON.stringify({ date: new Date().toISOString(), provider: 'openrouter', model, shot, prompt, seed: null, continuityReferences: generatedReferences.map(reference => reference.shot), notes: 'generated from the boarz review page; earlier successful shots in this run were supplied as continuity references' }, null, 2)}\n`);
      await updateStillSpecOutputs(pack, shot, `run-${stamp}`, model);
      await appendFile(join(pack.dir, 'generation.log'), `${new Date().toISOString()} shot=${shot} provider=openrouter model=${model} run=run-${stamp} ok\n`);
      generatedReferences.push({ shot, dataURL });
      shots.push({ shot, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await appendFile(join(pack.dir, 'generation.log'), `${new Date().toISOString()} shot=${shot} provider=openrouter model=${model} run=run-${stamp} error=${message.replace(/\s+/g, ' ').slice(0, 200)}\n`).catch(() => {});
      shots.push({ shot, ok: false, error: message });
    }
  }
  return { ok: shots.some(result => result.ok), shots };
}
