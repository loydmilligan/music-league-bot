import type { HeightClass } from './gating.js';
import { GLOBAL_NOTES, heightLine } from './notes.js';

export function extractFencedPrompt(styleMd: string): string {
	const blocks = [...styleMd.matchAll(/```(?:\w+)?\n([\s\S]*?)```/g)];
	if (blocks.length === 0) return styleMd.trim();
	return (blocks[0][1] ?? '').trim();
}

export function parseAttachInspiration(styleMd: string): boolean {
	return !/api_attach_inspiration:\s*false/i.test(styleMd);
}

export interface AssembleAvatarPromptInput {
	stylePrompt: string;
	globalNotes?: string;
	memberSlug: string;
	memberName: string;
	memberNotes: string;
	notesMd: string;
	height: HeightClass;
	tweakNote?: string;
}

export function assembleAvatarPrompt(input: AssembleAvatarPromptInput): string {
	const parts = [
		input.stylePrompt.trim(),
		'',
		'GLOBAL NOTES (must follow):',
		(input.globalNotes ?? GLOBAL_NOTES).trim(),
		'',
		'HEIGHT:',
		heightLine(input.memberSlug, input.height),
		'',
		`PLAYER: ${input.memberName} (${input.memberSlug})`,
	];
	if (input.memberNotes.trim()) {
		parts.push('', 'MEMBER NOTES (must follow):', input.memberNotes.trim());
	}
	if (input.notesMd.trim()) {
		parts.push('', 'PLAYER NOTES.md (must follow):', input.notesMd.trim());
	}
	if (input.tweakNote?.trim()) {
		parts.push('', 'TWEAK (apply this change on top of the previous lock):', input.tweakNote.trim());
	}
	return parts.join('\n');
}

export interface GroupMemberPrompt {
	slug: string;
	name: string;
	height: HeightClass;
	notes: string;
}

export function assembleGroupShotPrompt(input: {
	stylePrompt: string;
	themeName: string;
	members: GroupMemberPrompt[];
	globalNotes?: string;
}): string {
	const heights = input.members
		.map((m) => `- ${m.name} (${m.slug}): ${m.height}${m.height === 'tallest' ? ' — tallest of all' : ''}`)
		.join('\n');
	const notes = input.members
		.filter((m) => m.notes.trim())
		.map((m) => `- ${m.name}: ${m.notes.trim()}`)
		.join('\n');
	return [
		`Group shot of every league member together, in the same style as the attached approved avatars (${input.themeName}).`,
		'',
		input.stylePrompt.trim(),
		'',
		'GLOBAL NOTES (must follow):',
		(input.globalNotes ?? GLOBAL_NOTES).trim(),
		'',
		'HEIGHTS — feet on the same ground line; relative standing height must match:',
		heights,
		notes ? `\nMEMBER NOTES:\n${notes}` : '',
		'',
		'One image, all members present once, no extra people, no text, no logos, no watermarks.',
	]
		.filter((s) => s !== undefined)
		.join('\n');
}
