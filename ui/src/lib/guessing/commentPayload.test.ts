import { describe, it, expect } from 'vitest';
import { seedRound } from './fixtures.js';
import { applyComments } from './commentFetch.js';
import { toCommentPayload, countComments } from './commentPayload.js';

describe('toCommentPayload', () => {
	// DISCRIMINATING: the key names differ between producer and consumer. An
	// implementation that passes the payload straight through (or reads
	// `spotifyUri` off the raw song) yields undefined uris and fails here.
	it('renames spotify_uri → spotifyUri and drops the producer-only fields', () => {
		const out = toCommentPayload({
			ok: true,
			league_id: 'a'.repeat(32),
			round_id: 'b'.repeat(32),
			songs: [
				{
					spotify_uri: 'spotify:track:1',
					title: 'A Song',
					artist: 'A Band',
					comment: 'nice one',
					is_mine: false
				}
			],
			counts: { songs: 1, comments: 1 }
		});
		expect(out).toEqual({ ok: true, songs: [{ spotifyUri: 'spotify:track:1', comment: 'nice one' }] });
	});

	// DISCRIMINATING: the real ballot payload is mostly nulls (the producer emits
	// EVERY song, commented or not). Those nulls must survive as nulls so
	// applyComments' COALESCE can protect existing comments.
	it('keeps null comments null and normalises empty strings to null', () => {
		const out = toCommentPayload({
			ok: true,
			songs: [
				{ spotify_uri: 'spotify:track:1', comment: null },
				{ spotify_uri: 'spotify:track:2', comment: '' },
				{ spotify_uri: 'spotify:track:3', comment: 'real' }
			]
		});
		expect(out.songs).toEqual([
			{ spotifyUri: 'spotify:track:1', comment: null },
			{ spotifyUri: 'spotify:track:2', comment: null },
			{ spotifyUri: 'spotify:track:3', comment: 'real' }
		]);
	});

	it('passes a failed fetch through unchanged', () => {
		const out = toCommentPayload({ ok: false, error: 'Music League session expired.' });
		expect(out).toEqual({ ok: false, error: 'Music League session expired.' });
	});

	it('supplies an error when a failed fetch carries none', () => {
		expect(toCommentPayload({ ok: false }).error).toBe('comment fetch failed');
		expect(toCommentPayload(null).ok).toBe(false);
		expect(toCommentPayload('not json').ok).toBe(false);
	});

	// DISCRIMINATING: skipping the bad song instead of failing would report
	// "1 updated" on a payload whose shape has drifted, hiding the drift.
	it('fails the whole payload when a song has no spotify_uri', () => {
		const out = toCommentPayload({
			ok: true,
			songs: [{ spotify_uri: 'spotify:track:1', comment: 'x' }, { comment: 'y' }]
		});
		expect(out.ok).toBe(false);
		expect(out.error).toMatch(/no spotify_uri/);
		expect(out.songs).toBeUndefined();
	});

	it('fails when ok is true but songs is missing', () => {
		const out = toCommentPayload({ ok: true });
		expect(out.ok).toBe(false);
		expect(out.error).toMatch(/no songs array/);
	});

	it('counts commented songs', () => {
		expect(
			countComments([
				{ spotifyUri: 'a', comment: null },
				{ spotifyUri: 'b', comment: 'x' }
			])
		).toBe(1);
	});
});

describe('toCommentPayload → applyComments', () => {
	// The whole point of the wire: a converted payload must actually MATCH rows.
	// This is the test that would have caught the snake/camel gap.
	it('applies to the real submissions rows with nothing unmatched', () => {
		const { db, songs } = seedRound({ songCount: 3 });
		const payload = toCommentPayload({
			ok: true,
			songs: [
				{ spotify_uri: songs[0], comment: null, is_mine: true },
				{ spotify_uri: songs[1], comment: 'from the ballot', is_mine: false },
				{ spotify_uri: songs[2], comment: null, is_mine: false }
			]
		});
		const res = applyComments(db, 1, payload, '2026-09-01T00:00:00Z');
		expect(res.unmatched).toEqual([]);
		expect(res.updated).toBe(3);
		const row = db
			.prepare('SELECT comment FROM ml_submissions WHERE round_id = 1 AND spotify_uri = ?')
			.get(songs[1]) as { comment: string | null };
		expect(row.comment).toBe('from the ballot');
	});
});
