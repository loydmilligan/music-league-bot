import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * The preview allowlist: new catch-me-up features act only in these groups.
 * Persisted as `{ "groups": [...], "people": [...] }` (people are DM-target ids,
 * matched exactly; callers normalise), re-read when the file's
 * mtime or size changes so promoting a group needs no restart. A missing,
 * unreadable or misshapen file means nothing is in preview. Never throws.
 */
export interface CmuPreview {
  isPreview(groupId: string): boolean;
  isPreviewPerson(authorId: string): boolean;
}

interface Lists {
  groups: Set<string>;
  people: Set<string>;
}

export function cmuPreviewPath(): string {
  return path.resolve(process.env.DATA_DIR ?? 'data', 'cmu-preview.json');
}

function strings(v: unknown): Set<string> {
  return new Set(Array.isArray(v) ? v.filter((g): g is string => typeof g === 'string') : []);
}

function parse(text: string): Lists {
  try {
    const d = JSON.parse(text) as unknown;
    if (d && typeof d === 'object') {
      const r = d as Record<string, unknown>;
      return { groups: strings(r.groups), people: strings(r.people) };
    }
  } catch {
    // corrupt
  }
  return { groups: new Set(), people: new Set() };
}

export function openCmuPreview(
  file: string = cmuPreviewPath(),
  o?: { statFn?: typeof statSync; readFn?: typeof readFileSync },
): CmuPreview {
  const statFn = o?.statFn ?? statSync;
  const readFn = o?.readFn ?? readFileSync;
  let key: string | null = null;
  let lists: Lists = parse('');
  const refresh = (): Lists => {
    try {
      const st = statFn(file);
      const next = `${st.mtimeMs}:${st.size}`;
      if (next !== key) {
        lists = parse(readFn(file, 'utf8'));
        key = next;
      }
    } catch {
      lists = parse('');
      key = null;
    }
    return lists;
  };
  return {
    isPreview: (groupId) => refresh().groups.has(groupId),
    isPreviewPerson: (authorId) => refresh().people.has(authorId),
  };
}

/** An in-memory gate: the default when none is wired (tests, or CMU unconfigured). */
export function memoryCmuPreview(groups: string[] = [], people: string[] = []): CmuPreview {
  const g = new Set(groups);
  const p = new Set(people);
  return { isPreview: (id) => g.has(id), isPreviewPerson: (id) => p.has(id) };
}

let shared: CmuPreview | undefined;
/** The default gate over `cmuPreviewPath()`, created on first use. */
export function defaultCmuPreview(): CmuPreview {
  return (shared ??= openCmuPreview());
}

export function isPreview(groupId: string): boolean {
  return defaultCmuPreview().isPreview(groupId);
}
export function isPreviewPerson(authorId: string): boolean {
  return defaultCmuPreview().isPreviewPerson(authorId);
}
