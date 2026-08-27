import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';
import { buildEarlyLedePrompt, generateEarlyLedes, getEarlyLedes, saveEarlyLedeRatings } from './earlyLedes.js';
import { addNote } from './roundNotes.js';

const T0 = '2026-08-26T00:00:00Z';
let db: Database.Database;

beforeEach(() => {
	db = new Database(':memory:');
	db.exec(SCHEMA);
	db.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('bz', 'Boarz');
	db.prepare("INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')").run();
	const r = db.prepare(
		'INSERT INTO rounds (id, season_id, ml_round_id, name, voting_deadline, created_at) VALUES (?, 1, ?, ?, ?, ?)',
	);
	r.run(148, 'ml-148', 'Prev', '2026-08-20T06:30:00Z', T0);
	r.run(149, 'ml-149', 'Surrender Monkeys', '2026-08-27T06:30:00Z', T0);
});

const deps = (ledes: unknown = [{ id: 'a', title: 'T', angle: 'A', evidence: ['e'] }]) => ({
	call: vi.fn().mockResolvedValue({ content: JSON.stringify({ ledes }) }),
	now: () => T0,
});

describe('buildEarlyLedePrompt', () => {
	it('states plainly that votes and results do not exist yet', () => {
		const p = buildEarlyLedePrompt({ roundName: 'R', leagueName: 'L', songs: [], subComments: [], chat: [], bridge: null, notes: '' });
		expect(p).toMatch(/no votes/i);
		expect(p).toMatch(/results/i);
	});

	it('includes the previous round bridge when present', () => {
		const p = buildEarlyLedePrompt({ roundName: 'R', leagueName: 'L', songs: [], subComments: [], chat: [], bridge: '{"running_bits":["carrotbox"]}', notes: '' });
		expect(p).toContain('carrotbox');
	});

	it('includes notes with their envelope', () => {
		const p = buildEarlyLedePrompt({ roundName: 'R', leagueName: 'L', songs: [], subComments: [], chat: [], bridge: null, notes: '# Editor notes\nnot a quotable source\n- the mandolin thing' });
		expect(p).toContain('the mandolin thing');
		expect(p).toMatch(/not a quotable source/i);
	});
});

describe('generateEarlyLedes', () => {
	it('stores the result in digest_early_ledes', async () => {
		await generateEarlyLedes(db, 149, deps());
		const got = getEarlyLedes(db, 149)!;
		expect(got.ledes).toHaveLength(1);
		expect(got.generatedAt).toBe(T0);
	});

	it('NEVER writes digest_ledes', async () => {
		await generateEarlyLedes(db, 149, deps());
		const n = db.prepare('SELECT COUNT(*) AS n FROM digest_ledes').get() as { n: number };
		expect(n.n).toBe(0);
	});

	it('regenerating replaces the row rather than erroring', async () => {
		await generateEarlyLedes(db, 149, deps());
		await generateEarlyLedes(db, 149, deps([{ id: 'b', title: 'T2', angle: 'A2', evidence: [] }]));
		expect(getEarlyLedes(db, 149)!.ledes[0].title).toBe('T2');
	});

	it('preserves ratings across a regeneration', async () => {
		await generateEarlyLedes(db, 149, deps());
		saveEarlyLedeRatings(db, 149, { ratings: { a: 'love' } }, T0);
		await generateEarlyLedes(db, 149, deps());
		expect(getEarlyLedes(db, 149)!.ratings).toEqual({ ratings: { a: 'love' } });
	});

	it('feeds ledes- and general-targeted notes into the prompt', async () => {
		addNote(db, 149, 'ledes', 'lede steer', T0);
		addNote(db, 149, 'general', 'general colour', T0);
		addNote(db, 149, 'chat', 'chat only', T0);
		const d = deps();
		await generateEarlyLedes(db, 149, d);
		const prompt = JSON.stringify(d.call.mock.calls[0][0]);
		expect(prompt).toContain('lede steer');
		expect(prompt).toContain('general colour');
		expect(prompt).not.toContain('chat only');
	});

	it('throws a useful error on unparseable model output', async () => {
		const d = { call: vi.fn().mockResolvedValue({ content: 'not json' }), now: () => T0 };
		await expect(generateEarlyLedes(db, 149, d)).rejects.toThrow(/parse/i);
	});

	it('returns null from getEarlyLedes when none exist', () => {
		expect(getEarlyLedes(db, 149)).toBeNull();
	});

	it('uniquifies duplicate ids from the model before storing', async () => {
		const d = deps([
			{ id: 'x', title: 'T1', angle: 'A1', evidence: [] },
			{ id: 'x', title: 'T2', angle: 'A2', evidence: [] },
			{ id: 'x', title: 'T3', angle: 'A3', evidence: [] },
		]);
		const { ledes } = await generateEarlyLedes(db, 149, d);
		const ids = ledes.map((l) => l.id);
		expect(new Set(ids).size).toBe(3);
		expect(ids[0]).toBe('x');
		expect(ids[1]).not.toBe('x');
		expect(ids[2]).not.toBe('x');
		expect(ids[1]).not.toBe(ids[2]);
		// Stored copy must match the (deduped) returned copy.
		expect(getEarlyLedes(db, 149)!.ledes.map((l) => l.id)).toEqual(ids);
	});

	it('generates an id for a lede missing one', async () => {
		const d = deps([{ title: 'T1', angle: 'A1', evidence: [] } as unknown as { id: string; title: string; angle: string; evidence: string[] }]);
		const { ledes } = await generateEarlyLedes(db, 149, d);
		expect(ledes[0].id).toBe('lede-0');
	});
});
