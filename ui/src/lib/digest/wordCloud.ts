export interface WordCloudText {
  text: string;
  source?: 'comment' | 'chat' | string;
}

export interface WordCloudWord {
  word: string;
  count: number;
  /** Relative size, where the most frequent word has a weight of 1. */
  weight: number;
}

export interface WordCloudOptions {
  limit?: number;
  minLength?: number;
  /** Replaces the built-in stopword list entirely. */
  stopwords?: ReadonlySet<string> | readonly string[];
  /**
   * Added on top of the effective stopword list rather than replacing it.
   * Use this for per-round noise (song titles, artist names, handles) so the
   * built-in articles/connectives stay filtered.
   */
  extraStopwords?: ReadonlySet<string> | readonly string[];
}

const DEFAULT_STOPWORDS = new Set([
  'a',
  'about',
  'after',
  'again',
  'all',
  'also',
  'am',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'because',
  'been',
  'before',
  'being',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'for',
  'from',
  'get',
  'got',
  'had',
  'has',
  'have',
  'he',
  'her',
  'here',
  'him',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'just',
  'like',
  'me',
  'more',
  'most',
  'my',
  'no',
  'not',
  'of',
  'on',
  'or',
  'our',
  'out',
  'really',
  'so',
  'some',
  'such',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'to',
  'too',
  'up',
  'very',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
  // Pronouns / possessives the original list missed.
  'hers',
  'herself',
  'himself',
  'mine',
  'ours',
  'own',
  'she',
  'themselves',
  'us',
  'yours',
  'yourself',
  // Auxiliaries and modals.
  'aint',
  "ain't",
  'cannot',
  'cant',
  "can't",
  'couldnt',
  "couldn't",
  'didnt',
  "didn't",
  'doesnt',
  "doesn't",
  'doing',
  'done',
  'dont',
  "don't",
  'hadnt',
  "hadn't",
  'hasnt',
  "hasn't",
  'havent',
  "haven't",
  'hed',
  "he'd",
  'hes',
  "he's",
  'isnt',
  "isn't",
  'itll',
  "it's",
  'ive',
  "i'm",
  "i've",
  "i'll",
  "i'd",
  'may',
  'might',
  'must',
  'shall',
  'shes',
  "she's",
  'should',
  'shouldnt',
  "shouldn't",
  'thats',
  "that's",
  'theres',
  "there's",
  'theyre',
  "they're",
  'wasnt',
  "wasn't",
  'werent',
  "weren't",
  'weve',
  "we've",
  "we're",
  'wont',
  "won't",
  'wouldnt',
  "wouldn't",
  'youd',
  "you'd",
  'youll',
  "you'll",
  'youre',
  "you're",
  'youve',
  "you've",
  // Conjunctions, prepositions, determiners.
  'above',
  'across',
  'against',
  'along',
  'among',
  'another',
  'around',
  'back',
  'below',
  'besides',
  'between',
  'both',
  'down',
  'during',
  'each',
  'either',
  'else',
  'enough',
  'every',
  'few',
  'however',
  'instead',
  'less',
  'many',
  'much',
  'near',
  'neither',
  'off',
  'once',
  'only',
  'onto',
  'other',
  'others',
  'over',
  'per',
  'since',
  'though',
  'through',
  'together',
  'toward',
  'towards',
  'under',
  'until',
  'upon',
  'while',
  'whom',
  'whose',
  'with',
  'within',
  'without',
  'yet',
  // Low-signal filler that dominates chat and vote comments.
  'actually',
  'almost',
  'already',
  'always',
  'anything',
  'basically',
  'definitely',
  'even',
  'ever',
  'everything',
  'going',
  'gonna',
  'gotta',
  'guess',
  'kinda',
  'kind',
  'lot',
  'maybe',
  'much',
  'never',
  'nothing',
  'now',
  'pretty',
  'probably',
  'quite',
  'same',
  'seem',
  'seems',
  'something',
  'sort',
  'still',
  'sure',
  'thing',
  'things',
  'think',
  'those',
  'thought',
  'want',
  'way',
  'well',
  'yeah',
  'yes',
]);

const URL_OR_EMAIL = /(?:https?:\/\/|www\.|\S+@\S+\.)\S+/giu;
const USER_MENTION = /@[\p{L}\p{N}_.-]+/gu;
const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
const DEFAULT_LIMIT = 25;

function normalizeWord(word: string): string {
  return word
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/’/g, "'");
}

function asStopwordSet(stopwords: WordCloudOptions['stopwords']): ReadonlySet<string> {
  if (!stopwords) return DEFAULT_STOPWORDS;
  return Array.isArray(stopwords)
    ? new Set(stopwords.map((word) => normalizeWord(word)))
    : (stopwords as ReadonlySet<string>);
}

function withExtras(
  base: ReadonlySet<string>,
  extras: WordCloudOptions['extraStopwords'],
): ReadonlySet<string> {
  if (!extras) return base;
  const merged = new Set(base);
  for (const word of extras) merged.add(normalizeWord(word));
  return merged;
}

function sourceText(entry: string | WordCloudText): string {
  return typeof entry === 'string' ? entry : entry.text;
}

/**
 * Count meaningful words from vote comments and/or chat messages.
 *
 * Sorting is deliberately independent of input order: ties are resolved by
 * alphabetical order so the rendered cloud does not flicker between runs.
 */
export function getWordFrequencies(
  entries: readonly (string | WordCloudText)[],
  options: WordCloudOptions = {},
): WordCloudWord[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const minLength = options.minLength ?? 3;
  if (limit <= 0 || minLength <= 0) return [];

  const stopwords = withExtras(asStopwordSet(options.stopwords), options.extraStopwords);
  const counts = new Map<string, number>();

  for (const entry of entries) {
    const text = sourceText(entry);
    if (!text) continue;
    for (const match of text.replace(URL_OR_EMAIL, ' ').replace(USER_MENTION, ' ').matchAll(WORD)) {
      const word = normalizeWord(match[0]);
      if (word.length < minLength || stopwords.has(word) || /^(.)\1+$/.test(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  const ranked = [...counts.entries()]
    .sort(([wordA, countA], [wordB, countB]) => countB - countA || wordA.localeCompare(wordB))
    .slice(0, limit);
  const maximum = ranked[0]?.[1] ?? 1;

  return ranked.map(([word, count]) => ({
    word,
    count,
    weight: count / maximum,
  }));
}
