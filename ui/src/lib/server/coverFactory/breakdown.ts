// Pure module: importable by the client too. No node imports.
export type SubjectRole = 'main' | 'secondary' | 'background';
export interface Subject {
	label: string;
	kind: 'person' | 'animal' | 'object';
	role: SubjectRole;
	position: string;
	pose: string;
	gaze: string;
	clothing: string;
	expression: string;
	color_treatment: string;
	focus: string;
	box?: [number, number, number, number];
	/** Set on subjects added by an applied concept pitch; ignored by the prompt builders. */
	conceptId?: string;
}
export interface Breakdown {
	style: string;
	composition: string;
	palette_lighting: string;
	text_elements: string[];
	subjects: Subject[];
	no_subjects: boolean;
}

export const READ_PROMPT = `You are analysing an album cover so an image model can recreate it exactly with one person swapped.
Return ONLY JSON: {"style": "...medium, rendering, era, texture/grain", "composition": "...layout, framing, camera angle, where text/logos sit",
"palette_lighting": "...", "text_elements": ["exact visible text and where"],
"subjects": [{"label":"A","kind":"person|animal|object","role":"main|secondary|background","position":"...","pose":"...","gaze":"...","clothing":"...","expression":"...","color_treatment":"...","focus":"sharp|soft|blurred","box":[x,y,w,h]}]}
Each subject's "box" is a tight bounding box around that subject as fractions 0-1 of the image width/height, top-left origin: [x, y, width, height].
Role guidance: main = the obvious focal person; if several people share focus, mark them all secondary. Use background for incidental figures. If the cover has no people or animals, return an empty subjects list.`;

export const IDENTITY_PROMPT =
	"Describe ONLY this person's stable identifying features for a likeness transfer: face shape, eyes, eyebrows, nose, hairline/hair, facial hair, glasses (style), skin tone, apparent age, distinctive marks. One compact sentence. Ignore clothing, hat, background.";

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

function textItem(v: unknown): string {
	if (typeof v === 'string') return v;
	if (v && typeof v === 'object') {
		const o = v as Record<string, unknown>;
		const text = str(o.text) || str(o.content);
		const pos = str(o.position) || str(o.location);
		if (text) return pos ? `${text} (${pos})` : text;
		return JSON.stringify(v);
	}
	return v == null ? '' : String(v);
}

const ROLES: SubjectRole[] = ['main', 'secondary', 'background'];
const KINDS = ['person', 'animal', 'object'] as const;

/** 0 → A, 25 → Z, 26 → AA, … */
export function letter(i: number): string {
	let n = i, s = '';
	do {
		s = String.fromCharCode(65 + (n % 26)) + s;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return s;
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000;

export function normalizeBox(
	raw: unknown, size?: { width: number; height: number },
): [number, number, number, number] | undefined {
	if (!Array.isArray(raw) || raw.length !== 4) return undefined;
	if (!raw.every((x) => typeof x === 'number' && Number.isFinite(x))) return undefined;
	let [x, y, w, h] = raw as number[];
	if (raw.some((v: number) => v > 1)) {
		if (!size || !(size.width > 0) || !(size.height > 0)) return undefined;
		x /= size.width; w /= size.width; y /= size.height; h /= size.height;
	}
	const MIN = 0.02;
	x = Math.min(Math.max(x, 0), 1 - MIN);
	y = Math.min(Math.max(y, 0), 1 - MIN);
	w = Math.min(Math.max(w, MIN), 1 - x);
	h = Math.min(Math.max(h, MIN), 1 - y);
	return [r3(x), r3(y), r3(w), r3(h)];
}

export function normalizeBreakdown(raw: unknown, size?: { width: number; height: number }): Breakdown {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const rawSubjects = Array.isArray(r.subjects) ? r.subjects : [];
	const used = new Set<string>();
	const subjects: Subject[] = rawSubjects.map((item, i) => {
		const s = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
		let label = str(s.label).trim();
		if (!label || used.has(label)) {
			let k = i;
			label = letter(k);
			while (used.has(label)) label = letter(++k);
		}
		used.add(label);
		const role = ROLES.includes(s.role as SubjectRole) ? (s.role as SubjectRole) : 'secondary';
		const kind = (KINDS as readonly unknown[]).includes(s.kind) ? (s.kind as Subject['kind']) : 'object';
		const out: Subject = {
			label, kind, role,
			position: str(s.position), pose: str(s.pose), gaze: str(s.gaze), clothing: str(s.clothing),
			expression: str(s.expression), color_treatment: str(s.color_treatment), focus: str(s.focus),
		};
		const box = normalizeBox(s.box, size);
		if (box) out.box = box;
		if (typeof s.conceptId === 'string' && s.conceptId.trim()) out.conceptId = s.conceptId.trim();
		return out;
	});
	return {
		style: str(r.style),
		composition: str(r.composition),
		palette_lighting: str(r.palette_lighting),
		text_elements: Array.isArray(r.text_elements) ? r.text_elements.map(textItem) : [],
		subjects,
		no_subjects: subjects.filter((s) => s.kind !== 'object').length === 0,
	};
}

export function parseModelJson(text: string): unknown {
	const a = text.indexOf('{');
	const b = text.lastIndexOf('}');
	if (a < 0 || b <= a) throw new Error('unparseable');
	try {
		return JSON.parse(text.slice(a, b + 1));
	} catch {
		throw new Error('unparseable');
	}
}
