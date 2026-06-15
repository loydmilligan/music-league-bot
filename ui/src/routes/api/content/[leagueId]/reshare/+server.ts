import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import type { ReadModel } from '$lib/dashboard/buildReadModel.js';

const B_SIDE_BASE = (process.env.PUBLIC_DIGEST_BASE_URL ?? 'https://digest.mattmariani.com').replace(/\/+$/, '');
const VALID_MODES = new Set(['card', 'link', 'silent']);

// POST /api/content/:leagueId/reshare
// Body: { mode: 'card'|'link'|'silent' }
// Produces the announcement payload. card/link provide copy-ready text; silent is a no-op.
// The actual WhatsApp send is client-side (deep link or clipboard copy).
export const POST: RequestHandler = async ({ params, request }) => {
	const leagueId = Number(params.leagueId);
	if (!Number.isInteger(leagueId) || leagueId <= 0) throw error(400, 'invalid leagueId');

	let body: { mode?: string };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}

	const mode = VALID_MODES.has(body.mode ?? '') ? body.mode! : 'card';

	const db = getDb();

	const league = db.prepare('SELECT id, name FROM leagues WHERE id = ?').get(leagueId) as
		| { id: number; name: string }
		| undefined;
	if (!league) throw error(404, `league ${leagueId} not found`);

	const site = db
		.prepare('SELECT slug, read_model, archived_rounds FROM dashboard_sites WHERE league_id = ?')
		.get(leagueId) as
		| { slug: string; read_model: string; archived_rounds: string }
		| undefined;
	if (!site) throw error(404, `league ${leagueId} has no published b-side`);

	if (mode === 'silent') {
		return json({ ok: true, mode: 'silent', url: `${B_SIDE_BASE}/${site.slug}` });
	}

	const readModel = JSON.parse(site.read_model) as ReadModel;
	const url = `${B_SIDE_BASE}/${site.slug}`;

	// Most recent archived round
	const latestArchiveEntry = readModel.archive[0]; // archive is newest-first
	const round = latestArchiveEntry?.n ?? 1;
	const theme = latestArchiveEntry?.theme ?? '';
	const headline = 'NEW IN THE ARCHIVE';
	const blurb = `Round ${round} just landed — "${theme}"${latestArchiveEntry?.winnerSong ? `, won by ${latestArchiveEntry.submitter}` : ''}. The archive and season stats are updated.`;

	const cardText = `the b/side\n${headline}\nRound ${round} — "${theme}"\n${blurb}\n🔒 ${url}`;

	return json({
		ok: true,
		mode,
		url,
		headline,
		blurb,
		round,
		theme,
		league: league.name,
		cardText: mode === 'card' ? cardText : undefined,
		linkText: url,
	});
};
