import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { allocateVersionedPath, assertSlug } from './filenames.js';
import { factoryRoot, isImageName, resolveUnderRoot, sourcesRoot } from './paths.js';
import {
	BOARZ_HEIGHTS,
	BOARZ_LEAGUE_SLUG,
	DEFAULT_MEMBER_NOTES,
	heightFor,
} from './notes.js';
import { extractFencedPrompt, parseAttachInspiration } from './prompts.js';
import {
	ensureLeague,
	imagesRoot,
	loadState,
	newId,
	photosRoot,
	saveState,
	type FactoryState,
	type MemberRecord,
} from './store.js';
import { readRoster } from './roster.js';

const PLAYERS_SUB = 'boarz-players';

function importKey(abs: string): string {
	const st = statSync(abs);
	return `${abs}:${st.size}:${st.mtimeMs}`;
}

function copyOnly(src: string, dest: string): void {
	if (existsSync(dest)) throw new Error('refusing overwrite');
	mkdirSync(dirname(dest), { recursive: true });
	copyFileSync(src, dest);
}

function titleCaseTheme(slug: string): string {
	return slug
		.split('-')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

function labelForImportedAvatar(filename: string): { letter: string; label: string; themeSlug: string } {
	const base = filename.toLowerCase();
	if (base === 'south-park-v1.png') return { letter: 'D', label: 'South Park v1', themeSlug: 'south-park' };
	if (base === 'south-park.png') return { letter: 'E', label: 'South Park v2 canonical', themeSlug: 'south-park' };
	if (base === 'south-park-grok-imagine-unapproved.png') {
		return { letter: 'U', label: 'unapproved (Grok Imagine, archived)', themeSlug: 'south-park' };
	}
	if (base === 'simpsons.png') return { letter: 'S', label: 'Simpsons', themeSlug: 'simpsons' };
	return { letter: 'X', label: filename, themeSlug: 'south-park' };
}

/** `<slug>-<letter><n>.png` — e.g. matt-mariani-A.png, conor-johnston-C2.png */
export function parseAbcFilename(filename: string): { slug: string; letter: string; tag: string } | null {
	const m = filename.match(/^([a-z0-9]+(?:-[a-z0-9]+)*)-([A-Za-z])(\d*)\.png$/i);
	if (!m) return null;
	const letter = m[2].toUpperCase();
	const tag = m[3] ? `${letter}${m[3]}` : letter;
	return { slug: m[1].toLowerCase(), letter, tag };
}

function simpsonsPlateLabel(filename: string): string {
	if (filename === 'boarz-simpsons-plate-1615.png') return 'Simpsons group plate (p1C 1615)';
	if (filename === 'boarz-simpsons-plate-1615-v2.png') return 'Simpsons group plate v2 (p1C 1615)';
	return `Simpsons group plate (${filename})`;
}

function contactSheetLabel(filename: string): string {
	if (/-v2\.png$/i.test(filename)) return 'South Park ABC contact sheet v2 (p1C 1615)';
	return 'South Park ABC contact sheet (p1C 1615)';
}

function ensureMember(league: ReturnType<typeof ensureLeague>, slug: string, name: string, playerId: number | null): MemberRecord {
	let m = league.members.find((x) => x.slug === slug);
	if (!m) {
		m = {
			slug,
			name,
			playerId,
			height: heightFor(slug),
			notes: DEFAULT_MEMBER_NOTES[slug] ?? '',
			photoRel: null,
			candidates: [],
		};
		league.members.push(m);
	} else {
		if (name) m.name = name;
		if (playerId != null) m.playerId = playerId;
		if (!m.notes && DEFAULT_MEMBER_NOTES[slug]) m.notes = DEFAULT_MEMBER_NOTES[slug];
		if (!m.height) m.height = heightFor(slug);
	}
	return m;
}

export interface RescanResult {
	copied: number;
	skipped: number;
	themes: number;
	members: number;
	candidates: number;
	groupShots: number;
}

export function rescanSources(opts?: { factoryDir?: string; sourcesDir?: string }): RescanResult {
	const factoryDir = opts?.factoryDir ?? factoryRoot();
	const srcRoot = opts?.sourcesDir ?? sourcesRoot();
	const playersDir = join(srcRoot, PLAYERS_SUB);
	const state = loadState(factoryDir);
	const result: RescanResult = { copied: 0, skipped: 0, themes: 0, members: 0, candidates: 0, groupShots: 0 };

	importThemes(state, playersDir, result);
	importRosterAndHeadshots(state, playersDir, factoryDir, result);
	importExistingAvatars(state, playersDir, factoryDir, result);
	importAbcAndPlates(state, playersDir, factoryDir, result);

	saveState(state, factoryDir);
	result.themes = state.themes.length;
	const league = state.leagues[BOARZ_LEAGUE_SLUG];
	result.members = league?.members.length ?? 0;
	result.candidates = league?.members.reduce((n, m) => n + m.candidates.length, 0) ?? 0;
	result.groupShots = league?.groupShots.length ?? 0;
	return result;
}

function importThemes(state: FactoryState, playersDir: string, result: RescanResult): void {
	const stylesDir = join(playersDir, '_styles');
	if (!existsSync(stylesDir)) return;
	for (const name of readdirSync(stylesDir)) {
		const dir = join(stylesDir, name);
		if (!statSync(dir).isDirectory()) continue;
		if (name.startsWith('.')) continue;
		assertSlug(name, 'theme');
		const styleMdPath = join(dir, 'style.md');
		const styleMd = existsSync(styleMdPath) ? readFileSync(styleMdPath, 'utf8') : '';
		const prompt = styleMd ? extractFencedPrompt(styleMd) : '';
		const attachInspiration = styleMd ? parseAttachInspiration(styleMd) : true;
		const inspDir = join(dir, 'inspiration');
		const inspirationRels: string[] = [];
		if (existsSync(inspDir)) {
			for (const f of readdirSync(inspDir).sort()) {
				if (isImageName(f)) inspirationRels.push(`${PLAYERS_SUB}/_styles/${name}/inspiration/${f}`);
			}
		}
		const existing = state.themes.find((t) => t.slug === name);
		if (existing) {
			existing.prompt = prompt || existing.prompt;
			existing.attachInspiration = attachInspiration;
			existing.inspirationRels = inspirationRels.length ? inspirationRels : existing.inspirationRels;
			existing.name = existing.name || titleCaseTheme(name);
		} else {
			state.themes.push({
				slug: name,
				name: titleCaseTheme(name),
				prompt,
				attachInspiration,
				inspirationRels,
				source: 'imported',
			});
		}
		result.themes += 1;
	}
}

function loadManifestPlayers(playersDir: string): { slug: string; name: string; player_id: number }[] {
	const p = join(playersDir, 'manifest.json');
	if (!existsSync(p)) return [];
	const raw = JSON.parse(readFileSync(p, 'utf8')) as { players?: { slug: string; name: string; player_id: number }[] };
	return raw.players ?? [];
}

function importRosterAndHeadshots(
	state: FactoryState,
	playersDir: string,
	factoryDir: string,
	result: RescanResult,
): void {
	const league = ensureLeague(state, BOARZ_LEAGUE_SLUG, 'Boarz II Men');
	const roster = readRoster(BOARZ_LEAGUE_SLUG);
	const manifest = loadManifestPlayers(playersDir);
	const seen = new Set<string>();

	const rows: { slug: string; name: string; playerId: number | null }[] = [];
	if (roster && roster.members.length) {
		for (const m of roster.members) rows.push({ slug: m.slug, name: m.name, playerId: m.playerId });
	} else {
		for (const p of manifest) rows.push({ slug: p.slug, name: p.name, playerId: p.player_id });
	}

	for (const row of rows) {
		if (!BOARZ_HEIGHTS[row.slug] && !manifest.some((p) => p.slug === row.slug)) {
			// still include DB-only members
		}
		const member = ensureMember(league, row.slug, row.name, row.playerId);
		seen.add(row.slug);
		const head = join(playersDir, row.slug, 'headshot.png');
		if (existsSync(head) && !member.photoRel) {
			const destRel = `${BOARZ_LEAGUE_SLUG}/${row.slug}/headshot.png`;
			const destAbs = join(photosRoot(factoryDir), destRel);
			if (!existsSync(destAbs)) {
				copyOnly(head, destAbs);
				result.copied += 1;
			} else {
				result.skipped += 1;
			}
			member.photoRel = destRel;
		}
	}

	for (const p of manifest) {
		if (seen.has(p.slug)) continue;
		ensureMember(league, p.slug, p.name, p.player_id);
	}
}

function refreshImportedLabel(state: FactoryState, id: string, label: string): void {
	for (const league of Object.values(state.leagues)) {
		const g = league.groupShots.find((x) => x.id === id);
		if (g) {
			g.label = label;
			return;
		}
		for (const m of league.members) {
			const c = m.candidates.find((x) => x.id === id);
			if (c) {
				c.label = label;
				return;
			}
		}
	}
}

function importOneImage(
	state: FactoryState,
	factoryDir: string,
	srcAbs: string,
	leagueSlug: string,
	themeSlug: string,
	memberSlug: string,
	letter: string,
	label: string,
	kind: 'candidate' | 'group',
	result: RescanResult,
): void {
	if (!existsSync(srcAbs)) return;
	const key = importKey(srcAbs);
	if (state.importIndex[key]) {
		refreshImportedLabel(state, state.importIndex[key], label);
		result.skipped += 1;
		return;
	}
	const allocated = allocateVersionedPath(imagesRoot(factoryDir), leagueSlug, themeSlug, memberSlug, letter);
	copyOnly(srcAbs, allocated.abs);
	result.copied += 1;
	const id = newId();
	state.importIndex[key] = id;
	const league = ensureLeague(state, leagueSlug, 'Boarz II Men');
	const now = new Date().toISOString();
	if (kind === 'group') {
		league.groupShots.push({
			id,
			themeSlug,
			relPath: allocated.rel,
			label,
			status: 'candidate',
			source: 'imported',
			importKey: key,
			createdAt: now,
		});
	} else {
		const member = ensureMember(league, memberSlug, memberSlug, null);
		member.candidates.push({
			id,
			themeSlug,
			letter,
			relPath: allocated.rel,
			label,
			rating: null,
			status: 'candidate',
			source: 'imported',
			importKey: key,
			createdAt: now,
		});
	}
}

function importExistingAvatars(
	state: FactoryState,
	playersDir: string,
	factoryDir: string,
	result: RescanResult,
): void {
	const league = ensureLeague(state, BOARZ_LEAGUE_SLUG, 'Boarz II Men');
	for (const member of league.members) {
		const avDir = join(playersDir, member.slug, 'avatars');
		if (!existsSync(avDir)) continue;
		for (const f of readdirSync(avDir)) {
			if (!isImageName(f)) continue;
			const meta = labelForImportedAvatar(f);
			importOneImage(
				state,
				factoryDir,
				join(avDir, f),
				BOARZ_LEAGUE_SLUG,
				meta.themeSlug,
				member.slug,
				meta.letter,
				meta.label,
				'candidate',
				result,
			);
		}
	}
}

function importAbcAndPlates(
	state: FactoryState,
	playersDir: string,
	factoryDir: string,
	result: RescanResult,
): void {
	const abcDir = join(playersDir, '_styles', 'south-park', 'sp-v2-abc-1615');
	if (existsSync(abcDir)) {
		for (const f of readdirSync(abcDir)) {
			const parsed = parseAbcFilename(f);
			if (!parsed) continue;
			importOneImage(
				state,
				factoryDir,
				join(abcDir, f),
				BOARZ_LEAGUE_SLUG,
				'south-park',
				parsed.slug,
				parsed.letter,
				`South Park ${parsed.tag} (p1C 1615)`,
				'candidate',
				result,
			);
		}
	}

	const spDir = join(playersDir, '_styles', 'south-park');
	if (existsSync(spDir)) {
		for (const f of readdirSync(spDir)) {
			if (!/^sp-v2-abc-contact/i.test(f) || !isImageName(f)) continue;
			importOneImage(
				state,
				factoryDir,
				join(spDir, f),
				BOARZ_LEAGUE_SLUG,
				'south-park',
				'group',
				'T',
				contactSheetLabel(f),
				'group',
				result,
			);
		}
	}

	const simDir = join(playersDir, '_styles', 'simpsons');
	if (existsSync(simDir)) {
		for (const f of readdirSync(simDir)) {
			if (!/^boarz-simpsons-plate/i.test(f) || !isImageName(f)) continue;
			importOneImage(
				state,
				factoryDir,
				join(simDir, f),
				BOARZ_LEAGUE_SLUG,
				'simpsons',
				'group',
				'G',
				simpsonsPlateLabel(f),
				'group',
				result,
			);
		}
	}
}

export function readNotesMd(sourcesDir: string, memberSlug: string): string {
	const p = join(sourcesDir, PLAYERS_SUB, memberSlug, 'NOTES.md');
	if (!existsSync(p)) return '';
	return readFileSync(p, 'utf8').trim();
}

export function resolveSourceFile(sourcesDir: string, rel: string): string {
	return resolveUnderRoot(sourcesDir, rel);
}

export function readInspirationAbs(sourcesDir: string, rels: string[]): string[] {
	const out: string[] = [];
	for (const rel of rels) {
		const abs = resolveUnderRoot(sourcesDir, rel);
		if (existsSync(abs)) out.push(abs);
	}
	return out;
}

export { PLAYERS_SUB, basename };
