import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { openLeagueDb } from '../db/client';
import { gatherStorylineEvidence } from './storylineEvidence';

/**
 * Self-contained fixture: an 'sssc' league with two rounds (so there's a
 * previous-round boundary for the chat window), a Discord chat group with
 * matching and non-matching messages attributed via player_identities
 * (identity_type='discord', matching real SSSC data), and votes with
 * matching and non-matching comments. Includes a player whose `players.name`
 * deliberately differs from `competitors.name` (missmara / Mara Mariani), to
 * exercise player_id-keyed attribution rather than name-string matching.
 */

const DB_PATH = `/tmp/storylineEvidence-test-${Date.now()}.db`;
let db: ReturnType<typeof openLeagueDb>;

beforeAll(() => {
	db = openLeagueDb(DB_PATH);
	// chat_messages isn't part of the league-db schema owned by client.ts — it's
	// written by the relay's own storage module against the same file — so the
	// fixture creates it directly, same as chatSection.test.ts does.
	db.exec(`
		CREATE TABLE IF NOT EXISTS chat_messages (
			id TEXT, platform TEXT, group_name TEXT, group_key TEXT,
			sender TEXT, text TEXT, ts TEXT, msg_hash TEXT, captured_at TEXT
		);
	`);

	db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1, 'sssc', 'SSSC')`).run();
	db.prepare(
		`INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')`,
	).run();
	db.prepare(
		`INSERT INTO rounds (id, season_id, ml_round_id, name, voting_deadline, created_at)
		 VALUES (1, 1, 'r1', 'Round 1', '2026-07-17T08:00:00Z', '2026-07-10T00:00:00Z')`,
	).run();
	db.prepare(
		`INSERT INTO rounds (id, season_id, ml_round_id, name, voting_deadline, created_at)
		 VALUES (2, 1, 'r2', 'Round 2', '2026-07-24T08:00:00Z', '2026-07-17T08:00:00Z')`,
	).run();

	// Players — note 'Mara Mariani' (player row) vs 'missmara' (competitor /
	// seed label): the whole point of the player_id-id case.
	db.prepare(`INSERT INTO players (id, name) VALUES (1, 'PoetryinNoise')`).run();
	db.prepare(`INSERT INTO players (id, name) VALUES (2, 'Timmywhatup')`).run();
	db.prepare(`INSERT INTO players (id, name) VALUES (3, 'Mara Mariani')`).run();

	db.prepare(
		`INSERT INTO competitors (id, ml_competitor_id, name, player_id) VALUES (1, 'c-poetry', 'PoetryinNoise', 1)`,
	).run();
	db.prepare(
		`INSERT INTO competitors (id, ml_competitor_id, name, player_id) VALUES (2, 'c-timmy', 'Timmywhatup', 2)`,
	).run();
	db.prepare(
		`INSERT INTO competitors (id, ml_competitor_id, name, player_id) VALUES (3, 'c-mara', 'missmara', 3)`,
	).run();

	db.prepare(
		`INSERT INTO player_identities (player_id, league_id, identity_type, identifier)
		 VALUES (1, 1, 'discord', 'PoetryinNoise')`,
	).run();
	db.prepare(
		`INSERT INTO player_identities (player_id, league_id, identity_type, identifier)
		 VALUES (3, 1, 'discord', 'Mara Mariani')`,
	).run();

	// Chat: matching + non-matching, all within round 2's window
	// (2026-07-17T08:00:00Z .. 2026-07-24T08:00:00Z). Platform is 'discord',
	// matching real SSSC chat_messages rows.
	const ins = db.prepare(
		`INSERT INTO chat_messages (group_name, platform, sender, text, ts) VALUES (?,?,?,?,?)`,
	);
	ins.run('SSSC Chat', 'discord', 'PoetryinNoise', 'my cat is judging this playlist', '2026-07-18T10:00:00Z');
	ins.run('SSSC Chat', 'discord', 'PoetryinNoise', 'this track has big butts written all over it', '2026-07-19T10:00:00Z');
	ins.run('SSSC Chat', 'discord', 'PoetryinNoise', 'anyway great round everyone', '2026-07-20T10:00:00Z');
	// noise from someone with no seed
	ins.run('SSSC Chat', 'discord', 'Some Rando', 'my cat also likes this song', '2026-07-19T11:00:00Z');
	// outside the window (before round 1's start)
	ins.run('SSSC Chat', 'discord', 'PoetryinNoise', 'ancient cat chat from before the season', '2026-06-01T10:00:00Z');
	// bagimation/missmara motif: "songs they didn't pick" — attributed via
	// player_identities to the 'Mara Mariani' player row, whose competitor row
	// is named 'missmara'. Six matches so the 5-quote cap is exercised.
	ins.run('SSSC Chat', 'discord', 'Mara Mariani', 'honestly I almost went with the other track', '2026-07-18T09:00:00Z');
	ins.run('SSSC Chat', 'discord', 'Mara Mariani', 'should have submitted the b-side instead', '2026-07-18T09:05:00Z');
	ins.run('SSSC Chat', 'discord', 'Mara Mariani', 'I almost picked a different song honestly', '2026-07-19T09:00:00Z');
	ins.run('SSSC Chat', 'discord', 'Mara Mariani', 'should have picked the other one, ugh', '2026-07-20T09:00:00Z');
	ins.run('SSSC Chat', 'discord', 'Mara Mariani', 'didn’t pick my first choice, regret it', '2026-07-21T09:00:00Z');
	ins.run('SSSC Chat', 'discord', 'Mara Mariani', 'still thinking about the song I almost went with', '2026-07-22T09:00:00Z');

	db.prepare(
		`INSERT INTO settings (key, value) VALUES ('chat_league_group_map', '{"sssc":"SSSC Chat"}')`,
	).run();

	// Votes for round 2: matching + non-matching comments.
	const insVote = db.prepare(
		`INSERT INTO votes (round_id, voter_id, spotify_uri, points, comment, created_at) VALUES (?,?,?,?,?,?)`,
	);
	insVote.run(2, 1, 'spotify:track:aaa', 3, 'big butts and I cannot lie', '2026-07-20T12:00:00Z');
	insVote.run(2, 1, 'spotify:track:bbb', 2, 'solid pick, nothing special', '2026-07-21T12:00:00Z');
	// Timmywhatup has a seed but with sources: ['chat'] only, so a matching vote
	// comment must NOT surface as evidence for him.
	insVote.run(2, 2, 'spotify:track:ccc', 1, 'love a good friday new music drop', '2026-07-21T13:00:00Z');

	// missmara didn't vote this round but did submit — she still needs to show
	// up in the league's competitor roster for seed-player-id resolution
	// (mirrors guesserInsights.ts's votes-OR-submissions scoping).
	db.prepare(
		`INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at)
		 VALUES (2, 3, 'spotify:track:mara', 'Some Song', 'Some Artist', '2026-07-17T09:00:00Z')`,
	).run();
});

