import { it, expect, vi, beforeEach, describe } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';

const db = openLeagueDb(':memory:');

vi.mock('$lib/db/client.js', async (orig) => {
	const actual = await orig<typeof import('$lib/db/client.js')>();
	return { ...actual, getDb: () => db };
});

vi.mock('$lib/digest/llm.js', () => ({
	callOpenRouter: vi.fn(),
}));

vi.mock('$lib/predict/spotifyValidate.js', () => ({
	validateTracks: vi.fn(),
}));

import { callOpenRouter } from '$lib/digest/llm.js';
import { validateTracks } from '$lib/predict/spotifyValidate.js';
const mockCallOpenRouter = vi.mocked(callOpenRouter);
const mockValidateTracks = vi.mocked(validateTracks);

let POST: typeof import('./+server.js').POST;

beforeEach(async () => {
	db.prepare('DELETE FROM prediction_runs').run();
	db.prepare('DELETE FROM player_profiles').run();
	db.prepare('DELETE FROM players').run();
	vi.clearAllMocks();
	({ POST } = await import('./+server.js'));
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function mkPlayer(name = 'Alice'): number {
	db.prepare('INSERT INTO players (name) VALUES (?)').run(name);
	return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

function postEvt(playerId: number | string, body: unknown) {
	return {
		params: { playerId: String(playerId) },
		request: { json: async () => body } as unknown as Request,
	} as unknown as Parameters<typeof POST>[0];
}

const FIXTURE_LLM_OUTPUT = {
	profile: {
		genres: ['indie rock', 'post-punk'],
		artists_or_types: ['The Cure', 'Joy Division'],
		era: '80s–90s alternative',
		mood_energy: 'brooding mid-tempo',
		obscurity_lean: 'leans deep-cut',
		comment_likely: true,
		rationale: 'Player submitted post-punk twice; gave 5 pts to Joy Division in round 3.',
	},
	candidates: [
		{ title: 'Pictures of You', artist: 'The Cure', why: 'Top atmospheric 80s track for this player.' },
		{ title: 'Love Will Tear Us Apart', artist: 'Joy Division', why: 'Player voted 4 pts for this in round 3.' },
		{ title: 'Just Like Heaven', artist: 'The Cure', why: 'Fits the player\'s repeated Cure submissions.' },
		{ title: 'Blue Monday', artist: 'New Order', why: 'Crossover from post-punk to electronic.' },
	],
	prediction: {
		title: 'Pictures of You',
		artist: 'The Cure',
		detail: 'Edges out the others because the player submitted a similar Cure track in round 2.',
		similar_past_picks: [
			{ title: 'Disintegration', artist: 'The Cure', round: 'Sad Songs', similarity: 'Same artist, same era' },
		],
		confidence: 'medium' as const,
	},
};

const FIXTURE_VALIDATED_CANDIDATES = [
	{ title: 'Pictures of You', artist: 'The Cure', spotify_url: 'https://open.spotify.com/track/abc1', album_art_url: 'https://img1', resolved: true },
	{ title: 'Love Will Tear Us Apart', artist: 'Joy Division', resolved: false },
	{ title: 'Just Like Heaven', artist: 'The Cure', spotify_url: 'https://open.spotify.com/track/abc3', album_art_url: 'https://img3', resolved: true },
	{ title: 'Blue Monday', artist: 'New Order', resolved: false },
];

const FIXTURE_VALIDATED_PREDICTION = [
	{ title: 'Pictures of You', artist: 'The Cure', spotify_url: 'https://open.spotify.com/track/abc1', album_art_url: 'https://img1', resolved: true },
];

const VALID_BODY = {
	theme: { name: '80s Bangers', description: 'Songs that defined the 1980s' },
};

// ── POST /api/players/:playerId/submission-predict ────────────────────────────

describe('POST /api/players/:playerId/submission-predict', () => {
	it('returns 200 with the three-part enriched result', async () => {
		const id = mkPlayer();
		mockCallOpenRouter.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_LLM_OUTPUT), costUsd: 0.012, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });
		mockValidateTracks
			.mockResolvedValueOnce(FIXTURE_VALIDATED_CANDIDATES)
			.mockResolvedValueOnce(FIXTURE_VALIDATED_PREDICTION);

		const res = await POST(postEvt(id, VALID_BODY));
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.profile.genres).toEqual(['indie rock', 'post-punk']);
		expect(Array.isArray(body.candidates)).toBe(true);
		expect(body.candidates).toHaveLength(4);
		expect(body.prediction.title).toBe('Pictures of You');
	});

	it('merges Spotify fields into resolved candidates', async () => {
		const id = mkPlayer();
		mockCallOpenRouter.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_LLM_OUTPUT), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });
		mockValidateTracks
			.mockResolvedValueOnce(FIXTURE_VALIDATED_CANDIDATES)
			.mockResolvedValueOnce(FIXTURE_VALIDATED_PREDICTION);

		const res = await POST(postEvt(id, VALID_BODY));
		const body = await res.json();

		// First candidate was resolved
		expect(body.candidates[0].spotify_url).toBe('https://open.spotify.com/track/abc1');
		expect(body.candidates[0].why).toBe('Top atmospheric 80s track for this player.');
		// Second candidate was unresolved — no spotify_url
		expect(body.candidates[1].spotify_url).toBeUndefined();
		expect(body.candidates[1].resolved).toBe(false);
	});

	it('merges Spotify url + art into the prediction when resolved', async () => {
		const id = mkPlayer();
		mockCallOpenRouter.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_LLM_OUTPUT), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });
		mockValidateTracks
			.mockResolvedValueOnce(FIXTURE_VALIDATED_CANDIDATES)
			.mockResolvedValueOnce(FIXTURE_VALIDATED_PREDICTION);

		const res = await POST(postEvt(id, VALID_BODY));
		const body = await res.json();

		expect(body.prediction.spotify_url).toBe('https://open.spotify.com/track/abc1');
		expect(body.prediction.album_art_url).toBe('https://img1');
		expect(body.prediction.detail.length).toBeGreaterThan(0);
		expect(body.prediction.confidence).toBe('medium');
	});

	it('prediction carries no spotify_url when unresolved', async () => {
		const id = mkPlayer();
		const unresolvedPrediction = [{ title: 'Pictures of You', artist: 'The Cure', resolved: false }];
		mockCallOpenRouter.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_LLM_OUTPUT), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });
		mockValidateTracks
			.mockResolvedValueOnce(FIXTURE_VALIDATED_CANDIDATES)
			.mockResolvedValueOnce(unresolvedPrediction);

		const res = await POST(postEvt(id, VALID_BODY));
		const body = await res.json();
		expect(body.prediction.spotify_url).toBeUndefined();
	});

	it('calls validateTracks twice — once for candidates, once for prediction', async () => {
		const id = mkPlayer();
		mockCallOpenRouter.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_LLM_OUTPUT), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });
		mockValidateTracks
			.mockResolvedValueOnce(FIXTURE_VALIDATED_CANDIDATES)
			.mockResolvedValueOnce(FIXTURE_VALIDATED_PREDICTION);

		await POST(postEvt(id, VALID_BODY));

		expect(mockValidateTracks).toHaveBeenCalledTimes(2);
		// First call: all 4 candidates
		expect(mockValidateTracks.mock.calls[0][0]).toHaveLength(4);
		// Second call: just the prediction pick
		expect(mockValidateTracks.mock.calls[1][0]).toHaveLength(1);
		expect(mockValidateTracks.mock.calls[1][0][0]).toEqual({ title: 'Pictures of You', artist: 'The Cure' });
	});

	it('writes one prediction_runs row with task_id = submission-predict', async () => {
		const id = mkPlayer();
		mockCallOpenRouter.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_LLM_OUTPUT), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });
		mockValidateTracks
			.mockResolvedValueOnce(FIXTURE_VALIDATED_CANDIDATES)
			.mockResolvedValueOnce(FIXTURE_VALIDATED_PREDICTION);

		await POST(postEvt(id, VALID_BODY));

		const count = (db.prepare('SELECT COUNT(*) as n FROM prediction_runs').get() as { n: number }).n;
		expect(count).toBe(1);
		const run = db.prepare('SELECT task_id, player_id FROM prediction_runs').get() as {
			task_id: string;
			player_id: number;
		};
		expect(run.task_id).toBe('submission-predict');
		expect(run.player_id).toBe(id);
	});

	it('includes model and cost_usd in response', async () => {
		const id = mkPlayer();
		mockCallOpenRouter.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_LLM_OUTPUT), costUsd: 0.014, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });
		mockValidateTracks
			.mockResolvedValueOnce(FIXTURE_VALIDATED_CANDIDATES)
			.mockResolvedValueOnce(FIXTURE_VALIDATED_PREDICTION);

		const res = await POST(postEvt(id, VALID_BODY));
		const body = await res.json();
		expect(typeof body.model).toBe('string');
		expect(body.cost_usd).toBeCloseTo(0.014);
		expect(typeof body.latency_ms).toBe('number');
	});

	it('returns 404 for unknown player', async () => {
		await expect(POST(postEvt(99999, VALID_BODY))).rejects.toMatchObject({ status: 404 });
	});

	it('returns 400 for invalid playerId', async () => {
		await expect(POST(postEvt('abc', VALID_BODY))).rejects.toMatchObject({ status: 400 });
	});

	it('returns 400 when body is missing theme', async () => {
		const id = mkPlayer();
		await expect(POST(postEvt(id, {}))).rejects.toMatchObject({ status: 400 });
	});

	it('returns 400 when theme.name is missing', async () => {
		const id = mkPlayer();
		await expect(
			POST(postEvt(id, { theme: { description: 'ok' } })),
		).rejects.toMatchObject({ status: 400 });
	});

	it('returns 400 when theme.name is empty string', async () => {
		const id = mkPlayer();
		await expect(
			POST(postEvt(id, { theme: { name: '', description: 'ok' } })),
		).rejects.toMatchObject({ status: 400 });
	});

	it('returns 400 when theme.description is missing', async () => {
		const id = mkPlayer();
		await expect(
			POST(postEvt(id, { theme: { name: '80s' } })),
		).rejects.toMatchObject({ status: 400 });
	});

	it('returns 400 when body is not valid JSON', async () => {
		const id = mkPlayer();
		const badEvt = {
			params: { playerId: String(id) },
			request: { json: async () => { throw new SyntaxError('bad json'); } } as unknown as Request,
		} as unknown as Parameters<typeof POST>[0];
		await expect(POST(badEvt)).rejects.toMatchObject({ status: 400 });
	});

	it('returns 400 when body is not an object', async () => {
		const id = mkPlayer();
		await expect(POST(postEvt(id, 'just a string'))).rejects.toMatchObject({ status: 400 });
	});

	it('response includes generated_at and cache_hit fields', async () => {
		const id = mkPlayer();
		mockCallOpenRouter.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_LLM_OUTPUT), costUsd: 0.012, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });
		mockValidateTracks
			.mockResolvedValueOnce(FIXTURE_VALIDATED_CANDIDATES)
			.mockResolvedValueOnce(FIXTURE_VALIDATED_PREDICTION);

		const res = await POST(postEvt(id, VALID_BODY));
		const body = await res.json();
		expect(typeof body.generated_at).toBe('string');
		expect(body.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(body.cache_hit).toBe(false);
	});

	it('second identical POST returns cached result without a new LLM call', async () => {
		const id = mkPlayer();
		mockCallOpenRouter.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_LLM_OUTPUT), costUsd: 0.012, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });
		mockValidateTracks
			.mockResolvedValueOnce(FIXTURE_VALIDATED_CANDIDATES)
			.mockResolvedValueOnce(FIXTURE_VALIDATED_PREDICTION)
			// Second POST still validates Spotify (cache only skips LLM)
			.mockResolvedValueOnce(FIXTURE_VALIDATED_CANDIDATES)
			.mockResolvedValueOnce(FIXTURE_VALIDATED_PREDICTION);

		// First call — hits LLM, writes prediction_runs row
		await POST(postEvt(id, VALID_BODY));
		// Second call — same player + theme → cache hit, no LLM
		const res2 = await POST(postEvt(id, VALID_BODY));

		expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);
		const body2 = await res2.json();
		expect(body2.prediction.title).toBe('Pictures of You');
		expect(body2.cache_hit).toBe(true);
		expect(typeof body2.generated_at).toBe('string');
	});

	it('forceRegen:true bypasses cache and calls LLM again', async () => {
		const id = mkPlayer();
		mockCallOpenRouter
			.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_LLM_OUTPUT), costUsd: 0.012, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 })
			.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_LLM_OUTPUT), costUsd: 0.012, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });
		mockValidateTracks
			.mockResolvedValueOnce(FIXTURE_VALIDATED_CANDIDATES).mockResolvedValueOnce(FIXTURE_VALIDATED_PREDICTION)
			.mockResolvedValueOnce(FIXTURE_VALIDATED_CANDIDATES).mockResolvedValueOnce(FIXTURE_VALIDATED_PREDICTION);

		// First call — hits LLM
		await POST(postEvt(id, VALID_BODY));
		// Second call with forceRegen — bypasses cache, hits LLM again
		const res2 = await POST(postEvt(id, { ...VALID_BODY, forceRegen: true }));

		expect(mockCallOpenRouter).toHaveBeenCalledTimes(2);
		const body2 = await res2.json();
		expect(body2.cache_hit).toBe(false);
	});

	it('different theme skips cache and calls LLM', async () => {
		const id = mkPlayer();
		mockCallOpenRouter
			.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_LLM_OUTPUT), costUsd: 0.012, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 })
			.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_LLM_OUTPUT), costUsd: 0.012, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });
		mockValidateTracks
			.mockResolvedValueOnce(FIXTURE_VALIDATED_CANDIDATES).mockResolvedValueOnce(FIXTURE_VALIDATED_PREDICTION)
			.mockResolvedValueOnce(FIXTURE_VALIDATED_CANDIDATES).mockResolvedValueOnce(FIXTURE_VALIDATED_PREDICTION);

		await POST(postEvt(id, VALID_BODY));
		const res2 = await POST(postEvt(id, { theme: { name: 'Different Theme', description: 'A different one' } }));

		expect(mockCallOpenRouter).toHaveBeenCalledTimes(2);
		const body2 = await res2.json();
		expect(body2.cache_hit).toBe(false);
	});
});
