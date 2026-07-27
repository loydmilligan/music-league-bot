/**
 * chatExport — parse a WhatsApp "Export chat" .txt into structured messages.
 *
 * Deliberately separate from scripts/import_whatsapp_chat.py: that importer
 * targets chat_messages and throws away the edit marker. This one keeps it,
 * because "The Perfectionist" award is built on it.
 */

export interface Message {
	sender: string;
	/** ms since epoch, interpreted in the export's local wall-clock time. */
	ts: number;
	text: string;
	edited: boolean;
	/** Media messages carry a filename and contribute no words. */
	media: string | null;
	/** @Names extracted from the mention markers, in order of appearance. */
	mentions: string[];
}

// WhatsApp writes a narrow no-break space (U+202F) before AM/PM in recent
// exports, and a regular space in older ones. Accept either, or none.
const AMPM_SPACE = '[\\s\\u202f\\u00a0]?';

const LINE_RE = new RegExp(
	'^(\\d{1,2})/(\\d{1,2})/(\\d{2,4}), ' +
		'(\\d{1,2}):(\\d{2})' +
		AMPM_SPACE +
		'([AP]M) - ' +
		'(.*)$',
);

const EDIT_SUFFIX = '<This message was edited>';
const MEDIA_RE = /^(\S+\.\w{2,4}) \(file attached\)$/;

// U+2068 FIRST STRONG ISOLATE / U+2069 POP DIRECTIONAL ISOLATE wrap @mentions.
// WhatsApp writes the "@" *outside* the isolates: `@⁨Darren Pallets⁩`. Consume it
// either way so the rewrite doesn't emit "@@Name".
const MENTION_RE = /@?⁨@?([^⁨⁩]+)⁩/g;

/** Split "Sender: text" — but only on the first colon, and only if it looks
 *  like a sender rather than a system line ("You created this group"). */
function splitSender(body: string): { sender: string; text: string } | null {
	const idx = body.indexOf(': ');
	if (idx <= 0) return null;
	const sender = body.slice(0, idx);
	// A sender name never contains a newline, and in practice never runs long.
	if (sender.length > 60) return null;
	return { sender: sender.trim(), text: body.slice(idx + 2) };
}

function extractMentions(text: string): { text: string; mentions: string[] } {
	const mentions: string[] = [];
	const cleaned = text.replace(MENTION_RE, (_m, name: string) => {
		const trimmed = name.trim();
		if (trimmed) mentions.push(trimmed);
		return `@${trimmed}`;
	});
	return { text: cleaned, mentions };
}

function finalize(raw: { sender: string; ts: number; lines: string[] }): Message {
	let text = raw.lines.join('\n');
	let edited = false;

	if (text.endsWith(EDIT_SUFFIX)) {
		edited = true;
		text = text.slice(0, -EDIT_SUFFIX.length).trimEnd();
	}

	const mediaMatch = text.match(MEDIA_RE);
	const media = mediaMatch ? mediaMatch[1] : null;

	const { text: cleaned, mentions } = extractMentions(text);

	return { sender: raw.sender, ts: raw.ts, text: cleaned, edited, media, mentions };
}

export function parseExport(content: string): Message[] {
	const out: Message[] = [];
	let current: { sender: string; ts: number; lines: string[] } | null = null;

	for (const raw of content.split('\n')) {
		const line = raw.replace(/\r$/, '');
		const m = LINE_RE.exec(line);

		if (!m) {
			// Continuation of the previous message (or preamble noise before the
			// first timestamped line, which we drop).
			if (current) current.lines.push(line);
			continue;
		}

		const [, mo, day, yr, hr12, min, ampm, body] = m;
		const split = splitSender(body);
		if (!split) {
			// System line: "You created this group", encryption notice, etc.
			if (current) {
				out.push(finalize(current));
				current = null;
			}
			continue;
		}

		if (current) out.push(finalize(current));

		const year = yr.length === 4 ? Number(yr) : 2000 + Number(yr);
		let hour = Number(hr12) % 12;
		if (ampm === 'PM') hour += 12;

		current = {
			sender: split.sender,
			// Local wall-clock: these are the timestamps group members actually saw,
			// which is what "Night Owl" and the hour heatmap need.
			ts: Date.UTC(year, Number(mo) - 1, Number(day), hour, Number(min)),
			lines: [split.text],
		};
	}

	if (current) out.push(finalize(current));
	return out;
}
