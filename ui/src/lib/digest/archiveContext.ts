import type Database from 'better-sqlite3';
import type { GenParams } from './llm.js';

export interface ArchiveContext {
  /** Operator steer/intent for the round — section contexts + pasted-chat presence. */
  operatorSteer: string;
  /** One-line distilled "what happened" note (first sentence of the flow body). */
  roundDynamics: string;
}

function firstSentence(s: string): string {
  const trimmed = s.replace(/\s+/g, ' ').trim();
  const m = trimmed.match(/^(.*?[.!?])(\s|$)/);
  return (m ? m[1] : trimmed).trim();
}

export function buildArchiveContext(
  genParams: GenParams | undefined,
  output: { sections: Record<string, unknown> },
): ArchiveContext {
  const steerParts: string[] = [];
  for (const s of genParams?.sections ?? []) {
    if (s.context?.trim()) steerParts.push(`${s.id}: ${s.context.trim()}`);
  }
  if (genParams?.pastedChat?.trim()) steerParts.push('operator pasted chat transcript');

  const flow = output.sections?.flow as { body?: string } | undefined;
  const roundDynamics = flow?.body ? firstSentence(flow.body) : '';

  return { operatorSteer: steerParts.join(' | '), roundDynamics };
}

export function getArchiveContext(db: Database.Database, roundId: number): ArchiveContext | null {
  const row = db
    .prepare(
      `SELECT archive_context FROM digest_drafts
       WHERE round_id = ? ORDER BY generated_at DESC LIMIT 1`,
    )
    .get(roundId) as { archive_context: string | null } | undefined;
  if (!row?.archive_context) return null;
  try { return JSON.parse(row.archive_context) as ArchiveContext; } catch { return null; }
}
