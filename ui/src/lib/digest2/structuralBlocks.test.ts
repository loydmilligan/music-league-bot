import { describe, it, expect } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { buildDigest2Structural } from './structuralBlocks.js';

function base(db: Database.Database) {
	db.exec(`
		INSERT INTO leagues (id, slug, name) VALUES (1, 'boarz-ii-men', 'Boarz II Men');
		INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 2, 'active');
		INSERT INTO rounds (id, season_id, ml_round_id, name, created_at)
			VALUES (100, 10, 'ml-100', 'R', '2026-09-01T00:00:00Z');
	`);
}

function draftWithReel(db: Database.Database, reelContentJson: string, reelState = 'default') {
	db.exec(`
		INSERT INTO digest_drafts (id, round_id, rel_context, prep_checks, reel_state, reel_content_json)
			VALUES ('d1', 100, '{}', '{}', '${reelState}', '${reelContentJson.replace(/'/g, "''")}');
	`);
}

describe('buildDigest2Structural', () => {
	it('returns all-null for a brand-new round with no votes, no draft, no opt-in', () => {
		const db = openLeagueDb(':memory:');
		base(db);
		const s = buildDigest2Structural(db, 100);
		db.close();
		expect(s).toEqual({
			standings: null,
			nextRound: null,
			tastemaker: null,
			guesser: null,
			reel: null
		});
	});

	it('surfaces the reel when the newest draft has media and is not excluded', () => {
		const db = openLeagueDb(':memory:');
		base(db);
		draftWithReel(db, '{"title":"The Reel","media":{"poster":"/x.jpg"}}');
		const s = buildDigest2Structural(db, 100);
		db.close();
		expect((s.reel as { title?: string })?.title).toBe('The Reel');
	});

	it('hides the reel when reel_state is excluded even if media is present', () => {
		const db = openLeagueDb(':memory:');
		base(db);
		draftWithReel(db, '{"media":{"src":"/x.mp4"}}', 'excluded');
		const s = buildDigest2Structural(db, 100);
		db.close();
		expect(s.reel).toBeNull();
	});

	it('hides the reel when there is media-less content', () => {
		const db = openLeagueDb(':memory:');
		base(db);
		draftWithReel(db, '{"title":"no media here"}');
		const s = buildDigest2Structural(db, 100);
		db.close();
		expect(s.reel).toBeNull();
	});

	it('nulls the reel and never throws on malformed reel_content_json', () => {
		const db = openLeagueDb(':memory:');
		base(db);
		draftWithReel(db, '{bad json');
		const s = buildDigest2Structural(db, 100);
		db.close();
		expect(s.reel).toBeNull();
	});

	it('isolates a throwing supplier: that block is null, the others still resolve', () => {
		const db = openLeagueDb(':memory:');
		base(db);
		draftWithReel(db, '{"media":{"poster":"/x.jpg"}}');
		const s = buildDigest2Structural(db, 100, {
			getStandings: () => {
				throw new Error('boom');
			}
		});
		db.close();
		expect(s.standings).toBeNull();
		expect((s.reel as { media?: unknown })?.media).toBeTruthy();
	});
});
