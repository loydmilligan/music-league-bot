import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';
import { previousRoundId, gatherPrepMaterial } from './prepMaterial.js';

let db: Database.Database;

beforeEach(() => {
	db = new Database(':memory:');
	db.exec(SCHEMA);
	db.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('bz', 'Boarz II Men');
	db.prepare("INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')").run();
	const r = db.prepare(
		"INSERT INTO rounds (id, season_id, ml_round_id, name, voting_deadline, created_at) VALUES (?, 1, ?, ?, ?, '2026-08-01T00:00:00Z')",
	);
	r.run(148, 'ml-148', 'Smells Like Teen Cousin Fuckers', '2026-08-20T06:30:00Z');
	r.run(149, 'ml-149', 'Surrender Monkeys', '2026-08-27T06:30:00Z');
});

const insertBridge = (roundId: number, contentJson: string) =>
	db
		.prepare(
			'INSERT INTO digest_bridges (round_id, league_id, draft_id, content_json, generated_at) VALUES (?, 1, ?, ?, ?)',
		)
		.run(roundId, `draft-${roundId}`, contentJson, '2026-08-26T21:55:24Z');

describe('previousRoundId', () => {
	it('finds the prior round in the same season by deadline', () => {
		expect(previousRoundId(db, 149)).toBe(148);
	});

	it('returns null for the first round of a season', () => {
		expect(previousRoundId(db, 148)).toBeNull();
	});

	it('ignores rounds in other seasons', () => {
		db.prepare("INSERT INTO seasons (id, league_id, season_number, status) VALUES (2, 1, 2, 'active')").run();
		db.prepare(
			"INSERT INTO rounds (id, season_id, ml_round_id, name, voting_deadline, created_at) VALUES (200, 2, 'ml-200', ?, ?, '2026-08-01T00:00:00Z')",
		).run('Other', '2026-08-25T06:30:00Z');
		expect(previousRoundId(db, 149)).toBe(148);
	});
});

describe('gatherPrepMaterial — bridge row', () => {
	const bridgeRow = (roundId: number) =>
		gatherPrepMaterial(db, roundId).find((r) => r.id === 'bridge')!;

	it('reports absent when the previous round has no bridge — the R148 case', () => {
		const row = bridgeRow(149);
		expect(row.status).toBe('absent');
		expect(row.preview).toBeUndefined();
		expect(row.src).toContain('148');
	});

	it('reports present with a preview when the previous round has a bridge', () => {
		insertBridge(
			148,
			JSON.stringify({
				round: { id: 148 },
				headline_stories: [{ title: 'The Combo Option' }],
				running_bits: ['carrotbox'],
				callbacks_planted: ['mandolin'],
				notable_quotes: [{ text: 'a quote' }],
			}),
		);
		const row = bridgeRow(149);
		expect(row.status).toBe('present');
		expect(row.src).toContain('2026-08-26');
		expect((row.preview as { headline_stories: unknown[] }).headline_stories).toHaveLength(1);
	});

	it('reports absent, not present-with-nothing, for the first round of a season', () => {
		const row = bridgeRow(148);
		expect(row.status).toBe('absent');
		expect(row.src).toContain('no previous round');
	});

	it('survives a malformed bridge payload rather than throwing', () => {
		insertBridge(148, '{ not json');
		expect(() => bridgeRow(149)).not.toThrow();
		expect(bridgeRow(149).status).toBe('absent');
	});
});

describe('gatherPrepMaterial — the other rows', () => {
	const rows = (roundId: number) => {
		const m = gatherPrepMaterial(db, roundId);
		return Object.fromEntries(m.map((r) => [r.id, r]));
	};

	it('returns all six rows in a stable order', () => {
		expect(gatherPrepMaterial(db, 149).map((r) => r.id))
			.toEqual(['bridge', 'early-ledes', 'chat', 'storylines', 'guesser', 'participation']);
	});

	it('reports the early lede sheet absent until one is drafted', () => {
		expect(rows(149)['early-ledes'].status).toBe('absent');
	});

	it('marks storylines not-enabled for a league that is not opted in', () => {
		expect(rows(149).storylines.status).toBe('not-enabled');
	});

	it('marks the guesser not-enabled for a league that is not opted in', () => {
		expect(rows(149).guesser.status).toBe('not-enabled');
	});

	it('distinguishes not-enabled from absent for storylines', () => {
		db.prepare("INSERT INTO settings (key, value) VALUES ('storylines_section_leagues', ?)").run('["bz"]');
		const row = rows(149).storylines;
		expect(row.status).not.toBe('not-enabled'); // opted in, so absent or present
	});

	it('reports participation absent when no vectors exist for the round', () => {
		expect(rows(149).participation.status).toBe('absent');
	});

	it('reports participation present with a count when vectors exist', () => {
		db.prepare('INSERT INTO competitors (id, ml_competitor_id, name) VALUES (1, ?, ?)').run('mlc-1', 'Kozh');
		db.prepare(`INSERT INTO player_participation (league_id, round_id, competitor_id, computed_at)
                VALUES (1, 149, 1, ?)`).run('2026-08-26T00:00:00Z');
		const row = rows(149).participation;
		expect(row.status).toBe('present');
		expect(row.count).toBe(1);
	});

	it('never throws when a downstream table is missing entirely', () => {
		const bare = new Database(':memory:');
		bare.exec('CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER, name TEXT, voting_deadline TEXT)');
		bare.prepare('INSERT INTO rounds (id, season_id, name, voting_deadline) VALUES (1, 1, ?, ?)')
			.run('R', '2026-01-01T00:00:00Z');
		expect(() => gatherPrepMaterial(bare, 1)).not.toThrow();
	});
});
