import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { listSources, PathGuardError, sourcesRoot } from '$lib/server/avatarFactory/paths.js';

export const GET: RequestHandler = async ({ url }) => {
	const rel = url.searchParams.get('path') ?? '';
	try {
		return json({ root: 'AVATAR_SOURCES_DIR', path: rel, entries: listSources(sourcesRoot(), rel) });
	} catch (e) {
		if (e instanceof PathGuardError) error(400, e.message);
		error(400, e instanceof Error ? e.message : 'error');
	}
};
