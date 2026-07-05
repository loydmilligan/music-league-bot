import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { botUiFetch } from '../httpClient.js';

export interface Matchup {
  songAId: number;
  songBId: number | null;
}

export async function startRandomMatchup(input: { roundId: number }): Promise<Matchup> {
  return botUiFetch(`/api/rounds/${input.roundId}/h2h/random/start`, { method: 'POST' });
}

export async function reshuffleRandomMatchup(input: { roundId: number }): Promise<Matchup> {
  return botUiFetch(`/api/rounds/${input.roundId}/h2h/random/reshuffle`, { method: 'POST' });
}

export async function selectH2HWinner(input: { roundId: number; winnerSongId: number }): Promise<Matchup> {
  return botUiFetch(`/api/rounds/${input.roundId}/h2h/random/select-winner`, {
    method: 'POST',
    body: JSON.stringify({ winnerSongId: input.winnerSongId }),
  });
}

export async function getCurrentMatchup(input: { roundId: number }): Promise<Matchup | null> {
  return botUiFetch(`/api/rounds/${input.roundId}/h2h/random/current`);
}

export function registerH2HTools(server: McpServer): void {
  server.tool(
    'start_random_matchup',
    "Pick 2 random active songs from a round's research list to face off. Returns their research-song ids (call list_round_songs for titles/artists/spotify URIs).",
    { roundId: z.number().int() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await startRandomMatchup(input)) }] }),
  );

  server.tool(
    'reshuffle_random_matchup',
    'Replace the current pending matchup with 2 different random active songs.',
    { roundId: z.number().int() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await reshuffleRandomMatchup(input)) }] }),
  );

  server.tool(
    'select_h2h_winner',
    "Record the winner of the current matchup. The loser is removed from the round's research list. A new random challenger automatically faces the winner (songBId is null if no challengers remain).",
    { roundId: z.number().int(), winnerSongId: z.number().int() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await selectH2HWinner(input)) }] }),
  );

  server.tool(
    'get_current_matchup',
    "Get the currently-pending random-mode matchup for a round, or null if none is active.",
    { roundId: z.number().int() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await getCurrentMatchup(input)) }] }),
  );
}
