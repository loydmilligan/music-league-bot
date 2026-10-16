import type Database from 'better-sqlite3';
import { getActiveDraftForRound, getSectionsForDraft } from '$lib/digest/llm.js';

/**
 * "How It Played" + "The Ballot Grid": every vote of the round, per song and per
 * ballot, with the 1.0 draft's flow (lede/closer) and consensus (per-song notes)
 * text. Read-only; computed on every render like the other structural blocks.
 */

// Per-league face crops (96px). Inlined as data URIs at build so the static
// publish capture needs no extra image requests.
const AVATARS = import.meta.glob('./avatars/*/*.jpg', {
	eager: true,
	query: '?inline',
	import: 'default'
}) as Record<string, string>;

export const slugName = (name: string): string =>
	name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** CSS class key for a player's face, or null when this league has no crop for them. */
export function avatarFor(leagueSlug: string, playerName: string): string | null {
	const slug = slugName(playerName);
	return AVATARS[`./avatars/${leagueSlug}/${slug}.jpg`] ? `av-${slug}` : null;
}

/** One rule per face so each image is inlined once, however many times it appears. */
function avatarCss(leagueSlug: string, keys: Iterable<string>): string {
	return [...new Set(keys)]
		.map((k) => `.${k}{background-image:url(${AVATARS[`./avatars/${leagueSlug}/${k.slice(3)}.jpg`]})}`)
		.join('');
}

export interface BallotVote {
	voter: string;
	avatar: string | null;
	pts: number;
	comment: string;
}

export interface BallotSong {
	rank: number;
	title: string;
	artist: string;
	submitter: string;
	submitterAvatar: string | null;
	net: number;
	ups: number;
	downs: number;
	note: string | null;
	votes: BallotVote[]; // non-zero first by points desc, then zero-point comments
}

export interface BallotRow {
	voter: string;
	avatar: string | null;
	cells: { pts: number; comment: boolean; own: boolean }[]; // aligned with songs
	broke: boolean;
	ballot: number[];
}

export interface Digest2Ballot {
	lede: string | null;
	closer: string | null;
	songs: BallotSong[];
	villainRank: number | null;
	grid: BallotRow[];
	gridCaption: string | null;
	avatarCss: string; // .av-<slug>{background-image:…} for every face used
}

/** The legal ballot under Second Best's Season Three rules: 3·2·1 plus two −1s. */
const RULE_CHECK_LEAGUES = new Set(['second-best']);
const LEGAL = [3, 2, 1, -1, -1].sort((a, b) => a - b).join(',');

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function artistText(raw: string | null): string {
	if (!raw) return '';
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (Array.isArray(parsed)) {
			return parsed.map((a) => (typeof a === 'string' ? a : (a as { name?: string })?.name ?? '')).filter(Boolean).join(', ');
		}
	} catch {
		/* plain string */
	}
	return raw;
}

function parse<T>(json: string | undefined): T | null {
	if (!json) return null;
	try {
		return JSON.parse(json) as T;
	} catch {
		return null;
	}
}

