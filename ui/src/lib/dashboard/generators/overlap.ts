import type Database from 'better-sqlite3';
import { z } from 'zod';

// ── Slice types ─────────────────────────────────────────────────────────────────

export const PeerScoreSchema = z.object({
	who: z.string(),
	pct: z.number().int().min(0).max(100),
	label: z.string(),
});
export type PeerScore = z.infer<typeof PeerScoreSchema>;

export const OverlapSliceSchema = z.object({
	voteTogether: z.array(PeerScoreSchema),
	tasteTwins: z.array(PeerScoreSchema),
});
export type OverlapSlice = z.infer<typeof OverlapSliceSchema>;

// ── Internal row types ─────────────────────────────────────────────────────────

interface MemberRow {
	player_id: number;
	player_name: string;
}

interface SubRoundRow {
	player_id: number;
	round_id: number;
}

interface CrossVoteRow {
	round_id: number;
	voter_player_id: number;
	sub_player_id: number;
}

interface FingerprintRow {
	player_id: number;
	taste_fingerprint: string | null;
}

interface ParsedFingerprint {
	signature_artists: string[];
	genres: string[];
	eras: string[];
	rewards: string[];
	punishes: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseFingerprint(raw: string | null): ParsedFingerprint | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as ParsedFingerprint;
		return parsed;
	} catch {
		return null;
	}
}

