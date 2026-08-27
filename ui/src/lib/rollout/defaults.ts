/**
 * The process run by hand every week, written down. See spec §8.
 *
 * `verify` and `verify-post-punchup` are two cuts running the same script:
 * checks re-run AFTER punch-up because punch-up is when fabricated quotes are
 * actually introduced. Cut ids must be unique, hence the distinct id.
 *
 * `bridge` is a cut so it cannot be forgotten — the class of bug currently
 * live on R148, whose bridge row was never generated.
 */
import type { Rollout } from './types.js';

const QA = 'scripts/digest-qa';

export const DEFAULT_ROLLOUT: Rollout = {
  order: [
    'capture', 'generate',
    'verify', 'dedupe', 'mentions', 'participation',
    'ledes',
    'hold-ledes',
    'punchup',
    'verify-post-punchup', 'dedupe-post-punchup', 'dupe-findings',
    'dupe-page', 'cover-art',
    'hold-approve',
    'send',
    'bridge', 'archive-refresh',
  ],
  cuts: {
    capture:  { kind: 'script', runtime: 'app',  label: 'Capture round data', command: ['capture'] },
    generate: { kind: 'script', runtime: 'app',  label: 'Generate draft',     command: ['generate'] },

    verify:      { kind: 'script', runtime: 'host', label: 'Verify facts',
                   command: ['python3', `${QA}/verify_facts.py`, '{roundId}', '--json'],
                   check: { rule: 'no-fail-checks' } },
    dedupe:      { kind: 'script', runtime: 'host', label: 'Dedupe scan',
                   command: ['python3', `${QA}/dedupe_scan.py`, '{roundId}'],
                   check: { rule: 'exit-zero' } },
    mentions:    { kind: 'script', runtime: 'host', label: 'Mention matrix',
                   command: ['python3', `${QA}/mention_matrix.py`, '{roundId}', '--json'] },
    participation: { kind: 'script', runtime: 'host', label: 'Participation report',
                   command: ['python3', `${QA}/participation.py`, '{leagueSlug}', '--round', '{roundId}', '--report'] },

    ledes: { kind: 'agent', runtime: 'host', label: 'Story ledes', job: 'ledes' },

    'hold-ledes': { kind: 'human', label: 'Rate ledes & give direction',
                    reviewPath: '/digest/{roundId}/hil', alertType: 'digest_ready' },

    punchup: { kind: 'agent', runtime: 'host', label: 'Punch-up pass', job: 'punchup' },

    'verify-post-punchup': { kind: 'script', runtime: 'host', label: 'Re-verify facts',
                   command: ['python3', `${QA}/verify_facts.py`, '{roundId}', '--json'],
                   check: { rule: 'no-fail-checks' } },
    'dedupe-post-punchup': { kind: 'script', runtime: 'host', label: 'Re-scan dupes',
                   command: ['python3', `${QA}/dedupe_scan.py`, '{roundId}'],
                   check: { rule: 'exit-zero' } },
    'dupe-findings': { kind: 'agent', runtime: 'host', label: 'Semantic dupe findings', job: 'dupe-findings' },

    'dupe-page': { kind: 'script', runtime: 'host', label: 'Render dupe review page',
                   command: ['python3', `${QA}/dupe_review_page.py`, '{roundId}'] },
    'cover-art': { kind: 'script', runtime: 'host', label: 'Cover art',
                   command: ['python3', 'scripts/cover-gen/cli.py', '{roundId}'] },

    'hold-approve': { kind: 'human', label: 'Approve & send',
                      reviewPath: '/digest/{roundId}', alertType: 'digest_ready' },

    send: { kind: 'script', runtime: 'app', label: 'Finalize & send', command: ['send'] },

    bridge: { kind: 'agent', runtime: 'host', label: 'Round bridge', job: 'bridge' },
    'archive-refresh': { kind: 'script', runtime: 'app', label: 'Archive refresh', command: ['archive'] },
  },
  skipAfter: {
    capture: true, generate: true, participation: true, ledes: true,
    'hold-ledes': true, punchup: true, 'dupe-findings': true,
    'cover-art': true, 'hold-approve': true, send: true,
  },
  covers: [
    { of: 'verify', remaster: true, budget: 1 },
    { of: 'dedupe', remaster: true, budget: 1 },
    { of: 'verify-post-punchup', remaster: true, budget: 1 },
    { of: 'dedupe-post-punchup', remaster: true, budget: 1 },
  ],
};
