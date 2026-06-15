import { describe, it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from '../../db/client.js';
import {
	buildOverlap,
	PeerScoreSchema,
	OverlapSliceSchema,
} from './overlap.js';
import type Database from 'better-sqlite3';

// ── Fixture helpers ────────────────────────────────────────────────────────────

let db: Database.Database;

beforeEach(() => {
	db = openLeagueDb(':memory:');
});

function seedLeague(name = 'Test League'): number {
	db.prepare("INSERT INTO leagues (slug, name) VALUES (?, ?)").run(name.toLowerCase().replace(/\s/g, '-'), name);
	return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

function seedSeason(leagueId: number): number {
	db.prepare("INSERT INTO seasons (league_id, season_number, status) VALUES (?, 1, 'active')").run(leagueId);
	return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

function seedRound(seasonId: number, n: number): number {
	db.prepare(
		"INSERT INTO rounds (season_id, ml_round_id, name, created_at) VALUES (?, ?, ?, '2026-01-01')"
	).run(seasonId, `round-${n}`, `Round ${n}`);
	return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

function seedPlayer(name: string): number {
	db.prepare('INSERT INTO players (name) VALUES (?)').run(name);
	return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

function seedCompetitor(playerId: number, name: string, suffix = ''): number {
	const mlId = `ml-${playerId}${suffix}`;
	db.prepare('INSERT INTO competitors (ml_competitor_id, name, player_id) VALUES (?, ?, ?)').run(mlId, name, playerId);
	return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

function seedSubmission(roundId: number, competitorId: number, uri: string): void {
	db.prepare(
		"INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at) VALUES (?, ?, ?, 'Song', 'Artist', '2026-01-01')"
	).run(roundId, competitorId, uri);
}

function seedVote(roundId: number, voterId: number, uri: string, points: number): void {
	db.prepare(
		"INSERT INTO votes (round_id, voter_id, spotify_uri, points, created_at) VALUES (?, ?, ?, ?, '2026-01-01')"
	).run(roundId, voterId, uri, points);
}

function seedFingerprint(playerId: number, fp: object): void {
	db.prepare('INSERT OR IGNORE INTO player_profiles (player_id) VALUES (?)').run(playerId);
	db.prepare('UPDATE player_profiles SET taste_fingerprint = ? WHERE player_id = ?').run(
		JSON.stringify(fp),
		playerId,
	);
}

// ── Vote Together tests ────────────────────────────────────────────────────────

describe('buildOverlap — Vote Together', () => {
	it('a known co-voting pair scores high when they consistently vote for each other', () => {
		const leagueId = seedLeague();
		const seasonId = seedSeason(leagueId);
		const r1 = seedRound(seasonId, 1);
		const r2 = seedRound(seasonId, 2);
		const r3 = seedRound(seasonId, 3);

		const pA = seedPlayer('Alice');
		const pB = seedPlayer('Bob');
		const cA = seedCompetitor(pA, 'Alice');
		const cB = seedCompetitor(pB, 'Bob');

		// Both submit in all 3 rounds
		seedSubmission(r1, cA, 'spotify:a1'); seedSubmission(r1, cB, 'spotify:b1');
		seedSubmission(r2, cA, 'spotify:a2'); seedSubmission(r2, cB, 'spotify:b2');
		seedSubmission(r3, cA, 'spotify:a3'); seedSubmission(r3, cB, 'spotify:b3');

		// Rounds 1 and 2: mutual positive votes
		seedVote(r1, cA, 'spotify:b1', 3); // Alice → Bob
		seedVote(r1, cB, 'spotify:a1', 2); // Bob → Alice
		seedVote(r2, cA, 'spotify:b2', 5); // Alice → Bob
		seedVote(r2, cB, 'spotify:a2', 1); // Bob → Alice
		// Round 3: no cross-votes

		const result = buildOverlap(db, leagueId);

		const aliceSlice = result.get(pA);
		expect(aliceSlice).toBeDefined();

		const bobEntry = aliceSlice!.voteTogether.find((p) => p.who === 'Bob');
		expect(bobEntry).toBeDefined();
		// 2 mutual rounds out of 3 shared = 67%
		expect(bobEntry!.pct).toBe(67);
		expect(bobEntry!.pct).toBeGreaterThan(50);
	});

	it('is symmetric — A→B pct equals B→A pct', () => {
		const leagueId = seedLeague();
		const seasonId = seedSeason(leagueId);
		const r1 = seedRound(seasonId, 1);

		const pA = seedPlayer('Alice');
		const pB = seedPlayer('Bob');
		const cA = seedCompetitor(pA, 'Alice');
		const cB = seedCompetitor(pB, 'Bob');

		seedSubmission(r1, cA, 'spotify:a1');
		seedSubmission(r1, cB, 'spotify:b1');
		seedVote(r1, cA, 'spotify:b1', 3);
		seedVote(r1, cB, 'spotify:a1', 2);

		const result = buildOverlap(db, leagueId);

		const aliceEntry = result.get(pA)!.voteTogether.find((p) => p.who === 'Bob');
		const bobEntry = result.get(pB)!.voteTogether.find((p) => p.who === 'Alice');
		expect(aliceEntry?.pct).toBe(bobEntry?.pct);
	});

	it('a pair with ZERO shared rounds is ABSENT from voteTogether', () => {
		const leagueId = seedLeague();
		const seasonId = seedSeason(leagueId);
		const r1 = seedRound(seasonId, 1);
		const r2 = seedRound(seasonId, 2);

		const pA = seedPlayer('Alice');
		const pC = seedPlayer('Charlie'); // only round 2
		const cA = seedCompetitor(pA, 'Alice');
		const cC = seedCompetitor(pC, 'Charlie');

		// Alice only in round 1, Charlie only in round 2 — zero shared rounds
		seedSubmission(r1, cA, 'spotify:a1');
		seedSubmission(r2, cC, 'spotify:c2');

		const result = buildOverlap(db, leagueId);

		const aliceSlice = result.get(pA);
		expect(aliceSlice).toBeDefined();
		const charlieInAlice = aliceSlice!.voteTogether.find((p) => p.who === 'Charlie');
		expect(charlieInAlice).toBeUndefined();

		const charlieSlice = result.get(pC);
		expect(charlieSlice).toBeDefined();
		const aliceInCharlie = charlieSlice!.voteTogether.find((p) => p.who === 'Alice');
		expect(aliceInCharlie).toBeUndefined();
	});

	it('a pair who share rounds but never vote for each other scores 0%', () => {
		const leagueId = seedLeague();
		const seasonId = seedSeason(leagueId);
		const r1 = seedRound(seasonId, 1);
		const r2 = seedRound(seasonId, 2);

		const pA = seedPlayer('Alice');
		const pB = seedPlayer('Bob');
		const cA = seedCompetitor(pA, 'Alice');
		const cB = seedCompetitor(pB, 'Bob');

		seedSubmission(r1, cA, 'spotify:a1'); seedSubmission(r1, cB, 'spotify:b1');
		seedSubmission(r2, cA, 'spotify:a2'); seedSubmission(r2, cB, 'spotify:b2');
		// No cross-votes at all

		const result = buildOverlap(db, leagueId);

		// They share 2 rounds so they DO appear in voteTogether (0 mutual / 2 shared = 0%)
		const aliceEntry = result.get(pA)!.voteTogether.find((p) => p.who === 'Bob');
		expect(aliceEntry).toBeDefined();
		expect(aliceEntry!.pct).toBe(0);
	});

	it('100% score when every shared round has mutual votes', () => {
		const leagueId = seedLeague();
		const seasonId = seedSeason(leagueId);
		const r1 = seedRound(seasonId, 1);
		const r2 = seedRound(seasonId, 2);

		const pA = seedPlayer('Alice');
		const pB = seedPlayer('Bob');
		const cA = seedCompetitor(pA, 'Alice');
		const cB = seedCompetitor(pB, 'Bob');

		seedSubmission(r1, cA, 'spotify:a1'); seedSubmission(r1, cB, 'spotify:b1');
		seedSubmission(r2, cA, 'spotify:a2'); seedSubmission(r2, cB, 'spotify:b2');
		seedVote(r1, cA, 'spotify:b1', 3); seedVote(r1, cB, 'spotify:a1', 2);
		seedVote(r2, cA, 'spotify:b2', 5); seedVote(r2, cB, 'spotify:a2', 1);

		const result = buildOverlap(db, leagueId);

		const aliceEntry = result.get(pA)!.voteTogether.find((p) => p.who === 'Bob');
		expect(aliceEntry!.pct).toBe(100);
		expect(aliceEntry!.label).toBe('vote as a bloc');
	});

	it('downvotes (negative points) are NOT counted as "giving points"', () => {
		const leagueId = seedLeague();
		const seasonId = seedSeason(leagueId);
		const r1 = seedRound(seasonId, 1);

		const pA = seedPlayer('Alice');
		const pB = seedPlayer('Bob');
		const cA = seedCompetitor(pA, 'Alice');
		const cB = seedCompetitor(pB, 'Bob');

		seedSubmission(r1, cA, 'spotify:a1');
		seedSubmission(r1, cB, 'spotify:b1');
		// Alice downvotes Bob, Bob gives Alice positive
		seedVote(r1, cA, 'spotify:b1', -1);
		seedVote(r1, cB, 'spotify:a1', 3);

		const result = buildOverlap(db, leagueId);

		// Not mutual — Alice didn't give positive points
		const aliceEntry = result.get(pA)!.voteTogether.find((p) => p.who === 'Bob');
		expect(aliceEntry!.pct).toBe(0);
	});
});

// ── Taste Twins tests ──────────────────────────────────────────────────────────

describe('buildOverlap — Taste Twins', () => {
	it('a pair with ZERO shared rounds CAN appear in tasteTwins with similar fingerprints', () => {
		const leagueId = seedLeague();
		const seasonId = seedSeason(leagueId);
		const r1 = seedRound(seasonId, 1);
		const r2 = seedRound(seasonId, 2);

		const pA = seedPlayer('Alice');
		const pC = seedPlayer('Charlie');
		const cA = seedCompetitor(pA, 'Alice');
		const cC = seedCompetitor(pC, 'Charlie');

		// No shared rounds
		seedSubmission(r1, cA, 'spotify:a1');
		seedSubmission(r2, cC, 'spotify:c2');

		// But similar fingerprints
		const sharedFp = {
			signature_artists: ['Portishead', 'Mazzy Star', 'Cocteau Twins'],
			genres: ['trip-hop', 'dream pop'],
			eras: ['90s'],
			rewards: ['reverb', 'atmospheric'],
			punishes: ['bro-country'],
		};
		seedFingerprint(pA, sharedFp);
		seedFingerprint(pC, { ...sharedFp }); // identical fingerprint

		const result = buildOverlap(db, leagueId);

		// Zero shared rounds → NOT in voteTogether
		const charlieInAliceVT = result.get(pA)!.voteTogether.find((p) => p.who === 'Charlie');
		expect(charlieInAliceVT).toBeUndefined();

		// But in tasteTwins (identical fingerprints → 100%)
		const charlieInAliceTT = result.get(pA)!.tasteTwins.find((p) => p.who === 'Charlie');
		expect(charlieInAliceTT).toBeDefined();
		expect(charlieInAliceTT!.pct).toBeGreaterThan(50);
	});

	it('identical fingerprints produce high pct', () => {
		const leagueId = seedLeague();
		const seasonId = seedSeason(leagueId);
		const r1 = seedRound(seasonId, 1);

		const pA = seedPlayer('Alice');
		const pB = seedPlayer('Bob');
		const cA = seedCompetitor(pA, 'Alice');
		const cB = seedCompetitor(pB, 'Bob');
		seedSubmission(r1, cA, 'spotify:a1');
		seedSubmission(r1, cB, 'spotify:b1');

		const fp = {
			signature_artists: ['Portishead', 'Massive Attack', 'Tricky'],
			genres: ['trip-hop', 'electronica'],
			eras: ['90s'],
			rewards: ['dark', 'atmospheric'],
			punishes: ['auto-tune', 'bro-country'],
		};
		seedFingerprint(pA, fp);
		seedFingerprint(pB, fp);

		const result = buildOverlap(db, leagueId);
		const aliceEntry = result.get(pA)!.tasteTwins.find((p) => p.who === 'Bob');
		expect(aliceEntry!.pct).toBe(100);
		expect(aliceEntry!.label).toBe('kindred ears');
	});

	it('completely different fingerprints produce low pct', () => {
		const leagueId = seedLeague();
		const seasonId = seedSeason(leagueId);
		const r1 = seedRound(seasonId, 1);

		const pA = seedPlayer('Alice');
		const pB = seedPlayer('Bob');
		const cA = seedCompetitor(pA, 'Alice');
		const cB = seedCompetitor(pB, 'Bob');
		seedSubmission(r1, cA, 'spotify:a1');
		seedSubmission(r1, cB, 'spotify:b1');

		seedFingerprint(pA, {
			signature_artists: ['Portishead', 'Mazzy Star'],
			genres: ['trip-hop', 'dream pop'],
			eras: ['90s'],
			rewards: ['reverb', 'melancholy'],
			punishes: ['bro-country'],
		});
		seedFingerprint(pB, {
			signature_artists: ['Tom Petty', 'Creedence'],
			genres: ['classic rock', 'americana'],
			eras: ['70s'],
			rewards: ['guitar solo', 'lyrics'],
			punishes: ['auto-tune', 'pop'],
		});

		const result = buildOverlap(db, leagueId);
		const aliceEntry = result.get(pA)!.tasteTwins.find((p) => p.who === 'Bob');
		expect(aliceEntry!.pct).toBe(0);
	});

	it('players with no fingerprint are omitted from tasteTwins', () => {
		const leagueId = seedLeague();
		const seasonId = seedSeason(leagueId);
		const r1 = seedRound(seasonId, 1);

		const pA = seedPlayer('Alice');
		const pB = seedPlayer('Bob'); // no fingerprint
		const cA = seedCompetitor(pA, 'Alice');
		const cB = seedCompetitor(pB, 'Bob');
		seedSubmission(r1, cA, 'spotify:a1');
		seedSubmission(r1, cB, 'spotify:b1');

		seedFingerprint(pA, {
			signature_artists: ['Portishead'],
			genres: ['trip-hop'],
			eras: ['90s'],
			rewards: ['reverb'],
			punishes: ['bro-country'],
		});
		// pB has no fingerprint

		const result = buildOverlap(db, leagueId);
		const bobInAlice = result.get(pA)!.tasteTwins.find((p) => p.who === 'Bob');
		expect(bobInAlice).toBeUndefined();
	});

	it('is symmetric — A→B pct equals B→A pct in tasteTwins', () => {
		const leagueId = seedLeague();
		const seasonId = seedSeason(leagueId);
		const r1 = seedRound(seasonId, 1);

		const pA = seedPlayer('Alice');
		const pB = seedPlayer('Bob');
		const cA = seedCompetitor(pA, 'Alice');
		const cB = seedCompetitor(pB, 'Bob');
		seedSubmission(r1, cA, 'spotify:a1');
		seedSubmission(r1, cB, 'spotify:b1');

		const fp = {
			signature_artists: ['Portishead', 'Massive Attack'],
			genres: ['trip-hop'],
			eras: ['90s'],
			rewards: ['dark'],
			punishes: ['bro-country'],
		};
		seedFingerprint(pA, fp);
		seedFingerprint(pB, fp);

		const result = buildOverlap(db, leagueId);
		const aliceEntry = result.get(pA)!.tasteTwins.find((p) => p.who === 'Bob');
		const bobEntry = result.get(pB)!.tasteTwins.find((p) => p.who === 'Alice');
		expect(aliceEntry?.pct).toBe(bobEntry?.pct);
	});
});

// ── Edge cases ─────────────────────────────────────────────────────────────────

describe('buildOverlap — edge cases', () => {
	it('returns an empty map for a league with zero members', () => {
		const leagueId = seedLeague();
		const result = buildOverlap(db, leagueId);
		expect(result.size).toBe(0);
	});

	it('returns empty slices for a solo member', () => {
		const leagueId = seedLeague();
		const seasonId = seedSeason(leagueId);
		const r1 = seedRound(seasonId, 1);

		const pA = seedPlayer('Solo');
		const cA = seedCompetitor(pA, 'Solo');
		seedSubmission(r1, cA, 'spotify:s1');

		const result = buildOverlap(db, leagueId);
		expect(result.size).toBe(1);
		const slice = result.get(pA)!;
		expect(slice.voteTogether).toHaveLength(0);
		expect(slice.tasteTwins).toHaveLength(0);
	});

	it('lists are sorted by pct descending', () => {
		const leagueId = seedLeague();
		const seasonId = seedSeason(leagueId);
		const r1 = seedRound(seasonId, 1);
		const r2 = seedRound(seasonId, 2);

		const pA = seedPlayer('Alice');
		const pB = seedPlayer('Bob');
		const pC = seedPlayer('Charlie');
		const cA = seedCompetitor(pA, 'Alice');
		const cB = seedCompetitor(pB, 'Bob');
		const cC = seedCompetitor(pC, 'Charlie');

		// All 3 in both rounds
		seedSubmission(r1, cA, 'spotify:a1'); seedSubmission(r1, cB, 'spotify:b1'); seedSubmission(r1, cC, 'spotify:c1');
		seedSubmission(r2, cA, 'spotify:a2'); seedSubmission(r2, cB, 'spotify:b2'); seedSubmission(r2, cC, 'spotify:c2');

		// Alice ↔ Bob: both rounds mutual (100%)
		seedVote(r1, cA, 'spotify:b1', 3); seedVote(r1, cB, 'spotify:a1', 2);
		seedVote(r2, cA, 'spotify:b2', 5); seedVote(r2, cB, 'spotify:a2', 1);
		// Alice ↔ Charlie: only round 1 mutual (50%)
		seedVote(r1, cA, 'spotify:c1', 1); seedVote(r1, cC, 'spotify:a1', 1);
		// Charlie ↔ Bob: no votes

		const result = buildOverlap(db, leagueId);
		const aliceVT = result.get(pA)!.voteTogether;
		expect(aliceVT[0].who).toBe('Bob');    // 100%
		expect(aliceVT[1].who).toBe('Charlie'); // 50%
		expect(aliceVT[0].pct).toBeGreaterThanOrEqual(aliceVT[1].pct);
	});
});

// ── Schema validation ──────────────────────────────────────────────────────────

describe('OverlapSliceSchema', () => {
	it('accepts a valid slice', () => {
		const valid = {
			voteTogether: [{ who: 'Bob', pct: 75, label: 'vote as a bloc' }],
			tasteTwins: [{ who: 'Charlie', pct: 90, label: 'kindred ears' }],
		};
		expect(() => OverlapSliceSchema.parse(valid)).not.toThrow();
	});

	it('accepts empty arrays', () => {
		expect(() => OverlapSliceSchema.parse({ voteTogether: [], tasteTwins: [] })).not.toThrow();
	});

	it('rejects pct out of range', () => {
		const bad = {
			voteTogether: [{ who: 'Bob', pct: 150, label: 'label' }],
			tasteTwins: [],
		};
		expect(() => OverlapSliceSchema.parse(bad)).toThrow();
	});

	it('rejects non-integer pct', () => {
		const bad = {
			voteTogether: [{ who: 'Bob', pct: 50.5, label: 'label' }],
			tasteTwins: [],
		};
		expect(() => OverlapSliceSchema.parse(bad)).toThrow();
	});
});

describe('PeerScoreSchema', () => {
	it('accepts valid peer score', () => {
		expect(() => PeerScoreSchema.parse({ who: 'Alice', pct: 80, label: 'kindred ears' })).not.toThrow();
	});

	it('rejects negative pct', () => {
		expect(() => PeerScoreSchema.parse({ who: 'Alice', pct: -1, label: 'x' })).toThrow();
	});
});
