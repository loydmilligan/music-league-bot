import type Database from 'better-sqlite3';
import { callOpenRouter, extractJsonContent, logLlmCall, type LLMCallMeta } from '$lib/digest/llm.js';

export type LlmMessage = { role: string; content: string };
export type LlmFn = (messages: LlmMessage[], opts?: { jsonMode?: boolean }) => Promise<string>;

// Model actually requested when the caller doesn't override it — mirrors
// llm.ts's own DEFAULT_MODEL fallback so the cost-log `model` column is
// accurate without needing llm.ts to export its private constant.
const FALLBACK_MODEL = 'anthropic/claude-sonnet-4-5';

/**
 * Production LlmFn: real OpenRouter call, cost-logged to llm_cost_log, and
 * JSON-extracted when jsonMode is requested. Category is 'archive' — theme
 * matching is cross-round/season analysis, not a per-round digest section.
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
    try {
      logLlmCall(result, { model: process.env.OPENROUTER_DIGEST_MODEL ?? FALLBACK_MODEL }, meta);
    } catch {
      /* fire-and-forget */
    }
    return opts?.jsonMode ? extractJsonContent(result.content) : result.content;
  };
}
