import { it, expect, describe, vi, beforeEach } from 'vitest';
import { openLeagueDb } from '../../db/client.js';
import { generateFingerprint, FingerprintOutputSchema, tasteFingerprintTask } from './tasteFingerprint.js';
import type Database from 'better-sqlite3';

vi.mock('../../digest/llm.js', () => ({
	callOpenRouter: vi.fn(),
}));

import { callOpenRouter } from '../../digest/llm.js';
const mockCallOpenRouter = vi.mocked(callOpenRouter);

const FIXTURE_FINGERPRINT = {
	signature_artists: ['The Cure', 'Massive Attack'],
	genres: ['post-punk', 'trip-hop'],
	eras: ['80s', '90s'],
	rewards: ['atmospheric production', 'strong basslines'],
	punishes: ['mainstream pop', 'country'],
	summary: 'A player drawn to dark, atmospheric sounds from the post-punk and trip-hop worlds.',
	confidence: 'medium' as const,
};
const FIXTURE_JSON = JSON.stringify(FIXTURE_FINGERPRINT);

function seedPlayer(db: Database.Database, name = 'TestPlayer'): number {
	db.prepare('INSERT INTO players (name) VALUES (?)').run(name);
	return (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
}

let db: Database.Database;
beforeEach(() => {
	db = openLeagueDb(':memory:');
	vi.clearAllMocks();
});

// ── Happy path ─────────────────────────────────────────────────────────────────

describe('generateFingerprint — happy path', () => {
	it('returns the parsed fingerprint and meta', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0.005 });

		const { fingerprint, meta } = await generateFingerprint(db, playerId);

		expect(fingerprint).toEqual(FIXTURE_FINGERPRINT);
		expect(meta.model).toBe(tasteFingerprintTask.model);
		expect(meta.costUsd).toBe(0.005);
		expect(meta.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it('creates a player_profiles row if none exists', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0 });

		await generateFingerprint(db, playerId);

		const row = db.prepare('SELECT * FROM player_profiles WHERE player_id = ?').get(playerId);
		expect(row).not.toBeNull();
	});

	it('persists taste_fingerprint as JSON string', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0 });

		await generateFingerprint(db, playerId);

		const row = db.prepare('SELECT taste_fingerprint FROM player_profiles WHERE player_id = ?').get(playerId) as {
			taste_fingerprint: string;
		};
		expect(JSON.parse(row.taste_fingerprint)).toEqual(FIXTURE_FINGERPRINT);
	});

	it('persists fingerprint_model matching task model', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0.003 });

		await generateFingerprint(db, playerId);

		const row = db.prepare('SELECT fingerprint_model, fingerprint_cost_usd FROM player_profiles WHERE player_id = ?').get(playerId) as {
			fingerprint_model: string;
			fingerprint_cost_usd: number;
		};
		expect(row.fingerprint_model).toBe(tasteFingerprintTask.model);
		expect(row.fingerprint_cost_usd).toBeCloseTo(0.003);
	});

	it('persists fingerprint_generated_at as an ISO timestamp', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0 });

		await generateFingerprint(db, playerId);

		const row = db.prepare('SELECT fingerprint_generated_at FROM player_profiles WHERE player_id = ?').get(playerId) as {
			fingerprint_generated_at: string;
		};
		expect(row.fingerprint_generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('also writes one prediction_runs row', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0 });

		await generateFingerprint(db, playerId);

		const count = (db.prepare('SELECT COUNT(*) as n FROM prediction_runs').get() as { n: number }).n;
		expect(count).toBe(1);

		const run = db.prepare('SELECT task_id, player_id FROM prediction_runs').get() as {
			task_id: string; player_id: number;
		};
		expect(run.task_id).toBe('taste-fingerprint');
		expect(run.player_id).toBe(playerId);
	});
});

// ── Manual/auto separation invariant ──────────────────────────────────────────

