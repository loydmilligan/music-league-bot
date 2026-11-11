// Read-only projection of the league DB for Pocket Sign's Music League screens.
// Exposes display names and household person ids only: no emails, handles, or links.
import type Database from 'better-sqlite3';
import { getRoundsForSeason } from '../db/rounds.js';
import { readStoredStandings } from '../db/standings.js';
import { LEAGUE_DEFS, readSurveyLeague } from '../surveySync/parse.js';

export type SignagePhase = 'upcoming' | 'submission' | 'voting' | 'complete';

export interface SignageResponse {
  generatedAt: string;
  seasons: {
    league: { slug: string; name: string };
    season: number;
    members: string[];
    roundCount: number;
    rounds: { number: number; title: string; theme: string; revealed: boolean; submitBy: string | null; voteBy: string | null;
              phase: SignagePhase; submitted: string[]; voted: string[] }[];
    standings: { afterRound: number; rows: { rank: number; prevRank: number | null; name: string; total: number; roundPoints: number; person: string | null }[] } | null;
    shortlist: { round: number; title: string; artist: string; rating: number | null }[];
  }[];
}

export interface SignageOptions {
  /** Survey data dir for reveal times. Defaults to SURVEY_DATA_DIR. */
  surveyDir?: string;
}

const PEOPLE_KEY = 'signage_people';

function readPeople(db: Database.Database): Map<number, string> {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(PEOPLE_KEY) as { value: string } | undefined;
  const out = new Map<number, string>();
  if (!row?.value) return out;
  try {
    const parsed = JSON.parse(row.value) as unknown;
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        const id = Number(k);
        if (Number.isInteger(id) && typeof v === 'string' && v) out.set(id, v);
      }
    }
  } catch { /* malformed row reads as an empty map */ }
  return out;
}

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function toPhase(phase: string | undefined): SignagePhase {
  return phase === 'archive' ? 'complete' : (phase as SignagePhase) ?? 'upcoming';
}

/** Theme text with links and email-like tokens removed. */
function cleanTheme(text: string | null): string {
  return (text ?? '')
    .replace(/(?:https?:\/\/|(?:open\.)?spotify\.com)\S*/gi, ' ')
    .split(/\s+/).filter(t => t && !t.includes('@')).join(' ').trim();
}

function plainReveal(title: string, description: string | null, needDescription: boolean): boolean {
  const t = title.trim();
  if (!t || t.toUpperCase() === 'TBD') return false;
  return needDescription ? Boolean(description?.trim()) : true;
}

