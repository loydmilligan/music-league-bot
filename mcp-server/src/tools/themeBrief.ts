import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { botUiFetch } from '../httpClient.js';

export interface GetThemeBriefInput { roundId: number; force?: boolean; }

export async function getThemeBrief(input: GetThemeBriefInput): Promise<unknown> {
  return botUiFetch(`/api/theme-brief/${input.roundId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ force: input.force ?? false }),
  });
}

export function registerThemeBriefTools(server: McpServer): void {
  server.tool(
    'get_theme_brief',
    "Generate (or fetch cached) the Theme Strategy Brief for a round: prior runs of the same/similar theme across all leagues, each run's podium/cellar, winner-DNA & cellar-trap patterns, a familiarity (popularity->points) summary, the owner's audience-aware already-played songs, and 'what to submit' guidance. Pass force:true to regenerate.",
    { roundId: z.number().int(), force: z.boolean().optional() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await getThemeBrief(input)) }] }),
  );
}
