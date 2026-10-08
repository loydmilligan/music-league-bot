import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { requirePortalAdmin } from '$lib/portalAdmin/api.js';
import { SECTION_IDS } from '$lib/portalAdmin/config.js';
import { enqueueSectionRun } from '$lib/portalAdmin/runner.js';

export const POST: RequestHandler = async (event) => {
	const { db, leagueId } = requirePortalAdmin(event);
	const body = (await event.request.json().catch(() => null)) as { section?: unknown } | null;
	const section = body?.section;
	if (typeof section !== 'string' || !(SECTION_IDS as readonly string[]).includes(section)) {
		throw error(400, `section must be one of: ${SECTION_IDS.join(', ')}`);
	}
	return json(enqueueSectionRun(db, leagueId, section));
};