import { it, expect, describe, vi, beforeEach } from 'vitest';
import { openLeagueDb } from '../../db/client.js';
import {
	runSubmissionPredict,
	SubmissionPredictOutputSchema,
	submissionPredictTask,
} from './submissionPredict.js';
import { HARDCODED_MODEL } from '../../digest/modelFor.js';
import type Database from 'better-sqlite3';

vi.mock('../../digest/llm.js', () => ({
	callOpenRouter: vi.fn(),
}));

import { callOpenRouter } from '../../digest/llm.js';
const mockCallOpenRouter = vi.mocked(callOpenRouter);

const FIXTURE_OUTPUT = {
	profile: {
		genres: ['indie rock', 'post-punk'],
		artists_or_types: ['The Cure', 'Joy Division', 'type: atmospheric guitar bands'],
		era: '80s–90s alternative',
		mood_energy: 'brooding mid-tempo',
		obscurity_lean: 'leans deep-cut',
		comment_likely: true,
		rationale:
			'Player consistently submits 80s alternative and post-punk — gave 5 pts to Joy Division in round 3 and submitted The Cure twice in prior rounds.',
	},
	candidates: [
		{ title: 'Pictures of You', artist: 'The Cure', why: 'Iconic 80s alternative; player awarded 5 pts to similar atmospheric tracks in round 7.' },
		{ title: 'Love Will Tear Us Apart', artist: 'Joy Division', why: 'Player voted 4 pts for this in round 3; strong post-punk fit.' },
		{ title: 'Just Like Heaven', artist: 'The Cure', why: 'Fits the player\'s repeated Cure submissions and upbeat 80s theme.' },
		{ title: 'Blue Monday', artist: 'New Order', why: 'Player gave 3 pts to synth-adjacent tracks; crossover from post-punk to electronic.' },
	],
	prediction: {
		title: 'Pictures of You',
		artist: 'The Cure',
		detail: 'Over the candidates, this edges out Love Will Tear Us Apart because the player submitted a similar atmospheric Cure track ("Disintegration") in round 2 and scored 12 pts on it — highest single-song score in their history.',
		similar_past_picks: [
			{
				title: 'Disintegration',
				artist: 'The Cure',
				round: 'Sad Songs',
				similarity: 'Same artist, same era, same melancholic atmosphere',
			},
		],
		confidence: 'medium' as const,
	},
};

const FIXTURE_JSON = JSON.stringify(FIXTURE_OUTPUT);
const FIXTURE_THEME = { name: '80s Bangers', description: 'Songs that defined the 1980s' };

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

