import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { SeasonData } from '../db/seasonData.js';
import { buildArchiveContext } from './archiveContext.js';

export const SECTION_KINDS = ['podium', 'villain', 'flow', 'consensus', 'quotes', 'chat'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-5';

export interface DigestDraftRow {
  id: string;
  round_id: number;
  generated_at: string;
  finalized_at: string | null;
  rel_context: string;
  prep_checks: string;
  whole_regen_count: number;
  llm_cost_usd: number;
  /** sprint-21: generated in season-recap mode (1) and FINAL (1) vs mid (0). */
  recap_enabled: number;
  recap_final: number;
}

export interface DigestSectionRow {
  id: string;
  draft_id: string;
  kind: SectionKind;
  position: number;
  state: 'default' | 'excluded' | 'locked';
  content_json: string;
  edited_at: string | null;
  regen_count: number;
}

// Deterministic per-round facts for cross-round citations (sprint-35 bundle).
// One entry per round with round_number <= current, ordered by round_number.
export interface RoundBundleEntry {
  round_number: number;
  name: string;
  top3: { song: string; submitter: string | null; points: number }[];
  bottom1: { song: string; submitter: string | null; points: number } | null;
  winner: string | null;
  isCurrent: boolean;
  isPrev: boolean;
}

export interface RoundData {
  round: { id: number; name: string; description: string | null };
  league: { id: number; name: string };
  // Round-order awareness (sprint-14 prompt-rules): the current round's
  // sequence position in its season, plus the prior rounds in chronological
  // order so the LLM anchors "last round" correctly and never cites a later
  // round as already-happened.
  roundSequence: { number: number; total: number };
  priorRounds: { number: number; name: string }[];
  // Deterministic cross-round factual bundle (sprint-35). Covers all rounds
  // with round_number <= current; single source of cross-round citations.
  bundle: RoundBundleEntry[];
  submissions: { artist: string; title: string; album: string | null; submitter: string | null; comment: string | null; vote_total: number; spotifyUri: string; albumArtUrl: string | null }[];
  votes: { voter: string; song: string; points: number; comment: string | null }[];
  chatMentions: { sender: string; raw_message: string; captured_at: string }[];
  relContext: string;
}

// Per-section Generation params (sprint-14 generation-wiring). `id` is the
// section kind. Shared contract with the generate modal (frontend).
export interface GenSectionParam {
  id: SectionKind;
  enabled?: boolean;
  style?: string[];
  variant?: 'textual' | 'visual' | 'both';
  context?: string;
}
/** sprint-21 season-recap: re-render every section at season scope. */
export interface RecapParams {
  enabled: boolean;
  /** FINAL = champion / past tense; false = mid-season "so far, through R{N}". */
  final: boolean;
}
export interface GenParams {
  sections?: GenSectionParam[];
  pastedChat?: string;
  recap?: RecapParams;
}

export function gatherRoundData(
  db: Database.Database,
  roundId: number,
  opts?: { relContextOverride?: string },
): RoundData {
  const round = db
    .prepare(
      `SELECT r.id, r.name, r.description, r.season_id, s.league_id, l.name AS league_name
       FROM rounds r
       JOIN seasons s ON s.id = r.season_id
       JOIN leagues l ON l.id = s.league_id
       WHERE r.id = ?`,
    )
    .get(roundId) as
    | { id: number; name: string; description: string | null; season_id: number; league_id: number; league_name: string }
    | undefined;
  if (!round) throw new Error(`round not found: ${roundId}`);

  // Round chronology within the season — ordered by round_number (the real round
  // order), falling back to id for any round missing a number. Ordering by id
  // mis-sequenced rounds imported AFTER manually-created later-round placeholders
  // (e.g. a freshly-imported round 7 sorting after empty rounds 8-10).
  const seasonRounds = db
    .prepare(
      'SELECT id, name, round_number FROM rounds WHERE season_id = ? ORDER BY round_number IS NULL, round_number, id',
    )
    .all(round.season_id) as { id: number; name: string; round_number: number | null }[];
  const seqIdx = seasonRounds.findIndex((r) => r.id === roundId); // 0-based
  const roundSequence = {
    number: seasonRounds[seqIdx]?.round_number ?? seqIdx + 1,
    total: seasonRounds.length,
  };
  const priorRounds = seasonRounds
    .slice(0, seqIdx)
    .map((r, i) => ({ number: r.round_number ?? i + 1, name: r.name }));

  // Build deterministic per-round factual bundle (sprint-35 bundle task).
  // Query all submissions + votes for the season; filter to rounds <= current.
  const currentRoundNumber = roundSequence.number;
  const prevRoundId = seqIdx > 0 ? seasonRounds[seqIdx - 1].id : null;

  const bundleRows = db
    .prepare(
      `SELECT r.id AS round_id, r.round_number, r.name AS round_name,
              m.title AS song, c.name AS submitter,
              COALESCE(SUM(v.points), 0) AS vote_total
       FROM rounds r
       JOIN ml_submissions m ON m.round_id = r.id
       LEFT JOIN competitors c ON c.id = m.competitor_id
       LEFT JOIN votes v ON v.round_id = m.round_id AND v.spotify_uri = m.spotify_uri
       WHERE r.season_id = ?
       GROUP BY r.id, m.id
       ORDER BY r.round_number IS NULL, r.round_number, vote_total DESC`,
    )
    .all(round.season_id) as {
      round_id: number;
      round_number: number | null;
      round_name: string;
      song: string;
      submitter: string | null;
      vote_total: number;
    }[];

  const roundSongsMap = new Map<
    number,
    { round_number: number; round_name: string; songs: { song: string; submitter: string | null; points: number }[] }
  >();
  for (const row of bundleRows) {
    const rn = row.round_number ?? 0;
    if (rn > currentRoundNumber) continue;
    if (!roundSongsMap.has(row.round_id)) {
      roundSongsMap.set(row.round_id, { round_number: rn, round_name: row.round_name, songs: [] });
    }
    roundSongsMap.get(row.round_id)!.songs.push({ song: row.song, submitter: row.submitter, points: Number(row.vote_total) });
  }

  const bundle: RoundBundleEntry[] = Array.from(roundSongsMap.entries())
    .sort(([, a], [, b]) => a.round_number - b.round_number)
    .map(([rid, data]) => {
      const sorted = [...data.songs].sort((a, b) => b.points - a.points);
      const top3 = sorted.slice(0, 3);
      const bottom1 = sorted.length > 0 ? sorted[sorted.length - 1] : null;
      return {
        round_number: data.round_number,
        name: data.round_name,
        top3,
        bottom1,
        winner: top3[0]?.submitter ?? null,
        isCurrent: rid === roundId,
        isPrev: rid === prevRoundId,
      };
    });

  const subRows = db
    .prepare(
      `SELECT m.artists AS artists, m.title, m.album, m.spotify_uri, m.comment, m.album_art_url,
              c.name AS submitter,
              COALESCE(SUM(v.points), 0) AS vote_total
       FROM ml_submissions m
       LEFT JOIN competitors c ON c.id = m.competitor_id
       LEFT JOIN votes v ON v.round_id = m.round_id AND v.spotify_uri = m.spotify_uri
       WHERE m.round_id = ?
       GROUP BY m.id
       ORDER BY vote_total DESC`,
    )
    .all(roundId) as {
    artists: string;
    title: string;
    album: string | null;
    spotify_uri: string;
    comment: string | null;
    submitter: string | null;
    vote_total: number;
    album_art_url: string | null;
  }[];

  const voteRows = db
    .prepare(
      `SELECT c.name AS voter, m.title AS song, v.points, v.comment
       FROM votes v
       JOIN competitors c ON c.id = v.voter_id
       JOIN ml_submissions m ON m.round_id = v.round_id AND m.spotify_uri = v.spotify_uri
       WHERE v.round_id = ?`,
    )
    .all(roundId) as { voter: string; song: string; points: number; comment: string | null }[];

  const chatRows = db
    .prepare(
      `SELECT cm.sender_name AS sender, cm.raw_message, cm.captured_at
       FROM chat_mentions cm
       JOIN chat_assignments ca ON ca.chat_song_id = cm.song_id
       WHERE ca.round_id = ?
       ORDER BY cm.captured_at`,
    )
    .all(roundId) as { sender: string; raw_message: string; captured_at: string }[];

  // For regen of an existing round, callers pass the era-correct snapshot via
  // relContextOverride (sprint-35 relctx-scope). First-gen uses the live blob.
  const resolvedRelContext = opts?.relContextOverride !== undefined
    ? opts.relContextOverride
    : (db.prepare('SELECT text FROM relationship_contexts WHERE league_id = ?').get(round.league_id) as { text: string } | undefined)?.text ?? '';

  return {
    round: { id: round.id, name: round.name, description: round.description },
    league: { id: round.league_id, name: round.league_name },
    roundSequence,
    priorRounds,
    bundle,
    submissions: subRows.map(s => ({
      artist: s.artists,
      title: s.title,
      album: s.album,
      submitter: s.submitter,
      comment: s.comment,
      vote_total: Number(s.vote_total),
      spotifyUri: s.spotify_uri,
      albumArtUrl: s.album_art_url,
    })),
    votes: voteRows.map(v => ({ voter: v.voter, song: v.song, points: v.points, comment: v.comment })),
    chatMentions: chatRows,
    relContext: resolvedRelContext,
  };
}

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResult {
  content: string;
  /** USD cost of this call, from OpenRouter's usage accounting (0 if unavailable). */
  costUsd: number;
}

export async function callOpenRouter(messages: OpenRouterMessage[], opts: { model?: string; jsonMode?: boolean } = {}): Promise<LLMResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  const model = opts.model ?? process.env.OPENROUTER_DIGEST_MODEL ?? DEFAULT_MODEL;
  const body: Record<string, unknown> = { model, messages };
  if (opts.jsonMode) body.response_format = { type: 'json_object' };
  // Ask OpenRouter to include cost/usage accounting in the response (sprint-15
  // cost-capture). With this flag the chat-completion `usage` block carries the
  // call's USD `cost`.
  body.usage = { include: true };

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://mlb.mattmariani.com',
      'X-Title': 'Music League Bot - Digest',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { cost?: number };
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter returned no content');
  const costUsd = typeof json.usage?.cost === 'number' ? json.usage.cost : 0;
  const fenced = content.match(/^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  return { content: fenced ? fenced[1] : content, costUsd };
}

const SECTION_DESCRIPTIONS: Record<SectionKind, string> = {
  podium: 'Top 3 songs by vote_total — winner + runners-up. Include artist, title, submitter, vote_total, and one line of editorial color per song.',
  villain: 'The lowest-scoring or most-divisive submission. One paragraph of playful roasting using the actual numbers.',
  flow: 'A 1-2 paragraph narrative arc of how the round played out — what the theme produced, surprises, the shape of voting.',
  consensus: 'Songs/artists where multiple voters agreed (high vote spread / repeat voters). Bulleted list with the agreement noted.',
  quotes: '3-6 punchy direct quotes from vote comments — voter name + quote. Pick the ones with the most personality.',
  chat: 'Highlights from the WhatsApp chat tied to this round. Find the genuinely funny / notable exchanges and keep the dry, slightly-funny editorial voice. Output { "summary": <1-2 sentence overall read of the chat>, "moments": [{ "label": <short punchy title for one discrete chat moment>, "detail": <a fuller 1-2 sentence description of that moment, preserving the funny content> }] } with 3-6 moments.',
};

// sprint-21 season-recap: per-section recap-variant intents. Same OUTPUT shape
// as the round prompts (the system prompt is unchanged) — only the scope +
// editorial intent changes (the whole season vs one round).
const SECTION_DESCRIPTIONS_RECAP: Record<SectionKind, string> = {
  podium: 'The SEASON\'s standout tracks — the overall highest-scoring songs across every round (cumulative points). Crown the winners; for each give artist, title, submitter, the round it came from, and total season points, with a line of editorial color. This is the season\'s hall of fame.',
  villain: 'The season\'s LEAST-LOVED track(s) — the lowest cumulative-point songs of the whole season. This league has all-positive voting, so frame it as "least-loved" / "lowest-scoring", NOT "most-downvoted". Playful roast using the real numbers; you may nod to a player whose picks consistently underperformed.',
  flow: 'Narrate the ARC of the whole season — early leaders, lead changes, comebacks, and the race for #1 across the rounds. Use the round-by-round leader progression and the themes. This is the marquee recap section: tell the season\'s story.',
  consensus: 'The season\'s CONSENSUS darlings — tracks that earned broad, even agreement (many voters, low spread) AND high totals across the season. Bulleted; note the agreement.',
  quotes: 'The best lines from the SEASON\'s vote comments — punchy, full of personality, drawn from across all rounds. voter + quote. Pick the most memorable.',
  chat: 'Season highlights from the pasted chat transcript (the whole season, not one round). Output { "summary", "moments":[{"label","detail"}] } with 3-6 moments.',
};

// Format the compact season slice for one section into prompt text.
function recapSliceBlock(kind: SectionKind, s: SeasonData): string {
  const lines: string[] = [];
  switch (kind) {
    case 'podium':
      lines.push(`Season top ${s.podium.songs.length} by cumulative points:`);
      for (const x of s.podium.songs)
        lines.push(`  #${x.rank} [${x.points} pts] ${x.artist} — "${x.title}" (submitted by ${x.submitter ?? '—'}, round "${x.round}")`);
      break;
    case 'villain':
      lines.push('Least-loved songs of the season (lowest cumulative points — all votes are positive in this league):');
      for (const x of s.villain.lowest)
        lines.push(`  [${x.points} pts, ${x.voters} voters] ${x.artist} — "${x.title}" (${x.submitter ?? '—'}, round "${x.round}")`);
      if (s.villain.recurringLowScorers.length) {
        lines.push('Players whose picks underperformed all season (avg points/submission):');
        for (const r of s.villain.recurringLowScorers)
          lines.push(`  ${r.submitter}: avg ${r.avgPoints} over ${r.submissions} songs (worst: "${r.worstSong?.title}" ${r.worstSong?.points} pts)`);
      }
      break;
    case 'consensus':
      lines.push('Season consensus darlings (high total + broad, even support — more voters & lower variance = stronger agreement):');
      for (const x of s.consensus.songs)
        lines.push(`  [${x.points} pts, ${x.voters} voters, variance ${x.variance}] ${x.artist} — "${x.title}" (${x.submitter ?? '—'})`);
      break;
    case 'quotes':
      lines.push('Season vote-comment pool (voter → song, the points they gave, round, comment):');
      for (const c of s.quotes.comments)
        lines.push(`  ${c.voter} → "${c.song}" (${c.points} pts, round "${c.round}"): "${c.comment.replace(/\s+/g, ' ').trim()}"`);
      break;
    case 'flow':
      lines.push('Round-by-round cumulative leader progression + themes:');
      for (const r of s.flow.rounds)
        lines.push(`  R${r.number} "${r.name}": leader ${r.leader ?? '—'} (${r.leaderTotal} pts); round-best "${r.topSong?.title ?? '—'}" by ${r.topSong?.artist ?? '—'} (${r.topSong?.points ?? 0} pts)`);
      lines.push(`Lead changes across the season: ${s.flow.leadChanges}. Final leader: ${s.flow.finalLeader ?? '—'}.`);
      break;
    case 'chat':
      lines.push('(Use the pasted chat transcript below as the source.)');
      break;
  }
  return lines.join('\n');
}

// sprint-21: the season-recap user prompt. Same JSON output contract as the
// round prompt; swaps round data → per-section season slices + recap intents +
// final/mid framing. For a single-section regen, pass `steer.kind`.
function buildRecapUserPrompt(
  s: SeasonData,
  final: boolean,
  steer?: { chips: string[]; instructions: string; kind?: SectionKind; currentContent?: unknown },
  genParams?: GenParams,
): string {
  const parts: string[] = [];
  const c = s.context;
  parts.push(`# SEASON RECAP — ${c.seasonLabel}`);
  parts.push(`League: ${c.league.name}`);
  if (final) {
    parts.push(
      `\n# Framing: FINAL RECAP\nThe season is COMPLETE (all ${c.throughRound} rounds done). Write definitively, in PAST tense. ${c.champion ? `The CHAMPION is ${c.champion.name} (${c.champion.total} pts).` : ''} Cover the WHOLE season, not any single round.`,
    );
  } else {
    parts.push(
      `\n# Framing: MID-SEASON ("the season so far")\nThis is the season THROUGH Round ${c.throughRound} of ${c.totalRounds}. Write as a provisional check-in — present tense, "so far", "through round ${c.throughRound}". ${c.champion ? `The CURRENT LEADER is ${c.champion.name} (${c.champion.total} pts) — call them the current leader, NOT the champion; the season isn't over.` : ''} Do NOT declare a winner.`,
    );
  }

  parts.push(
    `\n# Season at a glance\nSongs: ${s.statStrip.songs} · Votes: ${s.statStrip.votes} · Rounds: ${s.statStrip.rounds} · Players: ${s.statStrip.players}${s.statStrip.biggestRound ? ` · Biggest round: "${s.statStrip.biggestRound.name}" (${s.statStrip.biggestRound.totalVotes} votes)` : ''}`,
  );

  if (c.relContext.trim()) {
    parts.push(`\n# Relationship context (people, history, recurring jokes)\n${c.relContext.trim()}`);
  }

  if (steer?.kind) {
    parts.push(`\n# Regenerate the ONE recap section "${steer.kind}"`);
    parts.push(SECTION_DESCRIPTIONS_RECAP[steer.kind]);
    parts.push(`\n## Season data for "${steer.kind}":\n${recapSliceBlock(steer.kind, s)}`);
    if (steer.kind === 'chat' && genParams?.pastedChat?.trim()) {
      parts.push(`\n## Pasted chat transcript (the source for "chat"):\n${genParams.pastedChat.trim()}`);
    }
    if (steer.currentContent !== undefined) parts.push(`\nPrevious version (replace it):\n${JSON.stringify(steer.currentContent)}`);
    if (steer.chips.length) parts.push(`\nSteer chips (apply ALL): ${steer.chips.join(', ')}`);
    if (steer.instructions.trim()) parts.push(`\nUser instructions: ${steer.instructions.trim()}`);
    parts.push(`\nReturn JSON: { "section": { ...content for "${steer.kind}"... } }`);
  } else {
    const activeKinds = activeKindsForRecap(genParams);
    parts.push(`\n# Write ${activeKinds.length} season-recap sections`);
    for (const k of activeKinds) {
      parts.push(`\n## ${k} — ${SECTION_DESCRIPTIONS_RECAP[k]}`);
      parts.push(recapSliceBlock(k, s));
      if (k === 'chat' && genParams?.pastedChat?.trim()) {
        parts.push(`Pasted chat transcript:\n${genParams.pastedChat.trim()}`);
      }
    }
  }

  return parts.join('\n');
}

// Recap-mode active kinds: same per-section enabled toggles, but chat depends
// ONLY on pasted text (no auto chat-mentions at season scope).
export function activeKindsForRecap(genParams?: GenParams): SectionKind[] {
  const disabled = new Set((genParams?.sections ?? []).filter((p) => p.enabled === false).map((p) => p.id));
  const hasChat = !!genParams?.pastedChat?.trim();
  return SECTION_KINDS.filter((k) => {
    if (disabled.has(k)) return false;
    if (k === 'chat') return hasChat;
    return true;
  });
}

export function buildSystemPrompt(): string {
  return `You are the editorial voice of "Music League Bot" — a private music-league digest writer.
Write in a sharp, dry, slightly literary tone. Be specific: use real song titles, real voter names, real numbers.
Never hedge. Never disclaim. Never apologize.

# Music League rules — these constrain what is TRUE. Never write a claim that violates them:
1. A player CANNOT vote on their own submission. Never imply someone "didn't even vote for their own song", that they "snubbed their own track", or that a comment on their own song counts as a self-vote. Self-votes do not exist.
2. Each voter may cast at most ONE downvote (negative-point vote) per round. "Only one downvote" is the maximum, not a noteworthy scarcity — never frame a single downvote as surprising, restrained, or meaningful. A song receiving one downvote means exactly one voter spent their single downvote on it.
3. When a song lists MULTIPLE artists, always refer to it by the FIRST listed artist only. Do not invent collaborations or name secondary artists unless the editorial point genuinely requires it.

# Chronology — respect round order:
You are given a verified Cross-round record listing every prior round with actual outcomes (winner, top songs, least-loved song). This record is THE ONLY permitted source for cross-round factual claims:
1. All callbacks, "last round" references, and recurring storylines must cite only songs, submitters, and outcomes that appear in the Cross-round record.
2. Do not name songs, submitters, or outcomes from other rounds unless they appear in the record.
3. "Last round" means the immediately preceding round in the record — never a later one.
4. Never reference rounds not in the record (i.e., rounds that come after the current one).
The Relationship context section that follows provides personality and tone — it is NOT a source of cross-round facts.

You output ONE JSON object with this exact shape:

{
  "sections": {
    "podium":    { "title": string, "items": [...], "body": string },
    "villain":   { "title": string, "body": string },
    "flow":      { "title": string, "body": string },
    "consensus": { "title": string, "items": [...] },
    "quotes":    { "title": string, "items": [{"voter": string, "quote": string}] },
    "chat":      { "title": string, "summary": string, "moments": [{"label": string, "detail": string}] }
  }
}

Each section's "items" shape is up to you per kind, but stay consistent within a section.`;
}

// Which section kinds a full draft should produce, honoring per-section
// `enabled` from the generate modal and whether chat content is available.
export function activeKindsForDraft(data: RoundData, genParams?: GenParams): SectionKind[] {
  const disabled = new Set(
    (genParams?.sections ?? []).filter((s) => s.enabled === false).map((s) => s.id),
  );
  const hasChat = data.chatMentions.length > 0 || !!genParams?.pastedChat?.trim();
  return SECTION_KINDS.filter((k) => {
    if (disabled.has(k)) return false;
    if (k === 'chat') return hasChat;
    return true;
  });
}

export function buildUserPrompt(
  data: RoundData,
  steer?: { chips: string[]; instructions: string; kind?: SectionKind; currentContent?: unknown },
  genParams?: GenParams,
  season?: SeasonData,
): string {
  // sprint-21: recap mode swaps the entire prompt body to season slices.
  if (genParams?.recap?.enabled && season) {
    return buildRecapUserPrompt(season, genParams.recap.final, steer, genParams);
  }
  const parts: string[] = [];
  parts.push(`# Round\n${data.round.name}${data.round.description ? ` — ${data.round.description}` : ''}`);
  parts.push(`League: ${data.league.name}`);

  // Chronology + cross-round factual bundle (sprint-35 prompt-cite).
  // The bundle is the single source of cross-round facts; relContext is personality only.
  const seq = data.roundSequence;
  const priorBundle = data.bundle.filter(e => !e.isCurrent);
  parts.push(`\n# Round chronology\nThis is round ${seq.number} of ${seq.total} in the season.`);

  if (priorBundle.length) {
    parts.push(
      '\n## Cross-round record — THE ONLY SOURCE of cross-round facts\n' +
      'Every prior round is listed with verified outcomes. ' +
      'All callbacks, "last round" references, and recurring storylines MUST cite only what appears here. ' +
      'Do not name songs, submitters, or outcomes from rounds not in this record.',
    );
    for (const e of priorBundle) {
      const tag = e.isPrev ? ' [last round]' : '';
      const topLine = e.top3.length
        ? e.top3.map(s => `${s.submitter ? `${s.submitter}: ` : ''}"${s.song}" (${s.points} pts)`).join(', ')
        : '—';
      const botLine = e.bottom1
        ? `${e.bottom1.submitter ? `${e.bottom1.submitter}: ` : ''}"${e.bottom1.song}" (${e.bottom1.points} pts)`
        : '—';
      parts.push(
        `Round ${e.round_number}: ${e.name}${tag}\n` +
        `  Winner: ${e.winner ?? '—'}\n` +
        `  Top 3: ${topLine}\n` +
        `  Least-loved: ${botLine}`,
      );
    }
    const last = priorBundle[priorBundle.length - 1];
    parts.push(`"Last round" = Round ${last.round_number}: ${last.name}. Do not reference any round after round ${seq.number}.`);
  } else {
    parts.push('This is the FIRST round of the season — there is no "last round" to reference.');
  }

  if (data.relContext.trim()) {
    parts.push(
      `\n# Relationship context (people, personality, recurring jokes)\n` +
      `NOTE: This is personality and tone context only — NOT a source of cross-round facts.\n` +
      `For cross-round facts (who won what, which song placed where), use the Cross-round record above.\n` +
      data.relContext.trim(),
    );
  }

  parts.push(`\n# Submissions (${data.submissions.length}) — sorted by vote_total desc`);
  for (const s of data.submissions) {
    const sub = s.submitter ? ` (submitted by ${s.submitter})` : '';
    const cmt = s.comment ? ` — "${s.comment.replace(/\s+/g, ' ').trim()}"` : '';
    parts.push(`- [${s.vote_total} pts] ${s.artist} — "${s.title}"${sub}${cmt}`);
  }

  parts.push(`\n# Votes (${data.votes.length})`);
  for (const v of data.votes) {
    const cmt = v.comment ? ` — "${v.comment.replace(/\s+/g, ' ').trim()}"` : '';
    parts.push(`- ${v.voter} → "${v.song}" (${v.points} pts)${cmt}`);
  }

  if (data.chatMentions.length) {
    parts.push(`\n# Chat mentions (${data.chatMentions.length})`);
    for (const m of data.chatMentions) {
      parts.push(`- [${m.captured_at}] ${m.sender}: ${m.raw_message.replace(/\s+/g, ' ').trim()}`);
    }
  }

  // Pasted WhatsApp chat (sprint-14 D5) — manual override feeding the chat
  // section, bypassing the flaky auto-capture.
  if (genParams?.pastedChat?.trim()) {
    parts.push(
      `\n# Pasted WhatsApp chat — use THIS as the source for the "chat" section (ignore auto-captured mentions for that section):\n${genParams.pastedChat.trim()}`,
    );
  }

  if (steer?.kind) {
    parts.push(`\n# Regenerate the ONE section "${steer.kind}"`);
    parts.push(SECTION_DESCRIPTIONS[steer.kind]);
    if (steer.currentContent !== undefined) {
      parts.push(`\nPrevious version (replace it):\n${JSON.stringify(steer.currentContent)}`);
    }
    if (steer.chips.length) {
      parts.push(`\nSteer chips (apply ALL): ${steer.chips.join(', ')}`);
    }
    if (steer.instructions.trim()) {
      parts.push(`\nUser instructions: ${steer.instructions.trim()}`);
    }
    parts.push(`\nReturn JSON: { "section": { ...content for "${steer.kind}"... } }`);
  } else {
    const activeKinds = activeKindsForDraft(data, genParams);
    const paramByKind = new Map((genParams?.sections ?? []).map((s) => [s.id, s]));
    parts.push(`\n# Write ${activeKinds.length} sections`);
    for (const k of activeKinds) {
      let line = `- ${k}: ${SECTION_DESCRIPTIONS[k]}`;
      const p = paramByKind.get(k);
      if (p?.style?.length) line += ` [style/focus — lean into: ${p.style.join(', ')}]`;
      if (p?.context?.trim()) line += ` [extra context: ${p.context.trim()}]`;
      parts.push(line);
    }
  }

  return parts.join('\n');
}

interface DraftLLMOutput {
  sections: Record<SectionKind, unknown>;
  /** Accumulated USD cost of the generation call (sprint-15 cost-capture). */
  costUsd: number;
}

export async function generateDraft(data: RoundData, genParams?: GenParams, season?: SeasonData): Promise<DraftLLMOutput> {
  const { content: raw, costUsd } = await callOpenRouter(
    [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(data, undefined, genParams, season) },
    ],
    { jsonMode: true },
  );
  const parsed = JSON.parse(raw) as DraftLLMOutput;
  if (!parsed.sections) throw new Error('LLM response missing "sections"');
  for (const k of SECTION_KINDS) {
    if (!(k in parsed.sections)) {
      parsed.sections[k] = { title: k, body: '', items: [] };
    }
  }
  parsed.costUsd = costUsd;
  return parsed;
}

