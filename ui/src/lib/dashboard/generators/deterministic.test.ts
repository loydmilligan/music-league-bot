import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '../../db/client.js';
import {
	buildDeterministicSlices,
	TIER_CUTOFF_RATIO,
} from './deterministic.js';

// ── Seed helpers ───────────────────────────────────────────────────────────────

let db: Database.Database;
let leagueId: number;
let seasonId: number;

beforeEach(() => {
	db = openLeagueDb(':memory:');
	db.prepare("INSERT INTO leagues (slug, name) VALUES ('test', 'Test League')").run();
	leagueId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
	db.prepare(
		"INSERT INTO seasons (league_id, season_number, status) VALUES (?, 1, 'active')",
	).run(leagueId);
	seasonId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
});

function addRound(name = 'Test Round'): number {
	db.prepare(
		`INSERT INTO rounds (season_id, ml_round_id, name, created_at)
     VALUES (?, ?, ?, '2026-01-01T00:00:00Z')`,
	).run(seasonId, `ml-${Math.random()}`, name);
	return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

function addPlayer(name: string): { playerId: number; competitorId: number } {
	db.prepare('INSERT INTO players (name) VALUES (?)').run(name);
	const playerId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
	db.prepare("INSERT INTO competitors (ml_competitor_id, name, player_id) VALUES (?, ?, ?)").run(
		`ml-${name}-${Math.random()}`,
		name,
		playerId,
	);
	const competitorId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
	return { playerId, competitorId };
}

function addSubmission(
	roundId: number,
	competitorId: number,
	playerId: number,
	uri: string,
	title: string,
	artists = 'Test Artist',
): void {
	db.prepare(
		`INSERT INTO ml_submissions (round_id, competitor_id, player_id, spotify_uri, title, artists, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00Z')`,
	).run(roundId, competitorId, playerId, uri, title, artists);
}

function addVote(
	roundId: number,
	voterCompetitorId: number,
	voterPlayerId: number,
	uri: string,
	points: number,
): void {
	db.prepare(
		`INSERT INTO votes (round_id, voter_id, player_id, spotify_uri, points, created_at)
     VALUES (?, ?, ?, ?, ?, '2026-01-01T00:00:00Z')`,
	).run(roundId, voterCompetitorId, voterPlayerId, uri, points);
}

// ── Stats tests ────────────────────────────────────────────────────────────────

describe('member stat — submitted / avgPts / wins', () => {
	it('counts submissions and computes avg pts per submission', () => {
		const r1 = addRound('Round 1');
		const r2 = addRound('Round 2');
		const alice = addPlayer('Alice');
		const bob = addPlayer('Bob');

		addSubmission(r1, alice.competitorId, alice.playerId, 'uri:a1', 'Song A1');
		addSubmission(r2, alice.competitorId, alice.playerId, 'uri:a2', 'Song A2');
		addSubmission(r1, bob.competitorId, bob.playerId, 'uri:b1', 'Song B1');

		// Bob gives Alice: 10 pts for a1, 20 pts for a2
		addVote(r1, bob.competitorId, bob.playerId, 'uri:a1', 10);
		addVote(r2, bob.competitorId, bob.playerId, 'uri:a2', 20);
		// Alice gives Bob: 8 pts for b1
		addVote(r1, alice.competitorId, alice.playerId, 'uri:b1', 8);

		const { members } = buildDeterministicSlices(db, leagueId);

		const aliceStat = members.get(alice.playerId)!.stat;
		expect(aliceStat.submitted).toBe(2);
		expect(aliceStat.avgPts).toBe(15); // (10 + 20) / 2
		expect(aliceStat.wins).toBe(2); // top scorer both rounds

		const bobStat = members.get(bob.playerId)!.stat;
		expect(bobStat.submitted).toBe(1);
		expect(bobStat.avgPts).toBe(8);
		expect(bobStat.wins).toBe(0); // Alice had max both rounds
	});

	it('avgPts is 0 when no votes exist for a submission', () => {
		const r1 = addRound('R1');
		const alice = addPlayer('Alice');
		addSubmission(r1, alice.competitorId, alice.playerId, 'uri:a', 'Song A');

		const { members } = buildDeterministicSlices(db, leagueId);
		expect(members.get(alice.playerId)!.stat.avgPts).toBe(0);
	});

	it('counts round wins correctly — tie gives both players a win', () => {
		const r1 = addRound('R1');
		const alice = addPlayer('Alice');
		const bob = addPlayer('Bob');
		addSubmission(r1, alice.competitorId, alice.playerId, 'uri:a', 'Song A');
		addSubmission(r1, bob.competitorId, bob.playerId, 'uri:b', 'Song B');

		// Both get 10 pts → both win (tie)
		addVote(r1, bob.competitorId, bob.playerId, 'uri:a', 10);
		addVote(r1, alice.competitorId, alice.playerId, 'uri:b', 10);

		const { members } = buildDeterministicSlices(db, leagueId);
		expect(members.get(alice.playerId)!.stat.wins).toBe(1);
		expect(members.get(bob.playerId)!.stat.wins).toBe(1);
	});
});

// ── Tier tests ─────────────────────────────────────────────────────────────────

describe('member tier — full vs lite', () => {
	it('full member: submitted >= 50% of rounds', () => {
		// 6 rounds; cutoff = max(3, round(6 * 0.5)) = 3
		for (let i = 0; i < 6; i++) addRound(`R${i}`);
		const alice = addPlayer('Alice');
		// Submit to all 6 rounds
		const rounds = db
			.prepare<[number], { id: number }>(
				`SELECT r.id FROM rounds r JOIN seasons s ON s.id = r.season_id WHERE s.league_id = ?`,
			)
			.all(leagueId);
		rounds.forEach((r, idx) => {
			addSubmission(r.id, alice.competitorId, alice.playerId, `uri:a${idx}`, `Song ${idx}`);
		});

		const { members } = buildDeterministicSlices(db, leagueId);
		expect(members.get(alice.playerId)!.tier).toBe('full');
	});

	it('quiet member: submitted < cutoff resolves to lite', () => {
		// 6 rounds; cutoff = 3; submit only 2 → lite
		for (let i = 0; i < 6; i++) addRound(`R${i}`);
		const rounds = db
			.prepare<[number], { id: number }>(
				`SELECT r.id FROM rounds r JOIN seasons s ON s.id = r.season_id WHERE s.league_id = ? LIMIT 2`,
			)
			.all(leagueId);
		const quiet = addPlayer('Quiet');
		rounds.forEach((r, idx) => {
			addSubmission(r.id, quiet.competitorId, quiet.playerId, `uri:q${idx}`, `Q${idx}`);
		});

		const { members } = buildDeterministicSlices(db, leagueId);
		expect(members.get(quiet.playerId)!.tier).toBe('lite');
	});

	it('TIER_CUTOFF_RATIO is 0.5', () => {
		expect(TIER_CUTOFF_RATIO).toBe(0.5);
	});
});

// ── KPI tests ──────────────────────────────────────────────────────────────────

describe('league kpis', () => {
	it('always includes songs-submitted and points-awarded kpis', () => {
		const r1 = addRound('R1');
		const alice = addPlayer('Alice');
		addSubmission(r1, alice.competitorId, alice.playerId, 'uri:a', 'Song A');

		const { league } = buildDeterministicSlices(db, leagueId);
		const labels = league.kpis.map((k) => k.label);
		expect(labels).toContain('songs submitted');
		expect(labels).toContain('points awarded');
	});

	it('kpis contain NO win/loss-ladder language', () => {
		const r1 = addRound('R1');
		const alice = addPlayer('Alice');
		addSubmission(r1, alice.competitorId, alice.playerId, 'uri:a', 'Song A');

		const { league } = buildDeterministicSlices(db, leagueId);
		const allText = league.kpis
			.flatMap((k) => [k.label, k.sub, k.value])
			.join(' ')
			.toLowerCase();

		// No leaderboard / ranking language
		expect(allText).not.toMatch(/last.?place/);
		expect(allText).not.toMatch(/worst/);
		expect(allText).not.toMatch(/win.?loss/);
		expect(allText).not.toMatch(/ladder/);
		expect(allText).not.toMatch(/standings/);
	});

	it('includes distinct-winners kpi when there are winners', () => {
		const r1 = addRound('R1');
		const r2 = addRound('R2');
		const alice = addPlayer('Alice');
		const bob = addPlayer('Bob');
		addSubmission(r1, alice.competitorId, alice.playerId, 'uri:a1', 'A1');
		addSubmission(r2, bob.competitorId, bob.playerId, 'uri:b1', 'B1');
		addSubmission(r1, bob.competitorId, bob.playerId, 'uri:b2', 'B2');
		addSubmission(r2, alice.competitorId, alice.playerId, 'uri:a2', 'A2');

		// Alice wins R1 (10 pts), Bob wins R2 (15 pts)
		addVote(r1, bob.competitorId, bob.playerId, 'uri:a1', 10);
		addVote(r2, alice.competitorId, alice.playerId, 'uri:b1', 15);

		const { league } = buildDeterministicSlices(db, leagueId);
		const winnersKpi = league.kpis.find((k) => k.label === 'different round winners');
		expect(winnersKpi).toBeDefined();
		expect(winnersKpi!.value).toBe('2');
	});

	it('each kpi has value, label, and sub fields', () => {
		const r1 = addRound('R1');
		const alice = addPlayer('Alice');
		addSubmission(r1, alice.competitorId, alice.playerId, 'uri:a', 'Song A');

		const { league } = buildDeterministicSlices(db, leagueId);
		for (const kpi of league.kpis) {
			expect(typeof kpi.value).toBe('string');
			expect(typeof kpi.label).toBe('string');
			expect(typeof kpi.sub).toBe('string');
			expect(kpi.value.length).toBeGreaterThan(0);
			expect(kpi.label.length).toBeGreaterThan(0);
		}
	});
});

// ── Moments tests ──────────────────────────────────────────────────────────────

describe('league moments', () => {
	it('returns null when no submissions', () => {
		const { league } = buildDeterministicSlices(db, leagueId);
		expect(league.moments).toBeNull();
	});

	it('mostLoved is the submission with the highest total points', () => {
		const r1 = addRound('R1');
		const alice = addPlayer('Alice');
		const bob = addPlayer('Bob');
		addSubmission(r1, alice.competitorId, alice.playerId, 'uri:a', 'Most Loved Song', 'Alice Artist');
		addSubmission(r1, bob.competitorId, bob.playerId, 'uri:b', 'Other Song', 'Bob Artist');

		// Alice's song gets 25 pts, Bob's gets 5
		addVote(r1, bob.competitorId, bob.playerId, 'uri:a', 25);
		addVote(r1, alice.competitorId, alice.playerId, 'uri:b', 5);

		const { league } = buildDeterministicSlices(db, leagueId);
		expect(league.moments).not.toBeNull();
		expect(league.moments!.mostLoved.title).toBe('Most Loved Song');
		expect(league.moments!.mostLoved.submitter).toBe('Alice');
		expect(league.moments!.mostLoved.round).toBe('R1');
	});

	it('mostDivisive is the submission with the highest vote spread', () => {
		const r1 = addRound('R1');
		const alice = addPlayer('Alice');
		const bob = addPlayer('Bob');
		const carol = addPlayer('Carol');
		// Song A: spread of 6 (5 - (-1))
		addSubmission(r1, alice.competitorId, alice.playerId, 'uri:a', 'Divisive Song', 'A');
		// Song B: spread of 2 (3 - 1)
		addSubmission(r1, bob.competitorId, bob.playerId, 'uri:b', 'Safe Song', 'B');
		addSubmission(r1, carol.competitorId, carol.playerId, 'uri:c', 'Third Song', 'C');

		// Make alice submit something so carol can vote on rounds with submissions
		// Vote on Song A: 5 from carol, -1 from bob → spread = 6
		addVote(r1, carol.competitorId, carol.playerId, 'uri:a', 5);
		addVote(r1, bob.competitorId, bob.playerId, 'uri:a', -1);
		// Vote on Song B: 3 from alice, 1 from carol → spread = 2
		addVote(r1, alice.competitorId, alice.playerId, 'uri:b', 3);
		addVote(r1, carol.competitorId, carol.playerId, 'uri:b', 1);

		const { league } = buildDeterministicSlices(db, leagueId);
		expect(league.moments!.mostDivisive.title).toBe('Divisive Song');
	});

	it('biggestUpset is the round winner with the smallest margin over 2nd place', () => {
		const r1 = addRound('Blowout Round');
		const r2 = addRound('Tight Round');
		const alice = addPlayer('Alice');
		const bob = addPlayer('Bob');
		const carol = addPlayer('Carol');

		// R1: Alice wins by 10 pts (20 vs 10) — not an upset
		addSubmission(r1, alice.competitorId, alice.playerId, 'uri:a1', 'Easy Win', 'A');
		addSubmission(r1, bob.competitorId, bob.playerId, 'uri:b1', 'R1 Loser', 'B');
		addVote(r1, carol.competitorId, carol.playerId, 'uri:a1', 20);
		addVote(r1, carol.competitorId, carol.playerId, 'uri:b1', 10);

		// R2: Bob wins by 1 pt (6 vs 5) — this is the upset
		addSubmission(r2, bob.competitorId, bob.playerId, 'uri:b2', 'Upset Winner', 'B');
		addSubmission(r2, alice.competitorId, alice.playerId, 'uri:a2', 'Near Miss', 'A');
		addVote(r2, carol.competitorId, carol.playerId, 'uri:b2', 6);
		addVote(r2, carol.competitorId, carol.playerId, 'uri:a2', 5);

		const { league } = buildDeterministicSlices(db, leagueId);
		expect(league.moments!.biggestUpset.title).toBe('Upset Winner');
	});

	it('moments entry has title, artist, submitter, round fields', () => {
		const r1 = addRound('Theme Round');
		const alice = addPlayer('Alice');
		const bob = addPlayer('Bob');
		addSubmission(r1, alice.competitorId, alice.playerId, 'uri:a', 'Track Title', 'Great Artist');
		addSubmission(r1, bob.competitorId, bob.playerId, 'uri:b', 'Other', 'Other');
		addVote(r1, bob.competitorId, bob.playerId, 'uri:a', 10);

		const { league } = buildDeterministicSlices(db, leagueId);
		const loved = league.moments!.mostLoved;
		expect(loved.title).toBe('Track Title');
		expect(loved.artist).toBe('Great Artist');
		expect(loved.submitter).toBe('Alice');
		expect(loved.round).toBe('Theme Round');
	});
});

// ── Fan / hater tests ──────────────────────────────────────────────────────────

describe('fan / hater relationships', () => {
	it('biggestFan is the player who gave the most total points to a member', () => {
		const r1 = addRound('R1');
		const r2 = addRound('R2');
		const alice = addPlayer('Alice');
		const bob = addPlayer('Bob');
		const carol = addPlayer('Carol');

		// Alice submits in both rounds
		addSubmission(r1, alice.competitorId, alice.playerId, 'uri:a1', 'A1');
		addSubmission(r2, alice.competitorId, alice.playerId, 'uri:a2', 'A2');
		// Bob and Carol also submit (needed for voter_id→competitor FK)
		addSubmission(r1, bob.competitorId, bob.playerId, 'uri:b1', 'B1');
		addSubmission(r2, carol.competitorId, carol.playerId, 'uri:c1', 'C1');

		// Bob gives Alice 30 total pts
		addVote(r1, bob.competitorId, bob.playerId, 'uri:a1', 20);
		addVote(r2, bob.competitorId, bob.playerId, 'uri:a2', 10);
		// Carol gives Alice 5 pts
		addVote(r1, carol.competitorId, carol.playerId, 'uri:a1', 5);

		const { members } = buildDeterministicSlices(db, leagueId);
		const aliceSlice = members.get(alice.playerId)!;
		expect(aliceSlice.biggestFan).not.toBeNull();
		expect(aliceSlice.biggestFan!.who).toBe('Bob');
		expect(aliceSlice.biggestFan!.pts).toBe(30);
	});

	it('biggestHater is the player who gave the fewest total points (≥2 shared rounds)', () => {
		const r1 = addRound('R1');
		const r2 = addRound('R2');
		const alice = addPlayer('Alice');
		const bob = addPlayer('Bob');
		const carol = addPlayer('Carol');

		addSubmission(r1, alice.competitorId, alice.playerId, 'uri:a1', 'A1');
		addSubmission(r2, alice.competitorId, alice.playerId, 'uri:a2', 'A2');
		addSubmission(r1, bob.competitorId, bob.playerId, 'uri:b1', 'B1');
		addSubmission(r2, bob.competitorId, bob.playerId, 'uri:b2', 'B2');
		addSubmission(r1, carol.competitorId, carol.playerId, 'uri:c1', 'C1');
		addSubmission(r2, carol.competitorId, carol.playerId, 'uri:c2', 'C2');

		// Bob gives Alice lots of pts
		addVote(r1, bob.competitorId, bob.playerId, 'uri:a1', 20);
		addVote(r2, bob.competitorId, bob.playerId, 'uri:a2', 20);
		// Carol gives Alice very few pts across 2 rounds → hater
		addVote(r1, carol.competitorId, carol.playerId, 'uri:a1', 1);
		addVote(r2, carol.competitorId, carol.playerId, 'uri:a2', 1);

		const { members } = buildDeterministicSlices(db, leagueId);
		const aliceSlice = members.get(alice.playerId)!;
		expect(aliceSlice.biggestHater).not.toBeNull();
		expect(aliceSlice.biggestHater!.who).toBe('Carol');
		expect(aliceSlice.biggestHater!.pts).toBe(2);
	});

	it('biggestHater requires >= 2 shared rounds (not just 1)', () => {
		const r1 = addRound('R1');
		const alice = addPlayer('Alice');
		const bob = addPlayer('Bob');

		addSubmission(r1, alice.competitorId, alice.playerId, 'uri:a', 'A');
		addSubmission(r1, bob.competitorId, bob.playerId, 'uri:b', 'B');

		// Bob gives Alice only 1 pt — but only 1 shared round
		addVote(r1, bob.competitorId, bob.playerId, 'uri:a', 1);

		const { members } = buildDeterministicSlices(db, leagueId);
		// biggestHater requires >=2 shared rounds → null
		expect(members.get(alice.playerId)!.biggestHater).toBeNull();
	});

	it('a player cannot be their own fan or hater', () => {
		const r1 = addRound('R1');
		const alice = addPlayer('Alice');
		const bob = addPlayer('Bob');

		addSubmission(r1, alice.competitorId, alice.playerId, 'uri:a', 'A');
		addSubmission(r1, bob.competitorId, bob.playerId, 'uri:b', 'B');
		// Only self-vote (should be excluded by the SQL)
		addVote(r1, alice.competitorId, alice.playerId, 'uri:a', 10);
		addVote(r1, bob.competitorId, bob.playerId, 'uri:b', 10);

		const { members } = buildDeterministicSlices(db, leagueId);
		// No cross-votes → fan/hater are null
		expect(members.get(alice.playerId)!.biggestFan).toBeNull();
		expect(members.get(bob.playerId)!.biggestFan).toBeNull();
	});
});
