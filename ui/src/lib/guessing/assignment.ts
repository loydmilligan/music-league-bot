import type Database from 'better-sqlite3';

export interface Validation {
  ok: boolean;
  missingSongs: string[];
  duplicatePlayerIds: number[];
}

/**
 * Songs that need a guess, in playlist order. Excludes the owner's own
 * submission (voting_lab_ballot.is_mine), which he already knows and must not
 * get credit for identifying.
 */
export function eligibleSongs(db: Database.Database, roundId: number): string[] {
  return (
    db.prepare(
      `SELECT ms.spotify_uri AS uri
         FROM ml_submissions ms
         LEFT JOIN voting_lab_ballot b
                ON b.round_id = ms.round_id AND b.spotify_uri = ms.spotify_uri
        WHERE ms.round_id = ?
          AND COALESCE(b.is_mine, 0) = 0
        ORDER BY ms.id`,
    ).all(roundId) as { uri: string }[]
  ).map((r) => r.uri);
}

/**
 * Roster for the round's season, minus the owner.
 *
 * Reads season_standings, not ml_submissions identity — this schema has no
 * players/season_players table, and even a repaired identity join would
 * return EMPTY during a live round (the only phase this function serves),
 * since submitter identity stays anonymous until reveal. season_standings
 * carries no song linkage, so it is safe to read from a live-phase module
 * that must never resolve who submitted what.
 */
export function eligiblePlayers(
  db: Database.Database,
  roundId: number,
  mePlayerId: number,
): number[] {
  return (
    db.prepare(
      `SELECT DISTINCT ss.competitor_id AS id
         FROM season_standings ss
        WHERE ss.season_id = (SELECT season_id FROM rounds WHERE id = ?)
          AND ss.competitor_id <> ?
        ORDER BY ss.competitor_id`,
    ).all(roundId, mePlayerId) as { id: number }[]
  ).map((r) => r.id);
}

/**
 * Spec §6: every eligible song must carry exactly one guess, and each player may
 * be used at most once. Phrasing it the other way round ("each player exactly
 * one song") deadlocks any round where somebody skipped — you cannot place 10
 * players one-each into 9 songs.
 */
export function validateGutSlate(
  db: Database.Database,
  roundId: number,
  mePlayerId: number,
): Validation {
  const songs = eligibleSongs(db, roundId);
  const picks = new Map(
    (
      db.prepare(
        `SELECT spotify_uri AS uri, gut_pick_player_id AS pid
           FROM guess_picks
          WHERE round_id = ? AND gut_pick_player_id IS NOT NULL`,
      ).all(roundId) as { uri: string; pid: number }[]
    ).map((r) => [r.uri, r.pid]),
  );

  const missingSongs = songs.filter((s) => !picks.has(s));

  const seen = new Map<number, number>();
  for (const s of songs) {
    const pid = picks.get(s);
    if (pid === undefined) continue;
    seen.set(pid, (seen.get(pid) ?? 0) + 1);
  }
  const duplicatePlayerIds = [...seen.entries()]
    .filter(([, n]) => n > 1)
    .map(([pid]) => pid)
    .sort((a, b) => a - b);

  void mePlayerId; // owner exclusion is applied in eligibleSongs/eligiblePlayers
  return {
    ok: missingSongs.length === 0 && duplicatePlayerIds.length === 0,
    missingSongs,
    duplicatePlayerIds,
  };
}
