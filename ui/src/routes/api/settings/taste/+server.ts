import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { getDb } from '$lib/db/client.js';
import { getTasteSettings } from '$lib/db/settings.js';

const DIGESTS_DIR = process.env.DIGESTS_DIR ?? 'digests';

export const TasteSettingsSchema = z.object({
	signal: z.enum(['all', 'subs', 'top', 'frac']),
	votePct: z.number().min(0).max(25),
	negatives: z.boolean(),
	dnPct: z.number().min(0).max(150),
	lyrWeight: z.number().min(0).max(1),
	spread: z.number().min(1).max(1.6),
	scopeAll: z.boolean(),
	showLabels: z.boolean(),
	showKey: z.boolean(),
	showRead: z.boolean(),
	showChips: z.boolean(),
	showLeagueAvg: z.boolean(),
	palette: z.enum(['neon', 'cool', 'spectrum']),
	lineStyle: z.enum(['strand', 'solid', 'none']),
	nodeStyle: z.enum(['glow', 'dot', 'none']),
	order: z.enum(['alt', 'raw', 'lyric-last', 'lyric-first']),
	band: z.boolean(),
	bandOpacity: z.number().min(0).max(0.3),
	amplitude: z.number().min(0.6).max(2.2),
});

export const GET: RequestHandler = async () => {
	const db = getDb();
	return json(getTasteSettings(db));
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body) throw error(400, 'JSON body required');

	const parsed = TasteSettingsSchema.safeParse(body);
	if (!parsed.success) throw error(400, parsed.error.message);

	const settings = parsed.data;
	const db = getDb();

	const sites = db
		.prepare('SELECT league_id, slug FROM dashboard_sites')
		.all() as { league_id: number; slug: string }[];

	// Phase 1: Pre-compute new read_model JSON strings for disk and DB (outside transaction).
	// Reading disk + DB here so the transaction is pure writes with no I/O.
	type SiteOp = {
		site: { league_id: number; slug: string };
		rmPath: string;
		newDiskJson: string | null;
		newDbJson: string | null;
		diskWritten: boolean;
		dbUpdated: boolean;
	};

	const siteOps: SiteOp[] = [];

	for (const site of sites) {
		const rmPath = join(DIGESTS_DIR, site.slug, 'read_model.json');
		let newDiskJson: string | null = null;
		let newDbJson: string | null = null;

		// Read disk file and apply taste patch
		try {
			const raw = await readFile(rmPath, 'utf8');
			const rm = JSON.parse(raw) as Record<string, unknown>;
			// I-1: upsert rm.taste when absent so sites without an existing .taste key get patched
			rm.taste = rm.taste && typeof rm.taste === 'object' ? rm.taste : {};
			(rm.taste as Record<string, unknown>).settings = settings;
			newDiskJson = JSON.stringify(rm);
		} catch {
			// File may not exist yet — skip silently
		}

		// Read DB read_model column and apply taste patch
		const row = db
			.prepare('SELECT read_model FROM dashboard_sites WHERE league_id = ?')
			.get(site.league_id) as { read_model: string } | undefined;
		if (row?.read_model) {
			try {
				const rm = JSON.parse(row.read_model) as Record<string, unknown>;
				// I-1: upsert rm.taste when absent
				rm.taste = rm.taste && typeof rm.taste === 'object' ? rm.taste : {};
				(rm.taste as Record<string, unknown>).settings = settings;
				newDbJson = JSON.stringify(rm);
			} catch {
				// Malformed read_model — skip silently
			}
		}

		siteOps.push({ site, rmPath, newDiskJson, newDbJson, diskWritten: false, dbUpdated: false });
	}

	// Phase 2: I-3 — atomic DB writes: settings INSERT + all site read_model UPDATEs in one
	// transaction so a mid-loop crash never leaves the DB half-updated.
	db.transaction(() => {
		db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('taste_settings', ?)").run(
			JSON.stringify(settings),
		);
		for (const op of siteOps) {
			if (op.newDbJson !== null) {
				db.prepare('UPDATE dashboard_sites SET read_model = ? WHERE league_id = ?').run(
					op.newDbJson,
					op.site.league_id,
				);
				op.dbUpdated = true;
			}
		}
	})();

	// Phase 3: Disk writes — filesystem isn't transactional, keep per-site try/catch.
	for (const op of siteOps) {
		if (op.newDiskJson !== null) {
			try {
				await writeFile(op.rmPath, op.newDiskJson, 'utf8');
				op.diskWritten = true;
			} catch {
				// Write failed — do not count this site as patched
			}
		}
	}

	// I-2: Count a site as patched only when BOTH its disk write AND its DB update succeeded.
	const patched = siteOps.filter((op) => op.dbUpdated && op.diskWritten).length;

	return json({ ok: true, patched });
};
