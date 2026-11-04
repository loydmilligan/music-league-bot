import sharp from 'sharp';

const SIZE = 456;
const STEPS = 14; // 13 interior wipe positions between 0 and SIZE
const EDGE = 8; // soft edge width, px

async function rawRgb(img: Buffer): Promise<Buffer> {
	return sharp(img).resize(SIZE, SIZE, { fit: 'cover' }).removeAlpha().raw().toBuffer();
}

/** Blend: columns left of `pos` show `top`, right of it show `base`, with a soft edge. */
function wipeFrame(base: Buffer, top: Buffer, pos: number): Buffer {
	const out = Buffer.allocUnsafe(base.length);
	for (let x = 0; x < SIZE; x++) {
		const a = Math.min(1, Math.max(0, (pos + EDGE / 2 - (x + 0.5)) / EDGE));
		for (let y = 0; y < SIZE; y++) {
			const o = (y * SIZE + x) * 3;
			for (let c = 0; c < 3; c++) out[o + c] = Math.round(base[o + c] * (1 - a) + top[o + c] * a);
		}
	}
	return out;
}

const toPng = (raw: Buffer) =>
	sharp(raw, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toBuffer();

/** 29-frame loop: original 2000ms, 13 wipe frames, swapped 2560ms, 13 wipe frames back + original. */
export async function makeWipeGif(original: Buffer, swapped: Buffer): Promise<Buffer> {
	const [o, s] = await Promise.all([rawRgb(original), rawRgb(swapped)]);
	const raws: Buffer[] = [o];
	for (let i = 1; i < STEPS; i++) raws.push(wipeFrame(o, s, (SIZE * i) / STEPS)); // swapped reveals L→R
	raws.push(s);
	for (let i = 1; i < STEPS; i++) raws.push(wipeFrame(s, o, (SIZE * i) / STEPS)); // original reveals L→R
	raws.push(o);
	const frames = await Promise.all(raws.map(toPng));
	const delay = raws.map(() => 60);
	delay[0] = 2000;
	delay[STEPS] = 2560;
	return sharp(frames, { join: { animated: true } }).gif({ delay, loop: 0 }).toBuffer();
}

export async function makeStill(swapped: Buffer): Promise<Buffer> {
	return sharp(swapped).resize(SIZE, SIZE, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer();
}
