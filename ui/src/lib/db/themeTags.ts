/**
 * Theme property-tags (sprint-22, History Phase 1, D11).
 *
 * Themes carry property tags so theme similarity (Phase 3) can be computed as
 * TAG OVERLAP — no LLM. A tag is a (category, value) pair drawn from an
 * extensible category taxonomy:
 *   semantic · musicality · energy-feel · instrument · artist  (+ add more).
 *
 * Storage (see schema.ts):
 *   - theme_tag_categories — the seeded, extensible taxonomy of categories.
 *   - theme_tags           — the (category, value) vocabulary; reused across rounds.
 *   - round_theme_tags     — the round↔tag join (multi-tag per round).
 *
 * Values + category keys are normalized (trim + lowercase, spaces→hyphens) so
 * overlap is a clean equality/join and we don't get "Chill" vs "chill" dupes.
 */
import type Database from 'better-sqlite3';

export interface ThemeTagCategory {
  key: string;
  label: string;
  description: string;
  sortOrder: number;
}

export interface ThemeTag {
  id: number;
  category: string;
  value: string;
}

export const THEME_TAG_CATEGORY_SEED: ThemeTagCategory[] = [
  { key: 'semantic',    label: 'Semantic',      description: "What the song is about — title, lyrics, subject matter (most common).", sortOrder: 1 },
  { key: 'musicality',  label: 'Musicality',    description: 'Musical content — tempo, key, production, bass.', sortOrder: 2 },
  { key: 'energy-feel', label: 'Energy / Feel', description: 'Mood and vibe — chill, hype, melancholy.', sortOrder: 3 },
  { key: 'instrument',  label: 'Instrument',    description: 'Features a specific instrument.', sortOrder: 4 },
  { key: 'artist',      label: 'Artist',        description: 'About who made it — one-hit wonders, a specific artist or era.', sortOrder: 5 },
];

// Starter vocabulary so tagging has something to pick from immediately. New
// (category, value) pairs are created on demand — this is just a head start.
export const THEME_TAG_VALUE_SEED: Record<string, string[]> = {
  semantic: ['love', 'heartbreak', 'place', 'travel', 'time', 'nostalgia', 'money', 'party', 'summer', 'weather', 'night', 'death', 'rebellion', 'family', 'friendship', 'food', 'animals', 'color'],
  musicality: ['bass-heavy', 'fast-tempo', 'slow-tempo', 'acoustic', 'electronic', 'lo-fi', 'heavy-production', 'minimal', 'key-change'],
  'energy-feel': ['chill', 'hype', 'melancholy', 'uplifting', 'dark', 'romantic', 'angry', 'dreamy', 'groovy'],
  instrument: ['guitar', 'piano', 'saxophone', 'strings', 'synth', 'drums', 'brass', 'a-cappella'],
  artist: ['one-hit-wonder', 'specific-artist', 'specific-era', 'cover', 'collaboration', 'debut'],
};

export function normCategory(c: string): string {
  return c.trim().toLowerCase().replace(/\s+/g, '-');
}
export function normValue(v: string): string {
  return v.trim().toLowerCase();
}

