import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/db/client.js';
import { buildAnalysisRoster, buildSongMetaBlock } from '$lib/server/boarzAnalysis.js';
import { runSubmitterOdds } from '$lib/predict/tasks/submitterOdds.js';
import { runVoteForecast } from '$lib/predict/tasks/voteForecast.js';
import { resolveBudget } from '$lib/voting-lab/ballotDb.js';

const Body = z.object({
  spotifyUri: z.string().min(1),
  kind: z.enum(['submitter-odds', 'vote-forecast']),
  forceRegen: z.boolean().optional(),
});

export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');

  const db = getDb();
  const round = db.prepare('SELECT name, description FROM rounds WHERE id = ?').get(roundId) as
    | { name: string; description: string | null }
    | undefined;
  if (!round) throw error(404, 'round not found');

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) throw error(400, parsed.error.message);
  const { spotifyUri, kind, forceRegen } = parsed.data;

  const song = db
    .prepare('SELECT title, artist, album FROM research_songs WHERE round_id = ? AND spotify_uri = ?')
    .get(roundId, spotifyUri) as { title: string; artist: string; album: string | null } | undefined;
  if (!song) throw error(404, 'song not in this round');

  const roster = buildAnalysisRoster(db, roundId);
  if (!roster.players.length) throw error(400, 'no league roster found for this round');
  if (!roster.players.some((p) => p.profileMd)) {
    throw error(400, 'no codex player profiles available for this league');
  }

  const metaBlock = buildSongMetaBlock(db, spotifyUri);
  const theme = { name: round.name, description: round.description ?? '' };
  const songInput = { title: song.title, artist: song.artist, spotifyUri, metaBlock };
  const players = roster.players.map((p) => ({
    name: p.displayName,
    competitorName: p.competitorName,
    profileMd: p.profileMd,
  }));

  if (kind === 'submitter-odds') {
    const result = await runSubmitterOdds(db, {
      roundId,
      input: { song: songInput, theme, players },
      forceRegen,
    });
    return json(result);
  }

  const { budget } = resolveBudget(db, roundId);
  const result = await runVoteForecast(db, {
    roundId,
    input: {
      song: songInput,
      theme,
      budget: { upTotal: budget.upTotal, cap: budget.perSongCap ?? budget.upTotal },
      players,
    },
    forceRegen,
  });
  return json(result);
};
