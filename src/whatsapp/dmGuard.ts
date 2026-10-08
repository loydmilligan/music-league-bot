/**
 * Guard for player WhatsApp DMs. Group /say and /media stay on their own routes.
 * /dm only accepts an E.164 number; missing numbers (the usual case until Matt
 * fills them in) fail closed with a reason the scheduler can log and skip.
 */

export type DmDecision =
  | { action: 'send'; target: string; e164: string; reason: string }
  | { action: 'block'; reason: string };

const E164 = /^\+[1-9]\d{7,14}$/;

export function normalizeE164(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const digits = raw.trim().replace(/[^\d+]/g, '');
  const normalized = digits.startsWith('+')
    ? `+${digits.slice(1).replace(/\D/g, '')}`
    : `+${digits.replace(/\D/g, '')}`;
  return E164.test(normalized) ? normalized : null;
}

export function resolveDmTarget(raw: string | null | undefined): DmDecision {
  const e164 = normalizeE164(raw);
  if (!raw?.trim()) {
    return { action: 'block', reason: 'no WhatsApp number linked yet' };
  }
  if (!e164) {
    return { action: 'block', reason: `not an E.164 number: "${raw}"` };
  }
  if (raw.includes('@g.us') || e164.includes('@')) {
    return { action: 'block', reason: 'player DMs cannot target a group' };
  }
  return {
    action: 'send',
    e164,
    target: `${e164.slice(1)}@c.us`,
    reason: `DM ${e164}`,
  };
}
