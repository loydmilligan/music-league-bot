import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { getDb } from '$lib/db/client.js';
import { getTasteSettings } from '$lib/db/settings.js';

const DIGESTS_DIR = process.env.DIGESTS_DIR ?? 'digests';

const TasteSettingsSchema = z.object({
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

	// Persist to settings table
	db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('taste_settings', ?)").run(
		JSON.stringify(settings),
	);

	// Patch every published site's read_model
	const sites = db
		.prepare('SELECT league_id, slug FROM dashboard_sites')
		.all() as { league_id: number; slug: string }[];

	let patched = 0;
	for (const site of sites) {
		// Patch the file on disk
		const rmPath = join(DIGESTS_DIR, site.slug, 'read_model.json');
		try {
			const raw = await readFile(rmPath, 'utf8');
			const rm = JSON.parse(raw) as Record<string, unknown>;
			if (rm.taste && typeof rm.taste === 'object') {
				(rm.taste as Record<string, unknown>).settings = settings;
			}
			await writeFile(rmPath, JSON.stringify(rm), 'utf8');
		} catch {
			// File may not exist yet — skip silently
		}

		// Patch the DB row
		try {
			const row = db
				.prepare('SELECT read_model FROM dashboard_sites WHERE league_id = ?')
				.get(site.league_id) as { read_model: string } | undefined;
			if (row?.read_model) {
				const rm = JSON.parse(row.read_model) as Record<string, unknown>;
				if (rm.taste && typeof rm.taste === 'object') {
					(rm.taste as Record<string, unknown>).settings = settings;
				}
				db.prepare('UPDATE dashboard_sites SET read_model = ? WHERE league_id = ?').run(
					JSON.stringify(rm),
					site.league_id,
				);
				patched++;
			}
		} catch {
			// Skip silently if the read_model is malformed
		}
	}

	return json({ ok: true, patched });
};
