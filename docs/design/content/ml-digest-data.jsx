// music-league-bot — /digest fixtures
// Round 14 "Must Be Love on the Brain" — sample data from the design brief
// with a couple of additions to make the visualizations land (extra
// submissions for the vote matrix, etc.).

const DIGEST_ROUND = {
  id: "r-14",
  number: 14,
  season: 3,
  league: "Vinyl scramblers",
  name: "Must Be Love on the Brain",
  themeChooser: "Sam",
  voteClosed: "May 17, 2026",
  submitClosed: "May 14, 2026",
  voters: 6,
  submissions: 6,
  totalPointsAwarded: 64,
};

// Six submissions, fully ranked.
const DIGEST_SUBMISSIONS = [
  { rank: 1, points: 18, title: "Wicked Game",            artist: "Chris Isaak",       album: "Heart Shaped World",        year: 1989, dur: "4:46", submitter: "Kieran", note: "I actually heard this at a funeral last year and sobbed. Felt right." },
  { rank: 2, points: 14, title: "I Will Always Love You", artist: "Whitney Houston",   album: "The Bodyguard OST",         year: 1992, dur: "4:31", submitter: "Matt",   note: "obvious. but obvious for a reason." },
  { rank: 3, points:  9, title: "Strange Fruit",          artist: "Billie Holiday",    album: "Commodore Recordings",      year: 1939, dur: "3:02", submitter: "Alex",   note: "complicated. it's a love song to a different kind of america." },
  { rank: 4, points:  8, title: "Take My Breath Away",    artist: "Berlin",            album: "Top Gun OST",                year: 1986, dur: "4:13", submitter: "Sam",    note: "self-pick for the theme i picked. judge me." },
  { rank: 5, points:  4, title: "Lovefool",               artist: "The Cardigans",     album: "First Band on the Moon",    year: 1996, dur: "3:18", submitter: "Jordan", note: "It's Love Month. Sue me." },
  { rank: 6, points:  2, title: "Bizarre Love Triangle",  artist: "New Order",         album: "Brotherhood",                year: 1986, dur: "4:18", submitter: "Davey",  note: "the lyrics are about anxiety as much as love. don't @ me." },
];

// The villain — Sam's downvote on Jordan's Lovefool.
const DIGEST_VILLAIN = {
  songTitle: "Lovefool",
  songArtist: "The Cardigans",
  songAlbum: "First Band on the Moon",
  songYear: 1996,
  submitter: "Jordan",
  downvoter: "Sam",
  points: -3,
  comment: "Sorry Jordan, felt like a cheap shot at the theme.",
};

// Six voters × six songs. Each row = a voter, each cell = points given to
// that submitter. Negative = the round's single downvote. Numbers sum to
// each voter's allotted 15 point bank (canonical Music League rules).
const FLOW_VOTERS = ["Kieran", "Matt", "Sam", "Alex", "Jordan", "Davey"];
const FLOW_SUBMITTERS = ["Kieran", "Matt", "Sam", "Alex", "Jordan", "Davey"];
const DIGEST_FLOW_MATRIX = {
  //         Kieran  Matt  Sam   Alex  Jordan Davey
  Kieran:  [ "—",    5,    0,    3,    5,    2 ],
  Matt:    [ 4,     "—",   1,    5,    0,    1 ],
  Sam:     [ 5,     4,    "—",   4,    -3,   1 ],
  Alex:    [ 5,     5,    0,    "—",   1,    0 ],
  Jordan:  [ 4,     0,    3,    0,    "—",   1 ],
  Davey:   [ 0,     0,    2,    1,    1,    "—" ],
};

