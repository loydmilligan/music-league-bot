import type Database from 'better-sqlite3';

// Canonical season-standings logic (sprint-14, backend lane).
//
// A competitor's score in Music League is the sum of points their *submitted*
// songs receive from other players' votes. Standings AS OF a round = those
// points accumulated over every round up to and including that one, in the
// season's round sequence (rounds ordered by id within a season).
//
// The `season_standings` table is the human-verified gospel the digest renders
// from. At generation we recompute from raw votes and reconcile against the
// stored table; the human can adopt-computed (overwrite with the recomputed
// numbers) or hand-edit (write corrected numbers as the new gospel).

/** The published Standings payload shape (backend → viz). */
export interface StandingRow {
  competitorId: number;
  name: string;
  rank: number;
  prevRank: number | null;
  priorTotal: number;
  roundPoints: number;
  currentTotal: number;
}

export type ReconcileField = 'priorTotal' | 'roundPoints' | 'currentTotal' | 'rank' | 'prevRank';

export interface ReconcileDiff {
  competitorId: number;
  name: string;
  /** Only present (i.e. the competitor is absent from one side) markers. */
  presence?: 'stored-only' | 'computed-only';
  fields: Array<{ field: ReconcileField; stored: number | null; computed: number | null }>;
}

export interface Reconcile {
  status: 'match' | 'mismatch';
  diffs: ReconcileDiff[];
}

export interface StandingsResult {
  seasonId: number;
  standings: StandingRow[];
  reconcile: Reconcile;
}

/** Resolve the season + the round-id sequence up to (and excluding) the target. */
function seasonAndRounds(
  db: Database.Database,
  roundId: number,
): { seasonId: number; upTo: number[]; prior: number[] } {
  const target = db
    .prepare('SELECT id, season_id FROM rounds WHERE id = ?')
    .get(roundId) as { id: number; season_id: number } | undefined;
  if (!target) throw new Error(`round not found: ${roundId}`);
  const all = (db
    .prepare('SELECT id FROM rounds WHERE season_id = ? ORDER BY id')
    .all(target.season_id) as { id: number }[]).map((r) => r.id);
  const idx = all.indexOf(roundId);
  return { seasonId: target.season_id, upTo: all.slice(0, idx + 1), prior: all.slice(0, idx) };
}

/** Points received per competitor across a set of rounds (0 for non-scorers). */
function pointsByCompetitor(
  db: Database.Database,
  roundIds: number[],
): Map<number, { name: string; pts: number }> {
  const out = new Map<number, { name: string; pts: number }>();
  if (!roundIds.length) return out;
  const placeholders = roundIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT m.competitor_id AS cid, c.name AS name, COALESCE(SUM(v.points), 0) AS pts
       FROM ml_submissions m
       JOIN competitors c ON c.id = m.competitor_id
       LEFT JOIN votes v ON v.round_id = m.round_id AND v.spotify_uri = m.spotify_uri
       WHERE m.round_id IN (${placeholders}) AND m.competitor_id IS NOT NULL
       GROUP BY m.competitor_id`,
    )
    .all(...roundIds) as { cid: number; name: string; pts: number }[];
  for (const r of rows) out.set(r.cid, { name: r.name, pts: Number(r.pts) });
  return out;
}

/** Standing-order ranks (1-based) by total desc, ties broken by name for determinism. */
function rankByTotal(entries: { cid: number; name: string; total: number }[]): Map<number, number> {
  const sorted = [...entries].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const m = new Map<number, number>();
  sorted.forEach((e, i) => m.set(e.cid, i + 1));
  return m;
}

/** Compute standings AS OF `roundId` purely from raw vote data. */
export function computeStandings(db: Database.Database, roundId: number): StandingRow[] {
  const { upTo, prior } = seasonAndRounds(db, roundId);
  const current = pointsByCompetitor(db, upTo);
  const roundMap = pointsByCompetitor(db, [roundId]);
  const priorMap = pointsByCompetitor(db, prior);

  const rankMap = rankByTotal([...current].map(([cid, v]) => ({ cid, name: v.name, total: v.pts })));
  const prevRankMap = rankByTotal([...priorMap].map(([cid, v]) => ({ cid, name: v.name, total: v.pts })));

  const rows: StandingRow[] = [...current].map(([cid, v]) => {
    const currentTotal = v.pts;
    const roundPoints = roundMap.get(cid)?.pts ?? 0;
    return {
      competitorId: cid,
      name: v.name,
      rank: rankMap.get(cid)!,
      prevRank: prevRankMap.get(cid) ?? null,
      priorTotal: currentTotal - roundPoints,
      roundPoints,
      currentTotal,
    };
  });
  rows.sort((a, b) => a.rank - b.rank);
  return rows;
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Overwrite the stored standings for a round with the given rows. */
export function persistStandings(
  db: Database.Database,
  roundId: number,
  seasonId: number,
  rows: StandingRow[],
): void {
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM season_standings WHERE round_id = ?').run(roundId);
    const ins = db.prepare(
      `INSERT INTO season_standings
         (season_id, round_id, competitor_id, name, prior_total, round_points, current_total, rank, prev_rank, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of rows) {
      ins.run(
        seasonId, roundId, r.competitorId, r.name,
        r.priorTotal, r.roundPoints, r.currentTotal, r.rank, r.prevRank, now,
      );
    }
  });
  tx();
}

