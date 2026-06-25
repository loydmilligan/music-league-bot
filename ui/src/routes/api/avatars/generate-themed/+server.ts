import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import {
  callOpenRouterImage,
  uploadToR2,
  modelForAvatar,
  buildBasePrompt,
} from '$lib/server/avatarImage.js';

type PlayerRow = {
  id: number;
  age: number | null;
  name: string;
  avatar_gender: string | null;
  avatar_hair: string | null;
  avatar_height: string | null;
  avatar_build: string | null;
  avatar_style: string | null;
  avatar_trait: string | null;
};

type RoundRow = {
  id: number;
  name: string;
  description: string | null;
};

function buildThemedPrompt(player: PlayerRow, shift: number, round: RoundRow): string {
  const base = buildBasePrompt(player, shift);
  return (
    base +
    `\n\nStyle them for this round's theme: "${round.name}" — ${round.description ?? ''}.\nKeep their core appearance but dress, pose, and surround them to reflect the theme.`
  );
}

/** POST /api/avatars/generate-themed { roundId } — generate themed avatars for all players in a round. */
export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    !('roundId' in body) ||
    typeof (body as Record<string, unknown>).roundId !== 'number'
  ) {
    return json({ error: 'roundId (number) is required' }, { status: 400 });
  }

  const roundId = (body as { roundId: number }).roundId;

  const db = getDb();

  // Fetch round
  const round = db
    .prepare('SELECT id, name, description FROM rounds WHERE id = ?')
    .get(roundId) as RoundRow | undefined;

  if (!round) {
    return json({ error: 'round not found' }, { status: 404 });
  }

  // Fetch all players with avatar_gender set
  const players = db
    .prepare(
      `SELECT p.id, p.age, p.name,
              pp.avatar_gender, pp.avatar_hair, pp.avatar_height,
              pp.avatar_build, pp.avatar_style, pp.avatar_trait
       FROM players p
       JOIN player_profiles pp ON pp.player_id = p.id
       WHERE pp.avatar_gender IS NOT NULL AND pp.avatar_gender != ''`,
    )
    .all() as PlayerRow[];

  // Fetch age shift setting (default 0)
  const shiftRow = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('avatar_age_shift') as { value: string } | undefined;
  const shift = shiftRow?.value ? Number(shiftRow.value) : 0;
  const effectiveShift = isNaN(shift) ? 0 : shift;

  const model = modelForAvatar(db);

  const results = await Promise.allSettled(
    players.map(async (player) => {
      const prompt = buildThemedPrompt(player, effectiveShift, round);
      const bytes = await callOpenRouterImage(prompt, model, { aspect_ratio: '1:1' });
      const key = `${player.id}/themed.png`;
      await uploadToR2(key, bytes);
      db.prepare(
        `INSERT INTO player_avatars (player_id, themed_r2_key, themed_round_id, themed_generated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(player_id) DO UPDATE SET
           themed_r2_key = excluded.themed_r2_key,
           themed_round_id = excluded.themed_round_id,
           themed_generated_at = excluded.themed_generated_at`,
      ).run(player.id, key, round.id, new Date().toISOString());
    }),
  );

  let generated = 0;
  let failed = 0;
  results.forEach((result, idx) => {
    if (result.status === 'fulfilled') {
      generated++;
    } else {
      failed++;
      console.error(`[generate-themed] Failed for player "${players[idx]?.name ?? 'unknown'}":`, result.reason);
    }
  });

  return json({ generated, failed }, { status: 200 });
};
