/**
 * Pure request router for the bot's local control server. Kept separate from the
 * HTTP glue so the routing — including the safe mode default — is unit-tested.
 */

export type ControlAction =
  | { action: 'trigger' }
  | { action: 'send'; roundId: number; target: string; mode: 'live' | 'dry-run' }
  | { action: 'notify'; text: string }
  | { action: 'poll'; target: string | null; name: string; options: string[]; allowMultiple: boolean }
  | { action: 'media'; target: string | null; file: string; caption: string | null; pin: number | null }
  | { action: 'say'; target: string | null; text: string; pin: number | null }
  | { action: 'prompt'; prompt: Record<string, unknown> }
  | { action: 'unknown'; reason: string };

/** Pin duration in seconds. Anything non-positive or absent means "don't pin". */
function parsePin(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
}

export function parseControlRequest(method: string, path: string, body: unknown): ControlAction {
  if (method !== 'POST') return { action: 'unknown', reason: `method ${method} not allowed` };

  if (path === '/trigger') return { action: 'trigger' };

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
