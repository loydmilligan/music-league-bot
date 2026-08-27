import type { AlertType } from '$lib/notifications/config.js';

export type Runtime = 'app' | 'host';

/** How to read pass/fail from a cut's captured output. */
export type Check =
  /** The command exited 0. */
  | { rule: 'exit-zero' }
  /** The cut's JSON output has no entries at `fail` severity (verify_facts). */
  | { rule: 'no-fail-checks' };

/**
 * Replay a cut in a later EP with accumulated context.
 *
 * Shared concept with the pipeline level. `remaster` is the rollout addition:
 * a remaster cover fires ONLY when the original's check failed, which is how
 * repair is expressed. `budget` caps how many times it may fire.
 */
export type RolloutCover = {
  of: string;
  model?: string;
  remaster?: true;
  budget?: number;
};

export type CutDef =
  | { kind: 'script'; runtime: Runtime; command: string[]; check?: Check; label: string }
  | { kind: 'agent'; runtime: 'host'; job: string; model?: string; check?: Check; label: string }
  | { kind: 'human'; label: string; reviewPath: string; alertType: AlertType };

export type Rollout = {
  order: string[];
  cuts: Record<string, CutDef>;
  skipAfter: Partial<Record<string, true>>;
  covers: RolloutCover[];
  /** Cut ids excluded from this rollout. Active = order minus disabled. */
  disabled?: string[];
};

export type CutRunState = {
  cutId: string;
  ep: number;
  runtime: Runtime | null; // null for human cuts
  state: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  attempts: number;
  remasters: number;
  /** undefined = no check declared, or not yet evaluated. */
  checkPassed?: boolean;
  outputJson?: string;
};

export type RunState = {
  runId: string;
  leagueId: number;
  roundId: number;
  currentEp: number;
  state: 'running' | 'parked' | 'done' | 'failed';
  cuts: CutRunState[];
  error?: string;
};

/** Active cut ids: declaration order minus anything disabled. */
export function activeCuts(rollout: Rollout): string[] {
  const off = new Set(rollout.disabled ?? []);
  return rollout.order.filter((id) => !off.has(id));
}
