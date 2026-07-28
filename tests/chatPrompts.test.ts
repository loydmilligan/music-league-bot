import { describe, it, expect } from 'vitest';
import { sanitizeAnswer } from '../src/chat/prompts/sanitize.js';
import { resolveAnswer } from '../src/chat/prompts/resolve.js';
import { render, pickVariant } from '../src/chat/prompts/template.js';
import { interpretMessage } from '../src/chat/prompts/engine.js';
import type { ChatPrompt, PromptOption } from '../src/chat/prompts/types.js';

const ROSTER: PromptOption[] = [
  { id: 'p1', label: 'Clements Johnson', aliases: ['clem', 'clemmy'] },
  { id: 'p2', label: 'Conor Johnston' },
  { id: 'p3', label: 'Darren Paletz', aliases: ['palletz'] },
  { id: 'p4', label: 'Dave Jensen' },
  { id: 'p5', label: 'Dave Steingart', aliases: ['steiny'] },
  { id: 'p6', label: 'Grant Koziol' },
  { id: 'p7', label: 'Jon Black', aliases: ['jorbo'] },
  { id: 'p8', label: 'Matt Mariani', aliases: ['mashew'] },
  { id: 'p9', label: 'Shane Farkas' },
];

const label = (t: string) => {
  const r = resolveAnswer(t, ROSTER);
  return r.kind === 'matched' ? r.option.label : r.kind;
};

describe('sanitizeAnswer', () => {
  it('strips a relay "Sender: " prefix', () => {
    // Regression: matching this raw resolved to Matt Mariani — the REPLIER —
    // instead of their answer, via the highest-confidence route.
    const r = sanitizeAnswer('Matt Mariani: Koziol');
    expect(r.text).toBe('Koziol');
    expect(r.strippedPrefix).toBe(true);
  });

  it('leaves a colon inside ordinary speech alone', () => {
    expect(sanitizeAnswer('honestly: it is grant').strippedPrefix).toBe(false);
  });

  it('does not mistake a URL scheme for a relay prefix', () => {
    expect(sanitizeAnswer('https://open.spotify.com/x').text).toContain('open.spotify.com');
  });

  it('strips the hashtag and reports it', () => {
    const r = sanitizeAnswer('#guess Falleetz', { hashtag: 'guess' });
    expect(r).toMatchObject({ text: 'Falleetz', usedHashtag: true });
  });

  it('strips stacked conversational lead-ins', () => {
    expect(sanitizeAnswer("i think it's Grant").text).toBe('Grant');
  });

  it('strips wrapping quotes but keeps internal punctuation', () => {
    expect(sanitizeAnswer('"O\'Brien-Smith"').text).toBe("O'Brien-Smith");
  });

  it('caps runaway length', () => {
    expect(sanitizeAnswer('x'.repeat(400), { maxLength: 20 }).text).toHaveLength(20);
  });
});

describe('resolveAnswer', () => {
  it('matches exact and partial names', () => {
    expect(label('Koziol')).toBe('Grant Koziol');
    expect(label('Farkas')).toBe('Shane Farkas');
    expect(label('gotta be Grant')).toBe('Grant Koziol');
  });

  it('uses curated aliases', () => {
    expect(label('steiny')).toBe('Dave Steingart');
    expect(label('clem')).toBe('Clements Johnson');
  });

  it('matches group-invented derivations by shared prefix', () => {
    for (const t of ['farkle', 'farkwad', 'farkface']) expect(label(t)).toBe('Shane Farkas');
  });

  it('matches concatenations', () => {
    expect(label('shanefarkas')).toBe('Shane Farkas');
  });

  it('refuses rather than guessing between two Daves', () => {
    expect(label('dave')).toBe('ambiguous');
    expect(label('dave j')).toBe('Dave Jensen');
  });

  it('keeps Johnson and Johnston apart on an exact word', () => {
    expect(label('Johnson')).toBe('Clements Johnson');
    expect(label('Johnston')).toBe('Conor Johnston');
    expect(label('john')).toBe('ambiguous');
  });

  // Measured against 2,945 real chat messages: these words collided with a
  // roster name and would silently record a vote nobody cast.
  it.each([
    ['have', 173], ['back', 26], ['share', 8], ['giant', 6],
    ['color', 3], ['gave', 4], ['comments', 10], ['pallets', 11],
  ])('never matches the innocent word %s (seen %i× in real chat)', (word) => {
    expect(label(word as string)).toBe('unmatched');
  });

  it('does not fuzzy-match a short token two edits away', () => {
    expect(label('Mara')).toBe('unmatched'); // "matt" is d=2 from "mara"
  });

  it('returns unmatched for an empty option set', () => {
    expect(resolveAnswer('grant', []).kind).toBe('unmatched');
  });
});

