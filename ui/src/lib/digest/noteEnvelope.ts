/**
 * The editorial envelope for editor notes in a prompt.
 *
 * This exists as its own file because it is the safety property of the notes
 * feature. A note is the editor's words going verbatim into a prompt, and a
 * model will otherwise treat them as source material — which means a note can
 * come back phrased as though it were said in the chat, and verify_facts then
 * flags it as a fabricated quote. Without this wrapper the feature
 * manufactures exactly the failure the QA gates exist to catch.
 *
 * Its wording is asserted by test. Change it deliberately, not incidentally.
 */
import type { RoundNote } from './roundNotes.js';

export function wrapNotes(notes: RoundNote[]): string {
  if (notes.length === 0) return '';
  const lines = notes.map((n) => `- ${n.body.trim()}`).join('\n');
  return [
    '',
    '# Editor notes',
    'Editorial direction from the human editor. Treat it as true, but it is',
    'NOT a quotable source: do not attribute it to anyone, and do not present it as',
    'something said in the chat or in a comment.',
    lines,
  ].join('\n');
}
