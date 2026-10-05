// Reads the mlsurvey admin's data files (boarz-season-2-survey/data, mounted
// read-only) into one plain structure. This is the ONLY module that knows the
// survey's file layout — see docs/superpowers/specs/2026-10-05-survey-round-sync-design.md.
//
// Titles/descriptions/deadlines come from the worker's Music League snapshot
// (ml-sync-state.json lastRounds), so unrevealed rounds carry their teasers.
// Credit and comment rule come from the survey's own season file, and only for
// revealed rounds.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface SurveyLeagueDef {
  slug: string;              // bot league slug
  prefix: string;            // survey data-file prefix
  submissions: string;       // survey submissions file (season-specific)
}

// Mirrors LEAGUES in the survey's scripts/ml-sync-worker.mjs.
export const LEAGUE_DEFS: SurveyLeagueDef[] = [
  { slug: 'boarz-ii-men', prefix: '', submissions: 'submissions.json' },
  { slug: 'second-best', prefix: 'second-best-', submissions: 'second-best-season-3-submissions.json' },
];

export const HEARTBEAT_STALE_MS = 24 * 3_600_000;

export interface SurveyRound {
  mlRoundId: string;
  number: number;
  name: string;
  description: string;
  submissionDeadline: string | null;
  votingDeadline: string | null;
  revealed: boolean;
  credits: string[];         // credited player names (Admins/mlbot removed); empty when unrevealed
  comment: { level: string; visibility: string | null; prompt: string | null } | null;
}

export interface SurveyLeague {
  slug: string;
  mlLeagueId: string;
  seasonNumber: number;
  rounds: SurveyRound[];
  warnings: string[];
}

export type SurveyLeagueResult = { ok: true; league: SurveyLeague } | { ok: false; slug: string; error: string };

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Port of the survey's theme-ids.js themeId().
export function themeId(submission: any, theme: any, index: number): string {
  return createHash('sha256')
    .update([
      submission.id || submission.voterName,
      index,
      theme.title || '',
      theme.description || theme.themeSuggestions || '',
    ].join('|'))
    .digest('hex')
    .slice(0, 20);
}

function themeOwners(submissions: any[]): Map<string, string> {
  const byId = new Map<string, string>();
  for (const s of submissions) {
    const themes = Array.isArray(s.themes)
      ? s.themes
      : s.themeSuggestions ? [{ title: '', description: s.themeSuggestions }] : [];
    themes.forEach((t: any, i: number) => byId.set(themeId(s, t, i), s.voterName));
  }
  return byId;
}

function commentLevel(req: any): string {
  if (['none', 'suggested', 'required'].includes(req?.level)) return req.level;
  return req?.required === true ? 'required' : 'none';
}

export function readSurveyLeague(dir: string, def: SurveyLeagueDef, nowMs: number): SurveyLeagueResult {
  const slug = def.slug;
  const file = (name: string) => join(dir, def.prefix + name);
  try {
    const linkPath = file('ml-link.json');
    if (!existsSync(linkPath)) return { ok: false, slug, error: `missing ${def.prefix}ml-link.json` };
    const link = readJson(linkPath) as any;
    const mlLeagueId = typeof link?.leagueId === 'string' ? link.leagueId : '';
    if (!mlLeagueId) return { ok: false, slug, error: 'survey has no Music League league linked' };

    const draft = readJson(file('draft-season.json')) as any;
    const seasonNumber = Number(draft?.season);
    if (!Number.isInteger(seasonNumber) || seasonNumber < 1) return { ok: false, slug, error: 'draft season has no season number' };

    const publishedPath = file('published-season.json');
    const published = existsSync(publishedPath) ? (readJson(publishedPath) as any) : null;
    const source: any[] = [...(published?.rounds?.length ? published.rounds : (draft?.rounds ?? []))]
      .sort((a, b) => Number(a.position) - Number(b.position));

    const state = readJson(file('ml-sync-state.json')) as any;
    const snapshot: any[] = Array.isArray(state?.lastRounds) ? state.lastRounds : [];
    const mine = snapshot.filter(r => r?.league_id === mlLeagueId);
    if (snapshot.length && !mine.length) {
      return { ok: false, slug, error: 'Music League snapshot is for a different league than the survey link' };
    }

    const subsPath = join(dir, def.submissions);
    const submissions = existsSync(subsPath) ? (readJson(subsPath) as any) : [];
    const owners = themeOwners(Array.isArray(submissions) ? submissions : []);

    const warnings: string[] = [];
    if (!mine.length) warnings.push('no Music League snapshot yet — the survey worker has not synced this season');
    const hb = Date.parse(state?.heartbeatAt ?? '');
    if (!Number.isNaN(hb) && nowMs - hb > HEARTBEAT_STALE_MS) {
      warnings.push(`survey sync worker last ran ${new Date(hb).toISOString()} — it may be down`);
    }

    const rounds: SurveyRound[] = mine.map(m => {
      const number = Number(m.number);
      const sr = source.find(r => Number(r.position) === number);
      const revealAt = sr?.reveal?.at ? Date.parse(sr.reveal.at) : NaN;
      const revealed = Boolean(sr) && !(Number.isFinite(revealAt) && nowMs < revealAt);
      let credits: string[] = [];
      let comment: SurveyRound['comment'] = null;
      if (revealed) {
        credits = [...new Set(((sr.links ?? []) as any[])
          .map(l => owners.get(l.themeId))
          .filter((n): n is string => Boolean(n))
          .filter(n => n.toLowerCase() !== 'mlbot'))];
        const req = sr.commentRequirement;
        comment = {
          level: commentLevel(req),
          visibility: req?.visibility ?? null,
          prompt: String(req?.prompt ?? '').trim() || null,
        };
      }
      return {
        mlRoundId: String(m.id),
        number,
        name: String(m.name ?? ''),
        description: String(m.description ?? ''),
        submissionDeadline: m.submissions_due_utc ?? null,
        votingDeadline: m.votes_due_utc ?? null,
        revealed,
        credits,
        comment,
      };
    });

    return { ok: true, league: { slug, mlLeagueId, seasonNumber, rounds, warnings } };
  } catch (e) {
    return { ok: false, slug, error: `could not read survey files: ${(e as Error).message}` };
  }
}