afterAll(() => {
	db.close();
	for (const suffix of ['', '-wal', '-shm']) {
		const p = `${DB_PATH}${suffix}`;
		if (existsSync(p)) unlinkSync(p);
	}
});

describe('gatherStorylineEvidence', () => {
	it('returns only seeds with matching quotes, drops the rest', () => {
		const evidence = gatherStorylineEvidence(db, 2);
		const players = evidence.map((e) => e.player);
		expect(players).toContain('PoetryinNoise');
		expect(players).toContain('missmara');
		// bagimation has no chat or votes at all this round.
		expect(players).not.toContain('bagimation');
	});

	it('collects both chat and vote-comment quotes for a multi-source seed', () => {
		const evidence = gatherStorylineEvidence(db, 2);
		const poetry = evidence.find((e) => e.player === 'PoetryinNoise')!;
		expect(poetry.motif).toBe('cats & big butts');
		const texts = poetry.quotes.map((q) => q.text);
		expect(texts).toContain('my cat is judging this playlist');
		expect(texts).toContain('this track has big butts written all over it');
		expect(texts).toContain('big butts and I cannot lie');
		// Non-matching noise never gets in.
		expect(texts).not.toContain('anyway great round everyone');
		expect(texts).not.toContain('solid pick, nothing special');
		// The message outside the chat window is excluded even though it matches.
		expect(texts).not.toContain('ancient cat chat from before the season');
		// Attribution: the rando's matching message isn't credited to PoetryinNoise.
		expect(texts).not.toContain('my cat also likes this song');
		const sources = poetry.quotes.map((q) => q.source);
		expect(sources).toContain('chat');
		expect(sources).toContain('vote_comments');
	});

	it('respects a seed whose sources are chat-only, ignoring a matching vote comment', () => {
		const evidence = gatherStorylineEvidence(db, 2);
		// Timmywhatup has no chat evidence and his matching vote comment is out of
		// scope (sources: ['chat']), so the whole seed drops.
		expect(evidence.map((e) => e.player)).not.toContain('Timmywhatup');
	});

	it("attributes chat by player_id, not by name string, when players.name != competitors.name", () => {
		// Chat sender resolves to player_id 3 ('Mara Mariani') via player_identities;
		// the seed is keyed on the competitor label 'missmara'. Name-string matching
		// would find nothing here — this only works through player_id.
		const evidence = gatherStorylineEvidence(db, 2);
		const mara = evidence.find((e) => e.player === 'missmara')!;
		expect(mara).toBeDefined();
		expect(mara.quotes.some((q) => q.text.includes('should have submitted the b-side instead'))).toBe(true);
	});

	it('caps quotes at 5 per seed, keeping the newest', () => {
		const evidence = gatherStorylineEvidence(db, 2);
		const mara = evidence.find((e) => e.player === 'missmara')!;
		// Six matching chat messages were seeded; only the newest 5 survive.
		expect(mara.quotes).toHaveLength(5);
		expect(mara.quotes.some((q) => q.text.includes('honestly I almost went with the other track'))).toBe(
			false,
		);
		expect(
			mara.quotes.some((q) => q.text.includes('still thinking about the song I almost went with')),
		).toBe(true);
	});

	it('orders quotes newest first', () => {
		const evidence = gatherStorylineEvidence(db, 2);
		const poetry = evidence.find((e) => e.player === 'PoetryinNoise')!;
		const times = poetry.quotes.map((q) => Date.parse(q.ts));
		const sorted = [...times].sort((a, b) => b - a);
		expect(times).toEqual(sorted);
	});

	it('returns [] for a league with no seeds configured', () => {
		db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (2, 'no-seeds-league', 'No Seeds')`).run();
		db.prepare(
			`INSERT INTO seasons (id, league_id, season_number, status) VALUES (2, 2, 1, 'active')`,
		).run();
		db.prepare(
			`INSERT INTO rounds (id, season_id, ml_round_id, name, voting_deadline, created_at)
			 VALUES (3, 2, 'r3', 'Round 1', '2026-07-24T08:00:00Z', '2026-07-17T08:00:00Z')`,
		).run();
		expect(gatherStorylineEvidence(db, 3)).toEqual([]);
	});

	it('returns [] for an unknown round id', () => {
		expect(gatherStorylineEvidence(db, 9999)).toEqual([]);
	});
});
