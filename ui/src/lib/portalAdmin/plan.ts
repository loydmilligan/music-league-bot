// Portal admin — season planner derivation (spec §7.2). Pure: no DB, no I/O.
// Round dates come from the stored `Round` deadlines; a missing anchor yields a
// task with `dueAt: null` (unscheduled) rather than dropping the row, so an
// admin fixing a deadline mid-season reschedules the derived tasks on re-derive.
import type { Round, Season } from '../types.js';

export type TaskKind = 'content' | 'ops' | 'review';

export interface DerivedTask {
	leagueId: number;
	seasonNumber: number;
	key: string;
	roundNumber: number | null;
	title: string;
	detail: string | null;
	dueAt: string | null;
	kind: TaskKind;
	source: 'derived';
}

const HOUR = 36e5;
const DAY = 864e5;

function shift(iso: string | null, deltaMs: number): string | null {
	if (!iso) return null;
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return null;
	d.setTime(d.getTime() + deltaMs);
	return d.toISOString();
}

const addDays = (iso: string | null, n: number) => shift(iso, n * DAY);
const addHours = (iso: string | null, n: number) => shift(iso, n * HOUR);
const addMinutes = (iso: string | null, n: number) => shift(iso, n * 60_000);

/** Midpoint of two ISO timestamps (used for the mid-season digest). */
function midPoint(a: string | null, b: string | null): string | null {
	if (!a || !b) return null;
	const ta = new Date(a).getTime();
	const tb = new Date(b).getTime();
	if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
	return new Date((ta + tb) / 2).toISOString();
}

export function deriveTasks(season: Season, rounds: Round[]): DerivedTask[] {
	const byNum = new Map<number, Round>();
	for (const r of rounds) if (r.roundNumber != null) byNum.set(r.roundNumber, r);
	const nums = [...byNum.keys()].sort((a, b) => a - b);
	if (nums.length === 0) return [];

	const subOf = (n: number) => byNum.get(n)?.submissionDeadline ?? null;
	const voteOf = (n: number) => byNum.get(n)?.votingDeadline ?? null;
	// Voting start is ≈ submission close; where only the voting deadline is
	// known bot-ui approximates it as vote − 3 days (spec §7.2).
	const votingStart = (n: number) => subOf(n) ?? addDays(voteOf(n), -3);

	const out: DerivedTask[] = [];
	const push = (
		key: string,
		roundNumber: number | null,
		dueAt: string | null,
		title: string,
		kind: TaskKind
	) => {
		out.push({
			leagueId: season.leagueId,
			seasonNumber: season.seasonNumber,
			key,
			roundNumber,
			title,
			detail: null,
			dueAt,
			kind,
			source: 'derived',
		});
	};

	const first = nums[0];
	const last = nums[nums.length - 1];

	// Season start — everyone is in Music League for this season: R1 sub − 2 d.
	push('season.start', null, addDays(subOf(first), -2),
		'Season start — everyone is in Music League for this season', 'ops');

	for (const n of nums) {
		const sub = subOf(n);
		const vote = voteOf(n);
		const vs = votingStart(n);

		push(`r${n}.submission`, n, sub, 'Make sure everyone meets the submission deadline', 'ops');
		push(`r${n}.voting-rules`, n, vs, 'Update everyone on the voting rules', 'content');
		push(`r${n}.capture-spotify`, n, addHours(vs, 1), 'Capture the Spotify playlist', 'ops');
		push(`r${n}.ytm-playlist`, n, addHours(vs, 3),
			'Create the YouTube Music playlist (refresh the YouTube refresh token first)', 'ops');
		push(`r${n}.digest-lede`, n, addMinutes(vote, 15),
			`Have the ML bot generate the ledes for digest ${n}`, 'content');
		push(`r${n}.digest-generate`, n, addHours(vote, 1), `Generate digest ${n}`, 'content');
		push(`r${n}.digest-edit`, n, addDays(vote, 1), `Edit digest ${n}`, 'content');
		push(`r${n}.next-theme`, n, addDays(vote, -3), `Check on the round ${n + 1} theme`, 'ops');
		push(`r${n}.mlbot-email`, n, addMinutes(vote, 15),
			'Confirm the Music League round-end email triggered the bot\'s digest job', 'ops');
		push(`r${n}.round-review`, n, subOf(n + 1),
			`Round ${n} process/workflow review — look for ways to improve`, 'review');

		const next = byNum.get(n + 1);
		if (next) {
			push(`r${n}.next-reveal`, n, addHours(subOf(n + 1), -1),
				`Reveal the hidden theme for round ${n + 1} at the right time`, 'content');
			// Only survey-app rounds carry a theme survey; skip otherwise.
			if (next.managedBy) {
				push(`r${n}.next-survey`, n, addDays(subOf(n + 1), -2),
					`Set up the round ${n + 1} theme survey (when the round has one)`, 'content');
			}
		}
	}

	push('season.midseason', null, midPoint(subOf(first), voteOf(last)), 'Mid-season digest', 'content');
	push('season.yearbook', null, addDays(voteOf(last), 3), 'Yearbook awards for the season', 'content');
	push('season.wrap', null, addDays(voteOf(last), 5),
		'Season wrap — publish the b-side for the season', 'content');

	return out;
}