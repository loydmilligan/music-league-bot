/**
 * One pass of the digest auto-post.
 *
 * Runs in the bot container, because that is where the authenticated WhatsApp
 * client lives (LocalAuth is a single-holder Chromium profile — a second process
 * cannot send). Everything else is bot-ui's: the bot asks it what to send and
 * asks it to render, then does the one thing only it can do.
 *
 * Ordering is the safety property. The guard is consulted BEFORE the claim, so a
 * dry run cannot burn a round's claim and silently prevent the real send later.
 *
 * The tick never throws: it is called from a timer and a rejection there is an
 * unhandled rejection, which this project has no backstop for.
 */
import { resolveSendTarget, guardedSend, type SendGuardEnv } from '../whatsapp/sendGuard.js';

export interface ScheduleEntry {
  leagueId: number;
  leagueSlug: string;
  action: 'send' | 'hold' | 'none';
  roundId: number;
  roundName: string;
  reason: string;
}

export interface AutoPostDeps {
  env: SendGuardEnv;
  fetchSchedule: () => Promise<ScheduleEntry[]>;
  /** Claims the round and renders the share page. claimed:false = someone else has it. */
  claimAndExport: (roundId: number) => Promise<{ claimed: boolean; url?: string }>;
  send: (target: string, text: string) => Promise<void>;
  confirm: (roundId: number, target: string, url: string) => Promise<void>;
  fail: (roundId: number, error: string) => Promise<void>;
  log: (msg: string) => void;
}

export function formatDigestMessage(entry: ScheduleEntry, url: string): string {
  return `🎧 ${entry.roundName} — the digest is up\n${url}`;
}

export async function runDigestTick(deps: AutoPostDeps): Promise<void> {
  let schedule: ScheduleEntry[];
  try {
    schedule = await deps.fetchSchedule();
  } catch (err) {
    deps.log(`[autopost] could not fetch the schedule: ${String(err)}`);
    return;
  }

  for (const entry of schedule) {
    try {
      await postOne(deps, entry);
    } catch (err) {
      // One league's problem must not stop the others.
      deps.log(`[autopost] ${entry.leagueSlug}: unexpected failure: ${String(err)}`);
    }
  }
}

async function postOne(deps: AutoPostDeps, entry: ScheduleEntry): Promise<void> {
  if (entry.action !== 'send') {
    deps.log(`[autopost] ${entry.leagueSlug}: ${entry.action} — ${entry.reason}`);
    return;
  }

  // Guard first, claim second. A blocked send must leave the round untouched so
  // that enabling live mode later still posts it.
  const decision = resolveSendTarget(deps.env, entry.leagueSlug);
  if (decision.action === 'block') {
    deps.log(
      `[autopost] ${entry.leagueSlug}: not sending round ${entry.roundId} (${entry.roundName}) — ${decision.reason}`,
    );
    return;
  }

  const claim = await deps.claimAndExport(entry.roundId);
  if (!claim.claimed) {
    deps.log(`[autopost] ${entry.leagueSlug}: round ${entry.roundId} is already claimed`);
    return;
  }
  if (!claim.url) {
    deps.log(`[autopost] ${entry.leagueSlug}: round ${entry.roundId} produced no share url`);
    return;
  }

  const text = formatDigestMessage(entry, claim.url);

  try {
    const result = await guardedSend(deps.env, entry.leagueSlug, text, deps.send);
    if (!result.sent) {
      deps.log(`[autopost] ${entry.leagueSlug}: blocked at send — ${result.reason}`);
      return;
    }
  } catch (err) {
    // The claim is deliberately retained: WhatsApp may have accepted the message
    // before throwing, and a duplicate in a real group is worse than a miss.
    const msg = err instanceof Error ? err.message : String(err);
    deps.log(`[autopost] ${entry.leagueSlug}: SEND FAILED for round ${entry.roundId}: ${msg}`);
    await deps.fail(entry.roundId, msg);
    return;
  }

  await deps.confirm(entry.roundId, decision.target, claim.url);
  deps.log(`[autopost] ${entry.leagueSlug}: sent round ${entry.roundId} → ${decision.target}`);
}
