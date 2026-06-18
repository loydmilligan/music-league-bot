import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openLeagueDb } from '../../db/client.js';
import {
	generateProfile,
	spectrumTask,
	playlistTask,
	SpectrumSliceSchema,
	PlaylistSliceSchema,
	ProfileSliceSchema,
} from './profile.js';
import type Database from 'better-sqlite3';

vi.mock('../../digest/llm.js', () => ({
	callOpenRouter: vi.fn(),
}));

import { callOpenRouter } from '../../digest/llm.js';
const mockCallOpenRouter = vi.mocked(callOpenRouter);

// ── Fixtures ───────────────────────────────────────────────────────────────────

const FIXTURE_SPECTRUM = {
	polished_vs_raw: 64,
	sunny_vs_melancholy: 82,
	familiar_vs_obscure: 58,
};

const FIXTURE_PLAYLIST = {
	name: "Songs TestPlayer Hasn't Found Yet",
	nudge: "Two of these would win the next round and they know it.",
	tracks: [
		{ title: 'Glory Box', artist: 'Portishead', why: 'The trip-hop they keep circling.' },
		{ title: 'Teardrop', artist: 'Massive Attack', why: 'Reverb you could swim in.' },
		{ title: 'Blue Light', artist: 'Mazzy Star', why: 'Deeper cut from a band they already love.' },
	],
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function seedPlayer(db: Database.Database, name = 'TestPlayer'): number {
	db.prepare('INSERT INTO players (name) VALUES (?)').run(name);
	return (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
}

function seedFingerprint(db: Database.Database, playerId: number) {
	db.prepare('INSERT OR IGNORE INTO player_profiles (player_id) VALUES (?)').run(playerId);
	const fp = {
		signature_artists: ['Portishead', 'Mazzy Star', 'Cocteau Twins'],
		genres: ['trip-hop', 'dream pop', 'slowcore'],
		eras: ['90s', 'late 90s'],
		rewards: ['reverb', 'a great cry in 4/4'],
		punishes: ['bro-country', 'anything over 140 BPM'],
		summary: 'A player drawn to melancholy atmospheric sounds from the 90s.',
		confidence: 'medium',
	};
	db.prepare('UPDATE player_profiles SET taste_fingerprint = ? WHERE player_id = ?').run(
		JSON.stringify(fp),
		playerId,
	);
}

let db: Database.Database;
beforeEach(() => {
	db = openLeagueDb(':memory:');
	vi.clearAllMocks();
});

// ── Happy path ─────────────────────────────────────────────────────────────────

describe('generateProfile — happy path', () => {
	it('returns spectrum with 3 axes in range 0-100', async () => {
		const playerId = seedPlayer(db);
		seedFingerprint(db, playerId);

		mockCallOpenRouter
			.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_SPECTRUM), costUsd: 0.002, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 })
			.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_PLAYLIST), costUsd: 0.003, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		const result = await generateProfile(db, playerId);

		expect(result.spectrum).toHaveLength(3);
		for (const axis of result.spectrum) {
			expect(axis.value).toBeGreaterThanOrEqual(0);
			expect(axis.value).toBeLessThanOrEqual(100);
			expect(typeof axis.left).toBe('string');
			expect(typeof axis.right).toBe('string');
		}
	});

	it('spectrum uses the three fixed axis labels', async () => {
		const playerId = seedPlayer(db);
		seedFingerprint(db, playerId);

		mockCallOpenRouter
			.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_SPECTRUM), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 })
			.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_PLAYLIST), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		const { spectrum } = await generateProfile(db, playerId);

		expect(spectrum[0]).toMatchObject({ left: 'Polished', right: 'Raw' });
		expect(spectrum[1]).toMatchObject({ left: 'Sunny', right: 'Melancholy' });
		expect(spectrum[2]).toMatchObject({ left: 'Familiar', right: 'Obscure' });
	});

	it('spectrum values match the LLM output', async () => {
		const playerId = seedPlayer(db);

		mockCallOpenRouter
			.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_SPECTRUM), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 })
			.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_PLAYLIST), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		const { spectrum } = await generateProfile(db, playerId);

		expect(spectrum[0].value).toBe(64);
		expect(spectrum[1].value).toBe(82);
		expect(spectrum[2].value).toBe(58);
	});

	it('returns playlist with name, nudge, and 3 tracks-with-why', async () => {
		const playerId = seedPlayer(db);

		mockCallOpenRouter
			.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_SPECTRUM), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 })
			.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_PLAYLIST), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		const { playlist } = await generateProfile(db, playerId);

		expect(typeof playlist.name).toBe('string');
		expect(playlist.name.length).toBeGreaterThan(0);
		expect(typeof playlist.nudge).toBe('string');
		expect(playlist.nudge.length).toBeGreaterThan(0);
		expect(playlist.tracks).toHaveLength(3);
		for (const track of playlist.tracks) {
			expect(typeof track.title).toBe('string');
			expect(typeof track.artist).toBe('string');
			expect(typeof track.why).toBe('string');
			expect(track.why.length).toBeGreaterThan(0);
		}
	});

	it('logs two prediction_runs rows (one per task)', async () => {
		const playerId = seedPlayer(db);

		mockCallOpenRouter
			.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_SPECTRUM), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 })
			.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_PLAYLIST), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		await generateProfile(db, playerId);

		const rows = db.prepare('SELECT task_id FROM prediction_runs ORDER BY task_id').all() as {
			task_id: string;
		}[];
		const ids = rows.map((r) => r.task_id).sort();
		expect(ids).toContain(spectrumTask.id);
		expect(ids).toContain(playlistTask.id);
	});
});

