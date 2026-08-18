/**
 * Measures what "inline" answering would actually cost.
 *
 * Not a pass/fail unit test so much as a guard on a product decision: inline
 * mode lets ANY group message count as an answer, so the false-positive rate on
 * real conversation decides whether it is usable at all. Reads the real Boarz
 * chat export when present and asserts the rate stays under the threshold the
 * decision was made on.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resolveAnswer } from '../src/chat/prompts/resolve.js';
import type { PromptOption } from '../src/chat/prompts/types.js';

const ROSTER: PromptOption[] = [
  { id: 'p1', label: 'Clements Johnson', aliases: ['clem', 'clemmy'] },
  { id: 'p2', label: 'Conor Johnston', aliases: ['connor'] },
  { id: 'p3', label: 'Darren Paletz', aliases: ['palletz', 'pallets'] },
  { id: 'p4', label: 'Dave Jensen' },
  { id: 'p5', label: 'Dave Steingart', aliases: ['steiny'] },
  { id: 'p6', label: 'Grant Koziol' },
  { id: 'p7', label: 'Jimmy' },
  { id: 'p8', label: 'Jon Black', aliases: ['jorbo', 'jb'] },
  { id: 'p9', label: 'Matt Mariani', aliases: ['mashew'] },
  { id: 'p10', label: 'Shane Farkas' },
];

const CORPUS = path.join(process.cwd(), 'data', '_boarzchat.json');

describe('inline answering — false-positive rate on real chat', () => {
  it('matches a name in only a small fraction of ordinary conversation', () => {
    if (!fs.existsSync(CORPUS)) {
      console.warn(`[skip] ${CORPUS} absent — regenerate from chat_messages to re-measure`);
      return;
    }
    const msgs = (JSON.parse(fs.readFileSync(CORPUS, 'utf8')) as Array<{ text: string }>)
      .map((m) => m.text)
      .filter(Boolean);

    let matched = 0;
    const samples: string[] = [];
    for (const text of msgs) {
      const r = resolveAnswer(text, ROSTER);
      if (r.kind === 'matched') {
        matched++;
        if (samples.length < 12) samples.push(`${r.option.label} ← ${text.replace(/\s+/g, ' ').slice(0, 62)}`);
      }
    }
    const rate = (matched / msgs.length) * 100;
    console.log(`NAIVE inline would fire on ${matched}/${msgs.length} messages (${rate.toFixed(1)}%)`);
    for (const s of samples) console.log('   ', s);

    // The hits above are real name MENTIONS in conversation, not typos, so no
    // blocklist can remove them. What separates an answer from a mention is
    // that an answer is JUST a name — measure that rule instead.
    let strict = 0;
    const strictSamples: string[] = [];
    for (const text of msgs) {
      if (!isBareAnswer(text)) continue;
      const r = resolveAnswer(text, ROSTER);
      if (r.kind === 'matched') {
        strict++;
        if (strictSamples.length < 10) strictSamples.push(`${r.option.label} ← "${text.trim().slice(0, 50)}"`);
      }
    }
    const strictRate = (strict / msgs.length) * 100;
    console.log(`BARE-NAME inline would fire on ${strict}/${msgs.length} (${strictRate.toFixed(2)}%)`);
    for (const s of strictSamples) console.log('   ', s);

    expect(strictRate).toBeLessThan(1);
  });
});

/** An answer is a name and nothing else: very few words, no sentence punctuation. */
function isBareAnswer(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t || t.length > 30) return false;
  if (/[.!?,;:]|https?:\/\//.test(t)) return false;
  return t.split(/\s+/).length <= 2;
}
