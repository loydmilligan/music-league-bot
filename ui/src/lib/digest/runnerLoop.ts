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
import { claimNextJob, transitionJob, failOrRetry } from './jobs.js';
import { captureRoundData } from './capture.js';
import { getLeagueDigestConfig } from './leagueDigestConfig.js';
import { type RunnerDeps, runOneJob } from './runner.js';
import { structuralReviewReason } from './structuralReview.js';
import { generateApprovalToken, setAwaitingApproval, setAwaitingReview } from './approvals.js';
import { ntfyConfigFromEnv, publish, buildApprovalNotification, buildReviewNotification, buildFailureNotification } from './ntfy.js';

const baseUrl = process.env.BOT_UI_INTERNAL_URL ?? 'http://localhost:3002';
const appBase = process.env.PUBLIC_APP_URL ?? 'https://mlb37.mattmariani.com';

function names(roundId: number, leagueId: number): { league: string; round: string } {
  const db = getDb();
  const league = (db.prepare('SELECT name FROM leagues WHERE id=?').get(leagueId) as { name?: string } | undefined)?.name ?? `League ${leagueId}`;
  const round = (db.prepare('SELECT name FROM rounds WHERE id=?').get(roundId) as { name?: string } | undefined)?.name ?? `Round ${roundId}`;
  return { league, round };
}

export function buildRunnerDeps(): RunnerDeps {
  return {
    claim: () => claimNextJob(getDb(), new Date().toISOString()),
    transition: (roundId, status, now) => transitionJob(getDb(), roundId, status, now),
    fail: (roundId, error, now) => {
      const outcome = failOrRetry(getDb(), roundId, error, now);
      if (outcome === 'failed') {
        const cfg = ntfyConfigFromEnv(process.env);
        if (cfg) void publish(cfg, buildFailureNotification({ stage: 'runner', reason: error, roundId }));
      }
    },
    capture: (roundId) => captureRoundData(roundId),
    generate: async (roundId, genParams) => {
      const res = await fetch(`${baseUrl}/api/digest/${roundId}/draft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...((genParams as object) ?? {}), force: true })
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
    structuralReview: (roundId) => structuralReviewReason(getDb(), roundId, new Date().toISOString()),
    awaitApproval: async (roundId, leagueId, reviewUrl) => {
      const token = generateApprovalToken();
      setAwaitingApproval(getDb(), roundId, token, reviewUrl, new Date().toISOString());
      const cfg = ntfyConfigFromEnv(process.env);
      if (!cfg) return;
      const { league, round } = names(roundId, leagueId);
      await publish(cfg, buildApprovalNotification({
        league, round, reviewUrl,
        approveUrl: `${appBase}/api/digest/approve`,
        denyUrl: `${appBase}/api/digest/deny`,
        editUrl: `${appBase}/digest/${roundId}`,
        token, bearer: cfg.token,
      }));
    },
    awaitReview: async (roundId, leagueId, reviewUrl, reason) => {
      const token = generateApprovalToken();
      setAwaitingReview(getDb(), roundId, token, reviewUrl, new Date().toISOString());
      const cfg = ntfyConfigFromEnv(process.env);
      if (!cfg) return;
      const { league, round } = names(roundId, leagueId);
      await publish(cfg, buildReviewNotification({
        league, round, reviewUrl,
        editUrl: `${appBase}/digest/${roundId}`,
        denyUrl: `${appBase}/api/digest/deny`,
        token, reason, bearer: cfg.token,
      }));
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
