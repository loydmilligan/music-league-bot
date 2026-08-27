import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';
import { buildUserPrompt, generateDraft, type GenParams, type RoundData, type RoundBundleEntry } from './llm.js';
import { addNote } from './roundNotes.js';
import type { PromptNotes, RoundNote } from './roundNotes.js';
import { makeRoundData } from './llm.test.js';

const T0 = '2026-08-26T00:00:00Z';
const note = (body: string, target: RoundNote['target']): RoundNote =>
  ({ id: body, roundId: 149, target, body, createdAt: T0, updatedAt: T0 });

const empty: PromptNotes = { general: [], bySection: {}, ledes: [] };

describe('note injection', () => {
  it('puts a general note in the prompt', () => {
    const p = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['podium'],
      { ...empty, general: [note('the mandolin thing', 'general')] });
    expect(p).toContain('the mandolin thing');
  });

  it('wraps every note in the editorial envelope', () => {
    const p = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['podium'],
      { ...empty, general: [note('x', 'general')] });
    expect(p).toMatch(/not a quotable source/i);
    expect(p).toMatch(/do not attribute/i);
  });

  it('puts a chat-targeted note on the chat section only', () => {
    const notes: PromptNotes = { ...empty, bySection: { chat: [note('chat thing', 'chat')] } };
    const p = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['chat', 'podium'], notes);
    const chatLine = p.split('\n').find((l) => l.startsWith('- chat:'))!;
    const podiumLine = p.split('\n').find((l) => l.startsWith('- podium:'))!;
    expect(chatLine).toContain('chat thing');
    expect(podiumLine).not.toContain('chat thing');
  });

  it('never puts a ledes note in a section prompt', () => {
    const p = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['podium'],
      { ...empty, ledes: [note('lede steer', 'ledes')] });
    expect(p).not.toContain('lede steer');
  });

  it('emits no envelope and no heading when there are no notes', () => {
    const p = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['podium'], empty);
    expect(p).not.toContain('# Editor notes');
  });

  it('is unchanged when the notes argument is omitted entirely', () => {
    const withArg = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['podium'], empty);
    const without = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['podium']);
    expect(without).toBe(withArg);
  });

  it('normalizes a multi-line note body so the section list stays one line per section', () => {
    const multiLine = 'Kozh needling Jensen\nabout the mandolin thing\nagain this week';
    const p = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['podium', 'villain'],
      { ...empty, bySection: { podium: [note(multiLine, 'podium')] } });
    const lines = p.split('\n');
    const podiumLine = lines.find((l) => l.startsWith('- podium:'))!;
    const villainLine = lines.find((l) => l.startsWith('- villain:'))!;
    // The whole note (including what followed its newlines) must stay inside
    // the podium line's bracket, not leak onto its own unwrapped line.
    expect(podiumLine).toContain('Kozh needling Jensen; about the mandolin thing; again this week');
    expect(podiumLine).not.toContain('\n');
    // No stray line holding the newline tail should appear before the next section.
    const podiumIdx = lines.indexOf(podiumLine);
    const villainIdx = lines.indexOf(villainLine);
    expect(villainIdx).toBe(podiumIdx + 1);
  });

  it('keeps the existing per-section context alongside a note', () => {
    const genParams: GenParams = {
      sections: [{ id: 'podium', enabled: true, style: [], variant: 'textual', context: 'lean dry' }],
    };
    const p = buildUserPrompt(makeRoundData(), undefined, genParams, undefined, ['podium'],
      { ...empty, bySection: { podium: [note('podium thing', 'podium')] } });
    expect(p).toContain('lean dry');
    expect(p).toContain('podium thing');
  });
});

// ---------------------------------------------------------------------------
// generateDraft → db → dynamic import('./roundNotes.js') → notesForPrompt →
// prompt. Nothing else exercises this seam: if the dynamic import regressed
// (wrong path, notesForPrompt renamed, the `if (db)` guard flipped), a note
// would silently stop reaching the LLM with no test failing. Mirrors the
// stub-and-assert-on-the-captured-call pattern from earlyLedes.test.ts,
// adapted to generateDraft's dependency (module-level callOpenRouter, which
// hits global fetch — the seam pipeline-a3.test.ts already mocks).
// ---------------------------------------------------------------------------
describe('generateDraft — note-injection seam', () => {
  let db: Database.Database;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  function mkBundleEntry(round_number: number, name: string, opts: Partial<RoundBundleEntry> = {}): RoundBundleEntry {
    return { round_number, name, top3: [], bottom1: null, winner: null, isCurrent: false, isPrev: false, ...opts };
  }

  function mkData(over: Partial<RoundData> = {}): RoundData {
    return {
      round: { id: 149, name: 'Surrender Monkeys', description: null },
      league: { id: 1, name: 'Boarz' },
      roundSequence: { number: 1, total: 1 },
      priorRounds: [],
      bundle: [mkBundleEntry(1, 'Surrender Monkeys', { isCurrent: true })],
      submissions: [],
      votes: [],
      chatMentions: [],
      relContext: '',
      ...over,
    };
  }

  function fetchResponse(): Response {
    const body = JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ sections: { podium: { title: 'podium', body: '', items: [] } } }) }, finish_reason: 'stop' }],
      usage: { cost: 0.01, prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    return { ok: true, json: async () => JSON.parse(body), text: async () => body } as unknown as Response;
  }

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(SCHEMA);
    db.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('bz', 'Boarz');
    db.prepare("INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')").run();
    db.prepare(
      "INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (149, 1, 'r149', 'Surrender Monkeys', ?)",
    ).run(T0);
    process.env.OPENROUTER_API_KEY = 'test-key';
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => fetchResponse());
  });

  it('carries a general note, wrapped in its envelope, into the LLM user message', async () => {
    addNote(db, 149, 'general', 'Kozh has been needling Jensen about the mandolin', T0);

    await generateDraft(mkData(), undefined, undefined, db);

    expect(fetchSpy).toHaveBeenCalled();
    const callBody = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    const userMsg = callBody.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg?.content).toContain('Kozh has been needling Jensen about the mandolin');
    expect(userMsg?.content).toMatch(/not a quotable source/i);
  });
});
