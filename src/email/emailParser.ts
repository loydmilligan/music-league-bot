import { simpleParser } from 'mailparser';

/**
 * Pure-ish parser for Music League notification emails.
 *
 * No I/O beyond decoding the raw message it is handed. Given a raw RFC822 email
 * it returns a {@link ParsedEmail} describing the lifecycle event (if any), with
 * the round identity and timestamp the ingest layer needs.
 *
 * Grounded in real samples under docs/sample_email/. Key facts:
 *  - Subject: `{League} {Season}: {Season Name} - {EventType}` — the suffix after
 *    the last " - " is the event type. (The pre-colon text is the SEASON, not the
 *    round — the round name lives in the body.)
 *  - Body prose names the round:
 *      round_starting → "The {round} round of the {league} league is open …"
 *      new_playlist   → "The playlist for the {round} round of the {league} league …"
 *      votes_are_in   → "The votes are in for the round {round}!"
 *  - Body links are wrapped in Amazon SES click-trackers
 *    (https://….awstrack.me/L0/<url-encoded-real-url>/1/…). round_starting and
 *    votes_are_in carry app.musicleague.com/l/{leagueId}/{roundId}… whose 32-hex
 *    roundId equals rounds.ml_round_id. new_playlist carries only the Spotify
 *    playlist URL (no round id) → mapped by round name + league.
 */

export type MlEmailType = 'round_starting' | 'new_playlist' | 'votes_are_in' | 'other';

export interface ParsedEmail {
  messageId: string;
  subject: string;
  fromAddr: string;
  toAddr: string | null;
  sentAt: string; // ISO 8601 — the real event time (Date header)
  type: MlEmailType;
  mlRoundId: string | null; // exact round id (round_starting / votes_are_in)
  leagueLabel: string | null; // e.g. "Hip Jammers 3: its all hippening"
  roundName: string | null; // e.g. "Plots so thicc"
  playlistUrl: string | null; // Spotify playlist (new_playlist)
}

/** Subject suffix (after the last " - ") → lifecycle type. */
export function classifySubject(subject: string): MlEmailType {
  const suffix = subject.includes(' - ')
    ? subject.slice(subject.lastIndexOf(' - ') + 3)
    : subject;
  const s = suffix.trim().toLowerCase();
  if (s === 'round starting') return 'round_starting';
  if (s === 'new playlist') return 'new_playlist';
  if (s === 'the votes are in') return 'votes_are_in';
  return 'other';
}

/** Undo an Amazon SES click-tracking redirect; pass non-SES URLs through. */
export function unwrapSesUrl(url: string): string {
  const m = url.match(/\/L0\/(.+?)\/\d+\//);
  if (!m) return url;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return url;
  }
}

/** Strip an HTML body down to readable text (entities + apostrophes normalized). */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[‘’]/g, "'") // curly single quotes → '
    .replace(/[“”]/g, '"') // curly double quotes → "
    .replace(/\s+/g, ' ')
    .trim();
}

/** All http(s) URLs in a blob, each SES-unwrapped. */
function unwrappedUrls(...blobs: (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const blob of blobs) {
    if (!blob) continue;
    for (const raw of blob.match(/https?:\/\/[^\s"'<>)]+/g) ?? []) {
      out.push(unwrapSesUrl(raw));
    }
  }
  return out;
}

/** Extract round name + league label from body prose, keyed by event type. */
function extractRoundAndLeague(
  text: string,
  type: MlEmailType,
): { roundName: string | null; leagueLabel: string | null } {
  let m: RegExpMatchArray | null;
  switch (type) {
    case 'new_playlist':
      // "The playlist for the {round} round of the {league} league …"
      m = text.match(/playlist for the\s+(.+?)\s+round of the\s+(.+?)\s+league/i);
      return m ? { roundName: m[1].trim(), leagueLabel: m[2].trim() } : { roundName: null, leagueLabel: null };
    case 'round_starting':
      // "The {round} round of the {league} league is open …"
      m = text.match(/\bThe\s+(.+?)\s+round of the\s+(.+?)\s+league/i);
      return m ? { roundName: m[1].trim(), leagueLabel: m[2].trim() } : { roundName: null, leagueLabel: null };
    case 'votes_are_in':
      // "The votes are in for the round {round}!" — note the votes body ALSO
      // contains "…round of the…league", so we must not fall through to that.
      m = text.match(/votes are in for the round\s+(.+?)\s*[!.]/i);
      if (m) return { roundName: m[1].trim(), leagueLabel: null };
      m = text.match(/voted in the\s+(.+?)\s+round of the\s+(.+?)\s+league/i);
      return m ? { roundName: m[1].trim(), leagueLabel: m[2].trim() } : { roundName: null, leagueLabel: null };
    default:
      return { roundName: null, leagueLabel: null };
  }
}

export async function parseEmail(raw: string | Buffer): Promise<ParsedEmail> {
  const mail = await simpleParser(raw);

  const subject = mail.subject ?? '';
  const type = classifySubject(subject);
  const fromAddr = mail.from?.value?.[0]?.address ?? '';
  const toField = Array.isArray(mail.to) ? mail.to[0] : mail.to;
  const toAddr = toField?.value?.[0]?.address ?? null;
  const sentAt = (mail.date ?? new Date(0)).toISOString();
  const messageId = (mail.messageId ?? '').replace(/^<|>$/g, '');

  const text = mail.text ?? '';
  const html = typeof mail.html === 'string' ? mail.html : '';
  const urls = unwrappedUrls(text, html);

  // Exact round id from an app.musicleague.com/l/{league}/{round} link.
  let mlRoundId: string | null = null;
  for (const u of urls) {
    const m = u.match(/app\.musicleague\.com\/l\/[a-f0-9]{32}\/([a-f0-9]{32})/i);
    if (m) {
      mlRoundId = m[1];
      break;
    }
  }

  // Spotify playlist URL (new_playlist).
  let playlistUrl: string | null = null;
  for (const u of urls) {
    const m = u.match(/https?:\/\/open\.spotify\.com\/playlist\/[A-Za-z0-9]+/i);
    if (m) {
      playlistUrl = m[0];
      break;
    }
  }

  // Prose lives in the HTML part for these emails (text/plain is near-empty), so
  // search both.
  const prose = `${text}\n${htmlToText(html)}`;
  const { roundName, leagueLabel } = extractRoundAndLeague(prose, type);

  return {
    messageId,
    subject,
    fromAddr,
    toAddr,
    sentAt,
    type,
    mlRoundId,
    leagueLabel,
    roundName,
    playlistUrl,
  };
}
