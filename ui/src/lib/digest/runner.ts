// ui/src/lib/digest/runner.ts
export interface RunnerDeps {
  claim: () => { roundId: number; leagueId: number; gen_params: string | null } | null;
  transition: (roundId: number, status: string, now: string) => void;
  fail: (roundId: number, error: string, now: string) => void;
  capture: (roundId: number) => Promise<{ ok: boolean; stage?: string; reason?: string }>;
  generate: (roundId: number, genParams: unknown) => Promise<void>;
  render: (roundId: number) => Promise<{ url: string }>;
  leagueConfig: (leagueId: number) => { mode: 'auto' | 'hil' | 'off'; genParams: unknown };
  finalize: (roundId: number) => Promise<void>;
  log: (msg: string) => void;
  now: () => string;
}

export async function runOneJob(deps: RunnerDeps): Promise<'idle' | 'ok' | 'failed' | 'held'> {
  let job;
  try {
    job = deps.claim();
  } catch (err) {
    deps.log(`[digest-runner] claim failed: ${err instanceof Error ? err.message : String(err)}`);
    return 'failed';
  }
  if (!job) return 'idle';
  const { roundId, leagueId } = job;
  try {
    const cap = await deps.capture(roundId);
    if (!cap.ok) { deps.fail(roundId, `capture ${cap.stage}: ${cap.reason}`, deps.now()); return 'failed'; }

    deps.transition(roundId, 'generating', deps.now());
    const cfg = deps.leagueConfig(leagueId);
    await deps.generate(roundId, cfg.genParams);

    deps.transition(roundId, 'rendered', deps.now());
    await deps.render(roundId);

    if (cfg.mode !== 'auto') {
      deps.log(`[digest-runner] round ${roundId}: held (mode=${cfg.mode}) — awaiting approval gate`);
      return 'held';
    }
    deps.transition(roundId, 'finalizing', deps.now());
    await deps.finalize(roundId);
    deps.transition(roundId, 'done', deps.now());
    deps.log(`[digest-runner] round ${roundId}: auto-finalized; existing poller will send`);
    return 'ok';
  } catch (err) {
    deps.fail(roundId, err instanceof Error ? err.message : String(err), deps.now());
    return 'failed';
  }
}
