/**
 * Structural validation for a stored Rollout. Deliberately structural, not
 * semantic — mirrors isValidPipeline in the pipeline-config endpoint, whose
 * contract is "never return an invalid object, fall back to the default".
 */
import type { Rollout, CutDef } from './types.js';

function isCutDef(v: unknown): v is CutDef {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  if (typeof c.label !== 'string' || !c.label) return false;
  if (c.kind === 'script') {
    return (c.runtime === 'app' || c.runtime === 'host')
      && Array.isArray(c.command) && c.command.length > 0
      && (c.command as unknown[]).every((s) => typeof s === 'string');
  }
  if (c.kind === 'agent') {
    // Agent cuts need python3 + the claude CLI, which exist only on the host.
    return c.runtime === 'host' && typeof c.job === 'string' && !!c.job;
  }
  if (c.kind === 'human') {
    return typeof c.reviewPath === 'string' && !!c.reviewPath && typeof c.alertType === 'string';
  }
  return false;
}

export function isValidRollout(v: unknown): v is Rollout {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;

  if (!Array.isArray(r.order) || r.order.length === 0) return false;
  if (!r.order.every((id) => typeof id === 'string')) return false;
  if (new Set(r.order as string[]).size !== (r.order as string[]).length) return false;

  if (!r.cuts || typeof r.cuts !== 'object' || Array.isArray(r.cuts)) return false;
  const cuts = r.cuts as Record<string, unknown>;
  for (const id of r.order as string[]) {
    if (!(id in cuts) || !isCutDef(cuts[id])) return false;
  }

  if (!r.skipAfter || typeof r.skipAfter !== 'object' || Array.isArray(r.skipAfter)) return false;

  if (!Array.isArray(r.covers)) return false;
  for (const cover of r.covers as unknown[]) {
    if (!cover || typeof cover !== 'object' || Array.isArray(cover)) return false;
    const c = cover as Record<string, unknown>;
    if (typeof c.of !== 'string' || !(r.order as string[]).includes(c.of)) return false;
    if (c.budget !== undefined && (typeof c.budget !== 'number' || c.budget < 0)) return false;
  }

  if (r.disabled !== undefined) {
    if (!Array.isArray(r.disabled) || !r.disabled.every((s) => typeof s === 'string')) return false;
  }
  return true;
}
