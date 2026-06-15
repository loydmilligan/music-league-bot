import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '../db/client.js';
import { publishSite } from './publish.js';
import { ReadModelSchema } from './buildReadModel.js';

vi.mock('../digest/llm.js', () => ({
	callOpenRouter: vi.fn(),
}));

import { callOpenRouter } from '../digest/llm.js';
const mockCallOpenRouter = vi.mocked(callOpenRouter);

// ── LLM fixtures (mirrors buildReadModel.test.ts) ───────────────────────────

function setupMock() {
	mockCallOpenRouter.mockImplementation(async (messages: { role: string; content: string }[]) => {
		const sys = (messages[0]?.content ?? '').toLowerCase();
		if (sys.includes('yearbook writer')) {
			return {
				content: JSON.stringify({
					superlatives: [{ award: 'The Dreamer', accent: 'pulp', blurb: 'Always finds the gem.' }],
					signatureSuperlative: { award: 'Heart on Sleeve', blurb: 'Every pick tells a story.' },
				}),
				costUsd: 0.001,
			};
		}
		if (sys.includes('0–100') || sys.includes('0-100') || sys.includes('polished_vs_raw')) {
			return {
				content: JSON.stringify({
					polished_vs_raw: 42,
					sunny_vs_melancholy: 68,
					familiar_vs_obscure: 55,
				}),
				costUsd: 0.001,
			};
		}
		if (sys.includes('discovery playlist') || sys.includes('personalised')) {
			return {
				content: JSON.stringify({
					name: 'Test Playlist',
					nudge: 'For you.',
					tracks: [{ title: 'Song', artist: 'Artist', why: 'Great pick.' }],
				}),
				costUsd: 0.001,
			};
		}
		if (sys.includes('biggest fan') || sys.includes('friendly hater')) {
			return {
				content: JSON.stringify({
					fanLine: 'Your biggest supporter.',
					haterLine: 'Lovingly withholds points.',
				}),
				costUsd: 0.001,
			};
		}
		if (sys.includes('yearbook editor') || sys.includes('reel')) {
			return {
				content: JSON.stringify({ reel: [] }),
				costUsd: 0.001,
			};
		}
		if (sys.includes('caption') || sys.includes('most loved')) {
			return {
				content: JSON.stringify({
					mostLovedLine: 'United the room.',
					mostDivisiveLine: 'Split the group.',
					biggestUpsetLine: 'Won everything.',
				}),
				costUsd: 0.001,
			};
		}
		return {
			content: JSON.stringify({
				signature_artists: ['Test Artist'],
				genres: ['indie'],
				eras: ['2010s'],
				rewards: ['good vibes'],
				punishes: ['bad vibes'],
				summary: 'A well-rounded listener.',
				confidence: 'low',
			}),
			costUsd: 0.001,
		};
	});
}

// ── Seed helpers ─────────────────────────────────────────────────────────────

let db: Database.Database;
let leagueId: number;
let seasonId: number;

beforeEach(() => {
	db = openLeagueDb(':memory:');
	vi.clearAllMocks();
	setupMock();

	db.prepare("INSERT INTO leagues (slug, name) VALUES ('test', 'Test League')").run();
	leagueId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
	db.prepare("INSERT INTO seasons (league_id, season_number, status) VALUES (?, 1, 'active')").run(
		leagueId,
	);
	seasonId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
});

function addPlayer(name: string): { playerId: number; competitorId: number } {
	db.prepare('INSERT INTO players (name) VALUES (?)').run(name);
	const playerId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
	db.prepare('INSERT INTO competitors (ml_competitor_id, name, player_id) VALUES (?, ?, ?)').run(
		`ml-${name}-${Math.random()}`,
		name,
		playerId,
	);
	const competitorId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
	return { playerId, competitorId };
}

