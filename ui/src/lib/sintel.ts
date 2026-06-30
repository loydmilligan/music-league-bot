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
		// killSignal:'SIGKILL' — the default SIGTERM can be caught/ignored by the
		// sintel/uv process (or a Python grandchild), in which case the child
		// never exits, execFile's promise never settles, and the caller's await
		// hangs forever — wedging the audio job in 'processing'. SIGKILL can't be
		// trapped, so the timeout always terminates the process and rejects.
		{ cwd: SINTEL_DIR, timeout: 120_000, killSignal: 'SIGKILL' },
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
		// killSignal:'SIGKILL' — same latent hang as analyzeTrack: a SIGTERM the
		// child ignores would leave this promise pending past the timeout.
		{ cwd: SINTEL_DIR, timeout: 600_000, killSignal: 'SIGKILL' },
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
