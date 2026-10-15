/**
 * Pure request router for the bot's local control server. Kept separate from the
 * HTTP glue so the routing — including the safe mode default — is unit-tested.
 */
import type { RoundRevealRequest } from '../reveal/announcement.js';

export type ControlAction =
  | { action: 'trigger' }
  | { action: 'send'; roundId: number; target: string; mode: 'live' | 'dry-run' }
  | { action: 'notify'; text: string }
  | { action: 'poll'; target: string | null; name: string; options: string[]; allowMultiple: boolean }
  | { action: 'media'; target: string | null; file: string; caption: string | null; pin: number | null }
  | { action: 'say'; target: string | null; text: string; pin: number | null }
  | { action: 'dm'; to: string; text: string }
  | { action: 'login-code'; league: string; name: string; code: string }
  | ({ action: 'round-reveal' } & RoundRevealRequest)
  | { action: 'prompt'; prompt: Record<string, unknown> }
  | { action: 'unknown'; reason: string };

/** Pin duration in seconds. Anything non-positive or absent means "don't pin". */
function parsePin(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
}

export function parseControlRequest(method: string, path: string, body: unknown): ControlAction {
  if (method !== 'POST') return { action: 'unknown', reason: `method ${method} not allowed` };

  if (path === '/trigger') return { action: 'trigger' };

  if (path === '/round-reveal') {
    const b = (body ?? {}) as Record<string, unknown>;
    const required = ['leagueSlug', 'leagueName', 'leagueId', 'roundId', 'theme'] as const;
    if (required.some((key) => typeof b[key] !== 'string' || !(b[key] as string).trim())) {
      return { action: 'unknown', reason: `${required.join(', ')} are required` };
    }
    const leagueSlug = (b.leagueSlug as string).trim();
    const leagueId = (b.leagueId as string).trim();
    const roundId = (b.roundId as string).trim();
    if (!/^[a-z0-9-]{1,80}$/.test(leagueSlug)) return { action: 'unknown', reason: 'invalid leagueSlug' };
    if (!/^[a-f0-9]{32}$/i.test(leagueId) || !/^[a-f0-9]{32}$/i.test(roundId)) {
      return { action: 'unknown', reason: 'leagueId and roundId must be 32-character hex ids' };
    }
    if (!Number.isInteger(b.roundNumber) || (b.roundNumber as number) < 1) {
      return { action: 'unknown', reason: 'roundNumber must be a positive integer' };
    }
    return {
      action: 'round-reveal',
      leagueSlug,
      leagueName: (b.leagueName as string).trim().slice(0, 160),
      leagueId,
      roundId,
      roundNumber: b.roundNumber as number,
      theme: (b.theme as string).trim().slice(0, 300),
      description: typeof b.description === 'string' && b.description.trim()
        ? b.description.trim().slice(0, 1500)
        : null,
    };
  }

  if (path === '/send') {
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.roundId !== 'number') return { action: 'unknown', reason: 'roundId (number) required' };
    if (typeof b.target !== 'string' || !b.target.trim()) {
      return { action: 'unknown', reason: 'target (string) required' };
    }
    // Default to dry-run and treat anything but the exact string 'live' as dry-run,
    // so a typo or omission can never cause a real send.
    const mode = b.mode === 'live' ? 'live' : 'dry-run';
    return { action: 'send', roundId: b.roundId, target: b.target.trim(), mode };
  }

  if (path === '/notify') {
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.text !== 'string' || !b.text.trim()) {
      return { action: 'unknown', reason: 'text (non-empty string) required' };
    }
    return { action: 'notify', text: b.text.trim() };
  }

  // Experiment: send a native WhatsApp poll. target omitted → the bot owner's DM.
  if (path === '/poll') {
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.name !== 'string' || !b.name.trim()) {
      return { action: 'unknown', reason: 'name (non-empty string) required' };
    }
    if (
      !Array.isArray(b.options) ||
      b.options.length < 2 ||
      !b.options.every((o) => typeof o === 'string' && o.trim())
    ) {
      return { action: 'unknown', reason: 'options (array of >=2 non-empty strings) required' };
    }
    const target = typeof b.target === 'string' && b.target.trim() ? b.target.trim() : null;
    return {
      action: 'poll',
      target,
      name: b.name.trim(),
      options: (b.options as string[]).map((o) => o.trim()),
      allowMultiple: b.allowMultiple === true,
    };
  }

  // Experiment: send an image already inside the container. `file` is confined to
  // /app/data (the only writable bind mount) so this route can never be coaxed
  // into reading .wwebjs_auth session material or anything else off the FS.
  if (path === '/media') {
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.file !== 'string' || !b.file.trim()) {
      return { action: 'unknown', reason: 'file (non-empty string) required' };
    }
    const file = b.file.trim();
    if (!file.startsWith('/app/data/') || file.includes('..')) {
      return { action: 'unknown', reason: 'file must be an absolute path under /app/data' };
    }
    const target = typeof b.target === 'string' && b.target.trim() ? b.target.trim() : null;
    const caption = typeof b.caption === 'string' && b.caption.trim() ? b.caption.trim() : null;
    return { action: 'media', target, file, caption, pin: parsePin(b.pin) };
  }

  // Player DM. `to` must be E.164; groups are refused in dmGuard, not here.
  if (path === '/dm') {
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.text !== 'string' || !b.text.trim()) {
      return { action: 'unknown', reason: 'text (non-empty string) required' };
    }
    if (typeof b.to !== 'string' || !b.to.trim()) {
      return { action: 'unknown', reason: 'to (E.164 number) required' };
    }
    if (b.to.includes('@g.us')) {
      return { action: 'unknown', reason: 'player DMs cannot target a group' };
    }
    return { action: 'dm', to: b.to.trim(), text: b.text.trim() };
  }

  // Portal login code. The bot resolves name → number itself; callers never see it.
  if (path === '/login-code') {
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.league !== 'string' || !b.league.trim()) {
      return { action: 'unknown', reason: 'league (string) required' };
    }
    if (typeof b.name !== 'string' || !b.name.trim()) {
      return { action: 'unknown', reason: 'name (string) required' };
    }
    if (typeof b.code !== 'string' || !/^\d{6}$/.test(b.code)) {
      return { action: 'unknown', reason: 'code (6-digit string) required' };
    }
    return { action: 'login-code', league: b.league.trim(), name: b.name.trim(), code: b.code };
  }

  // Plain text to an arbitrary chat, optionally pinned (how-to-play explainer).
  if (path === '/say') {
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.text !== 'string' || !b.text.trim()) {
      return { action: 'unknown', reason: 'text (non-empty string) required' };
    }
    const target = typeof b.target === 'string' && b.target.trim() ? b.target.trim() : null;
    return { action: 'say', target, text: b.text.trim(), pin: parsePin(b.pin) };
  }

  // Open a prompt (generic ask-the-group question). Body is validated by the
  // store; only the shape needed for routing is checked here.
  if (path === '/prompt') {
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.chatId !== 'string' || !b.chatId.trim()) {
      return { action: 'unknown', reason: 'chatId (string) required' };
    }
    if (!Array.isArray(b.options) || b.options.length === 0) {
      return { action: 'unknown', reason: 'options (non-empty array) required' };
    }
    return { action: 'prompt', prompt: b };
  }

  return { action: 'unknown', reason: `no route for ${method} ${path}` };
}
