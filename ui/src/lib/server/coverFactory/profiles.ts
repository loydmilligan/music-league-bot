import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { slugify } from '../avatarFactory/filenames.js';

const MAX_CHARS = 6000;
/** Priority order: if the cap bites, Topics is cut first. */
const SECTIONS: { key: string; re: RegExp }[] = [
	{ key: 'humor', re: /^humor style$/i },
	{ key: 'seen', re: /^how the others see (him|her|them)$/i },
	{ key: 'topics', re: /^topics$/i },
];

export function profilesRoot(): string {
	return process.env.COVER_PROFILES_DIR ?? join(process.cwd(), '..', '.planning/spikes/digest-comedy-media/personify/profiles');
}

export interface ProfileExcerpt {
	slug: string;
	name: string;
	text: string;
	source: 'file' | 'db' | 'both' | 'none';
}

function safeSlug(s: string): string | null {
	try {
		return slugify(s);
	} catch {
		return null;
	}
}

function findFile(p: { slug: string; name: string }): string | null {
	const want = p.name.trim().replace(/\s+/g, '_').toLowerCase() + '.md';
	const root = profilesRoot();
	for (const dir of [root, join(root, 'second_best')]) {
		if (!existsSync(dir)) continue;
		const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md'));
		const hit =
			files.find((f) => f.toLowerCase() === want) ??
			files.find((f) => safeSlug(f.slice(0, -3)) === p.slug);
		if (hit) return join(dir, hit);
	}
	return null;
}

/** Pull `## N. <title>` sections (with their ### subsections) whose title matches. */
function extractSections(md: string): string {
	const lines = md.split('\n');
	const found = new Map<string, string[]>();
	let cur: string | null = null;
	let fence = false;
	for (const line of lines) {
		if (/^\s*(```|~~~)/.test(line)) fence = !fence;
		const h = !fence ? /^##\s+(?:\d+\.\s*)?(.+?)\s*$/.exec(line) : null;
		if (h && !line.startsWith('###')) {
			const title = h[1].replace(/[*_`]/g, '').trim();
			const s = SECTIONS.find((x) => x.re.test(title));
			cur = s && !found.has(s.key) ? s.key : null;
			if (cur) found.set(cur, [`## ${title}`]);
			continue;
		}
		if (cur) found.get(cur)!.push(line);
	}
	return SECTIONS.filter((s) => found.has(s.key))
		.map((s) => found.get(s.key)!.join('\n').trim())
		.join('\n\n');
}

function capAtParagraph(text: string, max: number): string {
	if (text.length <= max) return text;
	const cut = text.slice(0, max);
	const i = cut.lastIndexOf('\n\n');
	return (i > 0 ? cut.slice(0, i) : cut).trimEnd();
}

function dbNotes(db: Database.Database, name: string): string {
	let row: { notes: string | null; tags: string | null } | undefined;
	try {
		row = db
			.prepare(
				`SELECT pp.notes AS notes, pp.tags AS tags FROM player_profiles pp
				 JOIN players pl ON pl.id = pp.player_id WHERE pl.name = ? COLLATE NOCASE LIMIT 1`,
			)
			.get(name) as typeof row;
	} catch {
		return '';
	}
	if (!row) return '';
	const parts: string[] = [];
	if (row.notes?.trim()) parts.push(`Notes: ${row.notes.trim()}`);
	let tags: unknown = [];
	try {
		tags = JSON.parse(row.tags || '[]');
	} catch {
		/* ignore malformed tags */
	}
	if (Array.isArray(tags) && tags.length) parts.push(`Tags: ${tags.map(String).join(', ')}`);
	return parts.join('\n');
}

export function loadProfileExcerpt(db: Database.Database, p: { slug: string; name: string }): ProfileExcerpt {
	const path = findFile(p);
	const fileText = path ? extractSections(readFileSync(path, 'utf8')) : '';
	const dbText = dbNotes(db, p.name);
	const source = fileText && dbText ? 'both' : fileText ? 'file' : dbText ? 'db' : 'none';
	// Reserve room for db notes so the file excerpt can't push them past the cap.
	const room = MAX_CHARS - (dbText ? dbText.length + 2 : 0);
	const text = [capAtParagraph(fileText, Math.max(0, room)), dbText].filter(Boolean).join('\n\n');
	return { slug: p.slug, name: p.name, text: text.slice(0, MAX_CHARS), source };
}
