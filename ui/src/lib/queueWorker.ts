import { getDb } from './db/client.js';
import { resolveYtmLink } from './songlink.js';

const RATE_MS = 6_000; // 10/min — one every 6s

interface PendingEntry {
	id: number;
	spotify_uri: string;
	title: string | null;
	artist: string | null;
}

export function startQueueWorker(): void {
	setInterval(async () => {
		const db = getDb();
		const next = db
			.prepare(
				`SELECT id, spotify_uri, title, artist FROM ytm_resolution_queue
				 WHERE status='pending' ORDER BY queued_at LIMIT 1`
			)
			.get() as PendingEntry | undefined;
		if (!next) return;
		db.prepare("UPDATE ytm_resolution_queue SET status='processing' WHERE id=?").run(next.id);
		try {
			const ytmUrl = await resolveYtmLink(next.spotify_uri);
			const now = new Date().toISOString();
			db.prepare(
				"UPDATE ytm_resolution_queue SET status='done', resolved_at=? WHERE id=?"
			).run(now, next.id);
			db.prepare(
				'INSERT OR REPLACE INTO ytm_link_cache (spotify_uri, ytm_url, resolved_at) VALUES (?, ?, ?)'
			).run(next.spotify_uri, ytmUrl, now);
		} catch (err) {
			db.prepare("UPDATE ytm_resolution_queue SET status='failed', error=? WHERE id=?").run(
				String(err),
				next.id
			);
		}
	}, RATE_MS);
}
