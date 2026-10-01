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

// One submission in round 100 is enough to make computeStandings return a row,
// so the standings block is non-null (and getStandings would persist a snapshot).
function withScoringSubmission(db: Database.Database) {
	db.exec(`
		INSERT INTO competitors (id, ml_competitor_id, name) VALUES (1, 'c1', 'Alice');
		INSERT INTO ml_submissions (id, round_id, competitor_id, spotify_uri, title, artists, created_at)
			VALUES (1, 100, 1, 'spotify:track:aaa', 'Song', 'Artist', '2026-09-01T00:00:00Z');
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
		withScoringSubmission(db); // standings would be non-null but for the throw
		draftWithReel(db, '{"media":{"poster":"/x.jpg"}}');
		const s = buildDigest2Structural(db, 100, {
			computeStandings: () => {
				throw new Error('boom');
			}
		});
		db.close();
		expect(s.standings).toBeNull();
		expect((s.reel as { media?: unknown })?.media).toBeTruthy();
	});

	it('never writes to season_standings — the standings block computes fresh, read-only', () => {
		const db = openLeagueDb(':memory:');
		base(db);
		withScoringSubmission(db);
		const count = () =>
			(db.prepare('SELECT COUNT(*) AS n FROM season_standings').get() as { n: number }).n;
		expect(count()).toBe(0);
		const s = buildDigest2Structural(db, 100);
		expect(count()).toBe(0); // getStandings would have persisted a snapshot here
		expect(s.standings).not.toBeNull(); // still renders, from a fresh compute
		db.close();
	});
});
