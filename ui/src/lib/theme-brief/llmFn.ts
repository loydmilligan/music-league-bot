import type Database from 'better-sqlite3';
import { callOpenRouter, extractJsonContent, type LLMCallMeta } from '$lib/digest/llm.js';

export type LlmMessage = { role: string; content: string };
export type LlmFn = (messages: LlmMessage[], opts?: { jsonMode?: boolean }) => Promise<string>;

/**
 * Production LlmFn: real OpenRouter call, cost-logged to llm_cost_log (via
 * callOpenRouter's own `meta`-driven logLlmCall — see llm.ts's `if (opts.meta)`
 * branch — NOT called again here, to avoid double-logging), and JSON-extracted
 * when jsonMode is requested. Category is 'archive' — theme matching is
 * cross-round/season analysis, not a per-round digest section.
 */
export function makeLlmFn(db: Database.Database, label: string): LlmFn {
  return async (messages, opts) => {
    const meta: LLMCallMeta = { category: 'archive', label, db };
    // callOpenRouter's messages are typed to the 'system'|'user'|'assistant'
    // role union; LlmMessage's `role: string` is a strict superset at the
    // type level, so this narrows rather than casts away safety.
    const result = await callOpenRouter(
      messages as { role: 'system' | 'user' | 'assistant'; content: string }[],
      { jsonMode: opts?.jsonMode, meta },
    );
    return opts?.jsonMode ? extractJsonContent(result.content) : result.content;
  };
}
