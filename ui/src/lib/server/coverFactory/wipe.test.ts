import { it, expect } from 'vitest';
import sharp from 'sharp';
import { makeWipeGif, makeStill } from './wipe.js';

const solid = (r: number, g: number, b: number) =>
	sharp({ create: { width: 600, height: 600, channels: 3, background: { r, g, b } } }).png().toBuffer();

async function px(gif: Buffer, page: number, x: number) {
	const { data, info } = await sharp(gif, { page }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
	const o = (200 * info.width + x) * 3;
	return [data[o], data[o + 1], data[o + 2]];
}
const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 24);

it('wipe gif matches podium format', async () => {
	const orig = await solid(200, 30, 30);
	const swap = await solid(30, 30, 200);
	const gif = await makeWipeGif(orig, swap);
	const m = await sharp(gif, { animated: true }).metadata();
	expect(m.pages).toBe(29);
	expect(m.width).toBe(456);
	expect(m.pageHeight).toBe(456);
	expect(m.loop).toBe(0);
	expect(m.delay![0]).toBe(2000);
	expect(m.delay![14]).toBe(2560);
	m.delay!.forEach((d, i) => { if (i !== 0 && i !== 14) expect(d).toBe(60); });
	expect(near(await px(gif, 0, 10), [200, 30, 30])).toBe(true);
	expect(near(await px(gif, 14, 446), [30, 30, 200])).toBe(true);
	expect(near(await px(gif, 7, 10), [30, 30, 200])).toBe(true);
	expect(near(await px(gif, 7, 446), [200, 30, 30])).toBe(true);
});

it('still is 456x456 jpeg', async () => {
	const out = await makeStill(await solid(30, 30, 200));
	const m = await sharp(out).metadata();
	expect([m.format, m.width, m.height]).toEqual(['jpeg', 456, 456]);
});
