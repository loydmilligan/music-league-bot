export type HeightClass = 'short' | 'medium' | 'tall' | 'tallest';

export interface MemberApproval {
	slug: string;
	approvedCandidateId: string | null;
}

/** Group-shot generation is enabled only when every member has an approved avatar for the theme. */
export function canRequestGroupShot(members: MemberApproval[]): boolean {
	if (members.length === 0) return false;
	return members.every((m) => typeof m.approvedCandidateId === 'string' && m.approvedCandidateId.length > 0);
}

export function groupShotBlockReason(members: MemberApproval[]): string | null {
	if (canRequestGroupShot(members)) return null;
	if (members.length === 0) return 'no members';
	const missing = members.filter((m) => !m.approvedCandidateId).map((m) => m.slug);
	return `need approved avatars for: ${missing.join(', ')}`;
}

export const MAX_OPTIONS_PER_CLICK = 3;

export function clampOptionCount(n: unknown): number {
	const v = typeof n === 'number' ? n : Number(n);
	if (!Number.isFinite(v) || v < 1) return 1;
	return Math.min(MAX_OPTIONS_PER_CLICK, Math.floor(v));
}

export function optionLetters(count: number): string[] {
	const n = clampOptionCount(count);
	return Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
}
