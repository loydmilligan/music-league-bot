import { basename } from 'node:path';
import sharp from 'sharp';
import type { ImageRefMeta } from './errors.js';

export const MAX_EDGE = 1024;

export interface NormalizedImage extends ImageRefMeta {
	dataUrl: string;
	mime: 'image/jpeg';
}

/**
 * EXIF-rotate, flatten alpha onto white, longest side ≤1024, baseline JPEG q≈90.
 * Never logs bytes as base64.
 */
export async function normalizeImage(input: Buffer, filename: string): Promise<NormalizedImage> {
	const out = await sharp(input, { failOn: 'none' })
		.rotate()
		.flatten({ background: { r: 255, g: 255, b: 255 } })
		.resize({
			width: MAX_EDGE,
			height: MAX_EDGE,
			fit: 'inside',
			withoutEnlargement: true,
		})
		.jpeg({ quality: 90, progressive: false })
		.toBuffer({ resolveWithObject: true });

	const width = out.info.width;
	const height = out.info.height;
	const bytes = out.data.byteLength;
	const mime = 'image/jpeg' as const;
	return {
		filename: basename(filename),
		width,
		height,
		bytes,
		mime,
		dataUrl: `data:${mime};base64,${out.data.toString('base64')}`,
	};
}
