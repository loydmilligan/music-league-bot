import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { PopularityBodySchema } from './schema.js';

// POST /api/songs/[spotifyUri]/popularity
// Body: { popularity_proxy: number } (0–100)
// Sets popularity_proxy and popularity_source='manual' for the given spotify_uri.
// UPDATE-first: if the row doesn't exist, INSERT with title/artist from ml_submissions.
export const POST: RequestHandler = async ({ params, request }) => {
	const body = await request.json().catch(() => null);
	const parsed = PopularityBodySchema.safeParse(body);
	if (!parsed.success) throw error(400, parsed.error.message);

	const uri = decodeURIComponent(params.spotifyUri!);
	const proxy = Math.round(parsed.data.popularity_proxy);
	const db = getDb();

	const upd = db
		.prepare(
			"UPDATE song_popularity SET popularity_proxy=?, popularity_source='manual' WHERE spotify_uri=?"
		)
		.run(proxy, uri);

	if (upd.changes === 0) {
		const s = db
			.prepare('SELECT title, artists FROM ml_submissions WHERE spotify_uri=? LIMIT 1')
			.get(uri) as { title?: string; artists?: string } | undefined;
		db.prepare(
			"INSERT INTO song_popularity (spotify_uri, title, artist, popularity_proxy, popularity_source, fetched_at) VALUES (?,?,?,?,'manual',?)"
		).run(uri, s?.title ?? '', s?.artists ?? '', proxy, new Date().toISOString());
	}

	return json({ ok: true });
};

// DELETE /api/songs/[spotifyUri]/popularity
// Clears popularity_source (→ NULL) so the next recompute resets the proxy.
export const DELETE: RequestHandler = async ({ params }) => {
	const uri = decodeURIComponent(params.spotifyUri!);
	const db = getDb();
	db.prepare('UPDATE song_popularity SET popularity_source = NULL WHERE spotify_uri = ?').run(uri);
	return json({ ok: true });
};
