import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '../db/client.js';
import {
	ConfigError,
	FREQUENCIES,
	KPI_CATALOG,
	SECTION_IDS,
	defaultConfig,
	mergeConfig,
	parseConfig,
	publicSections,
	setRunState,
	type PortalAdminConfig,
} from './config.js';
import { readConfig, writeConfig } from './store.js';

describe('default config', () => {
	it('selects every catalog KPI', () => {
		expect(defaultConfig().sections.byNumbers.kpis).toEqual([...KPI_CATALOG]);
	});

	it('turns every section on with an on-event-or-finer frequency', () => {
		const c = defaultConfig();
		for (const id of SECTION_IDS) {
			expect(c.sections[id].enabled).toBe(true);
			expect(FREQUENCIES).toContain(c.sections[id].frequency);
		}
	});

	it('starts with no run history and a null prompt everywhere', () => {
		const c = defaultConfig();
		expect(c.runState).toEqual({});
		expect(c.sections.pulse.prompt).toBeNull();
		expect(c.sections.moments.prompt).toBeNull();
		expect(c.sections.yearbook.season).toBeNull();
		expect(c.sections.family.players).toEqual({});
	});
});

describe('parseConfig', () => {
	it('round-trips a default config', () => {
		expect(parseConfig(defaultConfig())).toEqual(defaultConfig());
	});

	it('rejects an unknown frequency', () => {
		const bad = defaultConfig();
		(bad.sections.pulse as { frequency: string }).frequency = 'fortnightly';
		expect(() => parseConfig(bad)).toThrow(ConfigError);
	});

	it('rejects a wrong version', () => {
		expect(() => parseConfig({ ...defaultConfig(), version: 2 })).toThrow(ConfigError);
	});

	it('rejects a KPI id that is not in the catalog', () => {
		const bad = defaultConfig();
		(bad.sections.byNumbers as { kpis: string[] }).kpis = ['songs', 'imaginary'];
		expect(() => parseConfig(bad)).toThrow(ConfigError);
	});
});

describe('mergeConfig', () => {
	let base: PortalAdminConfig;
	beforeEach(() => {
		base = defaultConfig();
	});

	it('leaves untouched sections exactly as they were', () => {
		base.sections.pulse.prompt = 'Be kind about Round 3.';
		const merged = mergeConfig(base, { sections: { moments: { enabled: false } } });
		expect(merged.sections.moments.enabled).toBe(false);
		expect(merged.sections.pulse.prompt).toBe('Be kind about Round 3.');
	});

	it('merges keys inside a section rather than replacing the section', () => {
		const merged = mergeConfig(base, {
			sections: { thisWeek: { cards: { openPolls: false } } },
		});
		expect(merged.sections.thisWeek.cards.openPolls).toBe(false);
		expect(merged.sections.thisWeek.cards.latestDigest).toBe(true);
		expect(merged.sections.thisWeek.links.spotify).toBe(true);
	});

	it('drops unknown section ids and never lets a patch own version/runState', () => {
		const withHistory = setRunState(base, 'pulse', { status: 'ok', at: '2026-10-08T00:00:00Z' });
		const merged = mergeConfig(withHistory, {
			version: 9,
			runState: { pulse: { lastRunAt: 'nope' } },
			sections: { notASection: { enabled: false }, pulse: { frequency: 'daily' } },
		});
		expect(merged.version).toBe(1);
		expect(merged.runState).toEqual(withHistory.runState);
		expect('notASection' in merged.sections).toBe(false);
		expect(merged.sections.pulse.frequency).toBe('daily');
	});

	it('keeps an explicit null prompt (reset-to-default)', () => {
		base.sections.pulse.prompt = 'draft';
		const merged = mergeConfig(base, { sections: { pulse: { prompt: null } } });
		expect(merged.sections.pulse.prompt).toBeNull();
	});

	it('throws on an invalid patch value', () => {
		expect(() => mergeConfig(base, { sections: { pulse: { frequency: 'never' } } })).toThrow(
			ConfigError
		);
	});
});

describe('setRunState', () => {
	it('records success without an error string', () => {
		const c = setRunState(defaultConfig(), 'byNumbers', { status: 'ok', at: 'T' });
		expect(c.runState.byNumbers).toEqual({
			lastRunAt: 'T',
			lastStatus: 'ok',
			lastError: null,
		});
	});

	it('records failure with the message', () => {
		const c = setRunState(defaultConfig(), 'byNumbers', {
			status: 'error',
			error: 'boom',
			at: 'T',
		});
		expect(c.runState.byNumbers.lastStatus).toBe('error');
		expect(c.runState.byNumbers.lastError).toBe('boom');
	});
});

describe('publicSections', () => {
	it('carries display config and nothing else', () => {
		const base = defaultConfig();
		base.sections.pulse.prompt = 'secret prompt';
		base.sections.family.players = { m1: false };
		base.sections.byNumbers.kpis = ['songs'];
		const c = setRunState(base, 'pulse', { status: 'ok', at: 'T' });
		const pub = publicSections(c) as unknown as Record<string, unknown>;
		const json = JSON.stringify(pub);
		expect(json).not.toContain('secret prompt');
		expect(json).not.toContain('runState');
		expect(json).not.toContain('frequency');
		expect(publicSections(c).family.excluded).toEqual(['m1']);
		expect(publicSections(c).byNumbers.kpis).toEqual(['songs']);
	});

	it('defaults every section to enabled when nothing has been configured', () => {
		const pub = publicSections(defaultConfig());
		for (const id of SECTION_IDS) expect(pub.enabled[id]).toBe(true);
	});
});

describe('store round-trip', () => {
	let db: Database.Database;
	beforeEach(() => {
		db = openLeagueDb(':memory:');
		db.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ? , ?)').run('x', 'X');
	});

	it('returns defaults when nothing is stored', () => {
		expect(readConfig(db, 1)).toEqual(defaultConfig());
	});

	it('persists and re-reads a saved config', () => {
		const c = defaultConfig();
		c.sections.yearbook.season = 3;
		writeConfig(db, 1, c);
		expect(readConfig(db, 1).sections.yearbook.season).toBe(3);
	});

	it('falls back to defaults (without overwriting) for an unparseable row', () => {
		db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
			'portal_admin_config:1',
			'{not json'
		);
		expect(readConfig(db, 1)).toEqual(defaultConfig());
		const stored = db
			.prepare('SELECT value FROM settings WHERE key = ?')
			.get('portal_admin_config:1') as { value: string };
		expect(stored.value).toBe('{not json');
	});
});
