import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { isImageName, PathGuardError, resolveUnderRoot, sourcesRoot } from '$lib/server/avatarFactory/paths.js';

const MIME: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
};

export const GET: RequestHandler = async ({ params }) => {
	try {
		const abs = resolveUnderRoot(sourcesRoot(), params.path);
		if (!isImageName(abs)) error(400, 'not an image');
		const st = statSync(abs);
		if (!st.isFile()) error(404, 'not found');
		return new Response(readFileSync(abs), {
			headers: {
				'Content-Type': MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream',
				'Cache-Control': 'private, max-age=60',
			},
		});
	} catch (e) {
		if (e instanceof PathGuardError) error(400, e.message);
		error(404, 'not found');
	}
};
