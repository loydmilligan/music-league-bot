import { frameMessage, MESSAGE_NAMES, FOOTER_WRONG_PLACE } from './messageFrame.js';
import { NOOP_TRACE, type InteractionTrace } from '../storage/interactionLog.js';

export const WRONG_PLACE_EMOJI = '❌';
export const EXPLAIN_COOLDOWN_MS = 600_000;
export const WRONG_PLACE_COPY =
  'You tried to use a DM command (a command that is meant to be used when communicating with me directly) while in the group chat. Try using the same command here (in a direct message with me) and it should work. Try typing "help" to see a list of all DM commands and Group commands.';

export interface WrongPlaceMessage {
  from: string;
  author?: string;
  chatName?: string;
  notifyName?: string;
  react?(emoji: string): Promise<void>;
}

export interface WrongPlaceDeps {
  sendDm(target: string, text: string): Promise<void>;
  dmTarget(id: string): Promise<string>;
  isPreviewPerson(id: string): boolean;
  /** Owner on/off switch: off means no reactions and no DMs. */
  isEnabled(): boolean;
  trace: () => InteractionTrace;
  now?: () => number;
  log(l: string): void;
}

/** DM target -> time the last explainer went out. In memory; expired entries are pruned on each touch. */
const lastExplained = new Map<string, number>();

function prune(now: number): void {
  for (const [k, at] of lastExplained) if (now - at >= EXPLAIN_COOLDOWN_MS) lastExplained.delete(k);
}

const errName = (e: unknown): string => (e instanceof Error ? e.name : 'error');

function authorKind(a: string): 'lid' | 'c.us' | 'other' {
  return a.endsWith('@lid') ? 'lid' : a.endsWith('@c.us') ? 'c.us' : 'other';
}

/**
 * A DM-only command typed in the group: react ❌ every time, DM the framed explainer at most once per
 * DM target per 10 min. False = not handled (author is not a preview person). Never throws.
 */
export async function runWrongPlace(msg: WrongPlaceMessage, deps: WrongPlaceDeps): Promise<boolean> {
  // W4: the preview check is on the DM target (the id people are listed by), not the raw author.
  let target: string;
  try {
    target = await deps.dmTarget(msg.author ?? '');
    if (!deps.isPreviewPerson(target)) return false;
  } catch {
    return false;
  }
  const now = deps.now ?? Date.now;
  let trace: InteractionTrace = NOOP_TRACE;
  try { trace = deps.trace() ?? NOOP_TRACE; } catch { /* never throw */ }
  const safe = (f: () => void): void => { try { f(); } catch { /* never throw */ } };
  safe(() => trace.start({ group: msg.from, groupName: msg.chatName, who: msg.notifyName ?? '', authorKind: authorKind(msg.author ?? ''), command: 'wrong-place', via: 'group' }));

  let enabled = true;
  try { enabled = deps.isEnabled() !== false; } catch { /* fail open, like the reaction path */ }
  if (!enabled) {
    // Same as the reaction path: a trace that ends 'disabled'; no react, no DM, no cooldown.
    safe(() => trace.end('disabled'));
    return true;
  }

  let reacted = true;
  try {
    await msg.react?.(WRONG_PLACE_EMOJI);
  } catch (err) {
    reacted = false;
    safe(() => deps.log(`[cmu] wrong-place react failed: ${errName(err)}`));
  }
  safe(() => trace.step('react', { ok: reacted, emoji: WRONG_PLACE_EMOJI }));

  try {
    prune(now());
    const last = lastExplained.get(target);
    if (last !== undefined && now() - last < EXPLAIN_COOLDOWN_MS) {
      safe(() => trace.step('explain-throttled', { ok: true }));
    } else {
      const t0 = now();
      try {
        await deps.sendDm(target, frameMessage({ name: MESSAGE_NAMES.wrongPlace, body: WRONG_PLACE_COPY, footer: FOOTER_WRONG_PLACE }));
        lastExplained.set(target, now()); // only a delivered DM starts the cooldown
        safe(() => trace.step('explain-dm', { ok: true, ms: now() - t0 }));
      } catch (err) {
        safe(() => deps.log(`[cmu] wrong-place dm failed: ${errName(err)}`));
        safe(() => trace.step('explain-dm', { ok: false, ms: now() - t0 }));
      }
    }
  } catch (err) {
    safe(() => deps.log(`[cmu] wrong-place explainer failed: ${errName(err)}`));
    safe(() => trace.step('explain-dm', { ok: false }));
  }
  safe(() => trace.end('wrong-place'));
  return true;
}
