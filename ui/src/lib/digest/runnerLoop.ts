/**
 * runnerLoop.ts — wires the pure `runOneJob` orchestrator (Task 7) to its
 * real collaborators and starts the polling loop, alongside `queueWorker`.
 *
 * `generate`, `render`, and `finalize` intentionally reuse the EXISTING
 * bot-ui HTTP endpoints (POST /api/digest/:id/draft, /render, /finalize)
 * rather than reimplementing generation/render/finalize from lib
 * primitives — those endpoints are live production paths.
 */

import { getDb } from '$lib/db/client.js';
import { claimNextJob, transitionJob, failJob } from './jobs.js';
import { captureRoundData } from './capture.js';
import { getLeagueDigestConfig } from './leagueDigestConfig.js';
import { type RunnerDeps, runOneJob } from './runner.js';

const baseUrl = process.env.BOT_UI_INTERNAL_URL ?? 'http://localhost:3002';

export function buildRunnerDeps(): RunnerDeps {
  return {
    claim: () => claimNextJob(getDb(), new Date().toISOString()),
    transition: (roundId, status, now) => transitionJob(getDb(), roundId, status, now),
    fail: (roundId, error, now) => failJob(getDb(), roundId, error, now),
    capture: (roundId) => captureRoundData(roundId),
    generate: async (roundId, genParams) => {
      const res = await fetch(`${baseUrl}/api/digest/${roundId}/draft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(genParams ?? {})
      });
      if (!res.ok) throw new Error(`draft ${res.status}`);
    },
    render: async (roundId) => {
      const res = await fetch(`${baseUrl}/api/digest/${roundId}/render`, { method: 'POST' });
      if (!res.ok) throw new Error(`render ${res.status}`);
      return (await res.json()) as { url: string };
    },
    leagueConfig: (leagueId) => getLeagueDigestConfig(getDb(), leagueId),
    finalize: async (roundId) => {
      const res = await fetch(`${baseUrl}/api/digest/${roundId}/finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'pdf' })
      });
      if (!res.ok) throw new Error(`finalize ${res.status}`);
    },
    log: (msg) => console.log(msg),
    now: () => new Date().toISOString()
  };
}

/**
 * Start the digest auto-pipeline runner.
 * Called once from hooks.server.ts at startup, next to `startQueueWorker`.
 */
export function startDigestRunner(): void {
  const ms = Number(process.env.DIGEST_RUNNER_POLL_MS) || 60_000;
  const deps = buildRunnerDeps();
  console.log(`[digest-runner] starting (poll every ${ms}ms)`);
  const timer = setInterval(() => {
    void runOneJob(deps).catch((e) => console.error('[digest-runner] tick threw', e));
  }, ms);
  timer.unref?.();
}
