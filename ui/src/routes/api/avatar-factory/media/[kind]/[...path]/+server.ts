import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { mediaAbs } from '$lib/server/avatarFactory/actions.js';
import { PathGuardError } from '$lib/server/avatarFactory/paths.js';

const MIME: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
};

export const GET: RequestHandler = async ({ params }) => {
	const kind = params.kind === 'photos' ? 'photos' : params.kind === 'images' ? 'images' : null;
	if (!kind) error(404, 'not found');
	try {
		const abs = mediaAbs(kind, params.path);
		const st = statSync(abs);
		if (!st.isFile()) error(404, 'not found');
		const mime = MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream';
		return new Response(readFileSync(abs), {
			headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=60' },
		});
	} catch (e) {
		if (e instanceof PathGuardError) error(400, e.message);
		error(404, 'not found');
	}
};
