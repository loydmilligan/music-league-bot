const ODESLI = 'https://api.song.link/v1-alpha.1/links';

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
