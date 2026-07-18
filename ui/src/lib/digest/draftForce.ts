import type { GenParams } from '$lib/digest/llm.js';

/** True when a fresh generation is required (params supplied, or force requested). */
export function shouldRegenerate(genParams: GenParams | null, force: boolean): boolean {
  return force || genParams !== null;
}
