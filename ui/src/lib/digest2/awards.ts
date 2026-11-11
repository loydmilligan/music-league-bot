import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

// Minimal read-side shapes of the bot's store (src/awards/types.ts); not imported across packages.
type Cand = { n: number; who: string; text: string; ts: string; reactions: { emoji: string }[] | null };
type StoredRound = { award: string; roundId: number; candidates: Cand[]; picks: Record<string, number | undefined>; poster?: string; postedAt?: string };
type StoredConfig = { awards: { key: string; name: string; day: number }[] };

export type RoundAward = {
	key: string;
	name: string;
	day: number;
	postedAt: string;
	/** Public relative path, awards/<file>; '' when the award has no poster. */
	poster: string;
	top3: { place: 1 | 2 | 3; who: string; text: string; when: string; emoji: string }[];
};

function readJson<T>(file: string): T | null {
	try { return JSON.parse(readFileSync(file, 'utf8')) as T; } catch { return null; }
}

const laFmt = new Intl.DateTimeFormat('en-US', {
	timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
});
export function formatLA(ts: string): string {
	const d = new Date(ts);
	if (Number.isNaN(d.getTime())) return '';
	const p = Object.fromEntries(laFmt.formatToParts(d).map((x) => [x.type, x.value]));
	return `${p.weekday} ${p.month} ${p.day} ${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/** Posted awards for a round, sorted by day. Missing/corrupt store files give []. */
export function loadRoundAwards(dataDir: string, roundId: number): RoundAward[] {
	const dir = join(dataDir, 'awards');
	const rounds = readJson<StoredRound[]>(join(dir, 'rounds.json'));
	if (!Array.isArray(rounds)) return [];
	const defs = new Map((readJson<StoredConfig>(join(dir, 'config.json'))?.awards ?? []).map((a) => [a.key, a]));
	const out: RoundAward[] = [];
	for (const r of rounds) {
		if (r.roundId !== roundId || !r.postedAt) continue;
		const def = defs.get(r.award);
		const top3: RoundAward['top3'] = [];
		for (const place of [1, 2, 3] as const) {
			const c = r.candidates?.find((x) => x.n === r.picks?.[place]);
			if (c) top3.push({ place, who: c.who, text: c.text, when: formatLA(c.ts), emoji: c.reactions?.[0]?.emoji ?? '' });
		}
		out.push({
			key: r.award,
			name: def?.name ?? r.award,
			day: def?.day ?? 0,
			postedAt: r.postedAt,
			poster: r.poster ? `awards/${basename(r.poster)}` : '',
			top3
		});
	}
	return out.sort((a, b) => a.day - b.day);
}

export function awardsDataDir(): string {
	return process.env.DATA_DIR ?? join(process.cwd(), '../data');
}
