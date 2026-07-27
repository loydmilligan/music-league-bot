/**
 * chatLinks — pull every music link out of the chat, with who shared it.
 *
 * Pure: URL extraction and classification only. Resolving a Spotify id to a
 * track name is I/O and belongs to the caller.
 */

import type { Message } from './chatExport';
import { resolveSender } from './chatIdentity';

export type LinkKind = 'spotify' | 'youtube' | 'other';

export interface SharedLink {
	url: string;
	kind: LinkKind;
	/** Spotify track id, when the link is a track (not an album or playlist). */
	trackId: string | null;
	/** YouTube video id. */
	videoId: string | null;
	person: string;
	ts: number;
	/** The message it arrived in, with the URL removed. */
	context: string;
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;

/** Trailing punctuation is sentence structure, not part of the URL. */
function trimUrl(u: string): string {
	return u.replace(/[.,;:!?)\]}'"]+$/, '');
}

export function classify(url: string): { kind: LinkKind; trackId: string | null; videoId: string | null } {
	const spotifyTrack = url.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/([A-Za-z0-9]+)/);
	if (spotifyTrack) return { kind: 'spotify', trackId: spotifyTrack[1], videoId: null };

	const spotifyUri = url.match(/spotify:track:([A-Za-z0-9]+)/);
	if (spotifyUri) return { kind: 'spotify', trackId: spotifyUri[1], videoId: null };

	// Albums and playlists are Spotify links but not single tracks.
	if (/open\.spotify\.com\//.test(url)) return { kind: 'spotify', trackId: null, videoId: null };

	const yt =
		url.match(/(?:youtube\.com|m\.youtube\.com|music\.youtube\.com)\/watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]{6,})/) ||
		url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/) ||
		// Shorts are ordinary videos and resolve through the same oEmbed endpoint.
		url.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/);
	if (yt) return { kind: 'youtube', trackId: null, videoId: yt[1] };
	if (/youtube\.com|youtu\.be/.test(url)) return { kind: 'youtube', trackId: null, videoId: null };

	return { kind: 'other', trackId: null, videoId: null };
}

export function extractLinks(messages: Message[]): SharedLink[] {
	const out: SharedLink[] = [];
	const seen = new Set<string>();

	for (const m of messages.slice().sort((a, b) => a.ts - b.ts)) {
		const person = resolveSender(m.sender);
		if (!person) continue;

		const found = m.text.match(URL_RE);
		if (!found) continue;

		const context = m.text.replace(URL_RE, ' ').replace(/\s+/g, ' ').trim();

		for (const raw of found) {
			const url = trimUrl(raw);
			const { kind, trackId, videoId } = classify(url);
			if (kind === 'other') continue;

			// The same track pasted twice is one song, credited to whoever was first.
			const key = trackId ? 'sp:' + trackId : videoId ? 'yt:' + videoId : 'url:' + url;
			if (seen.has(key)) continue;
			seen.add(key);

			out.push({ url, kind, trackId, videoId, person: person.name, ts: m.ts, context });
		}
	}
	return out;
}
