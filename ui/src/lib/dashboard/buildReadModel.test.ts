import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '../db/client.js';
import { buildReadModel, ReadModelSchema, FullMemberSchema, LiteMemberSchema, ACCENT_VALUES } from './buildReadModel.js';

vi.mock('../digest/llm.js', () => ({
	callOpenRouter: vi.fn(),
}));

import { callOpenRouter } from '../digest/llm.js';
const mockCallOpenRouter = vi.mocked(callOpenRouter);

// ── LLM response fixtures ───────────────────────────────────────────────────────

const SUPERLATIVES_FIXTURE = {
	superlatives: [
		{ award: 'The Dreamer', accent: 'pulp', blurb: 'Always finds the hidden gem.' },
		{ award: 'Mood Setter', accent: 'amber', blurb: 'Sets the vibe every round.' },
	],
	signatureSuperlative: {
		award: 'Heart on Sleeve',
		blurb: 'Every pick tells a story.',
	},
};

const SPECTRUM_FIXTURE = {
	polished_vs_raw: 42,
	sunny_vs_melancholy: 68,
	familiar_vs_obscure: 55,
};

const PLAYLIST_FIXTURE = {
	name: "Songs You Haven't Found Yet",
	nudge: 'These are for you.',
	tracks: [
		{ title: 'Glory Box', artist: 'Portishead', why: 'Trip-hop in your wheelhouse.' },
		{ title: 'Teardrop', artist: 'Massive Attack', why: 'Reverb you could swim in.' },
		{ title: 'Blue Light', artist: 'Mazzy Star', why: 'Deeper cut from a band you love.' },
	],
};

const FAN_HATER_FIXTURE = {
	fanLine: 'Your biggest supporter — gave you points in every shared round.',
	haterLine: 'Lovingly withholds points, but secretly respects your taste.',
};

const REEL_FIXTURE = {
	reel: [
		{ award: 'Tastemaker', winner: 'Alice', accent: 'amber', blurb: 'Quietly ran the season.' },
		{ award: 'Deep Cut Award', winner: 'Bob', accent: 'sky', blurb: 'Found the obscure gem.' },
		{ award: 'Joy Bringer', winner: 'Alice', accent: 'pulp', blurb: 'Every pick landed.' },
	],
};

const MOMENT_LINES_FIXTURE = {
	mostLovedLine: 'The song that united the room.',
	mostDivisiveLine: 'Split the group clean down the middle.',
	biggestUpsetLine: 'Zero chat buzz, then won everything.',
};

const SEASON_UPDATE_FIXTURE = {
	title: 'The Race Is On',
	body: 'Alice surged to the top after a quiet start. The season is heating up.',
};

// Mock callOpenRouter to return appropriate fixture based on system prompt content
function setupMock() {
	mockCallOpenRouter.mockImplementation(async (messages: Parameters<typeof mockCallOpenRouter>[0]) => {
		const sys = (messages[0]?.content ?? '').toLowerCase();
		if (sys.includes('yearbook writer')) {
			return { content: JSON.stringify(SUPERLATIVES_FIXTURE), costUsd: 0.001, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 };
		}
		if (sys.includes('0–100') || sys.includes('0-100') || sys.includes('polished_vs_raw')) {
			return { content: JSON.stringify(SPECTRUM_FIXTURE), costUsd: 0.001, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 };
		}
		if (sys.includes('discovery playlist') || sys.includes('personalised')) {
			return { content: JSON.stringify(PLAYLIST_FIXTURE), costUsd: 0.001, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 };
		}
		if (sys.includes('biggest fan') || sys.includes('friendly hater')) {
			return { content: JSON.stringify(FAN_HATER_FIXTURE), costUsd: 0.001, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 };
		}
		if (sys.includes('yearbook editor') || sys.includes('reel')) {
			return { content: JSON.stringify(REEL_FIXTURE), costUsd: 0.001, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 };
		}
		if (sys.includes('caption') || sys.includes('most loved')) {
			return { content: JSON.stringify(MOMENT_LINES_FIXTURE), costUsd: 0.001, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 };
		}
		if (sys.includes('season-pulse writer') || sys.includes('season update')) {
			return { content: JSON.stringify(SEASON_UPDATE_FIXTURE), costUsd: 0.001, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 };
		}
		// Fingerprint generation fallback
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
			promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0,
		};
	});
}

