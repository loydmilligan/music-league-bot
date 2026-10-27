import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAbcFilename, rescanSources } from './seed.js';
import { loadState, saveState } from './store.js';

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
);

describe('rescan import is copy-only and idempotent', () => {
	it('imports existing avatars once, never overwrites', () => {
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-src-'));
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-dst-'));
		const player = join(sourcesDir, 'boarz-players/matt-mariani');
		mkdirSync(join(player, 'avatars'), { recursive: true });
		mkdirSync(join(sourcesDir, 'boarz-players/_styles/south-park/inspiration'), { recursive: true });
		writeFileSync(join(sourcesDir, 'boarz-players/_styles/south-park/style.md'), '# t\n\n```\nSTYLE PROMPT\n```\n');
		writeFileSync(join(player, 'headshot.png'), PNG);
		writeFileSync(join(player, 'NOTES.md'), 'glasses yes');
		writeFileSync(join(player, 'avatars/south-park.png'), PNG);
		writeFileSync(join(player, 'avatars/south-park-grok-imagine-unapproved.png'), PNG);
		writeFileSync(
			join(sourcesDir, 'boarz-players/manifest.json'),
			JSON.stringify({ players: [{ slug: 'matt-mariani', name: 'Matt Mariani', player_id: 1 }] }),
		);

		const first = rescanSources({ factoryDir, sourcesDir });
		expect(first.copied).toBeGreaterThan(0);
		const state = loadState(factoryDir);
		const matt = state.leagues['boarz-ii-men'].members.find((m) => m.slug === 'matt-mariani')!;
		expect(matt.photoRel).toBeTruthy();
		expect(matt.candidates.some((c) => c.label === 'South Park v2 canonical')).toBe(true);
		expect(matt.candidates.some((c) => c.label === 'unapproved (Grok Imagine, archived)')).toBe(true);
		expect(state.themes.some((t) => t.slug === 'south-park' && t.prompt.includes('STYLE PROMPT'))).toBe(true);

		const second = rescanSources({ factoryDir, sourcesDir });
		expect(second.copied).toBe(0);
		expect(
			loadState(factoryDir).leagues['boarz-ii-men'].members.find((m) => m.slug === 'matt-mariani')!.candidates,
		).toHaveLength(matt.candidates.length);
	});

	it('imports second-best jpg headshots into the second-best league', () => {
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-sb-src-'));
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-sb-dst-'));
		mkdirSync(join(sourcesDir, 'boarz-players'), { recursive: true });
		const jon = join(sourcesDir, 'second-best-players/jon-black');
		mkdirSync(jon, { recursive: true });
		writeFileSync(join(jon, 'headshot.jpg'), PNG);
		writeFileSync(
			join(sourcesDir, 'second-best-players/manifest.json'),
			JSON.stringify({ players: [{ slug: 'jon-black', name: 'Jon Black', player_id: 4 }] }),
		);

		const first = rescanSources({ factoryDir, sourcesDir });
		expect(first.copied).toBeGreaterThan(0);
		const state = loadState(factoryDir);
		const member = state.leagues['second-best'].members.find((m) => m.slug === 'jon-black')!;
		expect(member.photoRel).toBe('second-best/jon-black/headshot.jpg');
		expect(existsSync(join(factoryDir, 'photos', member.photoRel!))).toBe(true);

		const second = rescanSources({ factoryDir, sourcesDir });
		expect(second.copied).toBe(0);
		expect(
			loadState(factoryDir).leagues['second-best'].members.find((m) => m.slug === 'jon-black')!.photoRel,
		).toBe('second-best/jon-black/headshot.jpg');
	});

	it('imports hip-jammers jpg headshots into the hip-jammers league', () => {
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-hip-src-'));
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-hip-dst-'));
		mkdirSync(join(sourcesDir, 'boarz-players'), { recursive: true });
		const mara = join(sourcesDir, 'hip-jammers-players/mara-mariani');
		mkdirSync(mara, { recursive: true });
		writeFileSync(join(mara, 'headshot.jpg'), PNG);
		writeFileSync(
			join(sourcesDir, 'hip-jammers-players/manifest.json'),
			JSON.stringify({ players: [{ slug: 'mara-mariani', name: 'Mara Mariani', player_id: 2 }] }),
		);

		const first = rescanSources({ factoryDir, sourcesDir });
		expect(first.copied).toBeGreaterThan(0);
		const state = loadState(factoryDir);
		const member = state.leagues['hip-jammers'].members.find((m) => m.slug === 'mara-mariani')!;
		expect(member.photoRel).toBe('hip-jammers/mara-mariani/headshot.jpg');
		expect(existsSync(join(factoryDir, 'photos', member.photoRel!))).toBe(true);

		const second = rescanSources({ factoryDir, sourcesDir });
		expect(second.copied).toBe(0);
		expect(
			loadState(factoryDir).leagues['hip-jammers'].members.find((m) => m.slug === 'mara-mariani')!.photoRel,
		).toBe('hip-jammers/mara-mariani/headshot.jpg');
	});

	it('parses <slug>-<letter><n>.png variants', () => {
		expect(parseAbcFilename('matt-mariani-A.png')).toEqual({ slug: 'matt-mariani', letter: 'A', tag: 'A' });
		expect(parseAbcFilename('conor-johnston-C2.png')).toEqual({ slug: 'conor-johnston', letter: 'C', tag: 'C2' });
		expect(parseAbcFilename('south-park.png')).toBeNull();
		expect(parseAbcFilename('runs.jsonl')).toBeNull();
	});

	it('imports ADDENDUM 2 plates, contact sheet, and C2 copy-only', () => {
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-src2-'));
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-dst2-'));
		const players = join(sourcesDir, 'boarz-players');
		const abcDir = join(players, '_styles/south-park/sp-v2-abc-1615');
		const simDir = join(players, '_styles/simpsons');
		mkdirSync(abcDir, { recursive: true });
		mkdirSync(simDir, { recursive: true });
		mkdirSync(join(players, '_styles/south-park/inspiration'), { recursive: true });
		writeFileSync(join(players, '_styles/south-park/style.md'), '# t\n\n```\nSTYLE PROMPT\n```\n');
		writeFileSync(join(players, 'manifest.json'), JSON.stringify({ players: [{ slug: 'conor-johnston', name: 'Conor Johnston', player_id: 32 }] }));
		const abcA = join(abcDir, 'conor-johnston-A.png');
		const abcC = join(abcDir, 'conor-johnston-C.png');
		const abcC2 = join(abcDir, 'conor-johnston-C2.png');
		const contact = join(players, '_styles/south-park/sp-v2-abc-contact-1615.png');
		const contactV2 = join(players, '_styles/south-park/sp-v2-abc-contact-1615-v2.png');
		const plateV2 = join(simDir, 'boarz-simpsons-plate-1615-v2.png');
		for (const p of [abcA, abcC, abcC2, contact, contactV2, plateV2]) writeFileSync(p, PNG);

		const first = rescanSources({ factoryDir, sourcesDir });
		expect(first.copied).toBeGreaterThan(0);
		expect(existsSync(abcC2)).toBe(true);
		expect(existsSync(contact)).toBe(true);
		expect(existsSync(contactV2)).toBe(true);
		expect(existsSync(plateV2)).toBe(true);

		const state = loadState(factoryDir);
		const conor = state.leagues['boarz-ii-men'].members.find((m) => m.slug === 'conor-johnston')!;
		expect(conor.candidates.some((c) => c.label === 'South Park A (p1C 1615)')).toBe(true);
		expect(conor.candidates.some((c) => c.label === 'South Park C (p1C 1615)')).toBe(true);
		expect(conor.candidates.some((c) => c.label === 'South Park C2 (p1C 1615)')).toBe(true);
		expect(state.leagues['boarz-ii-men'].groupShots.some((g) => g.label === 'South Park ABC contact sheet (p1C 1615)')).toBe(true);
		expect(state.leagues['boarz-ii-men'].groupShots.some((g) => g.label === 'South Park ABC contact sheet v2 (p1C 1615)')).toBe(true);
		expect(state.leagues['boarz-ii-men'].groupShots.some((g) => g.label === 'Simpsons group plate v2 (p1C 1615)')).toBe(true);

		const second = rescanSources({ factoryDir, sourcesDir });
		expect(second.copied).toBe(0);

		const mutated = loadState(factoryDir);
		const plate = mutated.leagues['boarz-ii-men'].groupShots.find((g) => g.label.includes('plate v2'))!;
		plate.label = 'stale plate label';
		saveState(mutated, factoryDir);
		expect(rescanSources({ factoryDir, sourcesDir }).copied).toBe(0);
		expect(
			loadState(factoryDir).leagues['boarz-ii-men'].groupShots.some((g) => g.label === 'Simpsons group plate v2 (p1C 1615)'),
		).toBe(true);
	});
});
