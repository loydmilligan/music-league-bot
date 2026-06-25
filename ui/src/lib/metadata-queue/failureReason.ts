/**
 * failureReason.ts — client-safe failure classification helper.
 *
 * Extracted from metadataQueue.ts so Svelte components can import it without
 * pulling in the better-sqlite3 server-side dependency tree.
 */

export type FailureReason = 'rate_limited' | 'no_data' | 'transient' | 'config';

/**
 * Classify a job failure error string into a category.
 * Precedence (first match wins):
 *  1. 'config'       — /not set|not configured/i
 *  2. 'no_data'      — /not found/i
 *  3. 'rate_limited' — /HTTP 4|rate/i
 *  4. 'transient'    — /HTTP 5|ECONN|timeout/i
 *  5. default        — 'transient'
 */
export function classifyFailure(error: string | null): FailureReason {
	if (!error) return 'transient';
	if (/not set|not configured/i.test(error)) return 'config';
	if (/not found/i.test(error)) return 'no_data';
	if (/HTTP 4|rate/i.test(error)) return 'rate_limited';
	if (/HTTP 5|ECONN|timeout/i.test(error)) return 'transient';
	return 'transient';
}