// Notable edges — these become the "annotated flow" content in variant B
// and the "credits roll" callouts in variant C. Each is a single observation
// about the matrix above.
const DIGEST_FLOW_NOTABLE = [
  { kind: "first",  from: "Kieran", to: "Matt",  pts: 5, text: "First cross-faction vote of the season. Kieran has never given Matt points before." },
  { kind: "across", from: "Sam",    to: "Alex",  pts: 4, text: "Voted across enemy lines. Sam and Alex have publicly bickered all season." },
  { kind: "mutual", from: "Matt",   to: "Alex",  pts: 5, text: "Matt and Alex gave each other max points. The mutual top-billing of the round." },
  { kind: "down",   from: "Sam",    to: "Jordan",pts: -3, text: "Theme chooser used their downvote on the round's most theme-on-the-nose pick." },
];

// Consensus / controversy.
const DIGEST_CONSENSUS = {
  agreed: {
    title: "I Will Always Love You",
    artist: "Whitney Houston",
    submitter: "Matt",
    rank: 2,
    spread: [4, 5, 4, 5, 4],   // 5 voters, no downvote, tight cluster
    avg: 4.4,
    variance: 0.24,
    voterCount: 5,
  },
  contested: {
    title: "Strange Fruit",
    artist: "Billie Holiday",
    submitter: "Alex",
    rank: 3,
    spread: [5, 5, 4, 1, 1, -3], // wide split + a downvote
    avg: 2.17,
    variance: 8.97,
    voterCount: 6,
  },
};

// LLM-generated comment highlights.
const DIGEST_COMMENTS = [
  {
    type: "winner-note",
    who: "Kieran",
    whose_song: "Wicked Game",
    rank: 1,
    quote: "I actually heard this at a funeral last year and sobbed. Felt right.",
    gloss: "Won the round outright. The submission note was probably the highest-stakes one Kieran's ever written.",
  },
  {
    type: "vote-note",
    who: "Matt",
    whose_song: "Strange Fruit",
    points: 1,
    quote: "Brave choice. Too brave for me.",
    gloss: "Gave it one point — but couldn't fully back away either. Most ambivalent vote of the round.",
  },
  {
    type: "loser-note",
    who: "Jordan",
    whose_song: "Lovefool",
    rank: 5,
    quote: "It's Love Month. Sue me.",
    gloss: "Took the round's lone downvote with grace. The note reads even better in retrospect.",
  },
];

// LLM-generated chat summary. Each callout describes a pattern from the
// WhatsApp chat during the voting window.
const DIGEST_CHAT = [
  {
    type: "guesses",
    headline: "FIVE WRONG GUESSES",
    text: "Five people in chat guessed Wicked Game was Matt's. It was Kieran's. Kieran kept quiet for two days while everyone got it wrong.",
  },
  {
    type: "trash",
    who: "Kieran",
    headline: "TRASH TALK · KIERAN",
    quote: "Whoever submitted Lovefool owes us an explanation.",
    gloss: "Then gave it 4 points anyway. The note still hasn't been delivered.",
  },
  {
    type: "buzz",
    headline: "BUZZ TRACK",
    text: "Strange Fruit was the most-discussed song in chat — three separate threads on whether it even counts as a love song. The group split into camps and stayed there through voting.",
  },
];

// Relationship context — what the operator pastes in to prime the LLM.
// Renders in the page chrome above the infographic (not in the export).
const DIGEST_REL_CONTEXT = "Matt and Kieran are historic rivals — they've never voted for each other across 13 rounds. Sam and Alex have been bickering all season after the r-9 dispute. Jordan tends to pick on-the-nose for the theme; Davey leans dark/contrarian. The 'theme chooser using their downvote' is rare and considered a heel move.";

Object.assign(window, {
  DIGEST_ROUND, DIGEST_SUBMISSIONS, DIGEST_VILLAIN,
  FLOW_VOTERS, FLOW_SUBMITTERS, DIGEST_FLOW_MATRIX, DIGEST_FLOW_NOTABLE,
  DIGEST_CONSENSUS, DIGEST_COMMENTS, DIGEST_CHAT, DIGEST_REL_CONTEXT,
});
