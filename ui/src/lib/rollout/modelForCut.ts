/**
 * Model resolution for agent cuts (final review I9).
 *
 * Spec §6: "Model resolution for agent cuts reuses the modelFor cascade …
 * cuts become additional pinnable keys. No parallel resolver." The cascade
 * stores OpenRouter ids (e.g. anthropic/claude-sonnet-4-5) for API calls, but
 * agent cuts run `claude -p --model`, which takes claude CLI names — so the
 * resolved id is translated: anthropic/<m> → <m>; a non-anthropic id cannot
 * run on the claude CLI at all, so the cut falls back to the CLI's default
 * model (undefined = no --model flag).
 *
 * Resolution happens at run-snapshot time (promotePendingJobs), so the host
 * executor keeps reading a plain `model` string off the cut definition.
 */
import type Database from 'better-sqlite3';
import { modelFor } from '$lib/digest/modelFor.js';

export function modelForCut(cutId: string, db: Database.Database): string | undefined {
  const pin = db.prepare('SELECT value FROM settings WHERE key = ?')
    .get(`digest_model_${cutId}`) as { value: string } | undefined;
  const resolved = pin?.value ?? modelFor('digest', db);
  if (resolved.startsWith('anthropic/')) return resolved.slice('anthropic/'.length);
  return resolved.includes('/') ? undefined : resolved;
}
