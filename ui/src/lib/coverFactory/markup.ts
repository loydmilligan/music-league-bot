// Client-side geometry for the subject-markup overlay. Boxes are [x, y, w, h] fractions 0-1, top-left origin.
export type Box = [number, number, number, number];

const MIN = 0.02;
const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const floor3 = (n: number) => Math.floor(n * 1000 + 1e-9) / 1000;

/** 0 → A, 25 → Z, 26 → AA (same scheme as the server's letter()). */
function letterAt(i: number): string {
	let n = i, s = '';
	do {
		s = String.fromCharCode(65 + (n % 26)) + s;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return s;
}

export function nextLetter(used: Iterable<string>): string {
	const taken = new Set(used);
	let i = 0;
	while (taken.has(letterAt(i))) i++;
	return letterAt(i);
}

/** Box spanned by two drag points (fractions of the cover), or null when either side is under 2%. */
export function boxFromDrag(a: { x: number; y: number }, b: { x: number; y: number }): Box | null {
	const x0 = clamp01(Math.min(a.x, b.x)), x1 = clamp01(Math.max(a.x, b.x));
	const y0 = clamp01(Math.min(a.y, b.y)), y1 = clamp01(Math.max(a.y, b.y));
	if (x1 - x0 < MIN || y1 - y0 < MIN) return null;
	const x = r3(x0), y = r3(y0);
	return [x, y, Math.min(r3(x1 - x0), floor3(1 - x)), Math.min(r3(y1 - y0), floor3(1 - y))];
}

/** Short placement text for a hand-drawn subject, e.g. "left-center, x 10–45%, y 20–90%". */
export function boxPhrase([x, y, w, h]: Box): string {
	const pct = (n: number) => Math.round(n * 100);
	const cx = x + w / 2, cy = y + h / 2;
	const hz = cx < 1 / 3 ? 'left' : cx > 2 / 3 ? 'right' : 'center';
	const vt = cy < 1 / 3 ? 'top' : cy > 2 / 3 ? 'bottom' : 'center';
	const region = hz === 'center' && vt === 'center' ? 'center' : `${hz}-${vt}`;
	return `${region}, x ${pct(x)}–${pct(x + w)}%, y ${pct(y)}–${pct(y + h)}%`;
}
