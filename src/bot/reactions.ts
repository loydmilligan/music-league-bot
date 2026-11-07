import type { Palette } from './reactionPalette.js';
import type { CmuSwitch } from './cmuSwitch.js';
import { jevPickState, type JevPicker } from '../chat/jevPick.js';
import { NOOP_TRACE, type InteractionTrace } from '../storage/interactionLog.js';

export interface ReactionMessage {
  from: string;
  author: string;
  body: string;
  chatName: string;
  notifyName?: string;
  priorMessages: Array<{ sender: string; timeMs: number; text: string }>;
  react?(emoji: string): Promise<void>;
}

export interface ReactionDeps {
  palette: Palette;
  picker: JevPicker | null;
  forceFallback: boolean;
  cmuSwitch: CmuSwitch;
  trace: () => InteractionTrace;
  log(line: string): void;
  now?(): number;
  random?(): number;
  guard?: BurstGuard;
}

type FallbackReason = 'no-key' | 'forced-off' | 'error' | 'timeout' | 'bad-answer' | 'burst';

/** Sliding-window limiter; only an allowed call is recorded (in both windows). */
export class BurstGuard {
  private readonly perAuthor: number;
  private readonly global: number;
  private readonly windowMs: number;
  private readonly byAuthor = new Map<string, number[]>();
  private all: number[] = [];

  constructor(o: { perAuthor?: number; global?: number; windowMs?: number } = {}) {
    this.perAuthor = o.perAuthor ?? 5;
    this.global = o.global ?? 30;
    this.windowMs = o.windowMs ?? 60_000;
  }

  allow(author: string, now: number): boolean {
    const cutoff = now - this.windowMs;
    this.all = this.all.filter((t) => t > cutoff);
    const mine = (this.byAuthor.get(author) ?? []).filter((t) => t > cutoff);
    if (mine.length > 0) this.byAuthor.set(author, mine);
    else this.byAuthor.delete(author);
    if (mine.length >= this.perAuthor || this.all.length >= this.global) return false;
    mine.push(now);
    this.byAuthor.set(author, mine);
    this.all.push(now);
    return true;
  }
}

const DEFAULT_GUARD = new BurstGuard();

function safeCall<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function authorKind(author: string): 'lid' | 'c.us' | 'other' {
  if (author.endsWith('@lid')) return 'lid';
  if (author.endsWith('@c.us')) return 'c.us';
  return 'other';
}

const ms = (t0: number) => Math.round(performance.now() - t0);

class PickFailure extends Error {
  constructor(readonly reason: FallbackReason) {
    super(reason);
  }
}

const INTRO =
  'Pick the reaction a funny friend in this group chat would add to the message. ' +
  'Play along, one-up the joke, or take a side; for a sincere question, choose a warm "heard you". ';

/** Reacts to a command-less @-mention with one emoji. Never throws. */
export async function runReaction(msg: ReactionMessage, deps: ReactionDeps): Promise<void> {
  const raw = safeCall(() => deps.trace()) ?? NOOP_TRACE;
  const step = (name: string, f: { ok: boolean; ms?: number } & Record<string, string | number | boolean>) =>
    void safeCall(() => raw.step(name, f));
  const end = (outcome: string) => void safeCall(() => raw.end(outcome));
  safeCall(() =>
    raw.start({
      group: msg.from,
      groupName: msg.chatName,
      who: msg.notifyName ?? '',
      authorKind: authorKind(msg.author),
      command: 'reaction',
    }),
  );
  try {
    if (safeCall(() => deps.cmuSwitch.isEnabled()) === false) {
      end('disabled');
      deps.log('[react] disabled');
      return;
    }
    const random = deps.random ?? Math.random;
    const pool = deps.palette.fallbackPool;
    const fallbackEmoji = () => pool[Math.floor(random() * pool.length)];
    const now = (deps.now ?? Date.now)();

    let reason: FallbackReason | undefined;
    let emoji: string | undefined;
    if (!deps.picker) reason = 'no-key';
    else if (deps.forceFallback) reason = 'forced-off';
    else if (!(deps.guard ?? DEFAULT_GUARD).allow(msg.author, now)) reason = 'burst';
    else {
      try {
        emoji = await jevEmoji(msg, deps, deps.picker, step);
      } catch (e) {
        reason = e instanceof PickFailure ? e.reason : timedOut(e) ? 'timeout' : 'error';
      }
    }
    if (emoji === undefined) {
      emoji = fallbackEmoji();
      step('fallback', { ok: true, reason: reason ?? 'error' });
    }

    if (await send(msg, emoji, step, false)) {
      end(reason ? 'fallback' : 'jev');
      return;
    }
    // Send failed: one retry with a safe emoji.
    if (!reason) step('fallback', { ok: true, reason: 'error' });
    if (await send(msg, fallbackEmoji(), step, true)) end('fallback');
    else end('failed');
  } catch {
    end('failed');
  }
}

function timedOut(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

async function send(
  msg: ReactionMessage,
  emoji: string,
  step: (n: string, f: { ok: boolean; ms?: number } & Record<string, string | number | boolean>) => void,
  retry: boolean,
): Promise<boolean> {
  const t0 = performance.now();
  try {
    if (!msg.react) throw new Error('no react');
    await msg.react(emoji);
    step('react', { ok: true, ms: ms(t0), emoji, ...(retry ? { retry: true } : {}) });
    return true;
  } catch {
    step('react', { ok: false, ms: ms(t0), emoji, ...(retry ? { retry: true } : {}) });
    return false;
  }
}

async function jevEmoji(
  msg: ReactionMessage,
  deps: ReactionDeps,
  picker: JevPicker,
  step: (n: string, f: { ok: boolean; ms?: number } & Record<string, string | number | boolean>) => void,
): Promise<string> {
  const state = jevPickState({
    chatName: msg.chatName,
    speaker: msg.notifyName ?? '',
    body: msg.body,
    priorMessages: msg.priorMessages,
  });
  const cats = deps.palette.categories;
  const catInstructions =
    INTRO + 'First choose the kind of reaction. The options are:\n' + cats.map((c) => `${c.id} — ${c.describe}`).join('\n');
  let t0 = performance.now();
  const c = await picker.pick(catInstructions, cats.map((x) => x.id), state);
  const category = cats.find((x) => x.id === c.choice);
  step('pick-category', { ok: !!category, ms: ms(t0), cost: c.cost, category: category?.id ?? '' });
  if (!category) throw new PickFailure('bad-answer');

  t0 = performance.now();
  const e = await picker.pick(
    INTRO + `Now choose the single emoji from the "${category.id}" kind (${category.describe}) that fits best.`,
    category.emojis,
    state,
  );
  const emoji = category.emojis.find((x) => x === e.choice);
  step('pick-emoji', { ok: !!emoji, ms: ms(t0), cost: e.cost, emoji: emoji ?? '' });
  if (!emoji) throw new PickFailure('bad-answer');
  return emoji;
}