export async function regenerateOneSection(
  data: RoundData,
  kind: SectionKind,
  currentContent: unknown,
  chips: string[],
  instructions: string,
  genParams?: GenParams,
  season?: SeasonData,
): Promise<{ section: unknown; costUsd: number }> {
  const { content: raw, costUsd } = await callOpenRouter(
    [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(data, { chips, instructions, kind, currentContent }, genParams, season) },
    ],
    { jsonMode: true },
  );
  const parsed = JSON.parse(raw) as { section?: unknown };
  if (parsed.section === undefined) throw new Error('LLM response missing "section"');
  return { section: parsed.section, costUsd };
}

// ---- DB helpers ----

export function getActiveDraftForRound(db: Database.Database, roundId: number): DigestDraftRow | null {
  return (db
    .prepare('SELECT * FROM digest_drafts WHERE round_id = ? ORDER BY generated_at DESC LIMIT 1')
    .get(roundId) as DigestDraftRow | undefined) ?? null;
}

export function getSectionsForDraft(db: Database.Database, draftId: string): DigestSectionRow[] {
  return db
    .prepare('SELECT * FROM digest_sections WHERE draft_id = ? ORDER BY position ASC')
    .all(draftId) as DigestSectionRow[];
}

const normTitle = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Inject album-art URLs into a podium section's items so AlbumPodium renders
 * covers. Matches each item to a round submission by title (then falls back to
 * vote-rank position, since both lists are top-down). Mutates `content` in place.
 */