/** Household people (by person id) who appear in `table` for a round, matching display names case-insensitively. */
function peopleFromEvents(
  db: Database.Database, table: 'submission_events' | 'vote_events', nameCol: string,
  roundId: number, people: Map<number, string>,
): string[] {
  const rows = db.prepare(
    `SELECT DISTINCT c.player_id AS player_id
     FROM ${table} e JOIN competitors c ON lower(c.name) = lower(e.${nameCol})
     WHERE e.round_id = ? AND c.player_id IS NOT NULL
     ORDER BY c.player_id`,
  ).all(roundId) as { player_id: number }[];
  const out: string[] = [];
  for (const r of rows) {
    const p = people.get(r.player_id);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/** The mean of the rating fields that were filled in (0 or null means unrated); null when none were. */
function shortlistRating(r: Record<string, number>): number | null {
  const vals = [r.rating_discovery, r.rating_theme_fit, r.rating_nostalgia, r.rating_personal, r.rating_quality, r.rating_replayability]
    .filter((v): v is number => typeof v === 'number' && v > 0);
  if (!vals.length) return null;
  return Math.max(0, Math.min(5, Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)));
}

export function buildSignage(db: Database.Database, nowMs: number, opts: SignageOptions = {}): SignageResponse {
  const people = readPeople(db);
  const surveyDir = opts.surveyDir ?? process.env.SURVEY_DATA_DIR;
  const hasVoteEvents = tableExists(db, 'vote_events');

  const seasonRows = db.prepare(
    `SELECT s.id, s.season_number, s.managed_by, l.slug, l.name AS league_name
     FROM seasons s JOIN leagues l ON l.id = s.league_id
     WHERE s.status = 'active' ORDER BY l.id, s.season_number`,
  ).all() as { id: number; season_number: number; managed_by: string | null; slug: string; league_name: string }[];

  const seasons = seasonRows.map(s => {
    const raw = db.prepare('SELECT id, round_number, managed_by FROM rounds WHERE season_id = ? ORDER BY id').all(s.id) as
      { id: number; round_number: number | null; managed_by: string | null }[];
    const numberById = new Map(raw.map((r, i) => [r.id, r.round_number ?? i + 1]));
    const managedById = new Map(raw.map(r => [r.id, Boolean(r.managed_by || s.managed_by)]));

    // Survey reveal times, only when a survey league is linked and its files read cleanly.
    let surveyReveal: Map<number, boolean> | null = null;
    const def = LEAGUE_DEFS.find(d => d.slug === s.slug);
    if (surveyDir && def && raw.some(r => managedById.get(r.id))) {
      const res = readSurveyLeague(surveyDir, def, nowMs);
      if (res.ok) surveyReveal = new Map(res.league.rounds.map(r => [r.number, r.revealed]));
    }

    const rounds = getRoundsForSeason(db, s.id).map(r => {
      const number = numberById.get(r.id)!;
      const survey = managedById.get(r.id);
      const revealed = survey
        ? (surveyReveal?.get(number) ?? false) // fail closed: no survey data or round absent
        : plainReveal(r.name, r.description, true);
      return {
        id: r.id, number, title: r.name, theme: cleanTheme(r.description), revealed,
        submitBy: r.submissionDeadline, voteBy: r.votingDeadline, phase: toPhase(r.phase),
        submitted: peopleFromEvents(db, 'submission_events', 'submitter_name', r.id, people),
        voted: hasVoteEvents ? peopleFromEvents(db, 'vote_events', 'voter_name', r.id, people) : [],
      };
    }).sort((a, b) => a.number - b.number);

    const memberRows = db.prepare('SELECT player_id FROM season_players WHERE season_id = ? ORDER BY player_id').all(s.id) as { player_id: number }[];
    const members: string[] = [];
    for (const m of memberRows) {
      const p = people.get(m.player_id);
      if (p && !members.includes(p)) members.push(p);
    }

    // Latest snapshot = the highest-numbered round of this season that has one.
    const snaps = db.prepare('SELECT DISTINCT round_id FROM season_standings WHERE season_id = ?').all(s.id) as { round_id: number }[];
    const latest = rounds.filter(r => snaps.some(x => x.round_id === r.id)).pop();
    let standings: SignageResponse['seasons'][number]['standings'] = null;
    if (latest) {
      const playerOf = db.prepare('SELECT player_id FROM competitors WHERE id = ?');
      const rows = readStoredStandings(db, latest.id).map(r => {
        const pid = (playerOf.get(r.competitorId) as { player_id: number | null } | undefined)?.player_id;
        return { rank: r.rank, prevRank: r.prevRank, name: r.name, total: r.currentTotal, roundPoints: r.roundPoints,
          person: (pid != null ? people.get(pid) : undefined) ?? null };
      });
      if (rows.length) standings = { afterRound: latest.number, rows };
    }

    const open = rounds.filter(r => r.phase !== 'complete');
    const shortlist = open.flatMap(r =>
      (db.prepare(
        `SELECT t.title, t.artist, t.rating_discovery, t.rating_theme_fit, t.rating_nostalgia, t.rating_personal,
                t.rating_quality, t.rating_replayability
         FROM shortlist_assignments a JOIN shortlist_songs t ON t.id = a.shortlist_song_id
         WHERE a.round_id = ? ORDER BY a.assigned_at, t.title`,
      ).all(r.id) as Record<string, any>[]).map(t => ({
        round: r.number, title: t.title as string, artist: t.artist as string, rating: shortlistRating(t),
      })));

    return {
      league: { slug: s.slug, name: s.league_name },
      season: s.season_number,
      members,
      roundCount: rounds.length,
      rounds: rounds.map(({ id: _id, ...r }) => r),
      standings,
      shortlist,
    };
  });

  return { generatedAt: new Date(nowMs).toISOString(), seasons };
}
