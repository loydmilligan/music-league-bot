import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { basename, join, extname } from 'node:path';
import { awardsDataDir } from '$lib/digest2/awards.js';
import type { RequestHandler } from './$types';

// Live (non-published) page: a card's relative awards/<file> resolves to /digest2/awards/<file>.
const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
export const GET: RequestHandler = async ({ params }) => {
	const name = basename(params.file);
	const type = TYPES[extname(name).toLowerCase()];
	if (!type || name !== params.file) throw error(404, 'not found');
	try {
		return new Response(await readFile(join(awardsDataDir(), 'awards', 'posters', name)), { headers: { 'content-type': type, 'cache-control': 'private, max-age=300' } });
	} catch {
		throw error(404, 'not found');
	}
};
