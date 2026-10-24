import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { orderMembersByHeight } from './gating.js';
import { composeReferenceSheet, SHEET_MAX_EDGE } from './sheet.js';

async function tinyPng(color: { r: number; g: number; b: number }): Promise<Buffer> {
	return sharp({
		create: { width: 8, height: 8, channels: 3, background: color },
	})
		.png()
		.toBuffer();
}

describe('reference sheet compositor', () => {
	it('orders short → tallest with Clements last', () => {
		const ordered = orderMembersByHeight([
			{ slug: 'clements-johnson', name: 'Clements', height: 'tallest' as const },
			{ slug: 'matt-mariani', name: 'Matt', height: 'tall' as const },
			{ slug: 'ronnie-bertolina', name: 'Ronnie', height: 'short' as const },
			{ slug: 'jon-black', name: 'Jon', height: 'medium' as const },
		]);
		expect(ordered.map((m) => m.slug)).toEqual([
			'ronnie-bertolina',
			'jon-black',
			'matt-mariani',
			'clements-johnson',
		]);
	});

	it('composites tiny PNGs into one labeled JPEG ≤1536', async () => {
		const tiles = [
			{ input: await tinyPng({ r: 200, g: 20, b: 20 }), name: 'Ronnie' },
			{ input: await tinyPng({ r: 20, g: 200, b: 20 }), name: 'Jon' },
			{ input: await tinyPng({ r: 20, g: 20, b: 200 }), name: 'Clements' },
		];
		const sheet = await composeReferenceSheet(tiles, { tile: 32, labelH: 14, pad: 4, maxEdge: 256 });
		expect(sheet.names).toEqual(['Ronnie', 'Jon', 'Clements']);
		expect(sheet.cols).toBe(3);
		expect(sheet.rows).toBe(1);
		expect(Math.max(sheet.width, sheet.height)).toBeLessThanOrEqual(256);
		const meta = await sharp(sheet.jpeg).metadata();
		expect(meta.format).toBe('jpeg');
		expect(meta.hasAlpha).toBeFalsy();
		expect(meta.channels).toBe(3);
	});

	it('fits 11 tiles on a sheet with longest side ≤1536', async () => {
		const tiles = await Promise.all(
			Array.from({ length: 11 }, async (_, i) => ({
				input: await tinyPng({ r: 10 * i, g: 80, b: 160 }),
				name: `P${i}`,
			})),
		);
		const sheet = await composeReferenceSheet(tiles, { tile: 32, labelH: 12, pad: 4 });
		expect(sheet.names).toHaveLength(11);
		expect(sheet.cols).toBe(4);
		expect(sheet.rows).toBe(3);
		expect(Math.max(sheet.width, sheet.height)).toBeLessThanOrEqual(SHEET_MAX_EDGE);
		expect((await sharp(sheet.jpeg).metadata()).format).toBe('jpeg');
	});
});
