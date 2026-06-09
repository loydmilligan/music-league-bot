import type Database from 'better-sqlite3';

// Theme-history service (sprint-24, theme-data) — powers Tab 2 "Theme research".
// For every past round/theme across all seasons it returns the songs submitted
// under that theme, each with its submitter and the points it scored.
//
// In this corpus a round IS a theme: `rounds.description` holds the theme prompt
// (e.g. "Songs with weather-related lyrics") and `rounds.name` is the short round
// title (e.g. "Weatherbug"). We surface the prompt as `theme` and the title as
// `round` so the frontend gets both the scannable headline and a label. Joins
// mirror songHistory.ts / research.ts: rounds→seasons→leagues, and a submission's
// points = SUM(votes.points) for that round+uri.

export interface ThemePick {
  title: string;
  artist: string;
  submitter: string;
  points: number;
}

export interface ThemeHistory {
  theme: string;
  season: number;
  round: string;
  picks: ThemePick[];
}

/**
 * Strip the trailing "Theme provided by: …" attribution (and surrounding blank
 * lines) the importer leaves on round descriptions, so the prompt reads clean.
 */
function cleanPrompt(description: string | null): string {
  if (!description) return '';
  return description.replace(/\s*Theme provided by:.*$/is, '').trim();
}

/**
 * Every theme/round across all seasons with the songs submitted under it.
 * Themes are ordered season→round (created_at); picks within a theme are
 * ordered highest-points first.
 */
export function getThemeHistory(db: Database.Database): ThemeHistory[] {
  const rounds = db
    .prepare(
      `SELECT r.id AS round_id, r.name AS round, r.description AS description,
              s.season_number AS season
       FROM rounds r
       JOIN seasons s ON s.id = r.season_id
       ORDER BY s.season_number, r.created_at, r.id`,
    )
    .all() as { round_id: number; round: string; description: string | null; season: number }[];

  if (!rounds.length) return [];

  // All picks in one pass: a submission's points = SUM(votes.points) for its
  // round+uri (the league-wide convention used by songHistory.ts).
  const picks = db
    .prepare(
      `SELECT m.round_id AS round_id, m.title AS title, m.artists AS artist,
              COALESCE(c.name, 'Unknown') AS submitter,
              COALESCE(SUM(v.points), 0) AS points
       FROM ml_submissions m
       LEFT JOIN competitors c ON c.id = m.competitor_id
       LEFT JOIN votes v ON v.round_id = m.round_id AND v.spotify_uri = m.spotify_uri
       GROUP BY m.id
       ORDER BY points DESC, m.title`,
    )
    .all() as { round_id: number; title: string; artist: string; submitter: string; points: number }[];

  const byRound = new Map<number, ThemePick[]>();
  for (const p of picks) {
    const list = byRound.get(p.round_id) ?? [];
    list.push({ title: p.title, artist: p.artist, submitter: p.submitter, points: Number(p.points) });
    byRound.set(p.round_id, list);
  }

  return rounds.map((r) => ({
    theme: cleanPrompt(r.description) || r.round,
    season: Number(r.season),
    round: r.round,
    picks: byRound.get(r.round_id) ?? [],
  }));
}
