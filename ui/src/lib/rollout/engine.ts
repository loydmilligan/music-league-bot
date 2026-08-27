/**
 * Pure rollout decisions. No database, no IO, no clock.
 *
 * The executors are deliberately dumb: they ask this module what is claimable,
 * run it, write the result, and ask what happens next. Everything interesting
 * is here, where it can be tested as data in / data out.
 */
import { resolveRollout, type RolloutEP } from './solve.js';
import type { CutRunState, Rollout, RunState, Runtime } from './types.js';

const TERMINAL = new Set(['done', 'failed', 'skipped']);

/** One pending row per active cut, tagged with the EP it resolved into. */
export function initialCutRuns(rollout: Rollout): CutRunState[] {
  const eps = resolveRollout(rollout);
  const rows: CutRunState[] = [];
  eps.forEach((ep, i) => {
    for (const cutId of ep.cuts) {
      const def = rollout.cuts[cutId];
      rows.push({
        cutId,
        ep: i,
        runtime: def.kind === 'human' ? null : def.runtime,
        state: 'pending',
        attempts: 0,
        remasters: 0,
      });
    }
  });
  return rows;
}

/**
 * Cut ids an executor of `runtime` may claim right now: pending, in the run's
 * current EP, and matching that runtime. A parked or finished run offers
 * nothing, and a human cut is never claimable — reaching it parks the run.
 */
export function claimable(run: RunState, _rollout: Rollout, runtime: Runtime): string[] {
  if (run.state !== 'running') return [];
  return run.cuts
    .filter((c) => c.ep === run.currentEp && c.state === 'pending' && c.runtime === runtime)
    .map((c) => c.cutId);
}

/** True when every cut in `ep` has reached a terminal state. */
export function epComplete(run: RunState, ep: number): boolean {
  const inEp = run.cuts.filter((c) => c.ep === ep);
  return inEp.length > 0 && inEp.every((c) => TERMINAL.has(c.state));
}

function epHasHuman(run: RunState, ep: number): boolean {
  return run.cuts.some((c) => c.ep === ep && c.runtime === null && c.state === 'pending');
}

/**
 * Move the run forward if its current EP is complete.
 *
 * Returns a NEW RunState; never mutates. Parks when the EP it moves into
 * contains an unlifted human cut. Marks done when it moves past the last EP.
 */
export function advance(run: RunState, rollout: Rollout): RunState {
  if (run.state === 'done' || run.state === 'failed') return run;
  if (!epComplete(run, run.currentEp)) return run;

  const eps: RolloutEP[] = resolveRollout(rollout);
  const nextEp = run.currentEp + 1;
  if (nextEp >= eps.length) {
    return { ...run, state: 'done' };
  }
  return {
    ...run,
    currentEp: nextEp,
    state: epHasHuman(run, nextEp) ? 'parked' : 'running',
  };
}
