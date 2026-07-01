/**
 * tasteData.ts — builds the interaction-level `taste` block for read_model.json,
 * the input the client-side Taste Waveform engine consumes (see taste-waveform.ts
 * and the package IMPLEMENTATION.md).
 *
 * Shape (per league): { axes: SongAxes[], players: [{ name, rows }] }
 *   axes  — per-song 5-tuple [obscurity, energy, mood, tempo, lyrical] (0..100)
 *   rows  — [songIndex, interaction(0=sub,1=vote), points, roundId, hasComment, leagueId]
 *           leagueId is row[5] (ignored by the engine) so the client can filter to the
 *           current league when the "use all leagues" setting is OFF.
 *
 * Players = the current league's members; each member's rows include their interactions
 * across EVERY league (the default all-leagues corpus). Archetypes are league-relative,
 * computed client-side against these members.
 */
import type Database from 'better-sqlite3';

export type SongAxes = [number, number, number, number, number];
export type TasteRow = [number, number, number, number, number, number];
export interface TastePlayer { name: string; rows: TasteRow[]; }
export interface TasteBlock { axes: SongAxes[]; players: TastePlayer[]; }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface MetaRow {
	spotify_uri: string;
	popularity_proxy: number | null;
	energy: number | null;
	bpm: number | null;
	scale: string | null;
	has_lyrics: number | null;
}

/** Derive the 5 axes from raw song features (verbatim from IMPLEMENTATION.md §axes). */
function axesFor(m: MetaRow | undefined): SongAxes {
	const pop = m?.popularity_proxy ?? 50;
	const energy = m?.energy ?? 50;
	const bpm = m?.bpm ?? 108; // ~median → tempo ≈ 40
	const major = m?.scale === 'major';
	const minor = m?.scale === 'minor';
	const moodBase = major ? 62 : minor ? 38 : 50;
	const hasLyrics = m?.has_lyrics == null ? 1 : m.has_lyrics; // most songs have words
	return [
		clamp(100 - pop, 0, 100),
		clamp(energy, 0, 100),
		clamp(moodBase + (energy - 50) * 0.25, 0, 100),
		clamp((bpm - 60) / 1.2, 0, 100),
		hasLyrics ? 100 : 0,
	];
}

export function buildTasteData(
	db: Database.Database,
	members: { player_id: number; name: string }[],
): TasteBlock {
	// round → league map (for the scope marker on each row)
	const roundLeague = new Map<number, number>();
	for (const r of db
		.prepare('SELECT r.id AS round_id, s.league_id FROM rounds r JOIN seasons s ON s.id = r.season_id')
		.all() as { round_id: number; league_id: number }[]) {
		roundLeague.set(r.round_id, r.league_id);
	}

	// shared song index across all members in this block
	const songIndex = new Map<string, number>();
	const uris: string[] = [];
	const idxOf = (uri: string): number => {
		let i = songIndex.get(uri);
		if (i == null) { i = uris.length; songIndex.set(uri, i); uris.push(uri); }
		return i;
	};

	const subStmt = db.prepare(
		'SELECT spotify_uri AS uri, round_id, comment FROM ml_submissions WHERE player_id = ?',
	);
	const voteStmt = db.prepare(
		'SELECT spotify_uri AS uri, points, round_id, comment FROM votes WHERE player_id = ?',
	);

	const players: TastePlayer[] = members.map((m) => {
		const rows: TasteRow[] = [];
		for (const s of subStmt.all(m.player_id) as { uri: string; round_id: number; comment: string | null }[]) {
			rows.push([idxOf(s.uri), 0, 0, s.round_id, s.comment && s.comment.trim() ? 1 : 0, roundLeague.get(s.round_id) ?? 0]);
		}
		for (const v of voteStmt.all(m.player_id) as { uri: string; points: number; round_id: number; comment: string | null }[]) {
			rows.push([idxOf(v.uri), 1, v.points, v.round_id, v.comment && v.comment.trim() ? 1 : 0, roundLeague.get(v.round_id) ?? 0]);
		}
		return { name: m.name, rows };
	});

	// one metadata lookup for every referenced song → axes[]
	const meta = new Map<string, MetaRow>();
	const CHUNK = 400;
	for (let i = 0; i < uris.length; i += CHUNK) {
		const slice = uris.slice(i, i + CHUNK);
		const ph = slice.map(() => '?').join(',');
		for (const r of db
			.prepare(
				`SELECT sp.spotify_uri, sp.popularity_proxy, af.energy, af.bpm, af.scale, lm.has_lyrics
				 FROM song_popularity sp
				 LEFT JOIN song_audio_features af ON af.spotify_uri = sp.spotify_uri
				 LEFT JOIN song_lyrics_metrics lm ON lm.spotify_uri = sp.spotify_uri
				 WHERE sp.spotify_uri IN (${ph})`,
			)
			.all(...slice) as MetaRow[]) {
			meta.set(r.spotify_uri, r);
		}
	}
	const axes: SongAxes[] = uris.map((uri) => axesFor(meta.get(uri)));

	return { axes, players };
}
