const ODESLI = 'https://api.song.link/v1-alpha.1/links';

// Reverse direction of resolveYtmLink: given a music.youtube.com URL (track,
// album, or playlist), ask Songlink for the matching Spotify URL. Returns null
// when Songlink has no Spotify match or the API call fails — callers must
// surface the distinction to their users.
export async function resolveSpotifyFromYtm(ytmUrl: string): Promise<{ url: string } | { error: string }> {
	try {
		const res = await fetch(`${ODESLI}?url=${encodeURIComponent(ytmUrl)}`);
		if (!res.ok) {
			return { error: res.status === 404 ? 'Songlink has no record of this URL' : `Songlink API ${res.status}` };
		}
		const data = (await res.json()) as { linksByPlatform?: { spotify?: { url?: string } } };
		const spotifyUrl = data.linksByPlatform?.spotify?.url;
		if (!spotifyUrl) return { error: 'no Spotify match via Songlink' };
		return { url: spotifyUrl };
	} catch (e) {
		return { error: e instanceof Error ? e.message : 'Songlink network error' };
	}
}

export async function resolveYtmLink(spotifyUri: string): Promise<string | null> {
	const url = spotifyUri.startsWith('spotify:track:')
		? `https://open.spotify.com/track/${spotifyUri.slice('spotify:track:'.length)}`
		: spotifyUri;
	try {
		const res = await fetch(`${ODESLI}?url=${encodeURIComponent(url)}`);
		if (!res.ok) return null;
		const data = (await res.json()) as { linksByPlatform?: { youtubeMusic?: { url?: string } } };
		return data.linksByPlatform?.youtubeMusic?.url ?? null;
	} catch {
		return null;
	}
}
