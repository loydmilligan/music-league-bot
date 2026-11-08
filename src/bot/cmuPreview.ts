import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * The preview allowlist: new catch-me-up features act only in these groups.
 * Persisted as `{ "groups": [...], "people": [...] }` (people are DM-target ids,
 * matched exactly; callers normalise; the literal entry `"owner"` matches the known owner ids,
 * and the literal entry `"*"` matches every non-empty person id; `"owner"` and `"*"` mean nothing in
 * `groups`), re-read when the file's
 * mtime or size changes so promoting a group needs no restart. A missing,
 * unreadable or misshapen file means nothing is in preview. Never throws.
 */
export interface CmuPreview {
  isPreview(groupId: string): boolean;
  isPreviewPerson(authorId: string): boolean;
  /** Cheap pre-check: false when no people are listed, so no id lookup is needed. Optional for older gates. */
  hasPeople?(): boolean;
  /** Sprint 4 message-format gate (optional so older hand-built gates still type-check; callers use `?.`): exact match against the file's `format` list; `"owner"` and `"*"` mean nothing. */
  isFormatPreview?(groupId: string): boolean;
}

interface Lists {
  groups: Set<string>;
  people: Set<string>;
  format: Set<string>;
}

export function cmuPreviewPath(): string {
  return path.resolve(process.env.DATA_DIR ?? 'data', 'cmu-preview.json');
}

function strings(v: unknown): Set<string> {
  return new Set(Array.isArray(v) ? v.filter((g): g is string => typeof g === 'string') : []);
}

function noOwner(s: Set<string>): Set<string> {
  s.delete('owner');
  s.delete('*');
  return s;
}

function parse(text: string): Lists {
  try {
    const d = JSON.parse(text) as unknown;
    if (d && typeof d === 'object') {
      const r = d as Record<string, unknown>;
      return { groups: noOwner(strings(r.groups)), people: strings(r.people), format: noOwner(strings(r.format)) };
    }
  } catch {
    // corrupt
  }
  return { groups: new Set(), people: new Set(), format: new Set() };
}

const OWNER = 'owner';
const registeredOwnerIds = new Set<string>();

/** Register an id (e.g. the owner's DM-target LID) that the `"owner"` people entry matches. */
export function addPreviewOwnerId(id: string): void {
  if (typeof id === 'string' && id !== '') registeredOwnerIds.add(id);
}

/** Resolve the owner's DM-target id once and register it. Never throws, never logs ids. */
export async function registerPreviewOwner(
  dmTarget: (id: string) => Promise<string>,
  ownerPhone: string,
  log: (line: string) => void,
): Promise<void> {
  try {
    const id = await dmTarget(ownerPhone);
    if (typeof id === 'string' && id !== '') addPreviewOwnerId(id);
  } catch {
    try { log('[preview] owner id lookup failed'); } catch { /* ignore */ }
  }
}

function defaultOwnerIds(): Iterable<string> {
  const ids = new Set(registeredOwnerIds);
  const x = process.env.OWNER_PHONE_NUMBER;
  if (x) ids.add(x.includes('@') ? x : `${x}@c.us`);
  return ids;
}

function personMatch(people: Set<string>, id: string, owners: Iterable<string>): boolean {
  if (id === '') return false;
  if (people.has('*')) return true;
  if (id !== OWNER && people.has(id)) return true;
  if (!people.has(OWNER)) return false;
  for (const o of owners) if (o !== '' && o === id) return true;
  return false;
}

export function openCmuPreview(
  file: string = cmuPreviewPath(),
  o?: { statFn?: typeof statSync; readFn?: typeof readFileSync; ownerIds?: () => Iterable<string> },
): CmuPreview {
  const ownerIds = o?.ownerIds ?? defaultOwnerIds;
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
    isPreviewPerson: (authorId) => personMatch(refresh().people, authorId, ownerIds()),
    hasPeople: () => refresh().people.size > 0,
    isFormatPreview: (groupId) => refresh().format.has(groupId),
  };
}

/** An in-memory gate: the default when none is wired (tests, or CMU unconfigured). */
export function memoryCmuPreview(
  groups: string[] = [],
  people: string[] = [],
  ownerIds: string[] = [],
  format: string[] = [],
): CmuPreview {
  const f = noOwner(new Set(format));
  const g = new Set(groups);
  g.delete(OWNER);
  g.delete('*');
  const p = new Set(people);
  return { isPreview: (id) => g.has(id), isPreviewPerson: (id) => personMatch(p, id, ownerIds), hasPeople: () => p.size > 0, isFormatPreview: (id) => f.has(id) };
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
export function isFormatPreview(groupId: string): boolean {
  return defaultCmuPreview().isFormatPreview?.(groupId) ?? false;
}
