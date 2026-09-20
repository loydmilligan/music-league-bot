import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { resolveReviewMedia } from '$lib/server/boarzReview.js';

export const GET: RequestHandler = async ({ params, request }) => {
  const media = await resolveReviewMedia(params.player, params.path);
  if (!media) error(404, 'Media not found');

  const headers = new Headers({
    'Content-Type': media.mime,
    'Cache-Control': 'private, max-age=60',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
    'Accept-Ranges': 'bytes'
  });
  const range = request.headers.get('range');
  let start = 0;
  let end = media.size - 1;
  let status = 200;
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${media.size}` } });
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), end) : end;
    if (start > end || start >= media.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${media.size}` } });
    headers.set('Content-Range', `bytes ${start}-${end}/${media.size}`);
    status = 206;
  }
  headers.set('Content-Length', String(end - start + 1));
  const stream = Readable.toWeb(createReadStream(media.path, { start, end })) as ReadableStream;
  return new Response(stream, { status, headers });
};