export function enrichPodiumArt(content: unknown, submissions: RoundData['submissions']): void {
  if (!content || typeof content !== 'object') return;
  const items = (content as { items?: unknown }).items;
  if (!Array.isArray(items)) return;

  const byTitle = new Map<string, string>();
  for (const s of submissions) {
    if (s.albumArtUrl && !byTitle.has(normTitle(s.title))) byTitle.set(normTitle(s.title), s.albumArtUrl);
  }
  const ranked = submissions.map((s) => s.albumArtUrl).filter((u): u is string => !!u);

  items.forEach((it, idx) => {
    if (!it || typeof it !== 'object') return;
    const item = it as Record<string, unknown>;
    if (item.coverUrl || item.albumArtUrl || item.album_art_url) return; // already set
    const t = typeof item.title === 'string' ? item.title : '';
    const art = byTitle.get(normTitle(t)) ?? ranked[idx] ?? null;
    if (art) item.coverUrl = art;
  });
}

/** Add an LLM call's USD cost to a digest's accumulated total (sprint-15). */
export function addDraftCost(db: Database.Database, draftId: string, costUsd: number): void {
  if (!costUsd) return;
  db.prepare('UPDATE digest_drafts SET llm_cost_usd = llm_cost_usd + ? WHERE id = ?').run(costUsd, draftId);
}

