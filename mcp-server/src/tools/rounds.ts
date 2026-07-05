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

export interface LeagueSummary {
  slug: string;
  name: string;
}

export async function listLeagues(): Promise<LeagueSummary[]> {
  return botUiFetch<LeagueSummary[]>('/api/leagues');
}

export interface ListRoundsInput {
  leagueSlug: string;
  seasonNumber?: number;
}

export interface RoundSummary {
  id: number;
  name: string;
  roundNumber: number | null;
  phase: string;
  seasonNumber: number;
}

export async function listRounds(input: ListRoundsInput): Promise<RoundSummary[]> {
  const params = new URLSearchParams({ leagueSlug: input.leagueSlug });
  if (input.seasonNumber !== undefined) params.set('seasonNumber', String(input.seasonNumber));
  return botUiFetch<RoundSummary[]>(`/api/rounds/list?${params.toString()}`);
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

  server.tool(
    'list_leagues',
    'List every league (slug + name) — use this to discover league slugs before calling list_rounds or resolve_round.',
    {},
    async () => ({ content: [{ type: 'text', text: JSON.stringify(await listLeagues()) }] }),
  );

  server.tool(
    'list_rounds',
    "List a league's rounds (id, name, round number, phase, season number). Omit seasonNumber to list every round across every season for that league.",
    { leagueSlug: z.string(), seasonNumber: z.number().int().optional() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await listRounds(input)) }] }),
  );
}
