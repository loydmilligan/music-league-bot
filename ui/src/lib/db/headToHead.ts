import type Database from 'better-sqlite3';
import type { H2HCandidate } from '../types.js';
import { computeScore } from '../scoring.js';
import { getSettings } from './settings.js';

const ELIGIBLE_STATUS = 'reviewing';

function candidateRow(r: any, weightedScore: number | null): H2HCandidate {
  return {
    id: r.id,
    roundId: r.round_id,
    artist: r.artist,
    title: r.title,
    spotifyUri: r.spotify_uri,
    ytmUrl: r.ytm_url ?? null,
    themeFit: r.theme_fit,
    discoveryPotential: r.discovery_potential,
    nostalgiaPotential: r.nostalgia_potential,
    personalRating: r.personal_rating,
    notes: r.notes,
    weightedScore,
    status: r.status,
  };
}

export function getH2HCandidates(db: Database.Database, roundId: number): H2HCandidate[] {
  const rows = db.prepare(`
    SELECT rs.*, ylc.ytm_url AS ytm_url
    FROM research_songs rs
    LEFT JOIN ytm_link_cache ylc ON ylc.spotify_uri = rs.spotify_uri
    WHERE rs.round_id = ? AND rs.status = ?
  `).all(roundId, ELIGIBLE_STATUS) as any[];
  const weights = getSettings(db);
  return rows
    .map(r => candidateRow(r, computeScore({
      discoveryPotential: r.discovery_potential,
      themeFit: r.theme_fit,
      personalRating: r.personal_rating,
      nostalgiaPotential: r.nostalgia_potential,
    }, weights)))
    .sort((a, b) => (b.weightedScore ?? -Infinity) - (a.weightedScore ?? -Infinity));
}
