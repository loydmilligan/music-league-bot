import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { castAmaVote, readAmaVotes, resolveVoterId, roundForShareSlug, validVoteIndices, voterHeader } from './amaVotes.js';

function db() {
	const d = new Database(':memory:');
	d.exec(`
		CREATE TABLE digest2_shares (round_id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE);
		CREATE TABLE ama_votes (
			id INTEGER PRIMARY KEY AUTOINCREMENT, round_id INTEGER NOT NULL, prompt_index INTEGER NOT NULL,
			answer_index INTEGER NOT NULL, voter_id TEXT NOT NULL, voted_at TEXT NOT NULL DEFAULT (datetime('now')),
			UNIQUE(round_id, prompt_index, voter_id));
		INSERT INTO digest2_shares VALUES (168, 'slug168'), (170, 'slug170');`);
	return d;
}

describe('amaVotes', () => {
	it('resolves a share slug to its round, unknown slugs to null', () => {
		const d = db();
		expect(roundForShareSlug(d, 'slug170')).toBe(170);
		expect(roundForShareSlug(d, 'nope')).toBeNull();
	});

	it('cookie wins over the client fallback id', () => {
		expect(resolveVoterId('cookie-id', 'ls-id')).toBe('cookie-id');
		expect(resolveVoterId(undefined, 'ls-id')).toBe('ls-id');
		expect(voterHeader('v1', true)['Set-Cookie']).toMatch(/^ama_voter_id=v1; Path=\/; HttpOnly; SameSite=Lax; .*Secure$/);
	});

	it('one vote per voter per prompt, a re-vote replaces it, rounds stay separate', () => {
		const d = db();
		castAmaVote(d, 168, 'a', 0, 2);
		castAmaVote(d, 168, 'b', 0, 1);
		const out = castAmaVote(d, 168, 'a', 0, 1);
		expect(out.results).toEqual({ 1: 2 });
		castAmaVote(d, 170, 'a', 0, 3);
		expect(readAmaVotes(d, 168, 'a')).toEqual({ myVotes: { 0: 1 }, results: { 0: { 1: 2 } }, voter_id: 'a' });
	});

	it('rejects non-integer or out-of-range indices', () => {
		expect(validVoteIndices(0, 3)).toBe(true);
		for (const [p, a] of [[undefined, 1], [0, '1'], [-1, 0], [0, 1.5], [0, 50]]) {
			expect(validVoteIndices(p, a)).toBe(false);
		}
	});
});
