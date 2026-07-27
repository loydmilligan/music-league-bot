import { describe, it, expect } from 'vitest';
import type { Message } from './chatExport';
import { classify, extractLinks } from './chatLinks';

const T0 = Date.UTC(2026, 6, 11, 12, 0);
const msg = (sender: string, text: string, ts = T0): Message => ({
	sender, ts, text, edited: false, media: null, mentions: [],
});

describe('classify', () => {
	it('pulls the track id out of a Spotify link', () => {
		expect(classify('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'))
			.toEqual({ kind: 'spotify', trackId: '4cOdK2wGLETKBW3PvgPWqT', videoId: null });
	});

	it('handles Spotify locale-prefixed links', () => {
		expect(classify('https://open.spotify.com/intl-de/track/abc123').trackId).toBe('abc123');
	});

	it('treats a Spotify album as Spotify but not a track', () => {
		const c = classify('https://open.spotify.com/album/xyz');
		expect(c.kind).toBe('spotify');
		expect(c.trackId).toBeNull();
	});

	it('reads youtu.be and youtube.com watch links', () => {
		expect(classify('https://youtu.be/dQw4w9WgXcQ').videoId).toBe('dQw4w9WgXcQ');
		expect(classify('https://www.youtube.com/watch?v=dQw4w9WgXcQ').videoId).toBe('dQw4w9WgXcQ');
		expect(classify('https://m.youtube.com/watch?list=x&v=dQw4w9WgXcQ').videoId).toBe('dQw4w9WgXcQ');
	});

	it('reads YouTube Shorts, which are ordinary videos', () => {
		expect(classify('https://m.youtube.com/shorts/UMWf3z0Zo_o?ra=m').videoId).toBe('UMWf3z0Zo_o');
		expect(classify('https://youtube.com/shorts/BNG7ImuGyuE?is=x').videoId).toBe('BNG7ImuGyuE');
	});

	it('treats a YouTube Music playlist as YouTube but not a single video', () => {
		const c = classify('https://music.youtube.com/playlist?list=PLBmPJp4MneYw');
		expect(c.kind).toBe('youtube');
		expect(c.videoId).toBeNull();
	});

	it('ignores links that are not music', () => {
		expect(classify('https://app.musicleague.com/l/abc').kind).toBe('other');
	});
});

describe('extractLinks', () => {
	it('records who shared it and strips the URL from the context', () => {
		const links = extractLinks([
			msg('Matt Mariani', 'this one rules https://open.spotify.com/track/aaa listen'),
		]);
		expect(links).toHaveLength(1);
		expect(links[0].person).toBe('Matt Mariani');
		expect(links[0].context).toBe('this one rules listen');
	});

	it('drops trailing sentence punctuation from the URL', () => {
		const links = extractLinks([msg('Jimmy', 'try https://youtu.be/abc123def.')]);
		expect(links[0].url).toBe('https://youtu.be/abc123def');
		expect(links[0].videoId).toBe('abc123def');
	});

	it('credits a repeated track to whoever shared it first', () => {
		const links = extractLinks([
			msg('Jimmy', 'https://open.spotify.com/track/aaa', T0),
			msg('Matt Mariani', 'https://open.spotify.com/track/aaa again', T0 + 60_000),
		]);
		expect(links).toHaveLength(1);
		expect(links[0].person).toBe('Jimmy');
	});

	it('skips non-music links entirely', () => {
		expect(extractLinks([msg('Jimmy', 'see https://app.musicleague.com/l/x')])).toHaveLength(0);
	});

	it('finds multiple links in one message', () => {
		const links = extractLinks([
			msg('Jimmy', 'https://youtu.be/aaa111 and https://open.spotify.com/track/bbb'),
		]);
		expect(links).toHaveLength(2);
	});
});
