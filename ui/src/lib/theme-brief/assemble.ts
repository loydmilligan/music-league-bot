import type Database from 'better-sqlite3';
import type { LlmFn } from './llmFn.js';
import type { ThemeBrief, MatchedRun, SynthesisInput } from './types.js';
import { matchThemes } from './themeMatch.js';
import { standings, podiumCellar, familiarityBuckets, leagueScoringType } from './themeBriefData.js';
import { resolveOwnerCompetitorId, ownerExposure } from './audienceOverlap.js';
import { synthesize, gatherComments } from './themeBriefLlm.js';

const OWNER = 'Mashew';

export function readCachedBrief(db: Database.Database, roundId: number): ThemeBrief | null {
  const row = db.prepare('SELECT brief_json FROM theme_briefs WHERE round_id = ?').get(roundId) as { brief_json: string } | undefined;
  return row ? (JSON.parse(row.brief_json) as ThemeBrief) : null;
}

export function writeCachedBrief(db: Database.Database, roundId: number, brief: ThemeBrief): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO theme_briefs (round_id, brief_json, generated_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(round_id) DO UPDATE SET brief_json = excluded.brief_json, updated_at = excluded.updated_at
  `).run(roundId, JSON.stringify(brief), now, now);
}

export async function buildThemeBrief(db: Database.Database, roundId: number, llm: LlmFn): Promise<ThemeBrief> {
  const target = db.prepare(`
    SELECT r.name AS title, COALESCE(r.description,'') AS descr, l.name AS leagueName, l.id AS leagueId
    FROM rounds r JOIN seasons s ON s.id = r.season_id JOIN leagues l ON l.id = s.league_id
    WHERE r.id = ?
  `).get(roundId) as { title: string; descr: string; leagueName: string; leagueId: number } | undefined;
  if (!target) throw new Error(`round ${roundId} not found`);

  const ownerCid = resolveOwnerCompetitorId(db, OWNER) ?? -1;
  const matches = await matchThemes(db, roundId, llm);

  const runs: MatchedRun[] = matches.map((m) => {
    const rows = standings(db, m.roundId, ownerCid);
    const { podium, cellar } = podiumCellar(rows);
    return {
      roundId: m.roundId, leagueName: m.leagueName, seasonLabel: m.seasonLabel, title: m.title,
      subs: rows.length, scoring: leagueScoringType(db, m.leagueId),
      exactness: m.exactness, reason: m.reason, standings: rows, podium, cellar,
    };
  });

  const allRows = runs.flatMap((r) => r.standings);
  const familiarity = familiarityBuckets(allRows);
  const alreadyPlayed = ownerExposure(db, ownerCid, matches.map((m) => m.roundId), target.leagueId);

  const synthInput: SynthesisInput = {
    themeText: target.descr,
    runs: runs.map((r) => ({ label: `${r.leagueName} ${r.seasonLabel}`, standings: r.standings, comments: gatherComments(db, r.roundId) })),
  };
  const synth = runs.length > 0 ? await synthesize(synthInput, llm) : { winnerDna: '', cellarTraps: '', whatToSubmit: '', songLanguages: {} };

  const brief: ThemeBrief = {
    roundId, themeTitle: target.title, themeText: target.descr, leagueSlug: target.leagueName,
    runCount: runs.length + 1, firstTime: runs.length === 0,
    matches: runs, familiarity,
    winnerDna: synth.winnerDna, cellarTraps: synth.cellarTraps, whatToSubmit: synth.whatToSubmit,
    alreadyPlayed, songLanguages: synth.songLanguages,
    generatedAt: new Date().toISOString(),
  };
  writeCachedBrief(db, roundId, brief);
  return brief;
}
