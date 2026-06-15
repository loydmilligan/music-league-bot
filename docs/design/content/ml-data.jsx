// music-league-bot — shared mock data
// All fixtures live here so screens stay declarative and the variations
// don't drift apart on numbers. Names are invented; themes are in the
// Mash voice (sentence case, no marketing tone).

const LEAGUES = [
  { id: "vinyl-scramblers",   name: "Vinyl scramblers",   slug: "vinyl-scramblers",   members: 9, round: 14, status: "active" },
  { id: "the-jukebox",        name: "The jukebox",        slug: "the-jukebox",        members: 6, round: 7,  status: "voting" },
  { id: "vibe-shift-club",    name: "Vibe shift club",    slug: "vibe-shift-club",    members: 11, round: 22, status: "submissions-open" },
  { id: "deep-cuts-only",     name: "Deep cuts only",     slug: "deep-cuts-only",     members: 5, round: 4,  status: "between-rounds" },
];

const ACTIVE_LEAGUE = LEAGUES[0];

const ACTIVE_ROUND = {
  number: 14,
  theme: "Songs that sound like a question",
  prompt:
    "Submit a song whose melody, lyric, or structure leaves you waiting for an answer. Bonus points for a track that ends on the question, not the resolution.",
  submitOpens:  "Mon 8:00 AM",
  submitCloses: "Sun 11:59 PM",
  voteOpens:    "Mon 8:00 AM (next)",
  daysLeft: 3,
  hoursLeft: 14,
  myPick: "Tom Waits — Hold On",
  myPickStatus: "submitted",
  shortlistCount: 11,
};

// Songs in the working shortlist for the active round.
// `source` is "spotify" | "youtube" — drives the link icon
// `addedBy` is "self" if I added it manually, otherwise the contact who
// dropped it in the WhatsApp chat. `mention` is the chat line that hit
// the watcher.
const SHORTLIST = [
  {
    id: "s1", artist: "Tom Waits", title: "Hold On",
    album: "Mule Variations", year: 1999, dur: "5:32",
    source: "spotify", rating: 5,
    addedBy: "self", addedAt: "Mon 11:14 AM",
    note: "Current top pick. 'You can never hold back spring' lands the question without answering it.",
    tags: ["front-runner", "theme-fit"],
  },
  {
    id: "s2", artist: "Big Thief", title: "Sparrow",
    album: "Dragon New Warm Mountain", year: 2022, dur: "4:51",
    source: "spotify", rating: 4,
    addedBy: "Greg", addedAt: "Tue 9:41 PM",
    mention: "this is literally the prompt",
    note: "Greg dropped this without context. The opening 'who was the man, who was the woman' is the right shape.",
    tags: ["theme-fit"],
  },
  {
    id: "s3", artist: "Sufjan Stevens", title: "Should Have Known Better",
    album: "Carrie & Lowell", year: 2015, dur: "5:08",
    source: "spotify", rating: 4,
    addedBy: "Mira", addedAt: "Wed 7:02 AM",
    mention: "for the prompt this week — strong q-energy",
    note: "Title alone is on-theme. Music does the rest.",
    tags: ["theme-fit"],
  },
  {
    id: "s4", artist: "The Clash", title: "Should I Stay or Should I Go",
    album: "Combat Rock", year: 1982, dur: "3:08",
    source: "youtube", rating: 2,
    addedBy: "Davey", addedAt: "Wed 12:11 PM",
    mention: "lol obvious answer",
    note: "Too on-the-nose. Kept it on the list for the Davey-laugh.",
    tags: ["obvious"],
  },
  {
    id: "s5", artist: "Talking Heads", title: "Once in a Lifetime",
    album: "Remain in Light", year: 1980, dur: "4:21",
    source: "spotify", rating: 4,
    addedBy: "self", addedAt: "Tue 6:22 PM",
    note: "'How did I get here?' is the answer to a question I'm asking myself.",
    tags: ["classic"],
  },
  {
    id: "s6", artist: "Phoebe Bridgers", title: "Funeral",
    album: "Stranger in the Alps", year: 2017, dur: "4:42",
    source: "spotify", rating: 3,
    addedBy: "Mira", addedAt: "Thu 10:08 AM",
    note: "Quieter take. Maybe too sad for this group's voting pattern.",
    tags: ["dark-horse"],
  },
  {
    id: "s7", artist: "Radiohead", title: "How to Disappear Completely",
    album: "Kid A", year: 2000, dur: "5:56",
    source: "youtube", rating: 3,
    addedBy: "self", addedAt: "Wed 10:50 PM",
    note: "Plays it safe on the theme. Group has heard it. Maybe save for the build-to-a-climax round.",
    tags: ["safe"],
  },
  {
    id: "s8", artist: "Aphex Twin", title: "Avril 14th",
    album: "Drukqs", year: 2001, dur: "2:05",
    source: "spotify", rating: 2,
    addedBy: "Greg", addedAt: "Thu 11:31 PM",
    mention: "what if instrumental counts",
    note: "Instrumental — interpretation risk. Greg's lobbying for it. Holding at 2 stars.",
    tags: ["instrumental"],
  },
  {
    id: "s9", artist: "Nina Simone", title: "Who Knows Where the Time Goes",
    album: "Here Comes the Sun", year: 1971, dur: "5:32",
    source: "spotify", rating: 4,
    addedBy: "self", addedAt: "Thu 8:11 AM",
    note: "Title is literally a question. Performance closes it without answering.",
    tags: ["theme-fit", "dark-horse"],
  },
  {
    id: "s10", artist: "MF DOOM", title: "Doomsday",
    album: "Operation: Doomsday", year: 1999, dur: "4:01",
    source: "youtube", rating: 3,
    addedBy: "Davey", addedAt: "Fri 1:02 AM",
    mention: "the 'on doomsday, what will you do' line is a Q",
    note: "Reach. But Davey will defend it.",
    tags: ["reach"],
  },
  {
    id: "s11", artist: "Caroline Polachek", title: "So Hot You're Hurting My Feelings",
    album: "Pang", year: 2019, dur: "2:43",
    source: "spotify", rating: 2,
    addedBy: "Mira", addedAt: "Fri 9:44 AM",
    mention: "for fun. not serious.",
    note: "Off-theme but it'd be a banger in the dance round.",
    tags: ["off-theme"],
  },
];

