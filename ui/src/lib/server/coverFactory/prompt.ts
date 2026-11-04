// Pure module: importable by the client too. No node imports.
import type { Breakdown, Subject } from './breakdown';

export interface Treatment {
	label: string;
	mode: 'player' | 'keep' | 'remove';
	playerSlug?: string;
	playerName?: string;
	age?: string;
	gender?: string;
	clothing?: string;
	poseGaze?: string;
	styleMatch?: string;
	notes?: string;
}
export interface Identity { slug: string; name: string; features: string }

export const SEAMLESS_GOAL =
	'GOAL: at first glance this must look like the original album cover — same art style, composition, lighting, palette, grain/texture, clothing and text — with only the specified subjects changed, as seamlessly as if they were always part of the original artwork, never pasted on.';

export function defaultTreatments(b: Breakdown, submitter?: { slug: string; name: string }): Treatment[] {
	const player = (s: Subject): Treatment => ({ label: s.label, mode: 'player', playerSlug: submitter?.slug, playerName: submitter?.name });
	const keep = (s: Subject): Treatment => ({ label: s.label, mode: 'keep' });
	const living = (s: Subject) => s.kind === 'person' || s.kind === 'animal';
	const main = b.subjects.find((s) => s.role === 'main' && living(s));
	if (main) return b.subjects.map((s) => (s === main ? player(s) : keep(s)));
	const persons = b.subjects.filter((s) => s.kind === 'person');
	if (persons.length >= 2) return b.subjects.map((s) => (s.kind === 'person' ? player(s) : keep(s)));
	return b.subjects.map(keep);
}

function playerParagraph(s: Subject, t: Treatment, n: number, name: string, features: string): string {
	const who = `the person in image ${n} (${name})`;
	const keeps: string[] = [];
	const changes: string[] = [];
	if (t.poseGaze) changes.push(`pose and gaze: ${t.poseGaze}`);
	else keeps.push('pose/gaze');
	if (t.clothing) changes.push(`wearing ${t.clothing}`);
	else keeps.push(s.clothing.trim() ? `clothing and headwear from the cover (${s.clothing.trim()})` : 'clothing and headwear from the cover');
	// A clothing override must not silently drop the hat/cap, unless the notes talk about headwear.
	if (t.clothing && !/\b(hat|cap|headwear|beanie)\b/i.test(t.notes ?? '')) keeps.push('headwear from the cover');
	if (t.age) changes.push(`apparent age: ${t.age}`);
	if (t.gender) changes.push(`gender presentation: ${t.gender}`);
	if (t.styleMatch) changes.push(`style: ${t.styleMatch}`);
	if (t.notes) changes.push(t.notes);
	let p = `Subject ${s.label} (${s.position}) becomes ${who}: `;
	const parts: string[] = [];
	if (keeps.length) {
		// "keep the original pose/gaze, clothing and headwear from the cover unless told otherwise"
		parts.push(`keep the original ${keeps.join(', ')} unless told otherwise`);
	}
	if (changes.length) parts.push(`apply these changes: ${changes.join('; ')}`);
	p += parts.join('; ') + '. ';
	if (features.trim()) p += `Keep these identifying features exactly: ${features.trim()}. Render them in the cover's style, with the face clearly visible and recognizable.`;
	else p += `Render the person in the cover's style, with the face clearly visible and recognizable.`;
	// Live 2026-11-04: without this the model copied the headshot's plaid shirt onto the cover subject.
	p += ` Use image ${n} only for the face and identity: never copy its clothing, background or lighting into the cover.`;
	return p;
}

export function buildSwapPrompt(b: Breakdown, treatments: Treatment[], ids: Identity[]): { prompt: string; imageOrder: string[] } {
	const imageOrder = ['cover'];
	const byLabel = new Map(treatments.map((t) => [t.label, t]));
	const slot = (slug: string): number => {
		let i = imageOrder.indexOf(slug);
		if (i < 0) { imageOrder.push(slug); i = imageOrder.length - 1; }
		return i + 1;
	};
	const texts = b.text_elements.length ? b.text_elements.join('; ') : 'none';
	const lines: string[] = [
		'Recreate image 1 (an album cover) as faithfully as possible, changing ONLY the specified subjects.',
		SEAMLESS_GOAL,
		`Same art style (${b.style}), same composition (${b.composition}), same palette and lighting (${b.palette_lighting}), same grain/texture, same text and logos in the same places: ${texts}.`
	];
	for (const s of b.subjects) {
		const t = byLabel.get(s.label);
		if (!t || t.mode === 'keep') continue;
		if (t.mode === 'remove') { lines.push(`Remove subject ${s.label} and fill naturally.`); continue; }
		const id = ids.find((i) => i.slug === t.playerSlug);
		if (!t.playerSlug) continue;
		const n = slot(t.playerSlug);
		lines.push(playerParagraph(s, t, n, t.playerName || id?.name || t.playerSlug, id?.features ?? ''));
	}
	lines.push('Do not change anything else. Square output.');
	return { prompt: lines.join('\n'), imageOrder };
}
