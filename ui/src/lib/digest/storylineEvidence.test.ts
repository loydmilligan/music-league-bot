import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { openLeagueDb } from '../db/client';
import { gatherStorylineEvidence } from './storylineEvidence';

/**
 * Self-contained fixture: an 'sssc' league with two rounds (so there's a
 * previous-round boundary for the chat window), a chat group with matching
 * and non-matching messages attributed via player_identities, and votes
 * with matching and non-matching comments.
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

	db.prepare(`INSERT INTO competitors (id, ml_competitor_id, name) VALUES (1, 'c-poetry', 'PoetryinNoise')`).run();
	db.prepare(`INSERT INTO competitors (id, ml_competitor_id, name) VALUES (2, 'c-timmy', 'Timmywhatup')`).run();

	db.prepare(`INSERT INTO players (id, name) VALUES (1, 'PoetryinNoise')`).run();
	db.prepare(
		`INSERT INTO player_identities (player_id, league_id, identity_type, identifier)
		 VALUES (1, 1, 'whatsapp', 'PoetryinNoise')`,
	).run();

	// Chat: matching + non-matching, all within round 2's window
	// (2026-07-17T08:00:00Z .. 2026-07-24T08:00:00Z).
	const ins = db.prepare(
		`INSERT INTO chat_messages (group_name, sender, text, ts) VALUES (?,?,?,?)`,
	);
	ins.run('SSSC Chat', 'PoetryinNoise', 'my cat is judging this playlist', '2026-07-18T10:00:00Z');
	ins.run('SSSC Chat', 'PoetryinNoise', 'this track has big butts written all over it', '2026-07-19T10:00:00Z');
	ins.run('SSSC Chat', 'PoetryinNoise', 'anyway great round everyone', '2026-07-20T10:00:00Z');
	// noise from someone with no seed
	ins.run('SSSC Chat', 'Some Rando', 'my cat also likes this song', '2026-07-19T11:00:00Z');
	// outside the window (before round 1's start)
	ins.run('SSSC Chat', 'PoetryinNoise', 'ancient cat chat from before the season', '2026-06-01T10:00:00Z');

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
		// bagimation/missmara have no chat or votes at all this round.
		expect(players).not.toContain('bagimation');
		expect(players).not.toContain('missmara');
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