// Live WhatsApp watcher feed — every event the bot parsed out of the
// chat. Types: "mention" (a song link), "theme-idea" (someone proposed
// a future theme), "react" (someone reacted to a parsed mention),
// "system" (watcher state changes).
const WATCHER = [
  { id: "w14", t: "now",         contact: "Greg",  type: "mention", source: "spotify", artist: "Big Thief", title: "Sparrow",
    raw: "this is literally the prompt https://open.spotify.com/track/...", linkedRound: 14, sentiment: "theme-fit" },
  { id: "w13", t: "12 min ago",  contact: "Mira",  type: "react",   ref: "Sparrow", reaction: "🔥" },
  { id: "w12", t: "1 hr ago",    contact: "Davey", type: "theme-idea",
    raw: "future theme idea: songs that lie", proposedTheme: "Songs that lie" },
  { id: "w11", t: "4 hr ago",    contact: "Mira",  type: "mention", source: "spotify", artist: "Sufjan Stevens", title: "Should Have Known Better",
    raw: "for the prompt this week — strong q-energy https://open.spotify.com/...", linkedRound: 14, sentiment: "theme-fit" },
  { id: "w10", t: "Yesterday",   contact: "Greg",  type: "mention", source: "youtube", artist: "Aphex Twin", title: "Avril 14th",
    raw: "what if instrumental counts https://youtu.be/...", linkedRound: 14, sentiment: "ambiguous" },
  { id: "w09", t: "Yesterday",   contact: "Davey", type: "mention", source: "youtube", artist: "The Clash", title: "Should I Stay or Should I Go",
    raw: "lol obvious answer https://youtu.be/...", linkedRound: 14, sentiment: "joke" },
  { id: "w08", t: "Wed",         contact: "Mira",  type: "mention", source: "spotify", artist: "Phoebe Bridgers", title: "Funeral",
    raw: "this one's been on my list", linkedRound: 14, sentiment: "candidate" },
  { id: "w07", t: "Wed",         contact: "Davey", type: "theme-idea",
    raw: "what about: best song with a saxophone solo", proposedTheme: "Best song with a saxophone solo" },
  { id: "w06", t: "Tue",         contact: "Greg",  type: "mention", source: "spotify", artist: "Caribou", title: "Can't Do Without You",
    raw: "this is fire", linkedRound: null, sentiment: "freelance" },
  { id: "w05", t: "Tue",         contact: "system", type: "system", raw: "bot connected to whatsapp · 2 days uptime" },
];

const ROUND_HISTORY = [
  { n: 13, theme: "Best opener of an album",            myPick: "Bowie — Five Years",       result: "2nd",  pts: 11, votedAt: "Apr 24" },
  { n: 12, theme: "Cover that eclipses the original",   myPick: "Cash — Hurt",              result: "1st",  pts: 14, votedAt: "Apr 17" },
  { n: 11, theme: "A song you'd play on the last day",  myPick: "Talk Talk — New Grass",    result: "5th",  pts: 6,  votedAt: "Apr 10" },
  { n: 10, theme: "Best song under 2 minutes",          myPick: "Pixies — La La Love You",  result: "3rd",  pts: 9,  votedAt: "Apr 03" },
  { n: 9,  theme: "Songs that sound like winter",       myPick: "Sufjan — Year of the Boar", result: "1st", pts: 13, votedAt: "Mar 27" },
  { n: 8,  theme: "One good song from a mid album",     myPick: "Coldplay — Sparks",        result: "7th",  pts: 4,  votedAt: "Mar 20" },
];

const SETUP_TOOLS = [
  { name: "whatsapp-bridge", tier: "HARD DEPENDENCY", status: "Connected", version: "wuzapi 0.3.1 (linked)", desc: "Subscribes to the league's group chat and parses song links + theme proposals.", level: "ok" },
  { name: "spotify-api",     tier: "REQUIRED",        status: "Authorized",  version: "client-credentials · scope: playlists", desc: "Resolves track metadata, builds the per-round shortlist playlist.", level: "ok" },
  { name: "youtube-api",     tier: "REQUIRED",        status: "Authorized",  version: "yt-data v3 · daily-quota 7.2k / 10k", desc: "Resolves YouTube links, used as a fallback when Spotify match score is low.", level: "warn" },
  { name: "music-league",    tier: "REQUIRED",        status: "Session live", version: "auth via cookie · expires May 19", desc: "Scrapes round metadata, deadlines, and standings from musicleague.com.", level: "ok" },
  { name: "sqlite",          tier: "REQUIRED",        status: "Detected",     version: "sqlite 3.45.1 · ml-bot.db (12.4 MB)", desc: "Local store for shortlists, ratings, chat ingest, and link conversions.", level: "ok" },
  { name: "ffmpeg",          tier: "RECOMMENDED",     status: "Detected",     version: "ffmpeg 6.1.1",       desc: "Used by the digest generator if you opt into 30-second preview clips.", level: "ok" },
];

Object.assign(window, { LEAGUES, ACTIVE_LEAGUE, ACTIVE_ROUND, SHORTLIST, WATCHER, ROUND_HISTORY, SETUP_TOOLS });
