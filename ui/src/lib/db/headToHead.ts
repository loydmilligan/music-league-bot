import type Database from 'better-sqlite3';
import type { H2HCandidate, H2HMatch, H2HState } from '../types.js';
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

function matchRow(r: any): H2HMatch {
  return { id: r.id, roundId: r.round_id, winnerId: r.winner_id, loserId: r.loser_id, createdAt: r.created_at };
}

export function getH2HMatches(db: Database.Database, roundId: number): H2HMatch[] {
  return (db.prepare(
    'SELECT * FROM head_to_head_matches WHERE round_id = ? ORDER BY datetime(created_at) ASC, id ASC'
  ).all(roundId) as any[]).map(matchRow);
}

export function recordH2HMatch(
  db: Database.Database,
  roundId: number,
  winnerId: number,
  loserId: number,
): H2HMatch {
  const info = db.prepare(
    'INSERT INTO head_to_head_matches (round_id, winner_id, loser_id, created_at) VALUES (?,?,?,?)'
  ).run(roundId, winnerId, loserId, new Date().toISOString());
  return matchRow(db.prepare('SELECT * FROM head_to_head_matches WHERE id = ?').get(info.lastInsertRowid));
}

export function clearH2HMatches(db: Database.Database, roundId: number): number {
  return db.prepare('DELETE FROM head_to_head_matches WHERE round_id = ?').run(roundId).changes;
}

/**
 * Build the king-of-the-hill state from the round's candidates + matches.
 * - retired = anyone who lost ≥1 match
 * - champion = active candidate with most wins (tiebreak: weightedScore desc)
 * - queue    = candidates who have never played and aren't retired; sorted by weightedScore desc
 * - challenger = queue[0] (the next match-up the UI should offer)
 * - isComplete = queue empty (champion has cleared the field)
 */
export function buildH2HState(db: Database.Database, roundId: number): H2HState {
  const candidates = getH2HCandidates(db, roundId);
  const matches = getH2HMatches(db, roundId);

  const retired = new Set<number>();
  const wins = new Map<number, number>();
  const played = new Set<number>();
  for (const m of matches) {
    retired.add(m.loserId);
    wins.set(m.winnerId, (wins.get(m.winnerId) ?? 0) + 1);
    played.add(m.winnerId);
    played.add(m.loserId);
  }

  const byId = new Map(candidates.map(c => [c.id, c]));
  const active = candidates.filter(c => !retired.has(c.id));

  const champion = active.length === 0
    ? null
    : [...active].sort((a, b) => {
        const wa = wins.get(a.id) ?? 0;
        const wb = wins.get(b.id) ?? 0;
        if (wb !== wa) return wb - wa;
        return (b.weightedScore ?? -Infinity) - (a.weightedScore ?? -Infinity);
      })[0];

  const queue = candidates
    .filter(c => !retired.has(c.id) && (!champion || c.id !== champion.id) && !played.has(c.id))
    .sort((a, b) => (b.weightedScore ?? -Infinity) - (a.weightedScore ?? -Infinity));

  const retiredList = matches
    .map(m => byId.get(m.loserId))
    .filter((c): c is H2HCandidate => !!c);
  // dedupe in case a candidate appears as loser more than once
  const seen = new Set<number>();
  const retiredOrdered = retiredList.filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)));

  return {
    candidates,
    matches,
    champion,
    challenger: queue[0] ?? null,
    queue,
    retired: retiredOrdered,
    isComplete: queue.length === 0,
  };
}
