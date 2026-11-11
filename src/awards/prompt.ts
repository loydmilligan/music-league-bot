import type { AwardDef, Candidate } from './types.js';

export class PromptFieldMissing extends Error {
  constructor(public field: string) {
    super(`poster prompt field missing: ${field}`);
    this.name = 'PromptFieldMissing';
  }
}

const timeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', hour12: true,
});

/** h:mm AM/PM in LA time. */
function laTime(ts: string): string {
  return timeFmt.format(new Date(ts)).replace(/ /g, ' ');
}

/**
 * Fills `{{FIELD}}` placeholders. Fields: AWARD_NAME, and for place k in 1..3
 * Pk_NAME, Pk_TEXT, Pk_TIME, Pk_AVATAR. Any placeholder with no value throws.
 */
export function fillPrompt(
  template: string,
  def: AwardDef,
  picks: Candidate[],
  avatarFor: (who: string) => string,
): { prompt: string; avatars: string[] } {
  const values: Record<string, string> = { AWARD_NAME: def.name };
  const avatars: string[] = [];
  picks.slice(0, 3).forEach((c, i) => {
    const k = i + 1;
    const avatar = avatarFor(c.who);
    avatars.push(avatar);
    values[`P${k}_NAME`] = c.who;
    values[`P${k}_TEXT`] = c.text;
    values[`P${k}_TIME`] = laTime(c.ts);
    values[`P${k}_AVATAR`] = avatar;
  });
  const prompt = template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) throw new PromptFieldMissing(name);
    return values[name];
  });
  return { prompt, avatars };
}
