import type Database from 'better-sqlite3';
import type { YtmQueueEntry } from '../types.js';

export function enqueueYtm(
	db: Database.Database,
	spotifyUri: string,
	title?: string,
	artist?: string
): void {
	db.prepare(
		`INSERT OR IGNORE INTO ytm_resolution_queue (spotify_uri, title, artist, queued_at)
		 VALUES (?, ?, ?, ?)`
	).run(spotifyUri, title ?? null, artist ?? null, new Date().toISOString());
}

export function getQueueStatus(db: Database.Database) {
	const pending = (
		db.prepare("SELECT COUNT(*) n FROM ytm_resolution_queue WHERE status='pending'").get() as {
			n: number;
		}
	).n;
	const processing = (
		db.prepare("SELECT COUNT(*) n FROM ytm_resolution_queue WHERE status='processing'").get() as {
			n: number;
		}
	).n;
	const done24h = (
		db
			.prepare(
				`SELECT COUNT(*) n FROM ytm_resolution_queue
				 WHERE status='done' AND resolved_at > datetime('now','-1 day')`
			)
			.get() as { n: number }
	).n;
	const failures = db
		.prepare(
			"SELECT * FROM ytm_resolution_queue WHERE status='failed' ORDER BY queued_at DESC"
		)
		.all() as YtmQueueEntry[];
	return {
		pending,
		processing,
		done24h,
		estimatedMinutes: Math.ceil((pending + processing) / 10),
		failures
	};
}

export function retryFailed(db: Database.Database, id: number): void {
	db.prepare("UPDATE ytm_resolution_queue SET status='pending', error=NULL WHERE id=?").run(id);
}
