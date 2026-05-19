// Fixture data for /digest preview — sourced from
// docs/mashco-design-handoff-digest/digest-handoff/reference/ml-digest-data.jsx.
// Used until the LLM service (Task 7) writes real data into digest_sections.

export const DIGEST_ROUND = {
  id: 'r-14',
  number: 14,
  season: 3,
  league: 'Vinyl scramblers',
  name: 'Must Be Love on the Brain',
  themeChooser: 'Sam',
  voteClosed: 'May 17, 2026',
  submitClosed: 'May 14, 2026',
  voters: 6,
  submissions: 6,
  totalPointsAwarded: 64,
};

export type DigestSubmission = {
  rank: number;
  points: number;
  title: string;
  artist: string;
  album: string;
  year: number;
  dur: string;
  submitter: string;
  note: string;
};

export const DIGEST_SUBMISSIONS: DigestSubmission[] = [
  { rank: 1, points: 18, title: 'Wicked Game',            artist: 'Chris Isaak',       album: 'Heart Shaped World',     year: 1989, dur: '4:46', submitter: 'Kieran', note: 'I actually heard this at a funeral last year and sobbed. Felt right.' },
  { rank: 2, points: 14, title: 'I Will Always Love You', artist: 'Whitney Houston',   album: 'The Bodyguard OST',      year: 1992, dur: '4:31', submitter: 'Matt',   note: 'obvious. but obvious for a reason.' },
  { rank: 3, points:  9, title: 'Strange Fruit',          artist: 'Billie Holiday',    album: 'Commodore Recordings',   year: 1939, dur: '3:02', submitter: 'Alex',   note: "complicated. it's a love song to a different kind of america." },
  { rank: 4, points:  8, title: 'Take My Breath Away',    artist: 'Berlin',            album: 'Top Gun OST',            year: 1986, dur: '4:13', submitter: 'Sam',    note: 'self-pick for the theme i picked. judge me.' },
  { rank: 5, points:  4, title: 'Lovefool',               artist: 'The Cardigans',     album: 'First Band on the Moon', year: 1996, dur: '3:18', submitter: 'Jordan', note: "It's Love Month. Sue me." },
  { rank: 6, points:  2, title: 'Bizarre Love Triangle',  artist: 'New Order',         album: 'Brotherhood',            year: 1986, dur: '4:18', submitter: 'Davey',  note: "the lyrics are about anxiety as much as love. don't @ me." },
];

export const DIGEST_VILLAIN = {
  songTitle: 'Lovefool',
  songArtist: 'The Cardigans',
  songAlbum: 'First Band on the Moon',
  songYear: 1996,
  submitter: 'Jordan',
  downvoter: 'Sam',
  points: -3,
  comment: 'Sorry Jordan, felt like a cheap shot at the theme.',
};

export type FlowNotableKind = 'first' | 'across' | 'mutual' | 'down';
export type FlowNotable = { kind: FlowNotableKind; from: string; to: string; pts: number; text: string };

export const DIGEST_FLOW_NOTABLE: FlowNotable[] = [
  { kind: 'first',  from: 'Kieran', to: 'Matt',   pts:  5, text: 'First cross-faction vote of the season. Kieran has never given Matt points before.' },
  { kind: 'across', from: 'Sam',    to: 'Alex',   pts:  4, text: 'Voted across enemy lines. Sam and Alex have publicly bickered all season.' },
  { kind: 'mutual', from: 'Matt',   to: 'Alex',   pts:  5, text: 'Matt and Alex gave each other max points. The mutual top-billing of the round.' },
  { kind: 'down',   from: 'Sam',    to: 'Jordan', pts: -3, text: "Theme chooser used their downvote on the round's most theme-on-the-nose pick." },
];

export type ConsensusSide = {
  title: string;
  artist: string;
  submitter: string;
  rank: number;
  spread: number[];
  avg: number;
  variance: number;
  voterCount: number;
};

export const DIGEST_CONSENSUS: { agreed: ConsensusSide; contested: ConsensusSide } = {
  agreed: {
    title: 'I Will Always Love You',
    artist: 'Whitney Houston',
    submitter: 'Matt',
    rank: 2,
    spread: [4, 5, 4, 5, 4],
    avg: 4.4,
    variance: 0.24,
    voterCount: 5,
  },
  contested: {
    title: 'Strange Fruit',
    artist: 'Billie Holiday',
    submitter: 'Alex',
    rank: 3,
    spread: [5, 5, 4, 1, 1, -3],
    avg: 2.17,
    variance: 8.97,
    voterCount: 6,
  },
};

export type DigestComment = {
  type: 'winner-note' | 'vote-note' | 'loser-note';
  who: string;
  whose_song: string;
  rank?: number;
  points?: number;
  quote: string;
  gloss: string;
};

export const DIGEST_COMMENTS: DigestComment[] = [
  {
    type: 'winner-note',
    who: 'Kieran',
    whose_song: 'Wicked Game',
    rank: 1,
    quote: 'I actually heard this at a funeral last year and sobbed. Felt right.',
    gloss: "Won the round outright. The submission note was probably the highest-stakes one Kieran's ever written.",
  },
  {
    type: 'vote-note',
    who: 'Matt',
    whose_song: 'Strange Fruit',
    points: 1,
    quote: 'Brave choice. Too brave for me.',
    gloss: "Gave it one point — but couldn't fully back away either. Most ambivalent vote of the round.",
  },
  {
    type: 'loser-note',
    who: 'Jordan',
    whose_song: 'Lovefool',
    rank: 5,
    quote: "It's Love Month. Sue me.",
    gloss: 'Took the round\'s lone downvote with grace. The note reads even better in retrospect.',
  },
];

export type DigestChatCallout = {
  type: 'guesses' | 'trash' | 'buzz';
  headline: string;
  who?: string;
  quote?: string;
  text?: string;
  gloss?: string;
};

export const DIGEST_CHAT: DigestChatCallout[] = [
  {
    type: 'guesses',
    headline: 'FIVE WRONG GUESSES',
    text: "Five people in chat guessed Wicked Game was Matt's. It was Kieran's. Kieran kept quiet for two days while everyone got it wrong.",
  },
  {
    type: 'trash',
    who: 'Kieran',
    headline: 'TRASH TALK · KIERAN',
    quote: 'Whoever submitted Lovefool owes us an explanation.',
    gloss: "Then gave it 4 points anyway. The note still hasn't been delivered.",
  },
  {
    type: 'buzz',
    headline: 'BUZZ TRACK',
    text: 'Strange Fruit was the most-discussed song in chat — three separate threads on whether it even counts as a love song. The group split into camps and stayed there through voting.',
  },
];

export type SectionKind = 'podium' | 'villain' | 'flow' | 'consensus' | 'quotes' | 'chat';

export const DIGEST_SECTION_ORDER: SectionKind[] = [
  'podium',
  'villain',
  'flow',
  'consensus',
  'quotes',
  'chat',
];
