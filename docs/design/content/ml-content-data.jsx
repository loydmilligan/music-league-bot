// music-league-bot — Content screen fixtures (operator app)
// The operator-side counterpart to the b-side consumer site. The existing
// "Digest" nav becomes "Content", with two tabs: Digest (generate this
// round's digest) and Archive (publish/update each league's b-side site).
//
// Key model: ONE b-side per league, one stable unguessable slug for the
// whole season. When a round's digest finalizes, that round becomes
// available to ADD to the league's archive — surfaced as an "update ready"
// badge. Publishing an update reuses the same slug.

// Per-league b-side state. `pending` = a finalized digest not yet added to
// the archive (drives the "update ready" badge). `bside: null` = never
// published yet (needs a first publish).
const CONTENT_LEAGUES = [
  {
    id: "vinyl-scramblers", name: "Vinyl scramblers", members: 9, status: "active",
    bside: {
      slug: "vinyl-scramblers-a9f3",
      url: "digest.mattmariani.com/vinyl-scramblers-a9f3",
      season: 3, archived: 13, lastPublished: "May 4",
      pending: {
        round: 14, theme: "Songs that sound like a question",
        winnerSong: "Wicked Game", winnerArtist: "Chris Isaak",
        submitter: "Mira", closed: "May 17", votes: 60,
      },
    },
  },
  {
    id: "vibe-shift-club", name: "Vibe shift club", members: 11, status: "submissions-open",
    bside: {
      slug: "vibe-shift-club-7m1q",
      url: "digest.mattmariani.com/vibe-shift-club-7m1q",
      season: 4, archived: 21, lastPublished: "May 9",
      pending: {
        round: 22, theme: "A song that lies to you",
        winnerSong: "Videotape", winnerArtist: "Radiohead",
        submitter: "Dev", closed: "May 15", votes: 64,
      },
    },
  },
  {
    id: "the-jukebox", name: "The jukebox", members: 6, status: "voting",
    bside: {
      slug: "the-jukebox-3k2p",
      url: "digest.mattmariani.com/the-jukebox-3k2p",
      season: 2, archived: 7, lastPublished: "May 11",
      pending: null, // voting still open — no new digest to archive yet
    },
  },
  {
    id: "deep-cuts-only", name: "Deep cuts only", members: 5, status: "between-rounds",
    bside: null, // never published — first publish mints the slug
    firstPublish: { season: 1, rounds: 4 },
  },
];

// Count of leagues with an update waiting (drives the Archive tab badge).
const CONTENT_UPDATES_READY = CONTENT_LEAGUES.filter(
  (l) => l.bside && l.bside.pending
).length;

// The archive-update plan — what publishing Round 14 into the Vinyl
// scramblers b-side actually changes. One "add" entry + the recomputed
// sections. Each recompute row carries a default decision:
//   refresh — recompute from the new round's data (default for most)
//   hold    — keep the current version until next round
//   locked  — pinned; never auto-updates (operator curated it by hand)
const ARCHIVE_UPDATE = {
  league: "Vinyl scramblers",
  slug: "vinyl-scramblers-a9f3",
  round: 14,
  theme: "Songs that sound like a question",
  sections: [
    {
      id: "entry", kind: "add", label: "New archive entry", required: true,
      note: "Round 14 — “Songs that sound like a question”. Added to the timeline, newest first. Links to the full digest.",
      detail: "Wicked Game — Chris Isaak · won by Mira · 60 votes",
    },
    {
      id: "superlatives", kind: "recompute", label: "Season superlatives", decision: "refresh",
      note: "3 of 6 awards shift with this round's points.",
      detail: "“Tastemaker” holds (Rosa) · “Most divisive” moves to Theo · new: “Closer of the season” → Mira",
      steerable: true,
    },
    {
      id: "stats", kind: "recompute", label: "Season stats · KPIs", decision: "refresh",
      note: "Counts and tallies roll forward.",
      detail: "+12 songs · +84 points awarded · favourite-year tally unchanged (1994)",
    },
    {
      id: "fingerprints", kind: "recompute", label: "Taste fingerprints", decision: "refresh",
      note: "6 full-tier profiles re-read with the new votes. Lite profiles unchanged.",
      detail: "Biggest movement: Theo (Familiar→Obscure +6)",
      steerable: true,
    },
    {
      id: "moments", kind: "recompute", label: "Moments of the season", decision: "refresh",
      note: "Group-consensus picks re-evaluated.",
      detail: "New “most loved” candidate: Wicked Game (five 5s, no haters)",
      steerable: true,
    },
    {
      id: "overlap", kind: "recompute", label: "Your people · overlap", decision: "hold",
      note: "Vote-together percentages recalc within the new shared round.",
      detail: "Held by default — one round rarely moves it; refresh if you want it current",
    },
  ],
};

// Quick-steer chips for the per-section regen inside an archive update —
// same idiom as the digest regen modal, tuned for the yearbook voice.
const ARCHIVE_STEER_CHIPS = [
  "warmer",
  "less roast-y",
  "more concise",
  "celebrate, don't rank",
  "keep current winner",
];

// The reshare announcement produced after an update publishes.
const ARCHIVE_SHARE = {
  league: "Vinyl scramblers",
  url: "digest.mattmariani.com/vinyl-scramblers-a9f3",
  round: 14,
  theme: "Songs that sound like a question",
  headline: "New in the archive",
  blurb: "Round 14 just hit the b-side — “Songs that sound like a question”, won by Mira. Fingerprints and season awards refreshed.",
};

Object.assign(window, {
  CONTENT_LEAGUES, CONTENT_UPDATES_READY, ARCHIVE_UPDATE,
  ARCHIVE_STEER_CHIPS, ARCHIVE_SHARE,
});
