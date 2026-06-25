import type { RequestHandler } from './$types.js';
import { getDb } from '$lib/db/client.js';

type AvatarType = 'base' | 'themed';

/** GET /api/avatars/:playerId/:type — serve a player avatar image from R2. */
export const GET: RequestHandler = async ({ params }) => {
  const playerId = Number(params.playerId);
  if (!Number.isInteger(playerId) || isNaN(playerId) || playerId <= 0) {
    return new Response('invalid playerId', { status: 400 });
  }

  const type = params.type as AvatarType;
  if (type !== 'base' && type !== 'themed') {
    return new Response('type must be "base" or "themed"', { status: 400 });
  }

  const db = getDb();
  const row = db
    .prepare('SELECT base_r2_key, themed_r2_key FROM player_avatars WHERE player_id = ?')
    .get(playerId) as { base_r2_key: string | null; themed_r2_key: string | null } | undefined;

  const r2Key = type === 'base' ? row?.base_r2_key : row?.themed_r2_key;
  if (!row || !r2Key) {
    return new Response(null, { status: 404 });
  }

  const accountId = process.env.CF_ACCOUNT_ID;
  const bucket = process.env.CF_R2_BUCKET;
  const token = process.env.CF_R2_API_TOKEN;

  if (!accountId || !bucket || !token) {
    return new Response('R2 not configured', { status: 500 });
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeURIComponent(r2Key)}`;

  let r2res: Response;
  try {
    r2res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    console.error('R2 fetch error:', err);
    return new Response('R2 fetch failed', { status: 500 });
  }

  if (r2res.status === 404) {
    return new Response(null, { status: 404 });
  }

  if (!r2res.ok) {
    return new Response('R2 error', { status: 500 });
  }

  return new Response(r2res.body, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'max-age=3600',
    },
  });
};
