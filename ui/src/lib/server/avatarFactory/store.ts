import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { factoryRoot } from './paths.js';
import type { HeightClass } from './gating.js';

export type CandidateStatus = 'candidate' | 'approved' | 'rejected';
export type CandidateSource = 'generated' | 'imported';

export interface CandidateRecord {
	id: string;
	themeSlug: string;
	letter: string;
	relPath: string;
	label: string;
	rating: number | null;
	ratingComment?: string;
	status: CandidateStatus;
	source: CandidateSource;
	importKey?: string;
	prompt?: string;
	tweakNote?: string;
	usedNotes?: string;
	createdAt: string;
	costUsd?: number;
	costEstimated?: boolean;
	pricingBasis?: string;
	promptTruncated?: boolean;
	provider?: string;
	model?: string;
}

export interface MemberRecord {
	slug: string;
	name: string;
	playerId: number | null;
	height: HeightClass;
	notes: string;
	photoRel: string | null;
	candidates: CandidateRecord[];
}

export interface GroupShotRecord {
	id: string;
	themeSlug: string;
	relPath: string;
	label: string;
	status: CandidateStatus;
	source: CandidateSource;
	importKey?: string;
	createdAt: string;
	costUsd?: number;
	costEstimated?: boolean;
	pricingBasis?: string;
	promptTruncated?: boolean;
	provider?: string;
	model?: string;
	prompt?: string;
}

export interface ThemeRecord {
	slug: string;
	name: string;
	prompt: string;
	attachInspiration: boolean;
	inspirationRels: string[];
	source: 'imported' | 'in-app';
}

export interface LeagueRecord {
	slug: string;
	name: string;
	members: MemberRecord[];
	groupShots: GroupShotRecord[];
}

export interface FactoryState {
	version: 1;
	costUsd: number;
	attemptCount: number;
	themes: ThemeRecord[];
	leagues: Record<string, LeagueRecord>;
	importIndex: Record<string, string>;
}

export function emptyState(): FactoryState {
	return { version: 1, costUsd: 0, attemptCount: 0, themes: [], leagues: {}, importIndex: {} };
}

export function statePath(root = factoryRoot()): string {
	return join(root, 'state.json');
}

export function imagesRoot(root = factoryRoot()): string {
	return join(root, 'images');
}

export function photosRoot(root = factoryRoot()): string {
	return join(root, 'photos');
}

export function loadState(root = factoryRoot()): FactoryState {
	const p = statePath(root);
	if (!existsSync(p)) return emptyState();
	const raw = JSON.parse(readFileSync(p, 'utf8')) as FactoryState;
	if (raw.version !== 1) throw new Error('unsupported factory state version');
	raw.themes ??= [];
	raw.leagues ??= {};
	raw.importIndex ??= {};
	raw.costUsd ??= 0;
	raw.attemptCount ??= 0;
	return raw;
}

export function saveState(state: FactoryState, root = factoryRoot()): void {
	mkdirSync(root, { recursive: true });
	const p = statePath(root);
	const tmp = `${p}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(state, null, 2));
	renameSync(tmp, p);
}

export function newId(): string {
	return randomUUID();
}

export function ensureLeague(state: FactoryState, slug: string, name: string): LeagueRecord {
	if (!state.leagues[slug]) {
		state.leagues[slug] = { slug, name, members: [], groupShots: [] };
	} else if (name) {
		state.leagues[slug].name = name;
	}
	return state.leagues[slug];
}

export function findMember(league: LeagueRecord, slug: string): MemberRecord | undefined {
	return league.members.find((m) => m.slug === slug);
}

export function approvedForTheme(member: MemberRecord, themeSlug: string): CandidateRecord | undefined {
	return member.candidates.find((c) => c.themeSlug === themeSlug && c.status === 'approved');
}
