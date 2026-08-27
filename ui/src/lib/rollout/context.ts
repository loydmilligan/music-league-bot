/**
 * The dossier slice for one cut.
 *
 * Spec §3: context visibility is declared by POSITION, not wired by hand. A
 * cut reads the output of everything in a strictly earlier EP and never a
 * sibling in its own EP — which is what makes a parallel EP meaningful and
 * what makes adding a cut wire its own inputs.
 *
 * There is no separate dossier object. The dossier IS the accumulated
 * output_json of upstream cut runs.
 */
import type { RunState } from './types.js';

export type UpstreamOutput = { cutId: string; ep: number; outputJson: string };
export type CutContext = { cutId: string; ep: number; upstream: UpstreamOutput[] };

export function contextFor(run: RunState, cutId: string): CutContext {
  const self = run.cuts.find((c) => c.cutId === cutId);
  if (!self) throw new Error(`unknown cut "${cutId}" in run ${run.runId}`);

  const upstream = run.cuts
    .filter((c) => c.ep < self.ep && typeof c.outputJson === 'string')
    .sort((a, b) => a.ep - b.ep)
    .map((c) => ({ cutId: c.cutId, ep: c.ep, outputJson: c.outputJson as string }));

  return { cutId, ep: self.ep, upstream };
}