describe('generateFingerprint — manual/auto separation', () => {
	it('regenerating does NOT overwrite notes', async () => {
		const playerId = seedPlayer(db);
		db.prepare('INSERT INTO player_profiles (player_id, notes, tags) VALUES (?, ?, ?)').run(
			playerId,
			'Loves dark and moody music',
			JSON.stringify(['indie', 'post-punk']),
		);

		mockCallOpenRouter.mockResolvedValue({ content: FIXTURE_JSON, costUsd: 0 });

		// First generation
		await generateFingerprint(db, playerId);
		// Second generation (regenerate)
		await generateFingerprint(db, playerId);

		const row = db.prepare('SELECT notes, tags FROM player_profiles WHERE player_id = ?').get(playerId) as {
			notes: string; tags: string;
		};
		expect(row.notes).toBe('Loves dark and moody music');
		expect(row.tags).toBe(JSON.stringify(['indie', 'post-punk']));
	});

	it('notes and tags are byte-identical after regeneration', async () => {
		const playerId = seedPlayer(db);
		const originalNotes = 'Very specific owner note with emoji 🎵 and punctuation!';
		const originalTags = JSON.stringify(['80s synth-pop', 'dream-pop', 'krautrock']);
		db.prepare('INSERT INTO player_profiles (player_id, notes, tags) VALUES (?, ?, ?)').run(
			playerId,
			originalNotes,
			originalTags,
		);

		mockCallOpenRouter.mockResolvedValue({ content: FIXTURE_JSON, costUsd: 0 });

		await generateFingerprint(db, playerId);
		await generateFingerprint(db, playerId);
		await generateFingerprint(db, playerId);

		const row = db.prepare('SELECT notes, tags FROM player_profiles WHERE player_id = ?').get(playerId) as {
			notes: string; tags: string;
		};
		expect(row.notes).toBe(originalNotes);
		expect(row.tags).toBe(originalTags);
	});

	it('fingerprint is updated but notes/tags unchanged after regeneration', async () => {
		const playerId = seedPlayer(db);
		db.prepare('INSERT INTO player_profiles (player_id, notes) VALUES (?, ?)').run(
			playerId,
			'Original owner note',
		);

		const firstFingerprint = { ...FIXTURE_FINGERPRINT, summary: 'First run' };
		const secondFingerprint = { ...FIXTURE_FINGERPRINT, summary: 'Second run' };

		mockCallOpenRouter
			.mockResolvedValueOnce({ content: JSON.stringify(firstFingerprint), costUsd: 0 })
			.mockResolvedValueOnce({ content: JSON.stringify(secondFingerprint), costUsd: 0 });

		await generateFingerprint(db, playerId);
		await generateFingerprint(db, playerId);

		const row = db.prepare('SELECT notes, taste_fingerprint FROM player_profiles WHERE player_id = ?').get(playerId) as {
			notes: string; taste_fingerprint: string;
		};
		expect(row.notes).toBe('Original owner note');
		expect(JSON.parse(row.taste_fingerprint).summary).toBe('Second run');
	});
});

// ── Output schema validation ───────────────────────────────────────────────────

describe('FingerprintOutputSchema — validation', () => {
	it('accepts a valid fingerprint shape', () => {
		expect(() => FingerprintOutputSchema.parse(FIXTURE_FINGERPRINT)).not.toThrow();
	});

	it('rejects missing required fields', () => {
		const bad = { signature_artists: ['X'], genres: ['rock'] };
		expect(() => FingerprintOutputSchema.parse(bad)).toThrow();
	});

	it('rejects invalid confidence value', () => {
		const bad = { ...FIXTURE_FINGERPRINT, confidence: 'very-high' };
		expect(() => FingerprintOutputSchema.parse(bad)).toThrow();
	});

	it('rejects non-array fields', () => {
		const bad = { ...FIXTURE_FINGERPRINT, genres: 'not-an-array' };
		expect(() => FingerprintOutputSchema.parse(bad)).toThrow();
	});

	it('all array fields must contain strings', () => {
		const bad = { ...FIXTURE_FINGERPRINT, signature_artists: [1, 2, 3] };
		expect(() => FingerprintOutputSchema.parse(bad)).toThrow();
	});
});

// ── Edge cases ─────────────────────────────────────────────────────────────────

describe('generateFingerprint — edge cases', () => {
	it('works for a player with no submission or voting history', async () => {
		const playerId = seedPlayer(db, 'EmptyPlayer');
		const lowConfidenceOutput = { ...FIXTURE_FINGERPRINT, confidence: 'low' as const };
		mockCallOpenRouter.mockResolvedValueOnce({ content: JSON.stringify(lowConfidenceOutput), costUsd: 0 });

		const { fingerprint } = await generateFingerprint(db, playerId);
		expect(fingerprint.confidence).toBe('low');
	});
});
