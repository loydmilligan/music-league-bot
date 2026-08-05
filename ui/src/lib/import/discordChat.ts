export interface DiscordMessage { sender: string; text: string; tsMs: number }

const LINE_RE = /^\[(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}) (AM|PM) UTC\]\s+(.+?):\s([\s\S]*)$/;

/** Strip Discord's edit trailer: optional "Spoiler" then "(edited)<weekday date…>". */
function stripTrailer(text: string): string {
  return text.replace(/\s*(?:Spoiler\s*)?\(edited\).*$/s, '').trimEnd();
}

function toMs(mm: string, dd: string, yyyy: string, hh12: string, min: string, ap: string): number {
  let h = parseInt(hh12, 10) % 12;
  if (ap === 'PM') h += 12;
  const iso = `${yyyy}-${mm}-${dd}T${String(h).padStart(2, '0')}:${min}:00Z`;
  return Date.parse(iso);
}

export function parseDiscordLog(raw: string): DiscordMessage[] {
  const out: DiscordMessage[] = [];
  for (const line of raw.split('\n')) {
    const m = LINE_RE.exec(line);
    if (!m) {
      // Continuation of the previous message (multi-line body). Ignore stray
      // lines before the first message (header).
      if (out.length && line.trim()) out[out.length - 1].text += '\n' + line;
      continue;
    }
    const [, mm, dd, yyyy, hh, min, ap, sender, body] = m;
    const tsMs = toMs(mm, dd, yyyy, hh, min, ap);
    if (Number.isNaN(tsMs)) continue;
    out.push({ sender: sender.trim(), text: stripTrailer(body), tsMs });
  }
  // Strip trailers again after continuations were appended, then collapse
  // consecutive duplicate (sender,text) pairs — an export artifact.
  const cleaned: DiscordMessage[] = [];
  for (const msg of out) {
    msg.text = stripTrailer(msg.text).trim();
    if (!msg.text) continue;
    const prev = cleaned[cleaned.length - 1];
    if (prev && prev.sender === msg.sender && prev.text === msg.text) continue;
    cleaned.push(msg);
  }
  return cleaned;
}
