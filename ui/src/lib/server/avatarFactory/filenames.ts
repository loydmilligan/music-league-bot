import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveUnderRoot } from './paths.js';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LETTER = /^[A-Z]$/;

export function assertSlug(value: string, label = 'slug'): string {
	if (!SLUG.test(value)) throw new Error(`invalid ${label}`);
	return value;
}

export function slugify(name: string): string {
	const s = name
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^\w\s-]/g, '')
		.trim()
		.replace(/[\s_]+/g, '-');
	if (!SLUG.test(s)) throw new Error(`cannot slugify ${name}`);
	return s;
}

export function stampFromDate(at: Date): string {
	const y = at.getFullYear();
	const m = String(at.getMonth() + 1).padStart(2, '0');
	const d = String(at.getDate()).padStart(2, '0');
	const hh = String(at.getHours()).padStart(2, '0');
	const mm = String(at.getMinutes()).padStart(2, '0');
	const ss = String(at.getSeconds()).padStart(2, '0');
	return `${y}${m}${d}-${hh}${mm}${ss}`;
}

/** `<league>/<theme>/<member>/<YYYYMMDD-HHMMSS>-<letter>.png` */
export function versionedRelPath(
	league: string,
	theme: string,
	member: string,
	letter: string,
	at: Date,
): string {
	assertSlug(league, 'league');
	assertSlug(theme, 'theme');
	assertSlug(member, 'member');
	if (!LETTER.test(letter)) throw new Error('invalid letter');
	return `${league}/${theme}/${member}/${stampFromDate(at)}-${letter}.png`;
}

export function refuseOverwrite(absPath: string): void {
	if (existsSync(absPath)) throw new Error('refusing overwrite');
}

export function allocateVersionedPath(
	imagesRoot: string,
	league: string,
	theme: string,
	member: string,
	letter: string,
	at: Date = new Date(),
): { rel: string; abs: string } {
	let t = at;
	for (let i = 0; i < 120; i++) {
		const rel = versionedRelPath(league, theme, member, letter, t);
		const abs = resolveUnderRoot(imagesRoot, rel);
		if (!existsSync(abs)) {
			mkdirSync(dirname(abs), { recursive: true });
			return { rel, abs };
		}
		t = new Date(t.getTime() + 1000);
	}
	throw new Error('could not allocate unique filename');
}

const NAME_TOKEN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXT_TOKEN = /^[a-z0-9]+$/;

/** `<league>/<theme>/<member>/<YYYYMMDD-HHMMSS>-<name>.<ext>` e.g. group sheet.jpg */
export function versionedNamedRelPath(
	league: string,
	theme: string,
	member: string,
	name: string,
	ext: string,
	at: Date,
): string {
	assertSlug(league, 'league');
	assertSlug(theme, 'theme');
	assertSlug(member, 'member');
	if (!NAME_TOKEN.test(name)) throw new Error('invalid name');
	if (!EXT_TOKEN.test(ext)) throw new Error('invalid ext');
	return `${league}/${theme}/${member}/${stampFromDate(at)}-${name}.${ext}`;
}

export function allocateVersionedNamedPath(
	imagesRoot: string,
	league: string,
	theme: string,
	member: string,
	name: string,
	ext: string,
	at: Date = new Date(),
): { rel: string; abs: string } {
	let t = at;
	for (let i = 0; i < 120; i++) {
		const rel = versionedNamedRelPath(league, theme, member, name, ext, t);
		const abs = resolveUnderRoot(imagesRoot, rel);
		if (!existsSync(abs)) {
			mkdirSync(dirname(abs), { recursive: true });
			return { rel, abs };
		}
		t = new Date(t.getTime() + 1000);
	}
	throw new Error('could not allocate unique filename');
}

export function joinImages(imagesRoot: string, rel: string): string {
	return resolveUnderRoot(imagesRoot, rel);
}

export function ensureParent(abs: string): void {
	mkdirSync(dirname(abs), { recursive: true });
}