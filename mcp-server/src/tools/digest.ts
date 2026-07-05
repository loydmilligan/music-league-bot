import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { botUiFetch } from '../httpClient.js';

export interface PrepareCheck {
  name: string;
  ok: boolean;
  src: string;
  count?: number;
  optional?: boolean;
}

export async function checkDigestReadiness(input: { roundId: number }): Promise<{ checks: PrepareCheck[] }> {
  return botUiFetch(`/api/digest/${input.roundId}/prepare`, { method: 'POST' });
}

export interface GenerateDigestInput {
  roundId: number;
  sections?: Array<{ id: string; enabled?: boolean; style?: string[]; variant?: 'textual' | 'visual' | 'both'; context?: string }>;
  pastedChat?: string;
  recap?: { enabled: boolean; final?: boolean };
}

export async function generateDigest(input: GenerateDigestInput) {
  const { roundId, ...genParams } = input;
  return botUiFetch(`/api/digest/${roundId}/draft`, { method: 'POST', body: JSON.stringify(genParams) });
}

export interface ImportRoundDataResult {
  ok: boolean;
  imported?: { submissions: number; votes: number; voteComments: number };
  reason?: string;
  stage?: 'auth' | 'cli' | 'download' | 'import' | 'other';
}

export async function importRoundData(input: { roundId: number }): Promise<ImportRoundDataResult> {
  return botUiFetch(`/api/digest/${input.roundId}/import-export-zip`, { method: 'POST' });
}

const sectionShape = z.object({
  id: z.string(),
  enabled: z.boolean().optional(),
  style: z.array(z.string()).optional(),
  variant: z.enum(['textual', 'visual', 'both']).optional(),
  context: z.string().optional(),
});

export function registerDigestTools(server: McpServer): void {
  server.tool(
    'check_digest_readiness',
    "Check whether a round has everything needed to generate its digest (submissions, votes, comments, album art, etc). Returns each prerequisite's status.",
    { roundId: z.number().int() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await checkDigestReadiness(input)) }] }),
  );

  server.tool(
    'generate_digest',
    "Generate (or fetch the cached) digest draft for a round. Omit sections/pastedChat/recap to use defaults or return the existing cached draft.",
    {
      roundId: z.number().int(),
      sections: z.array(sectionShape).optional(),
      pastedChat: z.string().optional(),
      recap: z.object({ enabled: z.boolean(), final: z.boolean().optional() }).optional(),
    },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await generateDigest(input)) }] }),
  );

  server.tool(
    'import_round_data',
    "Trigger a host-side CLI export+import of a round's submissions/votes/vote-comments from Music League — the same action as the app's \"Import from CLI\" button. Use when check_digest_readiness shows Submissions/Votes/Vote comments failing. Can take noticeably longer than other tools (shells out to a CLI process on the host). A stage:'auth' failure means Music League auth has expired and needs manual re-login — this tool cannot self-heal that case.",
    { roundId: z.number().int() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await importRoundData(input)) }] }),
  );
}
