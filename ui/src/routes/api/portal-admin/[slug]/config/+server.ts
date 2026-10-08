import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { requirePortalAdmin } from '$lib/portalAdmin/api.js';
import { ConfigError, parseConfig } from '$lib/portalAdmin/config.js';
import { readConfig, writeConfig } from '$lib/portalAdmin/store.js';
import type { PortalAdminConfig } from '$lib/portalAdmin/config.js';

export const GET: RequestHandler = async (event) => {
	const { db, leagueId } = requirePortalAdmin(event);
	return json(readConfig(db, leagueId));
};

export const PUT: RequestHandler = async (event) => {
	const { db, leagueId } = requirePortalAdmin(event);
	const body = (await event.request.json().catch(() => null)) as PortalAdminConfig | null;
	if (!body || typeof body !== 'object' || typeof body.sections !== 'object') {
		throw error(400, 'body must be a PortalAdminConfig object');
	}
	try {
		const config = parseConfig(body);
		writeConfig(db, leagueId, config);
		return json(config);
	} catch (e) {
		if (e instanceof ConfigError) throw error(400, e.message);
		throw e;
	}
};