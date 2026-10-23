import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import BallotSongs from './BallotSongs.svelte';
import type { Digest2Ballot, BallotSong } from './ballot.js';

const song = (rank: number, comments: string[]): BallotSong => ({
	rank,
	title: `Song ${rank}`,
	artist: 'Artist',
	submitter: 'Sub',
	submitterAvatar: null,
	net: 4,
	rawNet: 4,
	ups: 2,
	rawUps: 2,
	downs: 0,
	forfeited: false,
	note: null,
	votes: comments.map((c, i) => ({ voter: `Voter ${i}`, avatar: null, pts: 2, comment: c })),
});

const ballot: Digest2Ballot = {
	lede: null,
	closer: null,
	songs: [song(1, ['first take', 'second take']), song(2, [])],
	villainRank: null,
	grid: [],
	gridCaption: null,
	avatarCss: '',
};

describe('How It Played comments', () => {
	const { body } = render(BallotSongs, { props: { ballot } });

	it('render collapsed behind a real toggle button', () => {
		const btn = body.match(/<button[^>]*class="qs-toggle[^"]*"[^>]*>/)?.[0] ?? '';
		expect(btn).toContain('aria-expanded="false"');
		const id = btn.match(/aria-controls="([^"]+)"/)?.[1];
		expect(id).toBeTruthy();
		// The comments stay in the markup but hidden until the button is tapped.
		expect(body).toMatch(new RegExp(`<div[^>]*id="${id}"[^>]*hidden`));
		expect(body).toContain('first take');
		expect(body).toMatch(/Show 2 comments/);
	});

	it('songs without comments get no toggle', () => {
		expect(body.match(/qs-toggle/g)?.length).toBe(1);
	});
});