describe('render', () => {
  it('interpolates dotted paths', () => {
    const r = render('Got {{answer.label}} for {{prompt.subject}}', {
      answer: { label: 'Darren Paletz' },
      prompt: { subject: 'Con Te Partirò' },
    });
    expect(r.text).toBe('Got Darren Paletz for Con Te Partirò');
    expect(r.missing).toEqual([]);
  });

  it('reports missing placeholders instead of throwing', () => {
    const r = render('Hi {{nope.deep}}!', {});
    expect(r.missing).toEqual(['nope.deep']);
    expect(r.text).toBe('Hi !');
  });

  it('picks a stable variant for a given seed', () => {
    const v = ['a', 'b', 'c'];
    expect(pickVariant(v, 'seed')).toBe(pickVariant(v, 'seed'));
    expect(pickVariant([], 'seed')).toBeNull();
  });
});

describe('interpretMessage', () => {
  const prompt: ChatPrompt = {
    id: 'q1',
    chatId: 'g1',
    messageId: 'm-question',
    hashtag: 'guess',
    subject: 'Con Te Partirò',
    options: ROSTER,
    templates: {
      matched: ['Logged {{answer.label}} for {{prompt.subject}}.'],
      ambiguous: ['Which one — {{ambiguous.labels}}?'],
      unmatched: ['No idea who "{{answer.text}}" is.'],
      duplicate: ['You already answered.'],
    },
    onePerPerson: true,
    status: 'open',
  };
  const noAnswers = { hasAnswered: () => false };
  const msg = (over: Partial<Parameters<typeof interpretMessage>[0]>) => ({
    chatId: 'g1', authorId: 'u1', text: '', ...over,
  });

  it('ignores ordinary chat', () => {
    expect(interpretMessage(msg({ text: 'do you have a bidet' }), [prompt], noAnswers)).toBeNull();
  });

  it('accepts a quote-reply and renders the reply', () => {
    const out = interpretMessage(
      msg({ text: 'Koziol', quotedMessageId: 'm-question' }), [prompt], noAnswers,
    );
    expect(out?.trigger).toBe('reply');
    expect(out?.reply).toBe('Logged Grant Koziol for Con Te Partirò.');
  });

  it('accepts the hashtag path', () => {
    const out = interpretMessage(msg({ text: '#guess steiny' }), [prompt], noAnswers);
    expect(out?.trigger).toBe('hashtag');
    expect(out?.reply).toContain('Dave Steingart');
  });

  it('asks rather than guessing when ambiguous', () => {
    const out = interpretMessage(msg({ text: '#guess dave' }), [prompt], noAnswers);
    expect(out?.reply).toBe('Which one — Dave Jensen or Dave Steingart?');
  });

  it('reports an unresolvable answer without inventing one', () => {
    const out = interpretMessage(msg({ text: '#guess Falleetz' }), [prompt], noAnswers);
    expect(out?.resolution.kind).toBe('unmatched');
    expect(out?.reply).toBe('No idea who "Falleetz" is.');
  });

  it('rejects a second answer when onePerPerson', () => {
    const out = interpretMessage(
      msg({ text: '#guess grant' }), [prompt], { hasAnswered: () => true },
    );
    expect(out?.duplicate).toBe(true);
    expect(out?.reply).toBe('You already answered.');
  });

  it('resolves a reply-to-the-bot when exactly one prompt is open', () => {
    // sendMessage returns undefined in this wwebjs build, so prompt.messageId is
    // unknowable and this is the only usable reply signal.
    const out = interpretMessage(
      msg({ text: 'Koziol', quotedFromBot: true }), [{ ...prompt, messageId: undefined }], noAnswers,
    );
    expect(out?.trigger).toBe('reply');
    expect(out?.reply).toContain('Grant Koziol');
  });

  it('will not guess which prompt a bot-reply meant when two are open', () => {
    const two = [
      { ...prompt, id: 'a', messageId: undefined, hashtag: undefined },
      { ...prompt, id: 'b', messageId: undefined, hashtag: undefined },
    ];
    expect(interpretMessage(msg({ text: 'Koziol', quotedFromBot: true }), two, noAnswers)).toBeNull();
  });

  it('ignores a quote-reply to some other message', () => {
    expect(
      interpretMessage(msg({ text: 'Koziol', quotedMessageId: 'other' }), [prompt], noAnswers),
    ).toBeNull();
  });

  it('ignores a closed prompt and another chat', () => {
    expect(interpretMessage(msg({ text: '#guess grant' }), [{ ...prompt, status: 'closed' }], noAnswers)).toBeNull();
    expect(interpretMessage(msg({ chatId: 'other', text: '#guess grant' }), [prompt], noAnswers)).toBeNull();
  });

  it('accepts a bare name in a DM, with no hashtag or reply', () => {
    // A DM to a bot is unambiguous intent, and keeps the guess secret from the
    // group — the whole point of offering the private channel.
    const out = interpretMessage(
      { chatId: 'dm-1', authorId: 'u1', text: 'steiny', isDirect: true },
      [{ ...prompt, acceptDirect: true }],
      noAnswers,
    );
    expect(out?.trigger).toBe('direct');
    expect(out?.reply).toContain('Dave Steingart');
  });

  it('ignores a DM when no prompt opted into private answers', () => {
    expect(
      interpretMessage(
        { chatId: 'dm-1', authorId: 'u1', text: 'steiny', isDirect: true }, [prompt], noAnswers,
      ),
    ).toBeNull();
  });

  it('needs a hashtag in a DM when two prompts accept private answers', () => {
    const two = [
      { ...prompt, id: 'a', acceptDirect: true, hashtag: 'guessa' },
      { ...prompt, id: 'b', acceptDirect: true, hashtag: 'guessb' },
    ];
    const dm = (text: string) => ({ chatId: 'dm-1', authorId: 'u1', text, isDirect: true });
    expect(interpretMessage(dm('steiny'), two, noAnswers)).toBeNull();
    expect(interpretMessage(dm('#guessb steiny'), two, noAnswers)?.promptId).toBe('b');
  });

  it('uses the quoted card to pick between two prompts taking private answers', () => {
    // WhatsApp "Reply privately" carries the original card into the DM. That
    // quoted text is what lets several questions run at once — across leagues,
    // or within one — which a bare name in a DM could never disambiguate.
    const two = [
      { ...prompt, id: 'a', subject: 'Con Te Partirò', acceptDirect: true, hashtag: undefined },
      { ...prompt, id: 'b', subject: 'Mala Vida', acceptDirect: true, hashtag: undefined },
    ];
    const out = interpretMessage(
      {
        chatId: 'dm-1', authorId: 'u1', text: 'steiny', isDirect: true,
        quotedText: '🎯 Who submitted this?\nMala Vida — Gogol Bordello',
      },
      two, noAnswers,
    );
    expect(out?.promptId).toBe('b');
    expect(out?.trigger).toBe('direct');
  });

  it('treats a bare hashtag as unmatched, not a crash', () => {
    const out = interpretMessage(msg({ text: '#guess' }), [prompt], noAnswers);
    expect(out?.resolution.kind).toBe('unmatched');
  });
});
