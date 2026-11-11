/**
 * The poster kit an owner pastes into an image model: the filled prompt, the award's
 * style reference (`<kitsDir>/<key>-style-reference.png`) and the three face photos
 * (`<kitsDir>/avatars/<file>`), zipped. Missing files are listed, never fatal.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AwardDef } from './types.js';
import { zipStore, type ZipEntry } from './zip.js';

const SAFE_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

export function buildKitZip(o: { kitsDir: string; def: AwardDef; prompt: string; avatars: string[] }): { zip: Buffer; missing: string[] } {
  const entries: ZipEntry[] = [{ name: 'prompt.md', data: Buffer.from(o.prompt, 'utf8') }];
  const missing: string[] = [];

  const style = `${o.def.key}-style-reference.png`;
  const stylePath = path.join(o.kitsDir, style);
  if (existsSync(stylePath)) entries.push({ name: 'style-reference.png', data: readFileSync(stylePath) });
  else missing.push(style);

  for (const a of [...new Set(o.avatars)]) {
    const p = path.join(o.kitsDir, 'avatars', a);
    if (SAFE_NAME.test(a) && !a.includes('..') && existsSync(p)) entries.push({ name: a, data: readFileSync(p) });
    else missing.push(a);
  }
  if (missing.length) entries.push({ name: 'MISSING.txt', data: Buffer.from(`Not found in the kit:\n${missing.join('\n')}\n`, 'utf8') });
  return { zip: zipStore(entries), missing };
}