function titleCase(key: string): string {
  return key.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Idempotent seed of the category taxonomy + starter vocabulary. */
export function seedThemeTags(db: Database.Database): void {
  const cat = db.prepare(
    'INSERT OR IGNORE INTO theme_tag_categories (key, label, description, sort_order) VALUES (?, ?, ?, ?)',
  );
  for (const c of THEME_TAG_CATEGORY_SEED) cat.run(c.key, c.label, c.description, c.sortOrder);
  const tag = db.prepare('INSERT OR IGNORE INTO theme_tags (category, value) VALUES (?, ?)');
  for (const [c, vals] of Object.entries(THEME_TAG_VALUE_SEED)) {
    for (const v of vals) tag.run(c, normValue(v));
  }
}

export function getCategories(db: Database.Database): ThemeTagCategory[] {
  return (db.prepare(
    'SELECT key, label, description, sort_order FROM theme_tag_categories ORDER BY sort_order, key',
  ).all() as any[]).map(r => ({ key: r.key, label: r.label, description: r.description, sortOrder: r.sort_order }));
}

/** Ensure a category exists (auto-create with a derived label) — the extensibility hook. */
export function ensureCategory(db: Database.Database, categoryRaw: string, label?: string): string {
  const key = normCategory(categoryRaw);
  if (!key) throw new Error('category required');
  db.prepare('INSERT OR IGNORE INTO theme_tag_categories (key, label) VALUES (?, ?)')
    .run(key, label ?? titleCase(key));
  return key;
}

/** Get-or-create a vocabulary tag for (category, value). Auto-creates the category. */
export function upsertVocabTag(db: Database.Database, categoryRaw: string, valueRaw: string): ThemeTag {
  const category = ensureCategory(db, categoryRaw);
  const value = normValue(valueRaw);
  if (!value) throw new Error('value required');
  db.prepare('INSERT OR IGNORE INTO theme_tags (category, value) VALUES (?, ?)').run(category, value);
  const row = db.prepare('SELECT id, category, value FROM theme_tags WHERE category = ? AND value = ?')
    .get(category, value) as ThemeTag;
  return row;
}

/** The full taxonomy: categories + the current tag vocabulary. */
export function getTaxonomy(db: Database.Database): { categories: ThemeTagCategory[]; tags: ThemeTag[] } {
  const tags = db.prepare('SELECT id, category, value FROM theme_tags ORDER BY category, value').all() as ThemeTag[];
  return { categories: getCategories(db), tags };
}

export function getRoundTags(db: Database.Database, roundId: number): ThemeTag[] {
  return db.prepare(
    `SELECT t.id, t.category, t.value
       FROM round_theme_tags rt JOIN theme_tags t ON t.id = rt.tag_id
      WHERE rt.round_id = ?
      ORDER BY t.category, t.value`,
  ).all(roundId) as ThemeTag[];
}

/** A tag reference: either an existing vocab id, or a (category, value) to upsert. */
export type TagRef = { id: number } | { category: string; value: string };

function resolveTag(db: Database.Database, ref: TagRef): ThemeTag {
  if ('id' in ref) {
    const row = db.prepare('SELECT id, category, value FROM theme_tags WHERE id = ?').get(ref.id) as ThemeTag | undefined;
    if (!row) throw new Error(`theme_tag ${ref.id} not found`);
    return row;
  }
  return upsertVocabTag(db, ref.category, ref.value);
}

/** Replace a round's full tag set. Upserts vocab as needed. Returns the new set. */
export function setRoundTags(db: Database.Database, roundId: number, refs: TagRef[]): ThemeTag[] {
  const tx = db.transaction((rs: TagRef[]) => {
    db.prepare('DELETE FROM round_theme_tags WHERE round_id = ?').run(roundId);
    const attach = db.prepare('INSERT OR IGNORE INTO round_theme_tags (round_id, tag_id) VALUES (?, ?)');
    for (const ref of rs) {
      const tag = resolveTag(db, ref);
      attach.run(roundId, tag.id);
    }
  });
  tx(refs);
  return getRoundTags(db, roundId);
}

/** Attach a single tag (upserting vocab). Returns the resolved tag. */
export function addRoundTag(db: Database.Database, roundId: number, categoryRaw: string, valueRaw: string): ThemeTag {
  const tag = upsertVocabTag(db, categoryRaw, valueRaw);
  db.prepare('INSERT OR IGNORE INTO round_theme_tags (round_id, tag_id) VALUES (?, ?)').run(roundId, tag.id);
  return tag;
}

/** Detach a tag from a round (leaves the vocab row intact). */
export function removeRoundTag(db: Database.Database, roundId: number, tagId: number): boolean {
  return db.prepare('DELETE FROM round_theme_tags WHERE round_id = ? AND tag_id = ?').run(roundId, tagId).changes > 0;
}

/** Count of rounds that carry at least one tag — for the theme-tagging report. */
export function countTaggedRounds(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(DISTINCT round_id) AS n FROM round_theme_tags').get() as { n: number }).n;
}