describe('runSubmissionPredict — happy path', () => {
	it('returns the parsed three-part output and meta', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0.012, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		const { output, meta } = await runSubmissionPredict(db, playerId, { theme: FIXTURE_THEME });

		expect(output.profile).toEqual(FIXTURE_OUTPUT.profile);
		expect(output.candidates).toHaveLength(4);
		expect(output.prediction.title).toBe('Pictures of You');
		expect(meta.model).toBe(HARDCODED_MODEL); // task.model is now a fn; resolved = hardcoded (no DB pin in test)
		expect(meta.costUsd).toBe(0.012);
		expect(meta.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it('writes one prediction_runs row with task_id = submission-predict', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		await runSubmissionPredict(db, playerId, { theme: FIXTURE_THEME });

		const count = (db.prepare('SELECT COUNT(*) as n FROM prediction_runs').get() as { n: number }).n;
		expect(count).toBe(1);

		const run = db.prepare('SELECT task_id, player_id FROM prediction_runs').get() as {
			task_id: string;
			player_id: number;
		};
		expect(run.task_id).toBe('submission-predict');
		expect(run.player_id).toBe(playerId);
	});

	it('prediction_runs row carries model + cost + latency', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0.015, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		await runSubmissionPredict(db, playerId, { theme: FIXTURE_THEME });

		const run = db.prepare('SELECT model, cost_usd, latency_ms FROM prediction_runs').get() as {
			model: string;
			cost_usd: number;
			latency_ms: number;
		};
		expect(run.model).toBe(HARDCODED_MODEL); // task.model is now a fn; resolved = hardcoded (no DB pin in test)
		expect(run.cost_usd).toBeCloseTo(0.015);
		expect(run.latency_ms).toBeGreaterThanOrEqual(0);
	});

	it('passes roundId to prediction_runs when provided', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		await runSubmissionPredict(db, playerId, { theme: FIXTURE_THEME, roundId: 7 });

		const run = db.prepare('SELECT round_id FROM prediction_runs').get() as { round_id: number | null };
		expect(run.round_id).toBe(7);
	});

	it('round_id is NULL when not provided', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		await runSubmissionPredict(db, playerId, { theme: FIXTURE_THEME });

		const run = db.prepare('SELECT round_id FROM prediction_runs').get() as { round_id: number | null };
		expect(run.round_id).toBeNull();
	});

	it('works for a player with no submission or voting history', async () => {
		const playerId = seedPlayer(db, 'EmptyPlayer');
		const lowConf = { ...FIXTURE_OUTPUT, prediction: { ...FIXTURE_OUTPUT.prediction, confidence: 'low' as const } };
		mockCallOpenRouter.mockResolvedValueOnce({ content: JSON.stringify(lowConf), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		const { output } = await runSubmissionPredict(db, playerId, { theme: FIXTURE_THEME });
		expect(output.prediction.confidence).toBe('low');
	});

	it('prediction has empty similar_past_picks when none exist', async () => {
		const playerId = seedPlayer(db);
		const noPrior = {
			...FIXTURE_OUTPUT,
			prediction: { ...FIXTURE_OUTPUT.prediction, similar_past_picks: [] },
		};
		mockCallOpenRouter.mockResolvedValueOnce({ content: JSON.stringify(noPrior), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		const { output } = await runSubmissionPredict(db, playerId, { theme: FIXTURE_THEME });
		expect(output.prediction.similar_past_picks).toEqual([]);
	});

	it('does not include spotify_url when omitted by LLM', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		const { output } = await runSubmissionPredict(db, playerId, { theme: FIXTURE_THEME });
		expect(output.prediction.spotify_url).toBeUndefined();
	});

	it('includes spotify_url when LLM provides it', async () => {
		const playerId = seedPlayer(db);
		const withUrl = {
			...FIXTURE_OUTPUT,
			prediction: {
				...FIXTURE_OUTPUT.prediction,
				spotify_url: 'https://open.spotify.com/track/abc123',
			},
		};
		mockCallOpenRouter.mockResolvedValueOnce({ content: JSON.stringify(withUrl), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		const { output } = await runSubmissionPredict(db, playerId, { theme: FIXTURE_THEME });
		expect(output.prediction.spotify_url).toBe('https://open.spotify.com/track/abc123');
	});
});

// ── Output schema validation ───────────────────────────────────────────────────

describe('SubmissionPredictOutputSchema — validation', () => {
	it('accepts the full fixture output', () => {
		expect(() => SubmissionPredictOutputSchema.parse(FIXTURE_OUTPUT)).not.toThrow();
	});

	it('accepts a prediction with 6 candidates (max)', () => {
		const extra = [...FIXTURE_OUTPUT.candidates, { title: 'X', artist: 'Y', why: 'z' }, { title: 'A', artist: 'B', why: 'c' }];
		expect(() => SubmissionPredictOutputSchema.parse({ ...FIXTURE_OUTPUT, candidates: extra })).not.toThrow();
	});

	it('rejects fewer than 4 candidates', () => {
		const short = FIXTURE_OUTPUT.candidates.slice(0, 3);
		expect(() => SubmissionPredictOutputSchema.parse({ ...FIXTURE_OUTPUT, candidates: short })).toThrow();
	});

	it('rejects more than 6 candidates', () => {
		const over = [
			...FIXTURE_OUTPUT.candidates,
			{ title: 'X1', artist: 'Y1', why: 'w1' },
			{ title: 'X2', artist: 'Y2', why: 'w2' },
			{ title: 'X3', artist: 'Y3', why: 'w3' },
		];
		expect(() => SubmissionPredictOutputSchema.parse({ ...FIXTURE_OUTPUT, candidates: over })).toThrow();
	});

	it('rejects candidate with empty title', () => {
		const bad = [{ ...FIXTURE_OUTPUT.candidates[0], title: '' }, ...FIXTURE_OUTPUT.candidates.slice(1)];
		expect(() => SubmissionPredictOutputSchema.parse({ ...FIXTURE_OUTPUT, candidates: bad })).toThrow();
	});

	it('rejects candidate with empty why', () => {
		const bad = [{ ...FIXTURE_OUTPUT.candidates[0], why: '' }, ...FIXTURE_OUTPUT.candidates.slice(1)];
		expect(() => SubmissionPredictOutputSchema.parse({ ...FIXTURE_OUTPUT, candidates: bad })).toThrow();
	});

	it('rejects invalid confidence value', () => {
		const bad = { ...FIXTURE_OUTPUT, prediction: { ...FIXTURE_OUTPUT.prediction, confidence: 'very-high' } };
		expect(() => SubmissionPredictOutputSchema.parse(bad)).toThrow();
	});

	it('rejects empty profile.rationale', () => {
		const bad = { ...FIXTURE_OUTPUT, profile: { ...FIXTURE_OUTPUT.profile, rationale: '' } };
		expect(() => SubmissionPredictOutputSchema.parse(bad)).toThrow();
	});

	it('rejects missing profile fields', () => {
		const { genres: _g, ...noGenres } = FIXTURE_OUTPUT.profile;
		expect(() => SubmissionPredictOutputSchema.parse({ ...FIXTURE_OUTPUT, profile: noGenres })).toThrow();
	});

	it('accepts prediction with spotify_url', () => {
		const withUrl = { ...FIXTURE_OUTPUT, prediction: { ...FIXTURE_OUTPUT.prediction, spotify_url: 'https://open.spotify.com/track/xyz' } };
		expect(() => SubmissionPredictOutputSchema.parse(withUrl)).not.toThrow();
	});

	it('rejects empty prediction.detail', () => {
		const bad = { ...FIXTURE_OUTPUT, prediction: { ...FIXTURE_OUTPUT.prediction, detail: '' } };
		expect(() => SubmissionPredictOutputSchema.parse(bad)).toThrow();
	});

	it('accepts an empty similar_past_picks array', () => {
		const noPrior = { ...FIXTURE_OUTPUT, prediction: { ...FIXTURE_OUTPUT.prediction, similar_past_picks: [] } };
		expect(() => SubmissionPredictOutputSchema.parse(noPrior)).not.toThrow();
	});
});

// ── a4-migrate: DB routing proof ───────────────────────────────────────────────

describe('submissionPredictTask — DB-first model routing (a4-migrate)', () => {
	it('task.model is a function (DB-first resolver, not a static env string)', () => {
		expect(typeof submissionPredictTask.model).toBe('function');
	});

	it('task.model(db) returns bucket predict_model when set in DB', () => {
		db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('predict_model', 'openai/gpt-4o-mini')").run();
		const resolved = (submissionPredictTask.model as (db: import('better-sqlite3').Database) => string)(db);
		expect(resolved).toBe('openai/gpt-4o-mini');
		db.prepare("DELETE FROM settings WHERE key = 'predict_model'").run();
	});

	it('task.model(db) returns section pin over bucket predict_model', () => {
		db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('predict_model', 'openai/gpt-4o-mini')").run();
		db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('digest_model_submission-predict', 'meta-llama/llama-3.1-405b')").run();
		const resolved = (submissionPredictTask.model as (db: import('better-sqlite3').Database) => string)(db);
		expect(resolved).toBe('meta-llama/llama-3.1-405b');
		db.prepare("DELETE FROM settings WHERE key IN ('predict_model', 'digest_model_submission-predict')").run();
	});

	it('task.model(db) falls back to HARDCODED_MODEL when neither pin nor bucket is set', () => {
		const origPredict = process.env.OPENROUTER_PREDICT_MODEL;
		delete process.env.OPENROUTER_PREDICT_MODEL;
		const resolved = (submissionPredictTask.model as (db: import('better-sqlite3').Database) => string)(db);
		expect(resolved).toBe(HARDCODED_MODEL);
		if (origPredict !== undefined) process.env.OPENROUTER_PREDICT_MODEL = origPredict;
	});
});
