export type Intent = 'alt' | 'retro' | 'found' | 'maybe' | 'unclassified';

const TRIGGERS: Array<{ intent: Intent; phrases: string[] }> = [
  {
    intent: 'alt',
    phrases: [
      'almost picked', 'was going to', "was gonna", 'yes/no/maybe', 'wildcard',
      'backup', 'thinking about', 'considering', 'nearly went with',
      'still thinking', 'on my list', 'shortlist',
    ],
  },
  {
    intent: 'retro',
    phrases: [
      'rediscovering', 'still holds up', 'remember when', 'going through old',
      'throwback', 'nostalgia', 'forgot about', 'used to love', 'back in the day',
      'holds up', 'still good',
    ],
  },
  {
    intent: 'maybe',
    phrases: [
      'what about', 'did anyone', 'anyone think', 'wondering if', 'could work',
      'might work', 'possibly', 'maybe', 'not sure if',
    ],
  },
  {
    intent: 'found',
    phrases: [
      'check this', 'found this', 'this band', 'best x song', 'best song',
      'this one', 'have you heard', 'listen to this', 'new to me',
      'just found', 'just heard', 'discovered',
    ],
  },
];

const PRIORITY: Intent[] = ['alt', 'retro', 'maybe', 'found'];

export function classifyIntent(message: string, lastPrior?: string): Intent {
  const haystack = `${message} ${lastPrior ?? ''}`.toLowerCase();
  for (const intent of PRIORITY) {
    const trigger = TRIGGERS.find(t => t.intent === intent)!;
    if (trigger.phrases.some(p => haystack.includes(p))) return intent;
  }
  return 'unclassified';
}
