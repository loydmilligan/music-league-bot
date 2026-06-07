import type Database from 'better-sqlite3';

// Badge data service (sprint-23, badges-api) — D6/D7. For a batch of songs
// computes achievement/notoriety badges at TWO levels (song-level = this exact
// uri; artist-level = any song by the same first-artist):
//   🥇🥈🥉 medals  — 1st / 2nd / 3rd round placements, with counts
//   💩 poop        — bottom-2 round finishes, with count
//   🗣️ bigDiscussion — rounds where a song drew a lot of vote comments, with count
//
// Placement = rank by SUM(votes.points) within the round. Ties share a place
// ("strictly more points above" = gold tier, etc.) so two songs tied for first
// are both gold. Joins follow research.ts / seasonData.ts. The corpus is small
// (~570 submissions) so we rank it in one pass and aggregate in JS.

// ── Thresholds — the single, documented, easily-tweakable knob block. ──────────
// Tuned against the real corpus (2026-06-07, 569 submissions / 60 rounds):
//   • Vote-comment counts per song top out at 7; only 6 songs reach 5+. So
//     BIG_DISCUSSION_MIN_COMMENTS = 5 flags the genuinely talked-about ~1%.
//   • Every round has 7–12 songs, so top-3 and bottom-2 never collide;
//     POOP_MIN_ROUND_SIZE = 5 guards only against future tiny rounds (a 2–3
//     song round shouldn't make a song both a medalist and a poop).
export const BADGE_THRESHOLDS = {
  /** A round's song earns a 🗣️ when it received at least this many vote comments. */
  BIG_DISCUSSION_MIN_COMMENTS: 5,
  /** 💩 only counts in rounds with at least this many submissions. */
  POOP_MIN_ROUND_SIZE: 5,
};

export interface BadgeInput {
  uri: string;
  artist: string;
}

export interface BadgeSet {
  medals: { gold: number; silver: number; bronze: number };
  poop: number;
  bigDiscussion: number;
}

export interface SongBadges {
  song: BadgeSet;
  artist: BadgeSet;
}

export type BadgeMap = Record<string, SongBadges>;

function firstArtist(artists: string): string {
  return (artists.split(',')[0] ?? artists).trim().toLowerCase();
}

function emptySet(): BadgeSet {
  return { medals: { gold: 0, silver: 0, bronze: 0 }, poop: 0, bigDiscussion: 0 };
}

/** Per-submission badge contribution, after round-relative ranking. */
interface RankedSong {
  uri: string;
  artist: string; // first-artist, lowercased
  gold: boolean;
  silver: boolean;
  bronze: boolean;
  poop: boolean;
  bigDiscussion: boolean;
}

/** Rank the whole corpus once: every submission tagged with its round-relative badges. */
function rankCorpus(db: Database.Database): RankedSong[] {
  const rows = db
    .prepare(
      `SELECT m.round_id AS round_id, m.spotify_uri AS uri, m.artists AS artists,
              COALESCE(SUM(v.points), 0) AS points,
              COUNT(DISTINCT CASE WHEN v.comment IS NOT NULL AND TRIM(v.comment) <> '' THEN v.id END) AS comments
       FROM ml_submissions m
       LEFT JOIN votes v ON v.round_id = m.round_id AND v.spotify_uri = m.spotify_uri
       GROUP BY m.id`,
    )
    .all() as { round_id: number; uri: string; artists: string; points: number; comments: number }[];

  // Group by round to compute within-round placement.
  const byRound = new Map<number, typeof rows>();
  for (const r of rows) {
    const arr = byRound.get(r.round_id);
    if (arr) arr.push(r);
    else byRound.set(r.round_id, [r]);
  }

  const out: RankedSong[] = [];
  for (const [, songs] of byRound) {
    const size = songs.length;
    for (const s of songs) {
      const above = songs.filter((o) => o.points > s.points).length; // 0 → 1st place tier
      const below = songs.filter((o) => o.points < s.points).length; // 0 → last place tier
      out.push({
        uri: s.uri,
        artist: firstArtist(s.artists),
        gold: above === 0,
        silver: above === 1,
        bronze: above === 2,
        poop: below <= 1 && size >= BADGE_THRESHOLDS.POOP_MIN_ROUND_SIZE,
        bigDiscussion: s.comments >= BADGE_THRESHOLDS.BIG_DISCUSSION_MIN_COMMENTS,
      });
    }
  }
  return out;
}

function aggregate(rows: RankedSong[]): BadgeSet {
  const set = emptySet();
  for (const r of rows) {
    if (r.gold) set.medals.gold++;
    if (r.silver) set.medals.silver++;
    if (r.bronze) set.medals.bronze++;
    if (r.poop) set.poop++;
    if (r.bigDiscussion) set.bigDiscussion++;
  }
  return set;
}

/**
 * Compute song- and artist-level badges for a batch of songs.
 * Returns a map keyed by uri, with every requested uri present (empty sets if clean).
 */
export function getBadgesBatch(db: Database.Database, items: BadgeInput[]): BadgeMap {
  const out: BadgeMap = {};
  for (const it of items) out[it.uri] = { song: emptySet(), artist: emptySet() };
  if (!items.length) return out;

  const ranked = rankCorpus(db);
  // Index for cheap lookup.
  const byUri = new Map<string, RankedSong[]>();
  const byArtist = new Map<string, RankedSong[]>();
  for (const r of ranked) {
    (byUri.get(r.uri) ?? byUri.set(r.uri, []).get(r.uri)!).push(r);
    (byArtist.get(r.artist) ?? byArtist.set(r.artist, []).get(r.artist)!).push(r);
  }

  for (const it of items) {
    const artistKey = (it.artist ?? '').trim().toLowerCase();
    out[it.uri] = {
      song: aggregate(byUri.get(it.uri) ?? []),
      artist: aggregate(artistKey ? byArtist.get(artistKey) ?? [] : []),
    };
  }
  return out;
}
