import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { uploadToR2, deleteFromR2, avatarKey } from '$lib/server/avatarImage.js';

export const POST: RequestHandler = async ({ params, request }) => {
  const playerId = Number(params.id);
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return json({ error: 'invalid player id' }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: 'failed to parse multipart form data' }, { status: 400 });
  }

  const file = formData.get('avatar');
  if (!file || !(file instanceof File)) {
    return json({ error: 'avatar field is required and must be a file' }, { status: 400 });
  }

  if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
    return json({ error: 'only PNG or JPEG allowed' }, { status: 400 });
  }

  if (file.size > 5 * 1024 * 1024) {
    return json({ error: 'file too large (max 5MB)' }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const db = getDb();
  // Versioned key so the new image lands on a never-cached URL (see avatarKey).
  const prevKey = (
    db.prepare('SELECT base_r2_key FROM player_avatars WHERE player_id = ?').get(playerId) as
      | { base_r2_key: string | null }
      | undefined
  )?.base_r2_key ?? null;
  const r2Key = avatarKey(playerId, 'base');

  try {
    await uploadToR2(r2Key, bytes);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: `R2 upload failed: ${msg}` }, { status: 500 });
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO player_avatars (player_id, base_r2_key, base_generated_at, base_source, base_cost_usd)
     VALUES (?, ?, ?, 'uploaded', NULL)
     ON CONFLICT(player_id) DO UPDATE SET
       base_r2_key = excluded.base_r2_key,
       base_generated_at = excluded.base_generated_at,
       base_source = 'uploaded',
       base_cost_usd = NULL`,
  ).run(playerId, r2Key, now);

  // Best-effort: remove the previous object so orphans don't accumulate.
  if (prevKey && prevKey !== r2Key) await deleteFromR2(prevKey);

  return json({ url: `/api/avatars/${playerId}/base` }, { status: 200 });
};
