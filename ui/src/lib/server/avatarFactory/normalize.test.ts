import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { MAX_EDGE, normalizeImage } from './normalize.js';

describe('normalizeImage', () => {
	it('flattens a tall RGBA PNG (Ronnie-shaped 245×700) onto white JPEG ≤1024', async () => {
		const png = await sharp({
			create: {
				width: 245,
				height: 700,
				channels: 4,
				background: { r: 10, g: 20, b: 30, alpha: 0.4 },
			},
		})
			.png()
			.toBuffer();
		const metaIn = await sharp(png).metadata();
		expect(metaIn.width).toBe(245);
		expect(metaIn.height).toBe(700);
		expect(metaIn.channels).toBe(4);

		const out = await normalizeImage(png, '/tmp/photos/1792809638774.png');
		expect(out.filename).toBe('1792809638774.png');
		expect(out.mime).toBe('image/jpeg');
		expect(out.width).toBe(245);
		expect(out.height).toBe(700);
		expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(MAX_EDGE);
		expect(out.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);

		const decoded = Buffer.from(out.dataUrl.split(',')[1] ?? '', 'base64');
		const metaOut = await sharp(decoded).metadata();
		expect(metaOut.format).toBe('jpeg');
		expect(metaOut.hasAlpha).toBe(false);
		expect(metaOut.channels).toBe(3);
		expect(metaOut.width).toBe(245);
		expect(metaOut.height).toBe(700);
	});

	it('downscales longest side to 1024 and applies EXIF rotation', async () => {
		const jpeg = await sharp({
			create: {
				width: 1600,
				height: 1200,
				channels: 3,
				background: { r: 200, g: 10, b: 10 },
			},
		})
			.jpeg({ quality: 80 })
			.withMetadata({ orientation: 6 })
			.toBuffer();

		const out = await normalizeImage(jpeg, 'wide.jpg');
		expect(Math.max(out.width, out.height)).toBe(MAX_EDGE);
		expect(out.width).toBeLessThanOrEqual(MAX_EDGE);
		expect(out.height).toBeLessThanOrEqual(MAX_EDGE);
		const decoded = Buffer.from(out.dataUrl.split(',')[1] ?? '', 'base64');
		const meta = await sharp(decoded).metadata();
		expect(meta.format).toBe('jpeg');
		expect(meta.hasAlpha).toBeFalsy();
	});
});
