import type Database from 'better-sqlite3';

export interface SongScore {
  spotifyUri: string;
  actualPlayerId: number;
  gutPickPlayerId: number | null;
  finalPickPlayerId: number | null;
  gutHit: boolean;
  finalHit: boolean;
  confidence: number | null;
  commentWasVisible: boolean;
}

export interface RoundScore {
  songs: SongScore[];
  /** songs with a revealed submitter AND a final pick */
  scored: number;
  gutCorrect: number;
  finalCorrect: number;
}

interface Row {
  uri: string;
  actual: number;
  gut: number | null;
  final: number | null;
  confidence: number | null;
  visible: number;
}

/**
 * Accuracy for one revealed round. DERIVED — nothing here is written back.
 * A zip re-import changes ml_submissions and the next call simply reflects it,
 * so there is no stored scoreline that can go stale (spec §8).
 *
 * This is one of only two modules permitted to read ml_submissions.competitor_id;
 * it runs after reveal, never during a live round.
 */
export function scoreRound(
  db: Database.Database,
  roundId: number,
  mePlayerId: number,
): RoundScore {
  const rows = db.prepare(
    `SELECT ms.spotify_uri            AS uri,
            ms.competitor_id          AS actual,
            gp.gut_pick_player_id     AS gut,
            gp.final_pick_player_id   AS final,
            gp.confidence             AS confidence,
            ms.visible_to_voters      AS visible
       FROM ml_submissions ms
       LEFT JOIN voting_lab_ballot b
              ON b.round_id = ms.round_id AND b.spotify_uri = ms.spotify_uri
       LEFT JOIN guess_picks gp
              ON gp.round_id = ms.round_id AND gp.spotify_uri = ms.spotify_uri
      WHERE ms.round_id = ?
        AND COALESCE(b.is_mine, 0) = 0
        AND ms.competitor_id IS NOT NULL
        AND ms.competitor_id <> ?
      ORDER BY ms.id`,
  ).all(roundId, mePlayerId) as Row[];

  const songs: SongScore[] = rows.map((r) => ({
    spotifyUri: r.uri,
    actualPlayerId: r.actual,
    gutPickPlayerId: r.gut,
    finalPickPlayerId: r.final,
    gutHit: r.gut !== null && r.gut === r.actual,
    finalHit: r.final !== null && r.final === r.actual,
    confidence: r.confidence,
    commentWasVisible: r.visible === 1,
  }));

  const scored = songs.filter((s) => s.finalPickPlayerId !== null).length;
  return {
    songs,
    scored,
    gutCorrect: songs.filter((s) => s.gutHit).length,
    finalCorrect: songs.filter((s) => s.finalHit).length,
  };
}