export function buildDigest2Ballot(db: Database.Database, roundId: number): Digest2Ballot | null {
	const league = db
		.prepare(
			`SELECT l.slug FROM rounds r JOIN seasons s ON s.id = r.season_id JOIN leagues l ON l.id = s.league_id WHERE r.id = ?`
		)
		.get(roundId) as { slug: string } | undefined;
	const leagueSlug = league?.slug ?? '';

	const subs = db
		.prepare(
			`SELECT s.spotify_uri AS uri, s.title, s.artists, COALESCE(p.name, c.name) AS submitter
			   FROM ml_submissions s JOIN competitors c ON c.id = s.competitor_id
			   LEFT JOIN players p ON p.id = c.player_id
			  WHERE s.round_id = ?`
		)
		.all(roundId) as { uri: string; title: string; artists: string | null; submitter: string }[];
	if (subs.length === 0) return null;

	const votes = db
		.prepare(
			`SELECT v.spotify_uri AS uri, COALESCE(p.name, c.name) AS voter, v.points AS pts, COALESCE(v.comment, '') AS comment
			   FROM votes v JOIN competitors c ON c.id = v.voter_id
			   LEFT JOIN players p ON p.id = c.player_id
			  WHERE v.round_id = ?`
		)
		.all(roundId) as { uri: string; voter: string; pts: number; comment: string }[];
	if (votes.length === 0) return null;

	// 1.0 draft text: flow = lede/closer, consensus = per-song notes.
	let lede: string | null = null;
	let closer: string | null = null;
	let gridCaption: string | null = null;
	const notes: { song: string; note: string }[] = [];
	const draft = getActiveDraftForRound(db, roundId);
	if (draft) {
		for (const s of getSectionsForDraft(db, draft.id)) {
			if (s.kind === 'flow') {
				const flow = parse<{ body?: string; note?: string; grid?: string }>(s.content_json);
				lede = flow?.body?.trim() || null;
				closer = flow?.note?.trim() || null;
				gridCaption = flow?.grid?.trim() || null;
			} else if (s.kind === 'consensus') {
				const c = parse<{ items?: { song?: string; note?: string; detail?: string }[] }>(s.content_json);
				for (const item of c?.items ?? []) {
					const note = (item.note ?? item.detail ?? '').trim();
					if (item.song && note) notes.push({ song: item.song, note });
				}
			}
		}
	}
	const noteFor = (title: string): string | null => {
		const key = norm(title);
		for (const n of notes) {
			const quoted = n.song.match(/["“]([^"”]+)["”]/)?.[1] ?? n.song;
			const nk = norm(quoted);
			if (nk && (key.startsWith(nk) || nk.startsWith(key))) return n.note;
		}
		return null;
	};

	const songs = subs.map((s) => {
		const vs = votes.filter((v) => v.uri === s.uri);
		return {
			uri: s.uri,
			title: s.title,
			artist: artistText(s.artists),
			submitter: s.submitter,
			submitterAvatar: avatarFor(leagueSlug, s.submitter),
			net: vs.reduce((t, v) => t + v.pts, 0),
			ups: vs.filter((v) => v.pts > 0).length,
			downs: vs.filter((v) => v.pts < 0).length,
			note: noteFor(s.title),
			votes: vs
				.filter((v) => v.pts !== 0 || v.comment.trim())
				.map((v) => ({ voter: v.voter, avatar: avatarFor(leagueSlug, v.voter), pts: v.pts, comment: v.comment.trim() }))
				.sort((a, b) => (b.pts === 0 ? -99 : b.pts) - (a.pts === 0 ? -99 : a.pts))
		};
	});
	songs.sort((a, b) => b.net - a.net || b.ups - a.ups || a.downs - b.downs || a.title.localeCompare(b.title));
	const ranked: BallotSong[] = songs.map((s, i) => ({ ...s, rank: i + 1 }));

	const voterNames = [...new Set(votes.map((v) => v.voter))].sort((a, b) => a.localeCompare(b));
	const grid: BallotRow[] = voterNames.map((voter) => {
		const mine = votes.filter((v) => v.voter === voter);
		const ballot = mine.map((v) => v.pts).filter((p) => p !== 0).sort((a, b) => b - a);
		return {
			voter,
			avatar: avatarFor(leagueSlug, voter),
			ballot,
			broke: RULE_CHECK_LEAGUES.has(leagueSlug) && [...ballot].sort((a, b) => a - b).join(',') !== LEGAL,
			cells: songs.map((s) => {
				const v = mine.find((m) => m.uri === s.uri);
				return { pts: v?.pts ?? 0, comment: !!v?.comment.trim(), own: s.submitter === voter };
			})
		};
	});

	return {
		lede,
		closer,
		songs: ranked,
		villainRank: ranked.length ? ranked[ranked.length - 1].rank : null,
		grid,
		gridCaption,
		avatarCss: avatarCss(
			leagueSlug,
			[...ranked.flatMap((s) => [s.submitterAvatar, ...s.votes.map((v) => v.avatar)]), ...grid.map((r) => r.avatar)].filter(
				(k): k is string => !!k
			)
		)
	};
}