// ── Lite member (thin fingerprint) ────────────────────────────────────────────

describe('generateProfile — lite member with thin fingerprint', () => {
	it('returns a coherent result with no submission history', async () => {
		const playerId = seedPlayer(db, 'LitePlayer');
		// No fingerprint, no submissions, no votes

		const thinSpectrum = { polished_vs_raw: 50, sunny_vs_melancholy: 48, familiar_vs_obscure: 52 };
		const thinPlaylist = {
			name: 'LitePlayer, A Place to Start',
			nudge: 'We don\'t have much to go on, but here\'s a door.',
			tracks: [
				{ title: 'Teardrop', artist: 'Massive Attack', why: 'A generous starting point.' },
			],
		};

		mockCallOpenRouter
			.mockResolvedValueOnce({ content: JSON.stringify(thinSpectrum), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 })
			.mockResolvedValueOnce({ content: JSON.stringify(thinPlaylist), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		const result = await generateProfile(db, playerId);

		// Spectrum is valid
		expect(result.spectrum).toHaveLength(3);
		for (const axis of result.spectrum) {
			expect(axis.value).toBeGreaterThanOrEqual(0);
			expect(axis.value).toBeLessThanOrEqual(100);
		}
		// Playlist is coherent — at minimum name + nudge + 1 track
		expect(result.playlist.name.length).toBeGreaterThan(0);
		expect(result.playlist.nudge.length).toBeGreaterThan(0);
		expect(result.playlist.tracks.length).toBeGreaterThanOrEqual(1);
		expect(typeof result.playlist.tracks[0].why).toBe('string');
	});

	it('still passes ProfileSliceSchema with a single track', async () => {
		const playerId = seedPlayer(db, 'LitePlayer2');

		const thinSpectrum = { polished_vs_raw: 50, sunny_vs_melancholy: 50, familiar_vs_obscure: 50 };
		const singleTrackPlaylist = {
			name: 'A Single Suggestion',
			nudge: 'Just one. See how it lands.',
			tracks: [
				{ title: 'Blue Light', artist: 'Mazzy Star', why: 'Minimal signal; maximum vibe.' },
			],
		};

		mockCallOpenRouter
			.mockResolvedValueOnce({ content: JSON.stringify(thinSpectrum), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 })
			.mockResolvedValueOnce({ content: JSON.stringify(singleTrackPlaylist), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		const result = await generateProfile(db, playerId);
		expect(() => ProfileSliceSchema.parse(result)).not.toThrow();
	});
});

// ── Schema validation ──────────────────────────────────────────────────────────

describe('SpectrumSliceSchema — validation', () => {
	it('accepts a valid 3-axis spectrum', () => {
		const valid = [
			{ left: 'Polished', right: 'Raw', value: 64 },
			{ left: 'Sunny', right: 'Melancholy', value: 82 },
			{ left: 'Familiar', right: 'Obscure', value: 58 },
		];
		expect(() => SpectrumSliceSchema.parse(valid)).not.toThrow();
	});

	it('rejects a value out of range', () => {
		const bad = [
			{ left: 'Polished', right: 'Raw', value: 150 },
			{ left: 'Sunny', right: 'Melancholy', value: 50 },
			{ left: 'Familiar', right: 'Obscure', value: 50 },
		];
		expect(() => SpectrumSliceSchema.parse(bad)).toThrow();
	});

	it('rejects fewer than 3 axes', () => {
		const bad = [{ left: 'Polished', right: 'Raw', value: 50 }];
		expect(() => SpectrumSliceSchema.parse(bad)).toThrow();
	});

	it('rejects a non-integer value', () => {
		const bad = [
			{ left: 'Polished', right: 'Raw', value: 50.5 },
			{ left: 'Sunny', right: 'Melancholy', value: 50 },
			{ left: 'Familiar', right: 'Obscure', value: 50 },
		];
		expect(() => SpectrumSliceSchema.parse(bad)).toThrow();
	});
});

describe('PlaylistSliceSchema — validation', () => {
	it('accepts a valid playlist with 3 tracks', () => {
		expect(() => PlaylistSliceSchema.parse(FIXTURE_PLAYLIST)).not.toThrow();
	});

	it('accepts a playlist with 1 track (lite member)', () => {
		const minimal = {
			name: 'One Track',
			nudge: 'Start here.',
			tracks: [{ title: 'Song', artist: 'Artist', why: 'Because.' }],
		};
		expect(() => PlaylistSliceSchema.parse(minimal)).not.toThrow();
	});

	it('rejects 0 tracks', () => {
		const bad = { name: 'Empty', nudge: 'Nothing.', tracks: [] };
		expect(() => PlaylistSliceSchema.parse(bad)).toThrow();
	});

	it('rejects more than 3 tracks', () => {
		const bad = {
			name: 'Too Many',
			nudge: 'Greedy.',
			tracks: [
				{ title: 'A', artist: 'X', why: 'w1' },
				{ title: 'B', artist: 'Y', why: 'w2' },
				{ title: 'C', artist: 'Z', why: 'w3' },
				{ title: 'D', artist: 'W', why: 'w4' },
			],
		};
		expect(() => PlaylistSliceSchema.parse(bad)).toThrow();
	});

	it('rejects a track missing why', () => {
		const bad = {
			name: 'Playlist',
			nudge: 'Nudge.',
			tracks: [{ title: 'Song', artist: 'Artist' }],
		};
		expect(() => PlaylistSliceSchema.parse(bad)).toThrow();
	});
});
