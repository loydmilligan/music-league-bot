/**
 * Pure rollout decisions. No database, no IO, no clock.
 *
 * The executors are deliberately dumb: they ask this module what is claimable,
 * run it, write the result, and ask what happens next. Everything interesting
 * is here, where it can be tested as data in / data out.
 */
import { resolveRollout, type RolloutEP } from './solve.js';
import type { Check, CutRunState, Rollout, RunState, Runtime } from './types.js';

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

export type CutResult = { exitCode: number; outputJson?: string; error?: string };

const MAX_ATTEMPTS = 3;      // mirrors failOrRetry's default
const DEFAULT_BUDGET = 1;    // spec §7: remaster budget defaults to 1

/**
 * Did this cut's declared check pass?
 *
 * `undefined` means no check was declared — the cut simply succeeds or fails
 * on its exit code. Fails CLOSED: unparseable output is a failure, because a
 * check we cannot read is not a check we can trust.
 */
export function evaluateCheck(check: Check | undefined, result: CutResult): boolean | undefined {
  if (!check) return undefined;
  if (check.rule === 'exit-zero') return result.exitCode === 0;

  // 'no-fail-checks': verify_facts --json grades each check ok | warn | fail
  // and exits non-zero if ANY failed. Warnings must not block the run.
  try {
    const parsed = JSON.parse(result.outputJson ?? '') as { checks?: { severity?: string }[] };
    if (!Array.isArray(parsed.checks)) return false;
    return !parsed.checks.some((c) => c.severity === 'fail');
  } catch {
    return false;
  }
}

function remasterFor(rollout: Rollout, cutId: string) {
  return rollout.covers.find((c) => c.of === cutId && c.remaster === true);
}

/**
 * Fold a finished cut's result into the run.
 *
 * Three outcomes, in priority order:
 *   1. transient failure (non-zero exit WITH an error string) → spend an
 *      attempt and re-queue, up to MAX_ATTEMPTS. Never spends a remaster.
 *   2. declared check failed → fire the remaster cover: spend a remaster and
 *      re-queue. Budget exhausted (or no remaster cover) → the cut fails and
 *      the run parks at a FORCED HOLD, carrying the unresolved cut ids.
 *   3. otherwise → done.
 *
 * Advancing the EP is NOT done here; the caller calls advance() afterwards.
 */
export function applyCutResult(
  run: RunState, rollout: Rollout, cutId: string, result: CutResult,
): RunState {
  const def = rollout.cuts[cutId];
  const idx = run.cuts.findIndex((c) => c.cutId === cutId);
  if (idx === -1) return run;
  const prev = run.cuts[idx];
  const write = (patch: Partial<CutRunState>): CutRunState[] =>
    run.cuts.map((c, i) => (i === idx ? { ...c, ...patch } : c));

  // 1. Transient failure — the command itself did not complete.
  if (result.error) {
    const attempts = prev.attempts + 1;
    if (attempts < MAX_ATTEMPTS) {
      return { ...run, cuts: write({ state: 'pending', attempts }) };
    }
    return {
      ...run,
      cuts: write({ state: 'failed', attempts }),
      state: 'parked',
      error: `cut "${cutId}" failed after ${attempts} attempts: ${result.error}`,
    };
  }

  // 2. Declared check.
  const checkPassed = evaluateCheck('check' in def ? def.check : undefined, result);
  if (checkPassed === false) {
    const cover = remasterFor(rollout, cutId);
    const budget = cover?.budget ?? DEFAULT_BUDGET;
    if (cover && prev.remasters < budget) {
      return {
        ...run,
        cuts: write({
          state: 'pending', remasters: prev.remasters + 1,
          checkPassed: false, outputJson: result.outputJson,
        }),
      };
    }
    // Forced hold: park where the failure happened, evidence attached.
    return {
      ...run,
      cuts: write({ state: 'failed', checkPassed: false, outputJson: result.outputJson }),
      state: 'parked',
      error: `cut "${cutId}" check failed and could not be repaired`,
    };
  }

  // 3. Success.
  return {
    ...run,
    cuts: write({ state: 'done', checkPassed, outputJson: result.outputJson }),
  };
}
