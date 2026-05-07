import type { ParsedSubmission } from './types.js';

const COMMAND_RE = /^!(\w+)\s+([\s\S]+)$/;
const URL_RE = /^(https?:\/\/\S+)/;

export function parseMessage(text: string): ParsedSubmission | null {
  const trimmed = text.trim();
  const commandMatch = trimmed.match(COMMAND_RE);
  if (!commandMatch) return null;

  const command = commandMatch[1].toLowerCase();
  if (command !== 'song') return null;

  const body = commandMatch[2].trim();
  const tags = Array.from(body.matchAll(/#(\w+)/g)).map((m) => m[1]);

  const urlMatch = body.match(URL_RE);
  if (urlMatch) {
    return { command, rawText: trimmed, sourceUrl: urlMatch[1], artistHint: null, titleHint: null, tags };
  }

  const bodyWithoutTags = body.replace(/#\w+/g, '').trim();
  const artistTitleMatch = bodyWithoutTags.match(/^(.+?)\s+-\s+(.+)$/);
  if (artistTitleMatch) {
    return {
      command,
      rawText: trimmed,
      sourceUrl: null,
      artistHint: artistTitleMatch[1].trim(),
      titleHint: artistTitleMatch[2].trim(),
      tags,
    };
  }

  return { command, rawText: trimmed, sourceUrl: null, artistHint: null, titleHint: null, tags };
}
