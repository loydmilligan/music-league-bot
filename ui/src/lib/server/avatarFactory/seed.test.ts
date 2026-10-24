import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rescanSources } from './seed.js';
import { loadState } from './store.js';

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
		expect(loadState(factoryDir).leagues['boarz-ii-men'].members[0].candidates).toHaveLength(matt.candidates.length);
	});
});
