#!/usr/bin/env node
/**
 * create-boarz-tape-playlist — build a public Spotify playlist from every
 * track shared in the Boarz II Men group chat, in the order it was shared.
 *
 * Idempotent: reuses the playlist recorded in chat-playlist.json if it still
 * exists, replacing its tracks rather than creating duplicates.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(UI, '..');
const SONGS = path.join(UI, 'scripts/chat-songs.json');
const STATE = path.join(UI, 'scripts/chat-playlist.json');

for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
	const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
	if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

// Playlist writes need a user-scoped token, so this uses the refresh token
// (playlist-modify-public), not client credentials.
async function userToken() {
	const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret, SPOTIFY_REFRESH_TOKEN: refresh } = process.env;
	if (!refresh) throw new Error('SPOTIFY_REFRESH_TOKEN missing — run `npm run spotify-auth`');
	const res = await fetch('https://accounts.spotify.com/api/token', {
		method: 'POST',
		headers: {
			Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
	});
	if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
	return (await res.json()).access_token;
}

const token = await userToken();
const api = async (p, opts = {}) => {
	const res = await fetch(p.startsWith('http') ? p : `https://api.spotify.com/v1${p}`, {
		...opts,
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
	});
	if (!res.ok) throw new Error(`${opts.method || 'GET'} ${p} → ${res.status} ${await res.text()}`);
	return res.status === 204 ? null : res.json();
};

const data = JSON.parse(fs.readFileSync(SONGS, 'utf8'));
const { links, podium = [], round = 'Round 1' } = data;

// Round 1's podium opens the tape, then everything shared in the chat in the
// order it was posted. Dedupe so a podium track shared in chat isn't listed twice.
const seen = new Set();
const uris = [];
for (const uri of [...podium.map((p) => p.uri), ...links.filter((l) => l.track?.uri).map((l) => l.track.uri)]) {
	if (!uri || seen.has(uri)) continue;
	seen.add(uri);
	uris.push(uri);
}
if (!uris.length) throw new Error('No resolved tracks — run resolve-chat-songs.mjs first');

const me = await api('/me');

let playlist = null;
if (fs.existsSync(STATE)) {
	const prev = JSON.parse(fs.readFileSync(STATE, 'utf8'));
	try {
		playlist = await api(`/playlists/${prev.id}`);
		console.error(`[info] reusing existing playlist ${prev.id}`);
	} catch {
		console.error('[info] recorded playlist is gone; creating a new one');
	}
}

const DESCRIPTION =
	`The top 3 from "${round}", then every song shared in the Boarz II Men group chat ` +
	'in the order it was posted. Assembled from the chat history for The Boarz Tape.';

if (!playlist) {
	playlist = await api(`/users/${me.id}/playlists`, {
		method: 'POST',
		body: JSON.stringify({ name: 'The Boarz Tape — Side A', public: true, description: DESCRIPTION }),
	});
}

// Replace rather than append, so re-running never duplicates tracks.
await api(`/playlists/${playlist.id}/tracks`, {
	method: 'PUT',
	body: JSON.stringify({ uris: uris.slice(0, 100) }),
});

const url = playlist.external_urls?.spotify ?? `https://open.spotify.com/playlist/${playlist.id}`;
fs.writeFileSync(STATE, JSON.stringify({ id: playlist.id, url, tracks: uris.length }, null, 2));

console.error(`[ok] ${uris.length} tracks → ${url}`);
