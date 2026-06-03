import type { RequestHandler } from './$types.js';
import { error } from '@sveltejs/kit';
import { stat, readFile } from 'node:fs/promises';
import { exportPathFor, contentTypeFor } from '$lib/digest/export.js';

// GET /api/digest/exports/:filename — stream a previously-rendered digest PNG as a downloadable attachment.
export const GET: RequestHandler = async ({ params }) => {
  let absPath: string;
  try {
    absPath = exportPathFor(params.filename ?? '');
  } catch {
    throw error(400, 'invalid filename');
  }

  try {
    await stat(absPath);
  } catch {
    throw error(404, 'export not found');
  }

  const bytes = await readFile(absPath);
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': contentTypeFor(params.filename ?? ''),
      'Content-Length': String(bytes.length),
      'Content-Disposition': `attachment; filename="${params.filename}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
};
