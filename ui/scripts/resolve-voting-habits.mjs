#!/usr/bin/env node
/**
 * resolve-voting-habits — compute the "Read the Room" data contract from live
 * votes: the season-long pairwise voter→submitter matrix, a PER-ROUND pairwise
 * matrix (for the Heat Ledger's round filter), and the per-person-per-round
 * consensus-deviation ("contrarian") signal.
 *
 * Writes ui/scripts/voting-habits.json, folded into the Tape by
 * build-chat-superlatives.mjs. Deliberately separate from chat-superlatives
 * (that's chat text; this is Music League vote data) but same "own all I/O,
 * emit inspectable JSON" shape.
 *
 *   node ui/scripts/resolve-voting-habits.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createJiti } from 'jiti';

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(UI, '..');
const jiti = createJiti(import.meta.url);
const { PEOPLE } = await jiti.import(path.join(UI, 'src/lib/digest/chatIdentity.ts'));

const LEAGUE_ID = 5; // Boarz II Men
const OUT = path.join(UI, 'scripts/voting-habits.json');

// Evenly-spaced hues + first-name labels, per CD's handoff (README.md,
// design_handoff_vote_habits) — the canonical roster/identity contract.
const ROSTER_META = {
	'Clements Johnson': { first: 'Clements', hue: 15 },
	'Conor Johnston': { first: 'Conor', hue: 50 },
	'Darren Pallets': { first: 'Darren', hue: 85 },
	'Dave Jensen': { first: 'Dave J', hue: 120 },
	'Dave Steingart': { first: 'Dave S', hue: 155 },
	'Grant Koziol': { first: 'Grant', hue: 190 },
	Jimmy: { first: 'Jimmy', hue: 225 },
	'Jon Black': { first: 'Jon', hue: 260 },
	'Matt Mariani': { first: 'Matt', hue: 300 },
	'Shane Farkas': { first: 'Shane', hue: 335 },
};

const db = new Database(path.join(ROOT, 'data/league.db'), { readonly: true });
const byCid = new Map(PEOPLE.filter((p) => p.mlCompetitorId).map((p) => [p.mlCompetitorId, p.name]));
const people = [...new Set(PEOPLE.filter((p) => p.mlCompetitorId).map((p) => p.name))].sort(
	(a, b) => (ROSTER_META[a]?.hue ?? 0) - (ROSTER_META[b]?.hue ?? 0),
);
const roster = people.map((n) => ({ name: n, first: ROSTER_META[n]?.first ?? n.split(' ')[0], hue: ROSTER_META[n]?.hue ?? 0 }));

const raw = db
	.prepare(
		`SELECT v.round_id, r.name AS round_name, r.voting_deadline, v.spotify_uri, v.points,
		        vc.ml_competitor_id AS voter_cid, sc.ml_competitor_id AS sub_cid
		   FROM votes v
		   JOIN rounds r ON r.id = v.round_id
		   JOIN seasons se ON se.id = r.season_id
		   LEFT JOIN competitors vc ON vc.id = v.voter_id
		   LEFT JOIN ml_submissions s ON s.round_id = v.round_id AND s.spotify_uri = v.spotify_uri
		   LEFT JOIN competitors sc ON sc.id = s.competitor_id
		  WHERE se.league_id = ?
		  ORDER BY r.voting_deadline`,
	)
	.all(LEAGUE_ID);
db.close();

// Resolve names; exclude the "commented on own song" 0-point placeholder rows.
const votes = raw
	.map((r) => ({ ...r, voter: byCid.get(r.voter_cid), sub: byCid.get(r.sub_cid) }))
	.filter((r) => r.voter && r.sub && r.voter !== r.sub);

// ── rounds, in chronological (voting_deadline) order ────────────────────────
const roundOrder = [];
const seen = new Set();
for (const v of votes) {
	if (seen.has(v.round_id)) continue;
	seen.add(v.round_id);
	roundOrder.push({ id: v.round_id, name: v.round_name });
}
// Short labels for chart axes — a manual map beats a lossy truncation heuristic.
const SHORT = {
	'I Heard It Through the Napster': 'Napster',
	'¡No Entiendo, Cabron!': 'No Entiendo',
	'Boner Jamz': 'Boner Jamz',
	'I Hope You Shit Your Pants at Target': 'Target',
	'Smells Like Teen Cousin Fuckers': 'Teen Cousin',
	'Surrender Monkeys': 'Surrender',
};
const rounds = roundOrder.map((r) => ({ ...r, short: SHORT[r.name] ?? r.name.slice(0, 10) }));

// ── season-long pairwise matrix ─────────────────────────────────────────────
function buildPairwise(voteSubset) {
	const cell = () => ({ up: 0, down: 0, net: 0, count: 0 });
	const m = {};
	for (const a of people) { m[a] = {}; for (const b of people) if (a !== b) m[a][b] = cell(); }
	for (const v of voteSubset) {
		const c = m[v.voter][v.sub];
		c.count++;
		c.net += v.points;
		if (v.points > 0) c.up += v.points;
		if (v.points < 0) c.down += Math.abs(v.points);
	}
	const pairs = [];
	for (const a of people) for (const b of people) {
		if (a === b) continue;
		const c = m[a][b];
		pairs.push({
			from: a, to: b, upvotePoints: c.up, downvotePoints: c.down,
			netPoints: c.net, ballotCount: c.count,
			leanScorePerBallot: c.count ? +(c.net / c.count).toFixed(2) : null,
		});
	}
	return pairs;
}

const pairwiseSeason = buildPairwise(votes);
const pairwiseByRound = {};
for (const r of rounds) pairwiseByRound[r.id] = buildPairwise(votes.filter((v) => v.round_id === r.id));

// ── contrarian-by-round (consensus deviation) ───────────────────────────────
const bySong = new Map();
for (const v of votes) {
	const key = v.round_id + '|' + v.spotify_uri;
	if (!bySong.has(key)) bySong.set(key, []);
	bySong.get(key).push(v);
}
const perRoundPerson = new Map();
for (const ballots of bySong.values()) {
	if (ballots.length < 2) continue;
	const total = ballots.reduce((s, b) => s + b.points, 0);
	for (const b of ballots) {
		const consensusExclSelf = (total - b.points) / (ballots.length - 1);
		const deviation = b.points - consensusExclSelf;
		const rk = b.round_id + '|' + b.voter;
		if (!perRoundPerson.has(rk)) perRoundPerson.set(rk, { round_id: b.round_id, person: b.voter, deviations: [] });
		perRoundPerson.get(rk).deviations.push(deviation);
	}
}
// signed[personIdx][roundIdx] = avgSignedDeviation or null if they didn't vote that round.
const personIdx = Object.fromEntries(people.map((p, i) => [p, i]));
const csigned = people.map(() => rounds.map(() => null));
const cabsAccum = people.map(() => []);
for (const { round_id, person, deviations } of perRoundPerson.values()) {
	const ri = rounds.findIndex((r) => r.id === round_id);
	const pi = personIdx[person];
	if (ri < 0 || pi === undefined) continue;
	const n = deviations.length;
	const signed = +(deviations.reduce((s, d) => s + d, 0) / n).toFixed(2);
	const abs = +(deviations.reduce((s, d) => s + Math.abs(d), 0) / n).toFixed(2);
	csigned[pi][ri] = signed;
	cabsAccum[pi].push(abs);
}
const cabs = cabsAccum.map((arr) => (arr.length ? +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2) : 0));

const out = {
	note:
		"Real Boarz II Men (league_id=5) voting data across all completed rounds. roster is ordered/colored per the CD handoff's identity table. pairwiseSeason = season-long voter->submitter matrix. pairwiseByRound[roundId] = the same shape restricted to one round's ballots (for the Heat Ledger's round filter). Both include leanScorePerBallot AND raw netPoints/ballotCount so a tooltip can show the actual number, not just a qualitative read. contrarian.csigned[personIndex][roundIndex] = that person's avg deviation from each song's consensus that round (null = didn't vote); contrarian.cabs[personIndex] = season-average absolute deviation ('maverick' score). Self-submission 0-point comment rows are excluded (not a preference signal).",
	league: { name: 'Boarz II Men', season: 1, roundsCounted: rounds.length },
	roster,
	rounds,
	pairwiseSeason,
	pairwiseByRound,
	contrarian: { csigned, cabs },
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.error(
	`[ok] ${path.relative(ROOT, OUT)} — ${roster.length} people, ${rounds.length} rounds, ` +
		`${pairwiseSeason.length} season pairs, ${votes.length} ballots counted`,
);