/** Read the stored (gospel) standings for a round, in standing order. */
export function readStoredStandings(db: Database.Database, roundId: number): StandingRow[] {
  const rows = db
    .prepare(
      `SELECT competitor_id, name, prior_total, round_points, current_total, rank, prev_rank
       FROM season_standings WHERE round_id = ? ORDER BY rank ASC`,
    )
    .all(roundId) as {
    competitor_id: number; name: string; prior_total: number;
    round_points: number; current_total: number; rank: number; prev_rank: number | null;
  }[];
  return rows.map((r) => ({
    competitorId: r.competitor_id,
    name: r.name,
    rank: r.rank,
    prevRank: r.prev_rank,
    priorTotal: r.prior_total,
    roundPoints: r.round_points,
    currentTotal: r.current_total,
  }));
}

/** Diff computed-from-votes against the stored table. */
export function reconcile(computed: StandingRow[], stored: StandingRow[]): Reconcile {
  const byIdC = new Map(computed.map((r) => [r.competitorId, r]));
  const byIdS = new Map(stored.map((r) => [r.competitorId, r]));
  const diffs: ReconcileDiff[] = [];

  const allIds = new Set<number>([...byIdC.keys(), ...byIdS.keys()]);
  for (const cid of allIds) {
    const c = byIdC.get(cid);
    const s = byIdS.get(cid);
    if (c && !s) {
      diffs.push({ competitorId: cid, name: c.name, presence: 'computed-only', fields: [] });
      continue;
    }
    if (s && !c) {
      diffs.push({ competitorId: cid, name: s.name, presence: 'stored-only', fields: [] });
      continue;
    }
    if (!c || !s) continue;
    const fields: ReconcileDiff['fields'] = [];
    const cmp: ReconcileField[] = ['priorTotal', 'roundPoints', 'currentTotal', 'rank', 'prevRank'];
    for (const f of cmp) {
      if (c[f] !== s[f]) fields.push({ field: f, stored: s[f], computed: c[f] });
    }
    if (fields.length) diffs.push({ competitorId: cid, name: c.name, fields });
  }
  return { status: diffs.length ? 'mismatch' : 'match', diffs };
}

/**
 * Read the gospel standings for a round + a reconcile block vs the recomputed
 * numbers. Lazily computes + persists on first access (the table is the source
 * the digest renders from, so it must exist once requested).
 */
export function getStandings(db: Database.Database, roundId: number): StandingsResult {
  const { seasonId } = seasonAndRounds(db, roundId);
  const computed = computeStandings(db, roundId);
  let stored = readStoredStandings(db, roundId);
  if (!stored.length) {
    persistStandings(db, roundId, seasonId, computed);
    stored = computed;
  }
  return { seasonId, standings: stored, reconcile: reconcile(computed, stored) };
}

/** Adopt the recomputed-from-votes numbers as the new gospel (overwrite). */
export function adoptComputed(db: Database.Database, roundId: number): StandingsResult {
  const { seasonId } = seasonAndRounds(db, roundId);
  const computed = computeStandings(db, roundId);
  persistStandings(db, roundId, seasonId, computed);
  return { seasonId, standings: computed, reconcile: { status: 'match', diffs: [] } };
}

export interface StandingEdit {
  competitorId: number;
  priorTotal?: number;
  roundPoints?: number;
  currentTotal?: number;
}

/**
 * Write human-corrected values as the new gospel. Re-ranks by current_total.
 * Any field omitted from an edit keeps its prior value; currentTotal is derived
 * from prior+round only when the editor didn't supply it explicitly.
 */
export function applyEdits(
  db: Database.Database,
  roundId: number,
  edits: StandingEdit[],
): StandingsResult {
  const { seasonId } = seasonAndRounds(db, roundId);
  const stored = readStoredStandings(db, roundId);
  const base = stored.length ? stored : computeStandings(db, roundId);
  const byId = new Map(base.map((r) => [r.competitorId, { ...r }]));

  for (const e of edits) {
    const row = byId.get(e.competitorId);
    if (!row) continue;
    if (e.priorTotal != null) row.priorTotal = e.priorTotal;
    if (e.roundPoints != null) row.roundPoints = e.roundPoints;
    if (e.currentTotal != null) row.currentTotal = e.currentTotal;
    else row.currentTotal = row.priorTotal + row.roundPoints;
  }

  const ranked = rankByTotal([...byId.values()].map((r) => ({ cid: r.competitorId, name: r.name, total: r.currentTotal })));
  const rows = [...byId.values()].map((r) => ({ ...r, rank: ranked.get(r.competitorId)! }));
  rows.sort((a, b) => a.rank - b.rank);
  persistStandings(db, roundId, seasonId, rows);

  const computed = computeStandings(db, roundId);
  return { seasonId, standings: rows, reconcile: reconcile(computed, rows) };
}

/** Compute + persist standings for every round in a season (backfill). */
export function backfillSeasonStandings(db: Database.Database, seasonId: number): number {
  const roundIds = (db
    .prepare('SELECT id FROM rounds WHERE season_id = ? ORDER BY id')
    .all(seasonId) as { id: number }[]).map((r) => r.id);
  for (const rid of roundIds) {
    persistStandings(db, rid, seasonId, computeStandings(db, rid));
  }
  return roundIds.length;
}
