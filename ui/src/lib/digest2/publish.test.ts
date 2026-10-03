import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { swapDirAtomically } from './publish.js';

describe('swapDirAtomically', () => {
	it('replaces the previous published copy with the new one', async () => {
		const root = await mkdtemp(join(tmpdir(), 'd2-'));
		const final = join(root, 'slug'); const tmp = join(root, '.slug.tmp');
		await mkdir(final); await writeFile(join(final, 'index.html'), 'OLD');
		await mkdir(tmp); await writeFile(join(tmp, 'index.html'), 'NEW');
		await swapDirAtomically(tmp, final);
		expect(await readFile(join(final, 'index.html'), 'utf8')).toBe('NEW');
		expect((await readdir(root)).sort()).toEqual(['slug']); // no tmp / backup left behind
	});
	it('first publish (no previous copy) works', async () => {
		const root = await mkdtemp(join(tmpdir(), 'd2-'));
		const tmp = join(root, '.s.tmp'); await mkdir(tmp); await writeFile(join(tmp, 'index.html'), 'NEW');
		await swapDirAtomically(tmp, join(root, 's'));
		expect(await readFile(join(root, 's', 'index.html'), 'utf8')).toBe('NEW');
	});
	it('if the new copy is missing, the old copy is left untouched', async () => {
		const root = await mkdtemp(join(tmpdir(), 'd2-'));
		const final = join(root, 'slug'); await mkdir(final); await writeFile(join(final, 'index.html'), 'OLD');
		await expect(swapDirAtomically(join(root, '.missing.tmp'), final)).rejects.toThrow();
		expect(await readFile(join(final, 'index.html'), 'utf8')).toBe('OLD');
	});
});