// ── DB seed helpers ─────────────────────────────────────────────────────────────

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

/** rounds.phase is nullable — import paths routinely leave it unset. */
const NO_PHASE = null as unknown as string;

function addRound(name: string, phase: string = 'complete'): number {
	db.prepare(
		"INSERT INTO rounds (season_id, ml_round_id, name, created_at, voting_deadline, phase) VALUES (?, ?, ?, '2026-01-01', '2026-01-07', ?)",
	).run(seasonId, `ml-${name}-${Math.random()}`, name, phase);
	return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

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

function addSubmission(
	roundId: number,
	competitorId: number,
	playerId: number,
	uri: string,
	title = 'Song',
	artists = 'Artist',
): void {
	db.prepare(
		"INSERT INTO ml_submissions (round_id, competitor_id, player_id, spotify_uri, title, artists, created_at) VALUES (?, ?, ?, ?, ?, ?, '2026-01-01')",
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
		"INSERT INTO votes (round_id, voter_id, player_id, spotify_uri, points, created_at) VALUES (?, ?, ?, ?, ?, '2026-01-01')",
	).run(roundId, voterCompetitorId, voterPlayerId, uri, points);
}

function seedFingerprint(playerId: number): void {
	db.prepare('INSERT OR IGNORE INTO player_profiles (player_id) VALUES (?)').run(playerId);
	db.prepare('UPDATE player_profiles SET taste_fingerprint = ? WHERE player_id = ?').run(
		JSON.stringify({
			signature_artists: ['Portishead', 'Mazzy Star'],
			genres: ['trip-hop', 'dream pop'],
			eras: ['90s'],
			rewards: ['reverb', 'melancholy'],
			punishes: ['bro-country'],
			summary: 'Drawn to melancholy atmospheric sounds.',
			confidence: 'medium',
		}),
		playerId,
	);
}

// ── Fixture: 4 rounds, Alice (full), Bob (lite) ─────────────────────────────────
// Tier cutoff for 4 rounds: max(3, round(4 × 0.5)) = max(3,2) = 3
// Alice submits 3/4 rounds → full; Bob submits 1/4 → lite

function seedTwoMemberLeague(): {
	alice: { playerId: number; competitorId: number };
	bob: { playerId: number; competitorId: number };
	rounds: number[];
} {
	const r1 = addRound('Sad Bangers');
	const r2 = addRound('Yacht Rock');
	const r3 = addRound('Midnight Vibes');
	const r4 = addRound('Deep Cuts');

	const alice = addPlayer('Alice');
	const bob = addPlayer('Bob');

	seedFingerprint(alice.playerId);
	seedFingerprint(bob.playerId);

	// Alice submits in rounds 1, 2, 3 (3 of 4 → full)
	addSubmission(r1, alice.competitorId, alice.playerId, 'spotify:a1', 'Wicked Game', 'Chris Isaak');
	addSubmission(r2, alice.competitorId, alice.playerId, 'spotify:a2', 'Harvest Moon', 'Neil Young');
	addSubmission(r3, alice.competitorId, alice.playerId, 'spotify:a3', 'Glory Box', 'Portishead');

	// Bob submits in round 1 only (1 of 4 → lite)
	addSubmission(r1, bob.competitorId, bob.playerId, 'spotify:b1', 'Teardrop', 'Massive Attack');

	// Votes: Bob votes for Alice, Alice votes for Bob (mutual in r1)
	addVote(r1, bob.competitorId, bob.playerId, 'spotify:a1', 5);
	addVote(r1, alice.competitorId, alice.playerId, 'spotify:b1', 3);
	// Alice also votes for her own round submissions (other people's songs)
	addVote(r2, bob.competitorId, bob.playerId, 'spotify:a2', 4);

	return { alice, bob, rounds: [r1, r2, r3, r4] };
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe('buildReadModel — full + lite members', () => {
	it('returns a ReadModel that passes zod validation', async () => {
		seedTwoMemberLeague();
		const model = await buildReadModel(db, leagueId);
		expect(() => ReadModelSchema.parse(model)).not.toThrow();
	});

	it('league meta has correct counts', async () => {
		seedTwoMemberLeague();
		const model = await buildReadModel(db, leagueId);
		expect(model.league.name).toBe('Test League');
		expect(model.league.memberCount).toBe(2);
		expect(model.league.seasons).toBe(1);
		expect(model.league.round).toBe(4);
	});

	it('full member (Alice) has spectrum, playlist, superlatives, voteTwins, voteTogether', async () => {
		const { alice } = seedTwoMemberLeague();
		const model = await buildReadModel(db, leagueId);

		const aliceEntry = model.members.find((m) => m.id === String(alice.playerId));
		expect(aliceEntry).toBeDefined();
		expect(aliceEntry!.tier).toBe('full');

		// Validate full member schema passes
		expect(() => FullMemberSchema.parse(aliceEntry)).not.toThrow();

		const full = aliceEntry as import('./buildReadModel.js').FullMember;
		expect(full.spectrum).toHaveLength(3);
		expect(full.playlist).toBeDefined();
		expect(full.playlist.tracks.length).toBeGreaterThan(0);
		expect(full.superlatives.length).toBeGreaterThan(0);
		expect(full.voteTwins).toBeDefined();
		expect(full.voteTogether).toBeDefined();
		expect(full.signatureSuperlative.award).toBeTruthy();
	});

	it('lite member (Bob) omits spectrum, playlist, superlatives[], voteTwins, voteTogether', async () => {
		const { bob } = seedTwoMemberLeague();
		const model = await buildReadModel(db, leagueId);

		const bobEntry = model.members.find((m) => m.id === String(bob.playerId));
		expect(bobEntry).toBeDefined();
		expect(bobEntry!.tier).toBe('lite');

		// Validate lite member schema passes
		expect(() => LiteMemberSchema.parse(bobEntry)).not.toThrow();

		// Lite members must NOT have these fields
		expect((bobEntry as Record<string, unknown>).spectrum).toBeUndefined();
		expect((bobEntry as Record<string, unknown>).playlist).toBeUndefined();
		expect((bobEntry as Record<string, unknown>).superlatives).toBeUndefined();
		expect((bobEntry as Record<string, unknown>).voteTwins).toBeUndefined();
		expect((bobEntry as Record<string, unknown>).voteTogether).toBeUndefined();

		// But lite member does have signatureSuperlative
		const lite = bobEntry as import('./buildReadModel.js').LiteMember;
		expect(lite.signatureSuperlative).toBeDefined();
		expect(lite.signatureSuperlative.award).toBeTruthy();
	});

	it('all accent values are in the allowed set (pulp|amber|sky|moss|ember)', async () => {
		seedTwoMemberLeague();
		const model = await buildReadModel(db, leagueId);

		const allowedAccents = new Set(ACCENT_VALUES);

		// Check member superlatives
		for (const member of model.members) {
			if (member.tier === 'full') {
				for (const s of member.superlatives) {
					expect(allowedAccents.has(s.accent as typeof ACCENT_VALUES[number])).toBe(true);
				}
			}
		}

		// Check reel
		for (const item of model.reel) {
			expect(allowedAccents.has(item.accent as typeof ACCENT_VALUES[number])).toBe(true);
		}
	});

	it('fingerprint fields (genres, eras, signatureArtists) are present for all members', async () => {
		seedTwoMemberLeague();
		const model = await buildReadModel(db, leagueId);

		for (const member of model.members) {
			expect(Array.isArray(member.genres)).toBe(true);
			expect(Array.isArray(member.eras)).toBe(true);
			expect(Array.isArray(member.signatureArtists)).toBe(true);
		}
	});

	it('returns an optional slug in league meta when provided', async () => {
		seedTwoMemberLeague();
		const model = await buildReadModel(db, leagueId, { slug: 'test-slug-abc123' });
		expect(model.league.slug).toBe('test-slug-abc123');
	});

	it('throws for an unknown leagueId', async () => {
		await expect(buildReadModel(db, 9999)).rejects.toThrow('not found');
	});

	it('returns empty members/reel/archive for a league with no submissions', async () => {
		const emptyLeagueId = (() => {
			db.prepare("INSERT INTO leagues (slug, name) VALUES ('empty', 'Empty League')").run();
			return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
		})();
		const model = await buildReadModel(db, emptyLeagueId);
		expect(model.members).toHaveLength(0);
		expect(model.reel).toHaveLength(0);
		expect(model.archive).toHaveLength(0);
		expect(model.moments).toBeNull();
	});

	it('archive entries are ordered newest-first and contain round metadata', async () => {
		seedTwoMemberLeague();
		const model = await buildReadModel(db, leagueId);
		expect(model.archive.length).toBe(4);
		// Newest-first: n values should be descending 4, 3, 2, 1
		const ns = model.archive.map((e) => e.n);
		expect(ns[0]).toBeGreaterThan(ns[1]);
		// All entries have required fields
		for (const entry of model.archive) {
			expect(typeof entry.theme).toBe('string');
			expect(typeof entry.season).toBe('number');
			expect(typeof entry.hue).toBe('string');
		}
	});

	it('stat fields are present and numeric for all members', async () => {
		seedTwoMemberLeague();
		const model = await buildReadModel(db, leagueId);
		for (const member of model.members) {
			expect(typeof member.stat.submitted).toBe('number');
			expect(typeof member.stat.avgPts).toBe('number');
			expect(typeof member.stat.wins).toBe('number');
		}
	});

	it('season-pulse writer: readModel.seasonUpdate is populated when signals exist', async () => {
		seedTwoMemberLeague();
		const model = await buildReadModel(db, leagueId);
		// Signals require ≥2 rounds with standings changes; seedTwoMemberLeague has 4 rounds with votes
		// so bigMover/faller may or may not fire, but either way schema must accept the field.
		expect(() => ReadModelSchema.parse(model)).not.toThrow();
		// If seasonUpdate was set, it must have title + body
		if (model.seasonUpdate !== null && model.seasonUpdate !== undefined) {
			expect(typeof model.seasonUpdate.title).toBe('string');
			expect(typeof model.seasonUpdate.body).toBe('string');
		}
	});

	it('league.round and songs-submitted KPI count only completed rounds', async () => {
		seedTwoMemberLeague(); // 4 complete rounds

		// Add incomplete rounds that must NOT inflate the counts
		addRound('Upcoming Theme', 'submission');
		addRound('Far Future Theme', 'not-started');

		const model = await buildReadModel(db, leagueId);

		// league.round must reflect completed rounds only
		expect(model.league.round).toBe(4);

		// "songs submitted" KPI sub must say "across 4 rounds", not 6
		const songKpi = model.kpis.find((k) => k.label === 'songs submitted');
		expect(songKpi).toBeDefined();
		expect(songKpi!.sub).toBe('across 4 rounds');
	});

	it('archive excludes incomplete rounds; keeps complete rounds that have no digest share', async () => {
		seedTwoMemberLeague(); // 4 complete rounds, no digest shares

		// Add incomplete rounds that must NOT appear in the archive
		addRound('Upcoming Theme', 'submission');
		addRound('Far Future Theme', 'not-started');

		const model = await buildReadModel(db, leagueId);

		// Only the 4 complete rounds belong in the archive
		expect(model.archive).toHaveLength(4);

		// Incomplete rounds are absent
		const themes = model.archive.map((e) => e.theme);
		expect(themes).not.toContain('Upcoming Theme');
		expect(themes).not.toContain('Far Future Theme');

		// Complete rounds with no digest share (digestUrl = null) are kept —
		// a missing share link does not disqualify a complete round.
		expect(model.archive.every((e) => e.digestUrl === null)).toBe(true);
	});

	it('archive keeps voted rounds whose phase was never set (Second Best S2 regression)', async () => {
		const { alice, bob } = seedTwoMemberLeague(); // 4 rounds, phase = 'complete'

		// A finished round that email/zip import left with a NULL phase — this is the
		// state every Second Best Season 2 round was in, which emptied the live archive.
		const orphan = addRound('Phaseless But Finished', NO_PHASE);
		addSubmission(orphan, alice.competitorId, alice.playerId, 'uri:orphan', 'Orphan Song', 'Orphan Band');
		addVote(orphan, bob.competitorId, bob.playerId, 'uri:orphan', 5);

		// A round with no votes at all and no phase stays out.
		addRound('Not Started Yet', NO_PHASE);

		const model = await buildReadModel(db, leagueId);
		const themes = model.archive.map((e) => e.theme);

		expect(themes).toContain('Phaseless But Finished');
		expect(themes).not.toContain('Not Started Yet');
		expect(model.archive).toHaveLength(5);

		const entry = model.archive.find((e) => e.theme === 'Phaseless But Finished')!;
		expect(entry.winnerSong).toBe('Orphan Song');
		expect(entry.votes).toBe(1);

		// n stays a contiguous 1..N sequence, newest first.
		expect(model.archive.map((e) => e.n)).toEqual([5, 4, 3, 2, 1]);
	});
});
