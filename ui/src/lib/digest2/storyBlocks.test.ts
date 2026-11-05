import { describe, it, expect } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { buildDigest2StoryBlocks } from './storyBlocks.js';

function base(db: Database.Database) {
	db.exec(`
		INSERT INTO leagues (id, slug, name) VALUES (1, 'boarz-ii-men', 'Boarz II Men');
		INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 2, 'active');
		INSERT INTO rounds (id, season_id, ml_round_id, name, created_at)
			VALUES (100, 10, 'ml-100', 'R', '2026-09-01T00:00:00Z');
	`);
}

function draftWithSections(db: Database.Database) {
	db.exec(`
		INSERT INTO digest_drafts (id, round_id, rel_context, prep_checks, stats_content_json)
			VALUES ('d1', 100, '{}', '{}', '{"phrase":{"term":"chopped unc"}}');
		INSERT INTO digest_sections (id, draft_id, kind, position, state, content_json) VALUES
			('s1','d1','podium',0,'default','{"title":"The Podium","body":"x"}'),
			('s2','d1','villain',1,'default','{"title":"The Villain","body":"y"}'),
			('s3','d1','flow',2,'default','{"title":"Flow"}'),
			('s4','d1','chat',3,'default','{"title":"Chat","summary":"z"}'),
			('s5','d1','storylines',4,'default','{"title":"Regulars","cast":[]}'),
			('s6','d1','podium',5,'excluded','{"title":"dupe"}');
	`);
}

describe('buildDigest2StoryBlocks', () => {
	it('returns the auto story kinds in order, excluding one-off kinds and excluded rows', () => {
		const db = openLeagueDb(':memory:');
		base(db);
		draftWithSections(db);
		const story = buildDigest2StoryBlocks(db, 100);
		db.close();
		expect(story.blocks.map((b) => b.kind)).toEqual(['podium', 'villain', 'chat', 'storylines']);
		expect(story.blocks[0].content).toEqual({ title: 'The Podium', body: 'x' });
		expect((story.coinage as { term: string }).term).toBe('chopped unc');
	});

	it('returns empty blocks and null coinage when the round has no draft', () => {
		const db = openLeagueDb(':memory:');
		base(db);
		const story = buildDigest2StoryBlocks(db, 100);
		db.close();
		expect(story).toEqual({ blocks: [], coinage: null });
	});

	it('skips a section with malformed content_json and nulls coinage on malformed stats json', () => {
		const db = openLeagueDb(':memory:');
		base(db);
		db.exec(`
			INSERT INTO digest_drafts (id, round_id, rel_context, prep_checks, stats_content_json)
				VALUES ('d2', 100, '{}', '{}', '{bad json');
			INSERT INTO digest_sections (id, draft_id, kind, position, state, content_json) VALUES
				('x1','d2','podium',0,'default','{bad json'),
				('x2','d2','chat',1,'default','{"title":"ok"}');
		`);
		const story = buildDigest2StoryBlocks(db, 100);
		db.close();
		expect(story.blocks.map((b) => b.kind)).toEqual(['chat']);
		expect(story.coinage).toBeNull();
	});
});

import { shareSafeStory } from './storyBlocks.js';
describe('shareSafeStory', () => {
	it('drops Cover Factory operator keys from every block, leaves the rest untouched', () => {
		const podium = { items: [{ rank: 1, title: 'A' }], _coverNotes: { '1': 'n' }, _coverProjects: { '1': 3 } };
		const chat = { moments: [] };
		const story = { blocks: [{ kind: 'podium' as const, content: podium, variant: 'both' }, { kind: 'chat' as const, content: chat, variant: 'visual' }], coinage: null };
		const out = shareSafeStory(story);
		expect(out.blocks[0].content).toEqual({ items: [{ rank: 1, title: 'A' }] });
		expect(out.blocks[1].content).toBe(chat);
		expect(JSON.stringify(out)).not.toMatch(/_cover/);
		expect(story.blocks[0].content).toBe(podium); // input not mutated
		expect(podium._coverNotes).toEqual({ '1': 'n' });
	});
});
