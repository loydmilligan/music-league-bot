/**
 * Guard for PROACTIVE (unprompted) WhatsApp sends.
 *
 * Every send that exists today is a reply to an inbound message, or an owner DM
 * via makeSendDm. Auto-posting the digest is the first send with no human in the
 * loop and a group on the other end, so it goes through here instead.
 *
 * Fails closed: absent or unrecognised config resolves to `block`, never to a
 * send. Enabling a live group send takes a deliberate DIGEST_TARGET_GROUP_ID.
 *
 * WHATSAPP_ALLOWED_GROUP_IDS is deliberately NOT consulted. That list gates what
 * the bot reacts to (handler.ts:39, substring match), carries three entries, and
 * one of them is a @lid rather than a @g.us. It cannot identify a send target.
 */

export type SendMode = 'dry-run' | 'owner' | 'live';

export interface SendGuardEnv {
  /** DIGEST_SEND_MODE. Absent → dry-run. */
  mode?: string;
  /** DIGEST_TARGET_GROUP_ID. Required, and must be a @g.us, for live mode. */
  targetGroupId?: string;
  ownerPhone: string;
}

export type SendDecision =
  | { action: 'send'; target: string; reason: string }
  | { action: 'block'; reason: string };

const GROUP_SUFFIX = '@g.us';

export function resolveSendTarget(env: SendGuardEnv): SendDecision {
  const mode = (env.mode ?? 'dry-run').trim();

  if (mode === 'dry-run') {
    return { action: 'block', reason: 'DIGEST_SEND_MODE is dry-run — nothing is sent' };
  }

  if (mode === 'owner') {
    const owner = env.ownerPhone.trim();
    if (!owner) {
      return { action: 'block', reason: 'owner mode requires OWNER_PHONE_NUMBER' };
    }
    return { action: 'send', target: owner, reason: 'owner mode — redirected to OWNER_PHONE_NUMBER' };
  }

  if (mode === 'live') {
    const target = env.targetGroupId?.trim();
    if (!target) {
      return { action: 'block', reason: 'live mode requires an explicit DIGEST_TARGET_GROUP_ID' };
    }
    if (!target.endsWith(GROUP_SUFFIX)) {
      return {
        action: 'block',
        reason: `live mode target must be a ${GROUP_SUFFIX} group id, got "${target}"`,
      };
    }
    return { action: 'send', target, reason: 'live mode — sending to the configured group' };
  }

  return { action: 'block', reason: `unrecognised DIGEST_SEND_MODE "${mode}"` };
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
  text: string,
  send: SendFn,
): Promise<GuardedSendResult> {
  const decision = resolveSendTarget(env);
  const target = decision.action === 'send' ? decision.target : (env.targetGroupId ?? '(unresolved)');
  const preview = `[digest send] → ${target}\n${text}`;

  if (!text.trim()) {
    return { sent: false, reason: 'refusing to send an empty digest message', preview };
  }

  if (decision.action === 'block') {
    return { sent: false, reason: decision.reason, preview };
  }

  await send(decision.target, text);
  return { sent: true, reason: decision.reason, preview };
}
