import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SINTEL_DIR = '/home/loydmilligan/Projects/sintel';

export interface AudioFeatures {
	spotify_uri: string;
	bpm: number;
	key: string;
	scale: 'major' | 'minor';
	energy: number;
	duration_s: number;
}

export interface TrackAnalysis extends AudioFeatures {
	track_id: string;
	artist: string;
	name: string;
}

function spotifyUriToUrl(uri: string): string {
	const id = uri.split(':').at(-1);
	return `https://open.spotify.com/track/${id}`;
}

function spotifyUrlToUri(url: string): string {
	const id = url.split('/track/').at(-1)?.split('?')[0];
	return `spotify:track:${id}`;
}

export async function analyzeTrack(spotifyUri: string): Promise<AudioFeatures> {
	const url = spotifyUriToUrl(spotifyUri);
	const { stdout } = await execFileAsync(
		'uv',
		['run', 'sintel', 'analyze', url, '--quiet'],
		{ cwd: SINTEL_DIR, timeout: 120_000 },
	);
	const raw = JSON.parse(stdout) as {
		spotify_url: string; bpm: number; key: string; scale: string; energy: number; duration_s: number;
	};
	return {
		spotify_uri: spotifyUri,
		bpm: raw.bpm,
		key: raw.key,
		scale: raw.scale as 'major' | 'minor',
		energy: raw.energy,
		duration_s: raw.duration_s,
	};
}

export async function analyzePlaylist(playlistUrl: string): Promise<TrackAnalysis[]> {
	const { stdout } = await execFileAsync(
		'uv',
		['run', 'sintel', 'analyze-playlist', playlistUrl, '--quiet'],
		{ cwd: SINTEL_DIR, timeout: 600_000 },
	);
	const raw = JSON.parse(stdout) as Array<{
		track_id: string; artist: string; name: string;
		spotify_url: string; bpm: number; key: string; scale: string; energy: number; duration_s: number;
	}>;
	return raw.map((r) => ({
		track_id: r.track_id,
		artist: r.artist,
		name: r.name,
		spotify_uri: spotifyUrlToUri(r.spotify_url),
		bpm: r.bpm,
		key: r.key,
		scale: r.scale as 'major' | 'minor',
		energy: r.energy,
		duration_s: r.duration_s,
	}));
}
