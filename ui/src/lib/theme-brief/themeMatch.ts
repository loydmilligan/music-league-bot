import type Database from 'better-sqlite3';
import type { LlmFn } from './llmFn.js';
import type { ThemeMatch } from './types.js';

interface Candidate { roundId: number; leagueId: number; leagueName: string; seasonNumber: number; title: string; description: string; }

const CANDIDATE_SELECT = `
    SELECT DISTINCT r.id AS roundId, l.id AS leagueId, l.name AS leagueName,
           s.season_number AS seasonNumber, r.name AS title, COALESCE(r.description,'') AS description
    FROM rounds r
    JOIN seasons s ON s.id = r.season_id
    JOIN leagues l ON l.id = s.league_id
    WHERE r.id <> ?
      AND (`;

// Short, generic stopwords that would otherwise dominate description-word
// overlap without being thematically meaningful. Kept small on purpose.
const STOPWORDS = new Set([
  'song', 'songs', 'theme', 'provided', 'submitted', 'other', 'than', 'with',
  'your', 'that', 'this', 'must', 'contain', 'from', 'into', 'have', 'their',
]);

// Distinct, lowercase, length>=4, non-stopword word tokens from free text —
// used as the untagged-round fallback signal (not hardcoded to any theme).
function significantWords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  return [...new Set(words.filter((w) => !STOPWORDS.has(w)))];
}

function candidates(db: Database.Database, targetRoundId: number): Candidate[] {
  const tagCount = (db.prepare('SELECT COUNT(*) AS n FROM round_theme_tags WHERE round_id = ?')
    .get(targetRoundId) as { n: number }).n;

  if (tagCount > 0) {
    // Tagged path: rounds sharing >=1 theme tag with the target.
    return db.prepare(`${CANDIDATE_SELECT}
        r.id IN (
          SELECT rtt2.round_id FROM round_theme_tags rtt2
          WHERE rtt2.tag_id IN (SELECT tag_id FROM round_theme_tags WHERE round_id = ?)
        )
      )
  `).all(targetRoundId, targetRoundId) as Candidate[];
  }

  // Untagged path: significant-word overlap on the target's own description
  // (generic — not hardcoded to any specific theme's vocabulary).
  const target = db.prepare('SELECT COALESCE(description,\'\') AS description FROM rounds WHERE id = ?')
    .get(targetRoundId) as { description: string } | undefined;
  const words = significantWords(target?.description ?? '');
  if (words.length === 0) return [];

  const orClause = words.map(() => 'r.description LIKE ?').join(' OR ');
  const likeParams = words.map((w) => `%${w}%`);
  return db.prepare(`${CANDIDATE_SELECT}
        (${orClause})
      )
  `).all(targetRoundId, ...likeParams) as Candidate[];
}

export async function matchThemes(db: Database.Database, targetRoundId: number, llm: LlmFn): Promise<ThemeMatch[]> {
  const target = db.prepare(`SELECT name, COALESCE(description,'') AS description FROM rounds WHERE id = ?`)
    .get(targetRoundId) as { name: string; description: string } | undefined;
  if (!target) return [];
  const cands = candidates(db, targetRoundId);
  if (cands.length === 0) return [];

  const sys = { role: 'system', content:
    'You match music-league round themes. Given a TARGET theme and CANDIDATE past themes, return JSON ' +
    '{"matches":[{"roundId":N,"exactness":"exact"|"related","reason":"<=12 words"}]}. ' +
    '"exact" = same core rule; "related" = adjacent but distinct. Only include candidates that genuinely match. ' +
    'Never invent a roundId not in CANDIDATES.' };
  const user = { role: 'user', content: JSON.stringify({
    target: { name: target.name, description: target.description },
    candidates: cands.map((c) => ({ roundId: c.roundId, name: c.title, description: c.description })),
  }) };

  let parsed: { matches?: Array<{ roundId: number; exactness: string; reason: string }> };
  try { parsed = JSON.parse(await llm([sys, user], { jsonMode: true })); } catch { return []; }

  const byId = new Map(cands.map((c) => [c.roundId, c]));
  return (parsed.matches ?? [])
    .filter((m) => byId.has(m.roundId)) // reject hallucinated rounds
    .map((m) => {
      const c = byId.get(m.roundId)!;
      return {
        roundId: c.roundId, leagueId: c.leagueId, leagueName: c.leagueName,
        seasonLabel: `S${c.seasonNumber}`, title: c.title,
        exactness: m.exactness === 'exact' ? 'exact' : 'related',
        reason: m.reason,
      } as ThemeMatch;
    });
}
