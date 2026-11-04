import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProfileExcerpt, profilesRoot } from './profiles.js';

const PROFILE = (humor = 'HUMORBODY') => `# Persona
## 1. Topics
TOPICSBODY
### Never talks about
NEVERBODY
## 2. Voice and mechanics
VOICEBODY
## 3. Humor style
${humor}
### Serious topics
SERIOUSBODY
## 4. How the others see him
SEENBODY
## 5. Negative space
NEGBODY
## 6. Imitation kit
KITBODY
`;

let dir: string;
let db: Database.Database;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'profiles-'));
	mkdirSync(join(dir, 'second_best'));
	writeFileSync(join(dir, 'Shane_Farkas.md'), PROFILE());
	writeFileSync(join(dir, 'second_best', 'Tommy_Chapin.md'), PROFILE('TOMMYHUMOR'));
	process.env.COVER_PROFILES_DIR = dir;
	db = new Database(':memory:');
	db.exec(`CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT);
		CREATE TABLE player_profiles (player_id INTEGER PRIMARY KEY, notes TEXT, tags TEXT NOT NULL DEFAULT '[]');`);
});
afterEach(() => {
	delete process.env.COVER_PROFILES_DIR;
	rmSync(dir, { recursive: true, force: true });
});

describe('profilesRoot', () => {
	it('honours env', () => expect(profilesRoot()).toBe(dir));
});

describe('loadProfileExcerpt', () => {
	it('extracts topics, humor, perception but not the imitation kit', () => {
		const r = loadProfileExcerpt(db, { slug: 'shane-farkas', name: 'Shane Farkas' });
		expect(r.source).toBe('file');
		expect(r.text).toContain('SEENBODY');
		expect(r.text).toContain('HUMORBODY');
		expect(r.text).toContain('TOPICSBODY');
		expect(r.text).toContain('SERIOUSBODY');
		expect(r.text).toContain('NEVERBODY');
		expect(r.text).not.toContain('KITBODY');
		expect(r.text).not.toContain('VOICEBODY');
		expect(r.text).not.toContain('NEGBODY');
	});
	it('finds second_best players', () => {
		const r = loadProfileExcerpt(db, { slug: 'tommy-chapin', name: 'Tommy Chapin' });
		expect(r.source).toBe('file');
		expect(r.text).toContain('TOMMYHUMOR');
	});
	it('matches case-insensitively and by slug stem', () => {
		writeFileSync(join(dir, 'Jimmy.md'), PROFILE('JIMMYHUMOR'));
		expect(loadProfileExcerpt(db, { slug: 'jimmy', name: 'jimmy' }).text).toContain('JIMMYHUMOR');
		expect(loadProfileExcerpt(db, { slug: 'shane-farkas', name: 'S. Farkas' }).text).toContain('HUMORBODY');
	});
	it('unknown player gives none', () => {
		expect(loadProfileExcerpt(db, { slug: 'nobody', name: 'No Body' })).toEqual({ slug: 'nobody', name: 'No Body', text: '', source: 'none' });
	});
	it('caps huge sections at 6000 at a paragraph boundary', () => {
		const big = Array.from({ length: 400 }, (_, i) => `para ${i} ${'x'.repeat(45)}`).join('\n\n');
		expect(big.length).toBeGreaterThan(20000);
		writeFileSync(join(dir, 'Shane_Farkas.md'), PROFILE(big));
		const r = loadProfileExcerpt(db, { slug: 'shane-farkas', name: 'Shane Farkas' });
		expect(r.text.length).toBeLessThanOrEqual(6000);
		expect(r.text.length).toBeGreaterThan(4000);
		expect(r.text.endsWith('x'.repeat(45))).toBe(true);
	});
	it('adds db notes/tags; db-only and both', () => {
		db.exec(`INSERT INTO players VALUES (1,'No Body'),(2,'Shane Farkas');
			INSERT INTO player_profiles VALUES (1,'loves cats','["cat guy"]'),(2,'vegas','[]');`);
		const a = loadProfileExcerpt(db, { slug: 'nobody', name: 'No Body' });
		expect(a.source).toBe('db');
		expect(a.text).toContain('loves cats');
		expect(a.text).toContain('cat guy');
		const b = loadProfileExcerpt(db, { slug: 'shane-farkas', name: 'Shane Farkas' });
		expect(b.source).toBe('both');
		expect(b.text).toContain('vegas');
		expect(b.text).toContain('HUMORBODY');
	});
	it('empty db row is none', () => {
		db.exec(`INSERT INTO players VALUES (1,'No Body'); INSERT INTO player_profiles VALUES (1,'','[]');`);
		expect(loadProfileExcerpt(db, { slug: 'nobody', name: 'No Body' }).source).toBe('none');
	});
});

const REAL = '/home/loydmilligan/Projects/mlb-cover-factory/.planning/spikes/digest-comedy-media/personify/profiles';
describe.skipIf(!existsSync(join(REAL, 'Shane_Farkas.md')))('real profile', () => {
	it('Shane_Farkas excerpt is non-empty and within cap', () => {
		process.env.COVER_PROFILES_DIR = REAL;
		const r = loadProfileExcerpt(db, { slug: 'shane-farkas', name: 'Shane Farkas' });
		expect(r.source).toBe('file');
		expect(r.text.length).toBeGreaterThan(0);
		expect(r.text.length).toBeLessThanOrEqual(6000);
	});
});
