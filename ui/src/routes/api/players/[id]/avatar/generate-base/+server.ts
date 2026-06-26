import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import {
  callOpenRouterImage,
  uploadToR2,
  deleteFromR2,
  avatarKey,
  modelForAvatar,
  buildBasePrompt,
  logImageGen,
  type ImageGenResult,
} from '$lib/server/avatarImage.js';

export const POST: RequestHandler = async ({ params }) => {
  const playerId = Number(params.id);
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return json({ error: 'invalid player id' }, { status: 400 });
  }

  const db = getDb();

  // Fetch player traits
  const player = db
    .prepare(
      `SELECT p.age, pp.avatar_gender, pp.avatar_race, pp.avatar_hair,
              pp.avatar_hair_style, pp.avatar_hair_color, pp.avatar_height,
              pp.avatar_build, pp.avatar_style, pp.avatar_trait
       FROM players p
       LEFT JOIN player_profiles pp ON pp.player_id = p.id
       WHERE p.id = ?`,
    )
    .get(playerId) as
    | {
        age: number | null;
        avatar_gender: string | null;
        avatar_race: string | null;
        avatar_hair: string | null;
        avatar_hair_style: string | null;
        avatar_hair_color: string | null;
        avatar_height: string | null;
        avatar_build: string | null;
        avatar_style: string | null;
        avatar_trait: string | null;
      }
    | undefined;

  if (!player) {
    return json({ error: 'player not found' }, { status: 404 });
  }

  if (!player.avatar_gender || !player.avatar_style) {
    return json({ error: 'gender and style are required' }, { status: 400 });
  }

  // Fetch age shift setting (default 0)
  const shiftRow = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('avatar_age_shift') as { value: string } | undefined;
  const shift = shiftRow?.value ? Number(shiftRow.value) : 0;

  const prompt = buildBasePrompt(player, isNaN(shift) ? 0 : shift);
  const model = modelForAvatar(db);

  let result: ImageGenResult;
  try {
    result = await callOpenRouterImage(prompt, model, { aspect_ratio: '1:1' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: `Image generation failed: ${msg}` }, { status: 500 });
  }

  // Versioned key so the new image lands on a never-cached URL (see avatarKey).
  const prevKey = (
    db.prepare('SELECT base_r2_key FROM player_avatars WHERE player_id = ?').get(playerId) as
      | { base_r2_key: string | null }
      | undefined
  )?.base_r2_key ?? null;
  const r2Key = avatarKey(playerId, 'base');
  try {
    await uploadToR2(r2Key, result.bytes);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: `R2 upload failed: ${msg}` }, { status: 500 });
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO player_avatars (player_id, base_r2_key, base_generated_at, base_source, base_cost_usd)
     VALUES (?, ?, ?, 'generated', ?)
     ON CONFLICT(player_id) DO UPDATE SET
       base_r2_key = excluded.base_r2_key,
       base_generated_at = excluded.base_generated_at,
       base_source = 'generated',
       base_cost_usd = excluded.base_cost_usd`,
  ).run(playerId, r2Key, now, result.costUsd);

  logImageGen(db, result, model, { label: 'base', playerId, outputKey: r2Key });

  // Best-effort: remove the previous object so orphans don't accumulate.
  if (prevKey && prevKey !== r2Key) await deleteFromR2(prevKey);

  return json({ url: `/api/avatars/${playerId}/base`, costUsd: result.costUsd }, { status: 200 });
};
