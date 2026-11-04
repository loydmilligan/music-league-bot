import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { getDb } from '$lib/db/client.js';
import { PathGuardError } from '$lib/server/avatarFactory/paths.js';
import { coverFile } from '$lib/server/coverFactory/paths.js';
import { buildExport, toApiError } from '$lib/server/coverFactory/service.js';

const MIME: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
};

const notFound = () => json({ error: 'not found' }, { status: 404 });

export const GET: RequestHandler = async ({ params, url }) => {
	const rel = params.path ?? '';
	const download = url.searchParams.get('download') === '1';
	try {
		const exp = /^export\/(\d+)\.(gif|jpg)$/.exec(rel);
		if (exp) {
			const ext = exp[2] as 'gif' | 'jpg';
			const bytes = await buildExport(getDb(), Number(exp[1]), ext);
			return new Response(new Uint8Array(bytes), {
				headers: {
					'Content-Type': MIME[`.${ext}`],
					'Cache-Control': 'private, max-age=60',
					'Content-Disposition': `attachment; filename="cover-${exp[1]}.${ext}"`,
				},
			});
		}
		const abs = coverFile(rel);
		if (!statSync(abs).isFile()) return notFound();
		const headers: Record<string, string> = {
			'Content-Type': MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream',
			'Cache-Control': 'private, max-age=60',
		};
		if (download) headers['Content-Disposition'] = `attachment; filename="${basename(abs)}"`;
		return new Response(new Uint8Array(readFileSync(abs)), { headers });
	} catch (e) {
		if (e instanceof PathGuardError) return json({ error: 'forbidden' }, { status: 403 });
		if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return notFound();
		const { status, body } = toApiError(e);
		return json(body, { status });
	}
};