export function writeDraft(
  db: Database.Database,
  roundId: number,
  data: RoundData,
  output: DraftLLMOutput,
  prepChecks: unknown,
  genParams?: GenParams,
): { draft: DigestDraftRow; sections: DigestSectionRow[] } {
  const draftId = `draft-${roundId}-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const variantByKind = new Map((genParams?.sections ?? []).map((s) => [s.id, s.variant]));

  // Inject existing per-song album art into the podium items so AlbumPodium
  // renders covers (sprint-15 podium-thumbnails).
  enrichPodiumArt(output.sections.podium, data.submissions);

  const recapEnabled = genParams?.recap?.enabled ? 1 : 0;
  const recapFinal = genParams?.recap?.final === false ? 0 : 1;

  const tx = db.transaction(() => {
    const archiveContext = JSON.stringify(buildArchiveContext(genParams, output));
    db.prepare(
      `INSERT INTO digest_drafts (id, round_id, generated_at, rel_context, prep_checks, whole_regen_count, llm_cost_usd, recap_enabled, recap_final, archive_context)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    ).run(draftId, roundId, now, data.relContext, JSON.stringify(prepChecks ?? {}), output.costUsd ?? 0, recapEnabled, recapFinal, archiveContext);

    // Only persist enabled + content-available sections; position is dense.
    // Recap mode: chat depends on pasted text only (no season chat-mentions).
    const activeKinds = recapEnabled ? activeKindsForRecap(genParams) : activeKindsForDraft(data, genParams);
    activeKinds.forEach((kind, idx) => {
      const id = `${draftId}-${kind}`;
      const variant = variantByKind.get(kind) ?? 'textual';
      db.prepare(
        `INSERT INTO digest_sections (id, draft_id, kind, position, state, content_json, regen_count, variant)
         VALUES (?, ?, ?, ?, 'default', ?, 0, ?)`,
      ).run(id, draftId, kind, idx, JSON.stringify(output.sections[kind] ?? {}), variant);
    });
  });
  tx();

  const draft = db.prepare('SELECT * FROM digest_drafts WHERE id = ?').get(draftId) as DigestDraftRow;
  const sections = getSectionsForDraft(db, draftId);
  return { draft, sections };
}

export function replaceSectionContent(
  db: Database.Database,
  section: DigestSectionRow,
  newContent: unknown,
  chips: string[],
  instructions: string,
): DigestSectionRow {
  const newJson = JSON.stringify(newContent ?? {});
  const regenId = `regen-${randomUUID().slice(0, 12)}`;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO digest_regenerations
         (id, section_id, chips, instructions, prior_content_json, new_content_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(regenId, section.id, JSON.stringify(chips ?? []), instructions ?? '', section.content_json, newJson);

    db.prepare(
      `UPDATE digest_sections
         SET content_json = ?, regen_count = regen_count + 1
       WHERE id = ?`,
    ).run(newJson, section.id);
  });
  tx();

  return db.prepare('SELECT * FROM digest_sections WHERE id = ?').get(section.id) as DigestSectionRow;
}

export function incrementWholeRegenCount(db: Database.Database, draftId: string): void {
  db.prepare('UPDATE digest_drafts SET whole_regen_count = whole_regen_count + 1 WHERE id = ?').run(draftId);
}
