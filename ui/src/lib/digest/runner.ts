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
  structuralReview: (roundId: number) => string | null;
  awaitApproval: (roundId: number, leagueId: number, reviewUrl: string) => void | Promise<void>;
  awaitReview: (roundId: number, leagueId: number, reviewUrl: string, reason: string) => void | Promise<void>;
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

    const cfg = deps.leagueConfig(leagueId);

    deps.transition(roundId, 'generating', deps.now());
    await deps.generate(roundId, cfg.genParams);

    deps.transition(roundId, 'rendered', deps.now());
    const { url } = await deps.render(roundId);

    if (cfg.mode === 'off') {
      deps.log(`[digest-runner] round ${roundId}: held (mode=off) — no notification`);
      return 'held';
    }

    const reviewReason = deps.structuralReview(roundId);
    if (reviewReason) {
      await deps.awaitReview(roundId, leagueId, url, reviewReason);
      deps.log(`[digest-runner] round ${roundId}: awaiting_review — ${reviewReason}`);
      return 'held';
    }

    if (cfg.mode !== 'auto') {
      await deps.awaitApproval(roundId, leagueId, url);
      deps.log(`[digest-runner] round ${roundId}: awaiting_approval (mode=${cfg.mode})`);
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
