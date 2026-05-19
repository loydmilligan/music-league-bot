import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

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

export interface RoundData {
  round: { id: number; name: string; description: string | null };
  league: { id: number; name: string };
  submissions: { artist: string; title: string; album: string | null; submitter: string | null; comment: string | null; vote_total: number }[];
  votes: { voter: string; song: string; points: number; comment: string | null }[];
  chatMentions: { sender: string; raw_message: string; captured_at: string }[];
  relContext: string;
}

export function gatherRoundData(db: Database.Database, roundId: number): RoundData {
  const round = db
    .prepare(
      `SELECT r.id, r.name, r.description, s.league_id, l.name AS league_name
       FROM rounds r
       JOIN seasons s ON s.id = r.season_id
       JOIN leagues l ON l.id = s.league_id
       WHERE r.id = ?`,
    )
    .get(roundId) as
    | { id: number; name: string; description: string | null; league_id: number; league_name: string }
    | undefined;
  if (!round) throw new Error(`round not found: ${roundId}`);

  const subRows = db
    .prepare(
      `SELECT m.artists AS artists, m.title, m.album, m.spotify_uri, m.comment,
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

  const relRow = db
    .prepare('SELECT text FROM relationship_contexts WHERE league_id = ?')
    .get(round.league_id) as { text: string } | undefined;

  return {
    round: { id: round.id, name: round.name, description: round.description },
    league: { id: round.league_id, name: round.league_name },
    submissions: subRows.map(s => ({
      artist: s.artists,
      title: s.title,
      album: s.album,
      submitter: s.submitter,
      comment: s.comment,
      vote_total: Number(s.vote_total),
    })),
    votes: voteRows.map(v => ({ voter: v.voter, song: v.song, points: v.points, comment: v.comment })),
    chatMentions: chatRows,
    relContext: relRow?.text ?? '',
  };
}

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function callOpenRouter(messages: OpenRouterMessage[], opts: { model?: string; jsonMode?: boolean } = {}): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  const model = opts.model ?? process.env.OPENROUTER_DIGEST_MODEL ?? DEFAULT_MODEL;
  const body: Record<string, unknown> = { model, messages };
  if (opts.jsonMode) body.response_format = { type: 'json_object' };

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
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter returned no content');
  const fenced = content.match(/^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  return fenced ? fenced[1] : content;
}

const SECTION_DESCRIPTIONS: Record<SectionKind, string> = {
  podium: 'Top 3 songs by vote_total — winner + runners-up. Include artist, title, submitter, vote_total, and one line of editorial color per song.',
  villain: 'The lowest-scoring or most-divisive submission. One paragraph of playful roasting using the actual numbers.',
  flow: 'A 1-2 paragraph narrative arc of how the round played out — what the theme produced, surprises, the shape of voting.',
  consensus: 'Songs/artists where multiple voters agreed (high vote spread / repeat voters). Bulleted list with the agreement noted.',
  quotes: '3-6 punchy direct quotes from vote comments — voter name + quote. Pick the ones with the most personality.',
  chat: 'Highlights from the WhatsApp chat mentions tied to this round. If no chat mentions, return an empty items array with a short note.',
};

function buildSystemPrompt(): string {
  return `You are the editorial voice of "Music League Bot" — a private music-league digest writer.
Write in a sharp, dry, slightly literary tone. Be specific: use real song titles, real voter names, real numbers.
Never hedge. Never disclaim. Never apologize.

You output ONE JSON object with this exact shape:

{
  "sections": {
    "podium":    { "title": string, "items": [...], "body": string },
    "villain":   { "title": string, "body": string },
    "flow":      { "title": string, "body": string },
    "consensus": { "title": string, "items": [...] },
    "quotes":    { "title": string, "items": [{"voter": string, "quote": string}] },
    "chat":      { "title": string, "items": [...], "body": string }
  }
}

Each section's "items" shape is up to you per kind, but stay consistent within a section.`;
}

function buildUserPrompt(data: RoundData, steer?: { chips: string[]; instructions: string; kind?: SectionKind; currentContent?: unknown }): string {
  const parts: string[] = [];
  parts.push(`# Round\n${data.round.name}${data.round.description ? ` — ${data.round.description}` : ''}`);
  parts.push(`League: ${data.league.name}`);

  if (data.relContext.trim()) {
    parts.push(`\n# Relationship context (people, history, recurring jokes)\n${data.relContext.trim()}`);
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
    const activeKinds = SECTION_KINDS.filter((k) => k !== 'chat' || data.chatMentions.length > 0);
    parts.push(`\n# Write ${activeKinds.length} sections`);
    for (const k of activeKinds) {
      parts.push(`- ${k}: ${SECTION_DESCRIPTIONS[k]}`);
    }
  }

  return parts.join('\n');
}

interface DraftLLMOutput {
  sections: Record<SectionKind, unknown>;
}

export async function generateDraft(data: RoundData): Promise<DraftLLMOutput> {
  const raw = await callOpenRouter(
    [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(data) },
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
  return parsed;
}

export async function regenerateOneSection(
  data: RoundData,
  kind: SectionKind,
  currentContent: unknown,
  chips: string[],
  instructions: string,
): Promise<unknown> {
  const raw = await callOpenRouter(
    [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(data, { chips, instructions, kind, currentContent }) },
    ],
    { jsonMode: true },
  );
  const parsed = JSON.parse(raw) as { section?: unknown };
  if (parsed.section === undefined) throw new Error('LLM response missing "section"');
  return parsed.section;
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

export function writeDraft(
  db: Database.Database,
  roundId: number,
  data: RoundData,
  output: DraftLLMOutput,
  prepChecks: unknown,
): { draft: DigestDraftRow; sections: DigestSectionRow[] } {
  const draftId = `draft-${roundId}-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO digest_drafts (id, round_id, generated_at, rel_context, prep_checks, whole_regen_count)
       VALUES (?, ?, ?, ?, ?, 0)`,
    ).run(draftId, roundId, now, data.relContext, JSON.stringify(prepChecks ?? {}));

    const activeKinds = SECTION_KINDS.filter((k) => k !== 'chat' || data.chatMentions.length > 0);
    activeKinds.forEach((kind, idx) => {
      const id = `${draftId}-${kind}`;
      db.prepare(
        `INSERT INTO digest_sections (id, draft_id, kind, position, state, content_json, regen_count)
         VALUES (?, ?, ?, ?, 'default', ?, 0)`,
      ).run(id, draftId, kind, idx, JSON.stringify(output.sections[kind] ?? {}));
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