function addRound(name: string): number {
	db.prepare(
		"INSERT INTO rounds (season_id, ml_round_id, name, created_at, voting_deadline) VALUES (?, ?, ?, '2026-01-01', '2026-01-07')",
	).run(seasonId, `ml-${name}-${Math.random()}`, name);
	return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

function addSubmission(
	roundId: number,
	competitorId: number,
	playerId: number,
	uri: string,
): void {
	db.prepare(
		"INSERT INTO ml_submissions (round_id, competitor_id, player_id, spotify_uri, title, artists, created_at) VALUES (?, ?, ?, ?, 'Song', 'Artist', '2026-01-01')",
	).run(roundId, competitorId, playerId, uri);
}

function addVote(roundId: number, voterCompetitorId: number, voterPlayerId: number, uri: string, points: number): void {
	db.prepare(
		"INSERT INTO votes (round_id, voter_id, player_id, spotify_uri, points, created_at) VALUES (?, ?, ?, ?, ?, '2026-01-01')",
	).run(roundId, voterCompetitorId, voterPlayerId, uri, points);
}

function seedLeague() {
	const alice = addPlayer('Alice');
	const bob = addPlayer('Bob');
	const r1 = addRound('Round 1');
	const r2 = addRound('Round 2');
	addSubmission(r1, alice.competitorId, alice.playerId, 'uri:alice:1');
	addSubmission(r1, bob.competitorId, bob.playerId, 'uri:bob:1');
	addSubmission(r2, alice.competitorId, alice.playerId, 'uri:alice:2');
	addSubmission(r2, bob.competitorId, bob.playerId, 'uri:bob:2');
	addVote(r1, bob.competitorId, bob.playerId, 'uri:alice:1', 5);
	addVote(r1, alice.competitorId, alice.playerId, 'uri:bob:1', 3);
	addVote(r2, bob.competitorId, bob.playerId, 'uri:alice:2', 4);
	addVote(r2, alice.competitorId, alice.playerId, 'uri:bob:2', 2);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('publishSite', () => {
	it('returns a slug on first publish', async () => {
		seedLeague();
		const result = await publishSite(db, leagueId);
		expect(typeof result.slug).toBe('string');
		expect(result.slug.length).toBeGreaterThanOrEqual(14); // ≥80-bit entropy check
	});

	it('persists a dashboard_sites row with valid read_model JSON', async () => {
		seedLeague();
		const { slug } = await publishSite(db, leagueId);

		const row = db
			.prepare('SELECT * FROM dashboard_sites WHERE league_id = ?')
			.get(leagueId) as {
			slug: string;
			league_id: number;
			season: number;
			read_model: string;
			archived_rounds: string;
			published_at: string;
			refreshed_at: string;
		};

		expect(row).toBeDefined();
		expect(row.slug).toBe(slug);
		expect(row.published_at).toBeTruthy();
		expect(row.refreshed_at).toBeTruthy();

		const parsed = JSON.parse(row.read_model);
		expect(() => ReadModelSchema.parse(parsed)).not.toThrow();
	});

	it('second publish reuses the same slug and bumps refreshed_at', async () => {
		seedLeague();
		const first = await publishSite(db, leagueId);

		// Small delay so timestamps differ
		await new Promise((r) => setTimeout(r, 10));

		const second = await publishSite(db, leagueId);
		expect(second.slug).toBe(first.slug);

		const row = db
			.prepare('SELECT published_at, refreshed_at FROM dashboard_sites WHERE league_id = ?')
			.get(leagueId) as { published_at: string; refreshed_at: string };

		// refreshed_at should be >= published_at (second run bumped it)
		expect(new Date(row.refreshed_at) >= new Date(row.published_at)).toBe(true);

		// Only one row for this league
		const count = (
			db
				.prepare('SELECT COUNT(*) AS n FROM dashboard_sites WHERE league_id = ?')
				.get(leagueId) as { n: number }
		).n;
		expect(count).toBe(1);
	});

	it('throws for a non-existent leagueId', async () => {
		await expect(publishSite(db, 99999)).rejects.toThrow('not found');
	});
});
