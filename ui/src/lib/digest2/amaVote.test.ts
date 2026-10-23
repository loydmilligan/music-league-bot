import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ama_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL,
  prompt_index INTEGER NOT NULL,
  answer_index INTEGER NOT NULL,
  voter_id TEXT NOT NULL,
  voted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(round_id, prompt_index, voter_id)
);
`;

function openTestDb() {
	const db = new Database(':memory:');
	db.exec(SCHEMA);
	return db;
}

describe('ama_votes table', () => {
	let db: Database.Database;

	beforeAll(() => {
		db = openTestDb();
	});

	it('inserts a vote and respects uniqueness per (round_id, prompt_index, voter_id)', () => {
		const run = (voter: string, prompt: number, answer: number) =>
			db.prepare(
				`INSERT INTO ama_votes (round_id, prompt_index, answer_index, voter_id, voted_at)
				 VALUES (168, ?, ?, ?, datetime('now'))
				 ON CONFLICT(round_id, prompt_index, voter_id) DO UPDATE SET
				 answer_index = excluded.answer_index, voted_at = excluded.voted_at`
			).run(prompt, answer, voter);

		run('voter-a', 0, 2);
		run('voter-b', 0, 1);
		run('voter-a', 0, 3); // change vote

		const tally = db.prepare(
			'SELECT prompt_index, answer_index, COUNT(*) AS c FROM ama_votes WHERE round_id = 168 GROUP BY prompt_index, answer_index ORDER BY prompt_index, c DESC'
		).all() as { prompt_index: number; answer_index: number; c: number }[];

		expect(tally).toHaveLength(2);
		expect(tally.find((r) => r.answer_index === 1)?.c).toBe(1);
		expect(tally.find((r) => r.answer_index === 3)?.c).toBe(1);
		// answer 2 should be 0 because voter-a changed to 3
		const myVote = db.prepare(
			'SELECT answer_index FROM ama_votes WHERE round_id = 168 AND prompt_index = 0 AND voter_id = ?'
		).get('voter-a') as { answer_index: number };
		expect(myVote.answer_index).toBe(3);
	});

	it('tallies across multiple prompts independently', () => {
		db.exec('DELETE FROM ama_votes');
		db.prepare(
			'INSERT INTO ama_votes (round_id, prompt_index, answer_index, voter_id, voted_at) VALUES (168, 0, 0, \'v1\', datetime(\'now\'))'
		).run();
		db.prepare(
			'INSERT INTO ama_votes (round_id, prompt_index, answer_index, voter_id, voted_at) VALUES (168, 1, 2, \'v1\', datetime(\'now\'))'
		).run();
		db.prepare(
			'INSERT INTO ama_votes (round_id, prompt_index, answer_index, voter_id, voted_at) VALUES (168, 1, 2, \'v2\', datetime(\'now\'))'
		).run();

		const tally = db.prepare(
			'SELECT prompt_index, answer_index, COUNT(*) AS c FROM ama_votes WHERE round_id = 168 GROUP BY prompt_index, answer_index'
		).all() as { prompt_index: number; answer_index: number; c: number }[];

		const p0 = tally.filter((r) => r.prompt_index === 0);
		const p1 = tally.filter((r) => r.prompt_index === 1);
		expect(p0).toHaveLength(1);
		expect(p0[0].c).toBe(1);
		expect(p1).toHaveLength(1);
		expect(p1[0].c).toBe(2);
	});

	it('handles multiple voters for same answer', () => {
		db.exec('DELETE FROM ama_votes');
		for (const v of ['a', 'b', 'c']) {
			db.prepare(
				`INSERT INTO ama_votes (round_id, prompt_index, answer_index, voter_id, voted_at)
				 VALUES (168, 0, 1, ?, datetime('now'))`
			).run(v);
		}
		const tally = db.prepare(
			'SELECT answer_index, COUNT(*) AS c FROM ama_votes WHERE round_id = 168 AND prompt_index = 0 GROUP BY answer_index'
		).all() as { answer_index: number; c: number }[];
		expect(tally).toHaveLength(1);
		expect(tally[0].c).toBe(3);
	});

	it('filters by round_id', () => {
		db.exec('DELETE FROM ama_votes');
		db.prepare(
			'INSERT INTO ama_votes (round_id, prompt_index, answer_index, voter_id, voted_at) VALUES (168, 0, 0, \'v1\', datetime(\'now\'))'
		).run();
		db.prepare(
			'INSERT INTO ama_votes (round_id, prompt_index, answer_index, voter_id, voted_at) VALUES (169, 0, 0, \'v1\', datetime(\'now\'))'
		).run();

		const tally168 = db.prepare(
			'SELECT COUNT(*) AS c FROM ama_votes WHERE round_id = 168'
		).get() as { c: number };
		expect(tally168.c).toBe(1);
	});
});

// Cookie resolution: the endpoint reads an HttpOnly cookie (primary) and falls
// back to a localStorage UUID in the query/body. This pure-function mirror
// tests the same priority rules the endpoint follows.
describe('voter identity resolution (cookie-first)', () => {
	const uuid = () => crypto.randomUUID();

	function resolveVoterId(cookie: string | null, fallback?: string | null) {
		if (cookie?.length) return cookie;
		if (fallback?.length) return fallback;
		return uuid();
	}

	it('uses cookie when present', () => {
		expect(resolveVoterId('cookie-uuid-abc', 'local-uuid-xyz')).toBe('cookie-uuid-abc');
	});

	it('falls back to localStorage param when cookie is missing', () => {
		expect(resolveVoterId(null, 'local-uuid-xyz')).toBe('local-uuid-xyz');
	});

	it('generates a new UUID when neither cookie nor fallback exist', () => {
		const id = resolveVoterId(null, null);
		const id2 = resolveVoterId(null, '');
		expect(id).toMatch(/^[0-9a-f-]{36}$/);
		expect(id2).toMatch(/^[0-9a-f-]{36}$/);
		expect(id).not.toBe(id2);
	});

	it('ignores empty-string cookie and fallback', () => {
		expect(resolveVoterId('', '')).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('prefers cookie over any fallback', () => {
		expect(resolveVoterId('cookie', 'fallback')).toBe('cookie');
	});
});