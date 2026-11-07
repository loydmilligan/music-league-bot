import { readFileSync } from 'node:fs';
import { CMU_SIGNAL_EMOJIS } from './catchMeUp.js';

export interface PaletteCategory {
  id: string;
  describe: string;
  emojis: string[];
}

export interface Palette {
  categories: PaletteCategory[];
  all: string[];
  fallbackPool: string[];
}

const FALLBACK_CATEGORIES = ['dying-laughing', 'hype'];

function strings(v: unknown, what: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every((e) => typeof e === 'string' && e.length > 0)) {
    throw new Error(`invalid palette: ${what} must be an array of non-empty strings`);
  }
  return v as string[];
}

/** Validate a raw palette (default: the bundled JSON) and derive `all` and `fallbackPool`. */
export function loadPalette(raw?: unknown): Palette {
  const data =
    raw ?? JSON.parse(readFileSync(new URL('./reactionPalette.json', import.meta.url), 'utf8'));
  if (typeof data !== 'object' || data === null) throw new Error('invalid palette: not an object');
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.categories) || d.categories.length === 0) {
    throw new Error('invalid palette: categories missing');
  }
  const reserved = new Set<string>(CMU_SIGNAL_EMOJIS);
  const ids = new Set<string>();
  const seen = new Set<string>();
  const categories: PaletteCategory[] = [];
  for (const c of d.categories as Record<string, unknown>[]) {
    if (typeof c?.id !== 'string' || !c.id || typeof c.describe !== 'string') {
      throw new Error('invalid palette: category needs id and describe');
    }
    if (ids.has(c.id)) throw new Error(`invalid palette: duplicate category id ${c.id}`);
    ids.add(c.id);
    const emojis = strings(c.emojis, `category ${c.id} emojis`);
    for (const e of emojis) {
      if (reserved.has(e)) throw new Error(`invalid palette: reserved emoji ${e}`);
      if (seen.has(e)) throw new Error(`invalid palette: duplicate emoji ${e}`);
      seen.add(e);
    }
    categories.push({ id: c.id, describe: c.describe, emojis });
  }
  const excluded = new Set([...strings(d.noFallback, 'noFallback'), ...strings(d.zwj, 'zwj')]);
  const fallbackPool = categories
    .filter((c) => FALLBACK_CATEGORIES.includes(c.id))
    .flatMap((c) => c.emojis)
    .filter((e) => !excluded.has(e));
  if (fallbackPool.length === 0) throw new Error('invalid palette: fallback pool is empty');
  return { categories, all: categories.flatMap((c) => c.emojis), fallbackPool };
}

export const PALETTE: Palette = loadPalette();
