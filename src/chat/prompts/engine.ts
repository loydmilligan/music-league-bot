/**
 * Decide whether an inbound message answers an open prompt, and what to say back.
 *
 * Pure: no I/O, no clock, no randomness. The caller supplies the open prompts and
 * a duplicate check, and receives a fully-rendered reply or null.
 *
 * Recognition is deliberately gated to an explicit quote-reply or an explicit
 * hashtag. Scanning open conversation was measured against real chat and matched
 * a name in 14.4% of ordinary messages — the gate is what makes this viable.
 */
import type { AnswerOutcome, ChatPrompt, InboundMessage, Resolution } from './types.js';
import { sanitizeAnswer } from './sanitize.js';
import { resolveAnswer, type ResolveOptions } from './resolve.js';
import { pickVariant, render, type TemplateVars } from './template.js';

export interface EngineDeps {
  /** True when this author already has a recorded answer for this prompt. */
  hasAnswered(promptId: string, authorId: string): boolean;
}

export interface InterpretOptions {
  resolve?: ResolveOptions;
  /** Extra template variables, merged under the engine's own. */
  vars?: TemplateVars;
}

/**
 * Returns null when the message is not an answer at all — the overwhelmingly
 * common case, and the caller should do nothing.
 */
export function interpretMessage(
  msg: InboundMessage,
  prompts: ChatPrompt[],
  deps: EngineDeps,
  opts: InterpretOptions = {},
): AnswerOutcome | null {
  // A DM carries no chat id we can match on, so it is offered every prompt that
  // opted into private answers; a group message only sees its own chat's.
  const open = prompts.filter(
    (p) => p.status === 'open' && (msg.isDirect ? p.acceptDirect === true : p.chatId === msg.chatId),
  );
  if (open.length === 0) return null;

  const targeted = selectPrompt(msg, open);
  if (!targeted) return null;
  const { prompt, trigger } = targeted;

  const clean = sanitizeAnswer(msg.text, { hashtag: prompt.hashtag });
  // A bare "#guess" with nothing after it is a question, not an answer; a
  // quote-reply that sanitises to nothing (a sticker, an emoji) is not one either.
  if (!clean.text) {
    if (trigger === 'hashtag' || trigger === 'direct') {
      return outcome(prompt, msg, '', { kind: 'unmatched' }, trigger, false, opts);
    }
    return null;
  }

  if (prompt.onePerPerson && deps.hasAnswered(prompt.id, msg.authorId)) {
    return outcome(prompt, msg, clean.text, { kind: 'unmatched' }, trigger, true, opts);
  }

  const resolution = resolveAnswer(clean.text, prompt.options, opts.resolve);
  return outcome(prompt, msg, clean.text, resolution, trigger, false, opts);
}

function selectPrompt(
  msg: InboundMessage,
  open: ChatPrompt[],
): { prompt: ChatPrompt; trigger: 'reply' | 'hashtag' | 'direct' } | null {
  // In a DM the whole conversation is the answer channel, so a bare name counts
  // — no hashtag, no quote-reply. Only when exactly one prompt takes private
  // answers, otherwise "Grant" could belong to either.
  if (msg.isDirect) {
    // "Reply privately" quotes the card, so the quoted text names the prompt.
    // This is what makes several questions answerable at once — across leagues
    // or within one — which a bare name in a DM never could.
    if (msg.quotedText) {
      const quoted = msg.quotedText.toLowerCase();
      const byQuote = open.filter((p) => p.subject && quoted.includes(p.subject.toLowerCase()));
      if (byQuote.length === 1) return { prompt: byQuote[0], trigger: 'direct' };
    }
    if (open.length === 1) return { prompt: open[0], trigger: 'direct' };
    const tagged = open.filter((p) => p.hashtag && hasHashtag(msg.text, p.hashtag));
    return tagged.length === 1 ? { prompt: tagged[0], trigger: 'direct' } : null;
  }

  // A quote-reply names its prompt exactly, so it always wins.
  if (msg.quotedMessageId) {
    const byReply = open.find((p) => p.messageId && p.messageId === msg.quotedMessageId);
    if (byReply) return { prompt: byReply, trigger: 'reply' };
  }
  // Fallback for platforms that cannot tell us our own message id: a reply to
  // ANY bot message resolves to the single open prompt. With two open at once
  // the reference is genuinely unknowable, so fall through to the hashtag.
  if (msg.quotedFromBot && open.length === 1) return { prompt: open[0], trigger: 'reply' };
  const tagged = open.filter((p) => p.hashtag && hasHashtag(msg.text, p.hashtag));
  // Several open prompts sharing one hashtag cannot be told apart; the caller
  // orders prompts oldest-first, so the newest is the live question.
  if (tagged.length > 0) return { prompt: tagged[tagged.length - 1], trigger: 'hashtag' };
  return null;
}

function hasHashtag(text: string, hashtag: string): boolean {
  const escaped = hashtag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)#${escaped}\\b`, 'iu').test(text ?? '');
}

function outcome(
  prompt: ChatPrompt,
  msg: InboundMessage,
  answerText: string,
  resolution: Resolution,
  trigger: 'reply' | 'hashtag' | 'direct',
  duplicate: boolean,
  opts: InterpretOptions,
): AnswerOutcome {
  const bucket = duplicate
    ? prompt.templates.duplicate ?? []
    : resolution.kind === 'matched'
      ? prompt.templates.matched
      : resolution.kind === 'ambiguous'
        ? prompt.templates.ambiguous
        : prompt.templates.unmatched;

  const vars: TemplateVars = {
    ...(opts.vars ?? {}),
    prompt: { subject: prompt.subject ?? '', id: prompt.id },
    author: { name: msg.authorName ?? '', id: msg.authorId },
    answer: {
      text: answerText,
      label: resolution.kind === 'matched' ? resolution.option.label : '',
      id: resolution.kind === 'matched' ? resolution.option.id : '',
      via: resolution.kind === 'matched' ? resolution.via : '',
    },
    // "Dave Jensen or Dave Steingart" — ready to drop into an ambiguous reply.
    ambiguous: {
      labels:
        resolution.kind === 'ambiguous'
          ? joinWithOr(resolution.options.map((o) => o.label))
          : '',
      count: resolution.kind === 'ambiguous' ? resolution.options.length : 0,
    },
  };

  // Seeded per author+prompt+answer so a given answer always draws the same
  // variant — a bot that reworded itself on every retry would read as broken.
  const variant = pickVariant(bucket, `${prompt.id}|${msg.authorId}|${answerText}`);
  const reply = variant ? render(variant, vars).text : null;

  return { promptId: prompt.id, authorId: msg.authorId, answerText, resolution, trigger, reply, duplicate };
}

function joinWithOr(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}
