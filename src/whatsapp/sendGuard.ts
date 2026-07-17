/**
 * Guard for PROACTIVE (unprompted) WhatsApp sends.
 *
 * Every send that exists today is a reply to an inbound message, or an owner DM
 * via makeSendDm. Auto-posting the digest is the first send with no human in the
 * loop and a group on the other end, so it goes through here instead.
 *
 * Fails closed: absent or unrecognised config resolves to `block`, never a send.
 *
 * Targets are per-league and explicit — a league slug maps to a @g.us id, and a
 * league with no entry cannot be sent to. This is deliberately dumb: it means the
 * code never has to infer which platform a league lives on. fam-jam is a Google
 * Chat league whose digest is hand-shared, so it points at the bot's staging
 * group (just the owner + the bot) and the owner forwards it on.
 *
 * WHATSAPP_ALLOWED_GROUP_IDS is deliberately NOT consulted. That list gates what
 * the bot reacts to (handler.ts:39, substring match), carries three entries, and
 * one of them is a @lid rather than a @g.us. It cannot identify a send target.
 */

export type SendMode = 'dry-run' | 'live';

export interface SendGuardEnv {
  /** DIGEST_SEND_MODE. Absent → dry-run. */
  mode?: string;
  /** DIGEST_SEND_TARGETS: league slug → @g.us group id. Absent slug → never sent. */
  targets?: Record<string, string>;
}

export type SendDecision =
  | { action: 'send'; target: string; reason: string }
  | { action: 'block'; reason: string };

const GROUP_SUFFIX = '@g.us';

export function resolveSendTarget(env: SendGuardEnv, leagueSlug: string): SendDecision {
  const mode = (env.mode ?? 'dry-run').trim();

  if (mode === 'dry-run') {
    return { action: 'block', reason: 'DIGEST_SEND_MODE is dry-run — nothing is sent' };
  }

  if (mode !== 'live') {
    return { action: 'block', reason: `unrecognised DIGEST_SEND_MODE "${mode}"` };
  }

  const target = env.targets?.[leagueSlug]?.trim();
  if (!target) {
    return {
      action: 'block',
      reason: `no DIGEST_SEND_TARGETS entry for league "${leagueSlug}"`,
    };
  }

  if (!target.endsWith(GROUP_SUFFIX)) {
    return {
      action: 'block',
      reason: `target for "${leagueSlug}" must be a ${GROUP_SUFFIX} group id, got "${target}"`,
    };
  }

  return { action: 'send', target, reason: `live mode — sending to the target for "${leagueSlug}"` };
}

export interface GuardedSendResult {
  sent: boolean;
  reason: string;
  /** Exactly what would have gone out, for logging and eyeballing before enabling. */
  preview: string;
}

export type SendFn = (target: string, text: string) => Promise<void>;

/**
 * The only way the digest reaches WhatsApp. Resolves the target through the
 * guard, refuses empty bodies, and otherwise hands off to `send`.
 */
export async function guardedSend(
  env: SendGuardEnv,
  leagueSlug: string,
  text: string,
  send: SendFn,
): Promise<GuardedSendResult> {
  const decision = resolveSendTarget(env, leagueSlug);
  const target =
    decision.action === 'send' ? decision.target : (env.targets?.[leagueSlug] || '(unresolved)');
  const preview = `[digest send] ${leagueSlug} → ${target}\n${text}`;

  if (!text.trim()) {
    return { sent: false, reason: 'refusing to send an empty digest message', preview };
  }

  if (decision.action === 'block') {
    return { sent: false, reason: decision.reason, preview };
  }

  await send(decision.target, text);
  return { sent: true, reason: decision.reason, preview };
}

/** Parse DIGEST_SEND_TARGETS. Malformed JSON yields no targets — i.e. nothing sends. */
export function parseTargets(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
