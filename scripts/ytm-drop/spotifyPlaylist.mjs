/**
 * Read a public Spotify playlist's tracks.
 *
 * Client-credentials (and even user refresh) currently 403 with
 * "Active premium subscription required for the owner of the app".
 * The embed page still exposes title/artist/uri/duration in __NEXT_DATA__,
 * so that is the fallback used for YTM drops and covers.
 */
const EMBED_UA =
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export function playlistIdFromUrl(playlistUrl) {
	return playlistUrl?.match(/playlist\/([A-Za-z0-9]+)/)?.[1] ?? null;
}

function mapApiTrack(t) {
	if (!t) return null;
	return {
		title: t.name,
		artists: t.artists?.map((a) => a.name).join(', ') ?? '',
		durationSec: Math.round((t.duration_ms ?? 0) / 1000),
		duration_ms: t.duration_ms ?? 0,
		spotify_uri: t.uri ?? null,
		album_art_url: t.album?.images?.[0]?.url ?? null,
	};
}

async function fromWebApi(id, env) {
	const tokRes = await fetch('https://accounts.spotify.com/api/token', {
		method: 'POST',
		headers: {
			Authorization: 'Basic ' + Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString('base64'),
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: 'grant_type=client_credentials',
	});
	if (!tokRes.ok) throw new Error(`Spotify token HTTP ${tokRes.status}`);
	const tok = (await tokRes.json()).access_token;
	const items = [];
	let url = `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100&fields=next,items(track(name,uri,duration_ms,artists(name),album(images)))`;
	while (url) {
		const res = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
		if (!res.ok) throw new Error(`Spotify playlist HTTP ${res.status}`);
		const body = await res.json();
		items.push(...(body.items ?? []));
		url = body.next;
	}
	return items.map((i) => mapApiTrack(i.track)).filter(Boolean);
}

async function fromEmbed(id) {
	const res = await fetch(`https://open.spotify.com/embed/playlist/${id}`, {
		headers: { 'user-agent': EMBED_UA, accept: 'text/html' },
	});
	if (!res.ok) throw new Error(`Spotify embed HTTP ${res.status}`);
	const html = await res.text();
	const m = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/);
	if (!m) throw new Error('Spotify embed missing __NEXT_DATA__');
	const trackList = JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity?.trackList;
	if (!Array.isArray(trackList) || !trackList.length) throw new Error('Spotify embed has no tracks');
	return trackList.map((t) => ({
		title: t.title ?? '',
		artists: t.subtitle ?? '',
		durationSec: Math.round((t.duration ?? 0) / 1000),
		duration_ms: t.duration ?? 0,
		spotify_uri: t.uri ?? null,
		album_art_url: null,
	}));
}

async function itunesArtwork(title, artists) {
	const q = new URL('https://itunes.apple.com/search');
	q.searchParams.set('term', `${title} ${artists}`);
	q.searchParams.set('entity', 'song');
	q.searchParams.set('limit', '1');
	const res = await fetch(q, { headers: { accept: 'application/json' } });
	if (!res.ok) return null;
	const art = (await res.json()).results?.[0]?.artworkUrl100;
	return art ? art.replace('100x100bb', '600x600bb') : null;
}

/**
 * @param {string} playlistUrl
 * @param {{ SPOTIFY_CLIENT_ID?: string, SPOTIFY_CLIENT_SECRET?: string }} env
 * @param {{ fillArtwork?: boolean }} [opts]
 */
export async function fetchSpotifyPlaylistTracks(playlistUrl, env, opts = {}) {
	const id = playlistIdFromUrl(playlistUrl);
	if (!id) throw new Error(`no usable Spotify playlist URL (${playlistUrl})`);
	let tracks;
	let source = 'api';
	try {
		tracks = await fromWebApi(id, env);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.log(`[warn] Spotify Web API failed (${msg}); falling back to public embed`);
		tracks = await fromEmbed(id);
		source = 'embed';
	}
	if (opts.fillArtwork) {
		for (const t of tracks) {
			if (t.album_art_url) continue;
			t.album_art_url = await itunesArtwork(t.title, t.artists);
			await new Promise((r) => setTimeout(r, 200));
		}
	}
	console.log(`[info] ${tracks.length} tracks from Spotify playlist (${source})`);
	return tracks;
}
