// ui/src/lib/digest/runner.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runOneJob, type RunnerDeps } from './runner.js';

function deps(over: Partial<RunnerDeps> = {}): RunnerDeps {
  return {
    claim: vi.fn().mockReturnValue({ roundId: 7, leagueId: 1, gen_params: null }),
    transition: vi.fn(), fail: vi.fn(),
    capture: vi.fn().mockResolvedValue({ ok: true, imported: {} }),
    generate: vi.fn().mockResolvedValue(undefined),
    render: vi.fn().mockResolvedValue({ url: 'https://d/x' }),
    leagueConfig: vi.fn().mockReturnValue({ mode: 'auto', genParams: {} }),
    finalize: vi.fn().mockResolvedValue(undefined),
    structuralReview: vi.fn().mockReturnValue(null),
    awaitApproval: vi.fn(), awaitReview: vi.fn(),
    log: vi.fn(), now: () => '2026-07-17T09:00:00Z',
    ...over,
  };
}

describe('runOneJob', () => {
  it('returns idle when there is no job', async () => {
    expect(await runOneJob(deps({ claim: vi.fn().mockReturnValue(null) }))).toBe('idle');
  });
  it('auto-mode: captures, generates, renders, finalizes, done', async () => {
    const d = deps();
    expect(await runOneJob(d)).toBe('ok');
    expect(d.capture).toHaveBeenCalledWith(7);
    expect(d.finalize).toHaveBeenCalledWith(7);
    expect(d.transition).toHaveBeenLastCalledWith(7, 'done', expect.any(String));
  });
  it('auto + clean: finalizes and returns ok', async () => {
    const d = deps();
    expect(await runOneJob(d)).toBe('ok');
    expect(d.finalize).toHaveBeenCalledWith(7);
    expect(d.awaitApproval).not.toHaveBeenCalled();
    expect(d.awaitReview).not.toHaveBeenCalled();
  });

  it('hil + clean: awaits approval, never finalizes', async () => {
    const d = deps({ leagueConfig: vi.fn().mockReturnValue({ mode: 'hil', genParams: {} }) });
    expect(await runOneJob(d)).toBe('held');
    expect(d.awaitApproval).toHaveBeenCalledWith(7, 1, 'https://d/x');
    expect(d.finalize).not.toHaveBeenCalled();
  });

  it('auto + structural review: escalates to review, never finalizes (item-11 fix)', async () => {
    const d = deps({ structuralReview: vi.fn().mockReturnValue('season-final round') });
    expect(await runOneJob(d)).toBe('held');
    expect(d.awaitReview).toHaveBeenCalledWith(7, 1, 'https://d/x', 'season-final round');
    expect(d.finalize).not.toHaveBeenCalled();
    expect(d.awaitApproval).not.toHaveBeenCalled();
  });

  it('hil + structural review: awaits review, not approval', async () => {
    const d = deps({
      leagueConfig: vi.fn().mockReturnValue({ mode: 'hil', genParams: {} }),
      structuralReview: vi.fn().mockReturnValue('round has no votes'),
    });
    expect(await runOneJob(d)).toBe('held');
    expect(d.awaitReview).toHaveBeenCalledWith(7, 1, 'https://d/x', 'round has no votes');
    expect(d.awaitApproval).not.toHaveBeenCalled();
  });

  it('off mode: holds silently — no approval, no review, no finalize', async () => {
    const d = deps({ leagueConfig: vi.fn().mockReturnValue({ mode: 'off', genParams: {} }) });
    expect(await runOneJob(d)).toBe('held');
    expect(d.awaitApproval).not.toHaveBeenCalled();
    expect(d.awaitReview).not.toHaveBeenCalled();
    expect(d.finalize).not.toHaveBeenCalled();
  });
  it('capture auth-failure fails the job and stops', async () => {
    const d = deps({ capture: vi.fn().mockResolvedValue({ ok: false, stage: 'auth', reason: 'expired' }) });
    expect(await runOneJob(d)).toBe('failed');
    expect(d.fail).toHaveBeenCalledWith(7, expect.stringContaining('auth'), expect.any(String));
    expect(d.generate).not.toHaveBeenCalled();
  });
  it('a thrown error becomes a failed job, not an exception', async () => {
    const d = deps({ generate: vi.fn().mockRejectedValue(new Error('llm down')) });
    await expect(runOneJob(d)).resolves.toBe('failed');
    expect(d.fail).toHaveBeenCalledWith(7, expect.stringContaining('llm down'), expect.any(String));
  });
  it('a synchronous claim() throw becomes failed, not a rejection', async () => {
    const d = deps({ claim: vi.fn(() => { throw new Error('db locked'); }) });
    await expect(runOneJob(d)).resolves.toBe('failed');
    expect(d.fail).not.toHaveBeenCalled(); // no job/roundId to fail
  });
});
