import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { botUiFetch } from '../httpClient.js';

export interface ResolvedRound {
  id: number;
  name: string;
  roundNumber: number | null;
  phase: string;
  seasonNumber: number;
  leagueSlug: string;
}

export interface ResolveRoundInput {
  leagueSlug: string;
  seasonNumber: number;
  roundNumber?: number;
  roundName?: string;
}

export async function resolveRound(input: ResolveRoundInput): Promise<ResolvedRound> {
  const params = new URLSearchParams({
    leagueSlug: input.leagueSlug,
    seasonNumber: String(input.seasonNumber),
  });
  if (input.roundNumber !== undefined) params.set('roundNumber', String(input.roundNumber));
  else if (input.roundName !== undefined) params.set('roundName', input.roundName);
  return botUiFetch<ResolvedRound>(`/api/rounds/resolve?${params.toString()}`);
}

export function registerRoundTools(server: McpServer): void {
  server.tool(
    'resolve_round',
    'Resolve a human-friendly round reference (league slug, season number, and either a round number or round name) to its stable round id.',
    {
      leagueSlug: z.string().describe('The league slug, e.g. "hip-jammers"'),
      seasonNumber: z.number().int().describe('The season number within the league'),
      roundNumber: z.number().int().optional().describe('The round number, if known'),
      roundName: z.string().optional().describe('The round name/theme, if roundNumber is not known'),
    },
    async (input) => {
      const round = await resolveRound(input);
      return { content: [{ type: 'text', text: JSON.stringify(round) }] };
    },
  );
}
