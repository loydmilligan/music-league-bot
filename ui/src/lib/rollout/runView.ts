/**
 * Presentation logic for a rollout run, extracted from the component so the
 * interesting part — what a cut's state actually MEANS — is testable without
 * a browser.
 *
 * The distinction that matters on this screen is the same one the engine
 * refuses to conflate: a transient failure (the command did not complete) is
 * not a failed check (the command completed and the output was wrong).
 */
import type { Rollout, RunState } from './types.js';

export type CutStatus =
  | 'pending' | 'running' | 'passed' | 'repaired'
  | 'failed-check' | 'failed-transient' | 'skipped';

export type CutView = {
  cutId: string; label: string; ep: number; kind: string;
  status: CutStatus; note?: string; outputJson?: string;
};

export type RunSummaryView = {
  runId: string; state: RunState['state'];
  progress: { done: number; total: number };
  resumable: boolean;
  waitingOn?: string;
  error?: string;
  cuts: CutView[];
};

const TERMINAL = new Set(['done', 'failed', 'skipped']);

export function summarizeRun(run: RunState, rollout: Rollout): RunSummaryView {
  const cuts: CutView[] = run.cuts.map((c) => {
    const def = rollout.cuts[c.cutId];
    let status: CutStatus;
    let note: string | undefined;

    if (c.state === 'pending') status = 'pending';
    else if (c.state === 'running') status = 'running';
    else if (c.state === 'skipped') status = 'skipped';
    else if (c.state === 'failed') {
      // A failed check has checkPassed === false; a transient failure never
      // got far enough to evaluate one.
      status = c.checkPassed === false ? 'failed-check' : 'failed-transient';
      note = status === 'failed-transient' ? `${c.attempts} attempts` : 'could not be repaired';
    } else if (c.remasters > 0) {
      status = 'repaired';
      note = `fixed after ${c.remasters} remaster${c.remasters === 1 ? '' : 's'}`;
    } else {
      status = 'passed';
    }

    return {
      cutId: c.cutId, ep: c.ep,
      label: def?.label ?? c.cutId,
      kind: def?.kind ?? 'script',
      status, note, outputJson: c.outputJson,
    };
  });

  const waiting = run.cuts.find(
    (c) => c.ep === run.currentEp && c.runtime === null && c.state === 'pending');

  return {
    runId: run.runId,
    state: run.state,
    progress: { done: run.cuts.filter((c) => TERMINAL.has(c.state)).length, total: run.cuts.length },
    resumable: run.state === 'parked',
    waitingOn: waiting ? rollout.cuts[waiting.cutId]?.label : undefined,
    error: run.error,
    cuts,
  };
}