function jaccardLower(a: string[], b: string[]): number {
	const aSet = new Set(a.map((x) => x.toLowerCase()));
	const bSet = new Set(b.map((x) => x.toLowerCase()));
	if (aSet.size === 0 && bSet.size === 0) return 0;
	let intersectionSize = 0;
	for (const v of aSet) {
		if (bSet.has(v)) intersectionSize++;
	}
	const unionSize = aSet.size + bSet.size - intersectionSize;
	return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

function fingerprintSimilarity(a: ParsedFingerprint, b: ParsedFingerprint): number {
	// Weighted Jaccard across fingerprint fields: artists and genres carry more signal.
	const fields: Array<[string[], string[], number]> = [
		[a.signature_artists, b.signature_artists, 3],
		[a.genres, b.genres, 2],
		[a.rewards, b.rewards, 2],
		[a.punishes, b.punishes, 1],
		[a.eras, b.eras, 1],
	];
	let totalWeight = 0;
	let weightedSum = 0;
	for (const [aList, bList, w] of fields) {
		weightedSum += jaccardLower(aList, bList) * w;
		totalWeight += w;
	}
	return totalWeight === 0 ? 0 : weightedSum / totalWeight;
}

function voteTogetherLabel(pct: number): string {
	if (pct >= 75) return 'vote as a bloc';
	if (pct >= 55) return 'quiet alliance';
	if (pct >= 35) return 'occasional allies';
	return 'curious about each other';
}

function tasteTwinsLabel(pct: number): string {
	if (pct >= 70) return 'kindred ears';
	if (pct >= 50) return 'same wavelength';
	if (pct >= 30) return 'find common ground';
	return 'passing intersection';
}

// ── Main ───────────────────────────────────────────────────────────────────────

/**
 * Compute per-member Vote Together + Taste Twins overlap for a league.
 *
 * Returns a Map<player_id, OverlapSlice> for every member who submitted in the league.
 *
 * Vote Together: in rounds where both members submitted, the fraction where they
 * gave each other positive points (mutual). Pairs with zero shared rounds are
 * omitted entirely — no fake low percentages.
 *
 * Taste Twins: weighted Jaccard similarity across taste_fingerprint fields
 * (artists, genres, rewards, punishes, eras). Independent of shared rounds —
 * two players who never overlapped can still be fingerprint twins.
 */
export function buildOverlap(
	db: Database.Database,
	leagueId: number,
): Map<number, OverlapSlice> {
	// 1. Members: players who submitted in this league (requires competitor→player link)
	const members = db
		.prepare(
			`SELECT DISTINCT p.id AS player_id, p.name AS player_name
       FROM players p
       JOIN competitors c ON c.player_id = p.id
       JOIN ml_submissions s ON s.competitor_id = c.id
       JOIN rounds r ON r.id = s.round_id
       JOIN seasons se ON se.id = r.season_id
       WHERE se.league_id = ?
         AND s.competitor_id IS NOT NULL`,
		)
		.all(leagueId) as MemberRow[];

	if (members.length < 2) {
		return new Map(members.map((m) => [m.player_id, { voteTogether: [], tasteTwins: [] }]));
	}

	const memberIds = new Set(members.map((m) => m.player_id));

	// 2. Which (player, round) pairs exist as submissions in this league
	const subRoundRows = db
		.prepare(
			`SELECT DISTINCT c.player_id, s.round_id
       FROM ml_submissions s
       JOIN competitors c ON c.id = s.competitor_id
       JOIN rounds r ON r.id = s.round_id
       JOIN seasons se ON se.id = r.season_id
       WHERE se.league_id = ?
         AND s.competitor_id IS NOT NULL
         AND c.player_id IS NOT NULL`,
		)
		.all(leagueId) as SubRoundRow[];

	const submittedRounds = new Map<number, Set<number>>();
	for (const row of subRoundRows) {
		if (!memberIds.has(row.player_id)) continue;
		let set = submittedRounds.get(row.player_id);
		if (!set) {
			set = new Set();
			submittedRounds.set(row.player_id, set);
		}
		set.add(row.round_id);
	}

	// 3. Positive cross-votes in this league: voter→submitter, positive points only
	const crossVoteRows = db
		.prepare(
			`SELECT v.round_id,
              cv.player_id AS voter_player_id,
              cs.player_id AS sub_player_id
       FROM votes v
       JOIN competitors cv ON cv.id = v.voter_id
       JOIN ml_submissions s ON s.round_id = v.round_id AND s.spotify_uri = v.spotify_uri
       JOIN competitors cs ON cs.id = s.competitor_id
       JOIN rounds r ON r.id = v.round_id
       JOIN seasons se ON se.id = r.season_id
       WHERE se.league_id = ?
         AND cv.player_id IS NOT NULL
         AND cs.player_id IS NOT NULL
         AND s.competitor_id IS NOT NULL
         AND v.points > 0
         AND cv.player_id != cs.player_id`,
		)
		.all(leagueId) as CrossVoteRow[];

	// Encode as "voter:sub:round" for O(1) lookup
	const positiveVotes = new Set<string>();
	for (const row of crossVoteRows) {
		if (!memberIds.has(row.voter_player_id) || !memberIds.has(row.sub_player_id)) continue;
		positiveVotes.add(`${row.voter_player_id}:${row.sub_player_id}:${row.round_id}`);
	}

	// 4. Fingerprints for all members (built from all leagues — global fingerprint)
	const fpPlaceholders = members.map(() => '?').join(',');
	const fpRows = db
		.prepare(
			`SELECT player_id, taste_fingerprint
       FROM player_profiles
       WHERE player_id IN (${fpPlaceholders})`,
		)
		.all(...members.map((m) => m.player_id)) as FingerprintRow[];

	const fingerprints = new Map<number, ParsedFingerprint>();
	for (const row of fpRows) {
		const fp = parseFingerprint(row.taste_fingerprint);
		if (fp) fingerprints.set(row.player_id, fp);
	}

	// 5. Pairwise computation
	const result = new Map<number, OverlapSlice>();
	for (const m of members) {
		result.set(m.player_id, { voteTogether: [], tasteTwins: [] });
	}

	for (let i = 0; i < members.length; i++) {
		for (let j = i + 1; j < members.length; j++) {
			const a = members[i];
			const b = members[j];

			// ── Vote Together ──────────────────────────────────────────────────
			const aRounds = submittedRounds.get(a.player_id) ?? new Set<number>();
			const bRounds = submittedRounds.get(b.player_id) ?? new Set<number>();
			const sharedRounds: number[] = [];
			for (const r of aRounds) {
				if (bRounds.has(r)) sharedRounds.push(r);
			}

			if (sharedRounds.length > 0) {
				let mutualCount = 0;
				for (const r of sharedRounds) {
					const aGaveB = positiveVotes.has(`${a.player_id}:${b.player_id}:${r}`);
					const bGaveA = positiveVotes.has(`${b.player_id}:${a.player_id}:${r}`);
					if (aGaveB && bGaveA) mutualCount++;
				}
				const pct = Math.round((mutualCount / sharedRounds.length) * 100);
				const aSlice = result.get(a.player_id)!;
				const bSlice = result.get(b.player_id)!;
				aSlice.voteTogether.push({ who: b.player_name, pct, label: voteTogetherLabel(pct) });
				bSlice.voteTogether.push({ who: a.player_name, pct, label: voteTogetherLabel(pct) });
			}
			// pairs with zero shared rounds → omitted from voteTogether entirely

			// ── Taste Twins ───────────────────────────────────────────────────
			const fpA = fingerprints.get(a.player_id);
			const fpB = fingerprints.get(b.player_id);
			if (fpA && fpB) {
				const similarity = fingerprintSimilarity(fpA, fpB);
				const pct = Math.round(similarity * 100);
				const aSlice = result.get(a.player_id)!;
				const bSlice = result.get(b.player_id)!;
				aSlice.tasteTwins.push({ who: b.player_name, pct, label: tasteTwinsLabel(pct) });
				bSlice.tasteTwins.push({ who: a.player_name, pct, label: tasteTwinsLabel(pct) });
			}
		}
	}

	// Sort each list by pct descending (best match first)
	for (const slice of result.values()) {
		slice.voteTogether.sort((x, y) => y.pct - x.pct);
		slice.tasteTwins.sort((x, y) => y.pct - x.pct);
	}

	return result;
}
