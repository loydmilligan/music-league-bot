import sharp from 'sharp';
import type { HeightClass } from './gating.js';

export const SHEET_TILE = 256;
export const SHEET_LABEL_H = 32;
export const SHEET_PAD = 12;
export const SHEET_MAX_EDGE = 1536;
export const SHEET_COLS = 4;

export interface SheetTile {
	input: Buffer;
	name: string;
	slug?: string;
	height?: HeightClass;
}

export interface SheetResult {
	jpeg: Buffer;
	width: number;
	height: number;
	cols: number;
	rows: number;
	names: string[];
}

function escapeXml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * One labeled reference sheet: ~256px tiles, name under each, short → tallest.
 * Re-encodes baseline JPEG, longest side ≤1536.
 */
export async function composeReferenceSheet(
	tiles: SheetTile[],
	opts: { tile?: number; labelH?: number; pad?: number; maxEdge?: number; cols?: number } = {},
): Promise<SheetResult> {
	if (tiles.length === 0) throw new Error('no tiles for reference sheet');
	const tile = opts.tile ?? SHEET_TILE;
	const labelH = opts.labelH ?? SHEET_LABEL_H;
	const pad = opts.pad ?? SHEET_PAD;
	const maxEdge = opts.maxEdge ?? SHEET_MAX_EDGE;
	const cols = Math.min(opts.cols ?? SHEET_COLS, tiles.length);
	const rows = Math.ceil(tiles.length / cols);
	const cellW = tile + pad;
	const cellH = tile + labelH + pad;
	const width = cols * cellW + pad;
	const height = rows * cellH + pad;
	const fontSize = Math.max(10, Math.round(labelH * 0.45));

	const overlays: sharp.OverlayOptions[] = [];
	for (let i = 0; i < tiles.length; i++) {
		const col = i % cols;
		const row = Math.floor(i / cols);
		const x = pad + col * cellW;
		const y = pad + row * cellH;
		const resized = await sharp(tiles[i].input, { failOn: 'none' })
			.rotate()
			.resize(tile, tile, { fit: 'cover', position: 'centre' })
			.png()
			.toBuffer();
		overlays.push({ input: resized, left: x, top: y });
		const label = Buffer.from(
			`<svg width="${tile}" height="${labelH}" xmlns="http://www.w3.org/2000/svg">
				<rect width="100%" height="100%" fill="#f4f1ea"/>
				<text x="50%" y="68%" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="${fontSize}" fill="#1a1a1a">${escapeXml(tiles[i].name)}</text>
			</svg>`,
		);
		overlays.push({ input: label, left: x, top: y + tile });
	}

	let out = await sharp({
		create: {
			width,
			height,
			channels: 3,
			background: { r: 244, g: 241, b: 234 },
		},
	})
		.composite(overlays)
		.jpeg({ quality: 90, progressive: false })
		.toBuffer({ resolveWithObject: true });

	if (Math.max(out.info.width, out.info.height) > maxEdge) {
		out = await sharp(out.data)
			.resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
			.jpeg({ quality: 90, progressive: false })
			.toBuffer({ resolveWithObject: true });
	}

	return {
		jpeg: out.data,
		width: out.info.width,
		height: out.info.height,
		cols,
		rows,
		names: tiles.map((t) => t.name),
	};
}
