import { it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound } from './rounds.js';
import {
  getCategories, getTaxonomy, upsertVocabTag, ensureCategory,
  getRoundTags, setRoundTags, addRoundTag, removeRoundTag, countTaggedRounds,
  THEME_TAG_CATEGORY_SEED,
} from './themeTags.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
let roundId: number;
beforeEach(() => {
  db = openLeagueDb(':memory:');
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 99, 'active');
  roundId = upsertRound(db, seasonId, {
    mlRoundId: 'r-tag', name: 'tagme', description: 'a theme',
    spotifyPlaylistUrl: '', createdAt: new Date().toISOString(),
  });
});

it('seeds the 5 canonical categories + a starter vocabulary', () => {
  const cats = getCategories(db);
  expect(cats.map(c => c.key)).toEqual(THEME_TAG_CATEGORY_SEED.map(c => c.key));
  const { tags } = getTaxonomy(db);
  expect(tags.some(t => t.category === 'energy-feel' && t.value === 'chill')).toBe(true);
});

it('upsertVocabTag normalizes + is idempotent (no dup case variants)', () => {
  const a = upsertVocabTag(db, 'Energy Feel', '  Chill ');
  const b = upsertVocabTag(db, 'energy-feel', 'chill');
  expect(a.id).toBe(b.id);
  expect(a.category).toBe('energy-feel');
  expect(a.value).toBe('chill');
});

it('ensureCategory auto-creates new categories (extensible taxonomy)', () => {
  ensureCategory(db, 'Decade Vibe');
  const cats = getCategories(db);
  const added = cats.find(c => c.key === 'decade-vibe');
  expect(added).toBeTruthy();
  expect(added!.label).toBe('Decade Vibe');
});

it('setRoundTags replaces the full set and upserts vocab on the fly', () => {
  setRoundTags(db, roundId, [
    { category: 'semantic', value: 'love' },
    { category: 'energy-feel', value: 'chill' },
    { category: 'instrument', value: 'banjo' }, // not in seed → created
  ]);
  let tags = getRoundTags(db, roundId);
  expect(tags.map(t => `${t.category}:${t.value}`).sort()).toEqual(
    ['energy-feel:chill', 'instrument:banjo', 'semantic:love'],
  );
  // replace with a smaller set
  setRoundTags(db, roundId, [{ category: 'semantic', value: 'love' }]);
  tags = getRoundTags(db, roundId);
  expect(tags).toHaveLength(1);
  expect(tags[0].value).toBe('love');
});

it('add / remove a single tag and count tagged rounds', () => {
  expect(countTaggedRounds(db)).toBe(0);
  const tag = addRoundTag(db, roundId, 'artist', 'one-hit-wonder');
  expect(getRoundTags(db, roundId).map(t => t.id)).toContain(tag.id);
  expect(countTaggedRounds(db)).toBe(1);
  // adding the same tag again is a no-op (PK on round_id,tag_id)
  addRoundTag(db, roundId, 'artist', 'one-hit-wonder');
  expect(getRoundTags(db, roundId)).toHaveLength(1);
  removeRoundTag(db, roundId, tag.id);
  expect(getRoundTags(db, roundId)).toHaveLength(0);
  expect(countTaggedRounds(db)).toBe(0);
});

it('setRoundTags accepts vocab ids as references', () => {
  const t = upsertVocabTag(db, 'musicality', 'bass-heavy');
  setRoundTags(db, roundId, [{ id: t.id }]);
  expect(getRoundTags(db, roundId)[0].id).toBe(t.id);
});

it('deleting a round cascades its tag attachments', () => {
  addRoundTag(db, roundId, 'semantic', 'love');
  db.prepare('DELETE FROM rounds WHERE id = ?').run(roundId);
  expect(countTaggedRounds(db)).toBe(0);
});
