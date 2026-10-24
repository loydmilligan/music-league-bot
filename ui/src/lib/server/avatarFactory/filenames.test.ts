import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	allocateVersionedNamedPath,
	allocateVersionedPath,
	refuseOverwrite,
	stampFromDate,
	versionedNamedRelPath,
	versionedRelPath,
} from './filenames.js';

describe('versioned filenames', () => {
	it('uses league/theme/member/YYYYMMDD-HHMMSS-letter.png', () => {
		const at = new Date(2026, 9, 23, 16, 32, 5);
		expect(versionedRelPath('boarz-ii-men', 'south-park', 'matt-mariani', 'A', at)).toBe(
			'boarz-ii-men/south-park/matt-mariani/20261023-163205-A.png',
		);
	});

	it('refuses overwrite of an existing file', () => {
		const dir = mkdtempSync(join(tmpdir(), 'af-fn-'));
		const p = join(dir, 'x.png');
		writeFileSync(p, 'one');
		expect(() => refuseOverwrite(p)).toThrow(/overwrite/);
	});

	it('allocates a later stamp when the path already exists', () => {
		const root = mkdtempSync(join(tmpdir(), 'af-alloc-'));
		const at = new Date(2026, 9, 23, 16, 32, 5);
		const first = allocateVersionedPath(root, 'boarz-ii-men', 'south-park', 'matt-mariani', 'A', at);
		mkdirSync(join(root, 'boarz-ii-men/south-park/matt-mariani'), { recursive: true });
		writeFileSync(first.abs, 'kept');
		const second = allocateVersionedPath(root, 'boarz-ii-men', 'south-park', 'matt-mariani', 'A', at);
		expect(second.rel).toBe('boarz-ii-men/south-park/matt-mariani/20261023-163206-A.png');
		expect(second.abs).not.toBe(first.abs);
	});

	it('stamp pads components', () => {
		expect(stampFromDate(new Date(2026, 0, 5, 3, 4, 5))).toBe('20260105-030405');
	});

	it('allocates a versioned group sheet jpg', () => {
		const at = new Date(2026, 9, 23, 19, 45, 0);
		expect(versionedNamedRelPath('boarz-ii-men', 'simpsons', 'group', 'sheet', 'jpg', at)).toBe(
			'boarz-ii-men/simpsons/group/20261023-194500-sheet.jpg',
		);
		const root = mkdtempSync(join(tmpdir(), 'af-sheet-'));
		const first = allocateVersionedNamedPath(root, 'boarz-ii-men', 'simpsons', 'group', 'sheet', 'jpg', at);
		writeFileSync(first.abs, 'x');
		const second = allocateVersionedNamedPath(root, 'boarz-ii-men', 'simpsons', 'group', 'sheet', 'jpg', at);
		expect(second.rel).toBe('boarz-ii-men/simpsons/group/20261023-194501-sheet.jpg');
	});
});
