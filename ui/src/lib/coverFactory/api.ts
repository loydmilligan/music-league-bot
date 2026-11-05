// Client-side helpers for the /cover-factory page. No server imports (types only).
import type { Breakdown } from '$lib/server/coverFactory/breakdown';
import type { Treatment } from '$lib/server/coverFactory/prompt';
import type { Concept, ConceptMove } from '$lib/server/coverFactory/pitch';
import type { AltCover } from '$lib/server/coverFactory/alternates';

export type { AltCover, Breakdown, Concept, ConceptMove, Treatment };
export type Subject = Breakdown['subjects'][number];

export interface Project {
	id: number;
	title: string;
	source: 'round' | 'spotify' | 'upload';
	round_id: number | null;
	league_slug: string | null;
	cover_rel: string;
	/** Set once an alternate edition has replaced the cover; the cover to go back to. */
	original_cover_rel: string | null;
	song_title: string | null;
	song_artist: string | null;
	song_album: string | null;
	keeper_version_id: number | null;
	share_dir: string | null;
	share_version_id: number | null;
	created_at: string;
}
export interface ProjectRow extends Project {
	version_count: number;
	keeper_rel: string | null;
}
export interface Version {
	id: number;
	try_no: number;
	model_id: string;
	provider: string;
	prompt: string;
	image_rel: string | null;
	status: 'ok' | 'failed';
	error_reason: string | null;
	rating_likeness: number | null;
	rating_seamlessness: number | null;
	rating_gag: number | null;
	rating_instructions: number | null;
	note: string | null;
	created_at: string;
	cost_usd?: number | null;
	cost_estimated?: number;
	latency_ms?: number | null;
}
export interface Player {
	slug: string;
	name: string;
	leagueSlug: string;
	headshotRel: string | null;
	lowRes: boolean;
	missing: boolean;
}
export interface Stats {
	tries: number;
	failures: number;
	triesToKeeper: number | null;
	spendUsd: number;
}
export interface HomeState {
	projects: ProjectRow[];
	leagues: { slug: string; name: string }[];
	models: { reader: string | null; generator: string | null };
}
export interface ProjectState {
	project: Project;
	breakdown: Breakdown | null;
	treatments: Treatment[];
	versions: Version[];
	stats: Stats;
	players: Player[];
	submitter: { slug: string; name: string } | null;
}
export interface AlternatesResult {
	alternates: AltCover[];
	/** MusicBrainz busy / no match; null when the list is good. */
	message: string | null;
	/** The alternate the current cover came from; null on the original. */
	currentId: string | null;
}

/** An alternate's id is its MusicBrainz release id: its Cover Art Archive thumbnail is derivable. */
export function altThumbUrl(id: string): string {
	return `https://coverartarchive.org/release/${encodeURIComponent(id)}/front-250`;
}

export interface RoundSong {
	submissionId: number;
	title: string;
	artists: string;
	playerName: string | null;
	playerSlug: string | null;
	artUrl: string | null;
}

export const RATING_KEYS = [
	{ key: 'likeness', label: 'Likeness' },
	{ key: 'seamlessness', label: 'Seamless' },
	{ key: 'gag', label: 'Gag' },
	{ key: 'instructions', label: 'Followed' },
] as const;
export type RatingKey = (typeof RATING_KEYS)[number]['key'];

export class ApiFailure extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly reason?: string,
	) {
		super(message);
	}
}

async function unwrap<T>(r: Response): Promise<T> {
	const j = (await r.json().catch(() => ({}))) as { error?: string; reason?: string; message?: string };
	if (!r.ok) {
		const msg =
			r.status === 409 && j.reason === 'paused'
				? 'Image generation is paused. Browsing, rating and sharing still work.'
				: j.error || j.message || r.statusText || `HTTP ${r.status}`;
		throw new ApiFailure(r.status, msg, j.reason);
	}
	return j as T;
}

export async function cfGet<T>(qs = ''): Promise<T> {
	return unwrap<T>(await fetch(`/api/cover-factory${qs}`));
}

export async function cfPost<T>(body: Record<string, unknown>): Promise<T> {
	return unwrap<T>(
		await fetch('/api/cover-factory', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		}),
	);
}

export async function cfUpload<T>(fields: Record<string, string | Blob>): Promise<T> {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return unwrap<T>(await fetch('/api/cover-factory', { method: 'POST', body: fd }));
}

const enc = (rel: string) => rel.split('/').map(encodeURIComponent).join('/');

export function mediaUrl(rel: string | null | undefined, download = false): string {
	if (!rel) return '';
	return `/api/cover-factory/media/${enc(rel)}${download ? '?download=1' : ''}`;
}

export function exportUrl(versionId: number, ext: 'gif' | 'jpg'): string {
	return `/api/cover-factory/media/export/${versionId}.${ext}`;
}

/** Project uploads live under the cover root; roster headshots live in the avatar sources dir. */
export function headshotUrl(rel: string | null): string {
	if (!rel) return '';
	return rel.startsWith('uploads/') ? mediaUrl(rel) : `/api/avatar-factory/sources/file/${enc(rel)}`;
}

export function reasonText(reason: string | null | undefined): string {
	if (reason === 'no_image' || reason === 'safety_refusal') return 'Model returned no image (safety/likeness refusal)';
	if (reason === 'out_of_credits') return 'Out of OpenRouter credits';
	return reason || 'Generation failed';
}

export function usd(n: number | null | undefined, digits = 3): string {
	return n == null ? '—' : `$${n.toFixed(digits)}`;
}

export function shortModel(id: string | null | undefined): string {
	if (!id) return 'none pinned';
	return id.split('/').pop() ?? id;
}
