import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listSources, PathGuardError, resolveUnderRoot } from './paths.js';

describe('path-traversal guard', () => {
	const root = mkdtempSync(join(tmpdir(), 'af-paths-'));

	it('resolves a nested relative path', () => {
		expect(resolveUnderRoot(root, 'boarz-players/matt-mariani/headshot.png')).toBe(
			join(root, 'boarz-players/matt-mariani/headshot.png'),
		);
	});

	it('rejects .. segments', () => {
		expect(() => resolveUnderRoot(root, '../etc/passwd')).toThrow(PathGuardError);
		expect(() => resolveUnderRoot(root, 'boarz-players/../../etc/passwd')).toThrow(PathGuardError);
	});

	it('rejects absolute paths', () => {
		expect(() => resolveUnderRoot(root, '/etc/passwd')).toThrow(PathGuardError);
	});

	it('rejects NUL bytes', () => {
		expect(() => resolveUnderRoot(root, 'foo\0.png')).toThrow(PathGuardError);
	});

	it('lists only under the sources root', () => {
		mkdirSync(join(root, 'boarz-players'), { recursive: true });
		writeFileSync(join(root, 'boarz-players', 'a.png'), 'x');
		const entries = listSources(root, 'boarz-players');
		expect(entries.map((e) => e.name)).toEqual(['a.png']);
		expect(() => listSources(root, '../')).toThrow(PathGuardError);
	});
});
