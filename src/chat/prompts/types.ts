/**
 * A generic ask-the-group / collect-answers engine.
 *
 * Deliberately knows nothing about songs, submitters, or Music League. A prompt
 * is "a question posed to a chat, whose answers resolve to one of a known set of
 * options". Guess-the-submitter is merely the first caller: its options happen to
 * be players. A prompt whose options are albums, years, or yes/no works
 * identically and needs no new code here.
 *
 * Everything in this directory is pure — no WhatsApp, no database, no clock.
 */

/** One of the answers a prompt will accept. `id` is the caller's own key. */
export interface PromptOption {
  id: string;
  label: string;
  /** Nicknames the group actually types. Curated, because they cannot be inferred. */
  aliases?: string[];
}

/** Copy the bot replies with, chosen by what happened to the answer. */
export interface PromptTemplates {
  /** Resolved to exactly one option. */
  matched: string[];
  /** Resolved to several — the bot must ask, never guess. */
  ambiguous: string[];
  /** Resolved to nothing. */
  unmatched: string[];
  /** Someone answering a second time, when onePerPerson is set. */
  duplicate?: string[];
}

export interface ChatPrompt {
  id: string;
  chatId: string;
  /** Id of the bot's own question message, for quote-reply detection. */
  messageId?: string;
  /** Bare word (no '#'), e.g. "guess". Answers may arrive as "#guess <answer>". */
  hashtag?: string;
  /** What the question is ABOUT — free for templates to interpolate. */
  subject?: string;
  options: PromptOption[];
  templates: PromptTemplates;
  /** First answer wins; later ones get the duplicate template. */
  onePerPerson: boolean;
  /**
   * Accept answers sent privately to the bot, not just in `chatId`.
   *
   * The point is secrecy: an answer typed in the group is visible to everyone,
   * so early answers tip off later ones. A DM keeps a guess blind. In a DM no
   * hashtag or quote-reply is needed — nobody messages a bot by accident.
   */
  acceptDirect?: boolean;
  /**
   * Accept a bare name typed straight into the chat — no hashtag, no reply.
   *
   * Only safe under the "bare answer" rule below. Measured over 2,954 real
   * Boarz messages: treating ANY message as an answer fires on 14.4% of
   * ordinary conversation, because people genuinely say each other's names
   * ("Darren said he'll vote tonight"). Requiring the message to be a name and
   * nothing else drops that to 0.58%.
   */
  acceptInline?: boolean;
  status: 'open' | 'closed';
}

/** What a piece of free text resolved to. */
export type Resolution =
  | { kind: 'matched'; option: PromptOption; via: string }
  | { kind: 'ambiguous'; options: PromptOption[] }
  | { kind: 'unmatched' };

/** A normalised inbound message. The caller adapts its platform to this. */
export interface InboundMessage {
  chatId: string;
  /** Stable id of the sender. */
  authorId: string;
  /** Display name, when the platform offers one. */
  authorName?: string;
  text: string;
  /** Id of the message this one quote-replies, if any. */
  quotedMessageId?: string;
  /**
   * True when this message quote-replies something the BOT said.
   *
   * Needed because `sendMessage` returns undefined in this whatsapp-web.js build
   * (broken Store), so a prompt can never learn its own message id and
   * `quotedMessageId` has nothing to be compared against. Quoting the bot at all
   * is the usable signal; it resolves to a prompt only when exactly one is open.
   */
  quotedFromBot?: boolean;
  /** True when this arrived as a private message to the bot, not in a group. */
  isDirect?: boolean;
  /**
   * Body/caption of the quoted message, when there is one.
   *
   * WhatsApp's "Reply privately" opens a DM carrying the original message as a
   * quote, which is the only thing that says WHICH question a private answer is
   * for. Message ids are unavailable (sendMessage returns undefined), so the
   * quoted TEXT is what identifies the prompt.
   */
  quotedText?: string;
}

/** The engine's verdict. `reply` is already rendered and ready to send. */
export interface AnswerOutcome {
  promptId: string;
  authorId: string;
  /** The cleaned text the resolver actually saw — useful for auditing. */
  answerText: string;
  resolution: Resolution;
  /** How the message was recognised as an answer to this prompt. */
  trigger: 'reply' | 'hashtag' | 'direct' | 'inline';
  /** Null when a template list was empty — caller then stays silent. */
  reply: string | null;
  /** True when onePerPerson rejected it; no answer should be recorded. */
  duplicate: boolean;
}
