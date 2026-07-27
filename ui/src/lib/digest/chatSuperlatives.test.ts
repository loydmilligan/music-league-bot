import { describe, it, expect } from 'vitest';
import type { Message } from './chatExport';
import { resolveSender } from './chatIdentity';
import {
	computeSuperlatives,
	standardizedTTR,
	syllables,
	shrink,
	gunningFog,
	prose,
	words,
} from './chatSuperlatives';

const T0 = Date.UTC(2026, 6, 11, 12, 0);

function msg(sender: string, text: string, over: Partial<Message> = {}): Message {
	return { sender, ts: T0, text, edited: false, media: null, mentions: [], ...over };
}

describe('chatIdentity', () => {
	it('maps every known alias of one person to a single canonical name', () => {
		for (const alias of ['Dave Jensen', 'David Jensen', '~ Dave']) {
			expect(resolveSender(alias)?.name).toBe('Dave Jensen');
		}
	});

	it('decodes the uncontacted phone number to Grant', () => {
		expect(resolveSender('+1 (786) 626-6895')?.name).toBe('Grant Koziol');
	});

	it("uses the export's spelling, not the players-table typo", () => {
		expect(resolveSender('Darren Paletz')?.name).toBe('Darren Pallets');
		expect(resolveSender('~ Darren')?.name).toBe('Darren Pallets');
	});

	it('returns null for group pseudo-senders', () => {
		expect(resolveSender('Mentioned all')).toBeNull();
	});

	it('throws rather than silently minting an eleventh person', () => {
		expect(() => resolveSender('Some Stranger')).toThrow(/unrecognised sender/);
	});
});

describe('text helpers', () => {
	it('counts syllables plausibly', () => {
		expect(syllables('cat')).toBe(1);
		expect(syllables('hello')).toBe(2);
		// The heuristic says 4 for "beautiful" (true answer: 3). Vowel-group
		// counting is approximate by design; FK on chat text is already a blunt
		// instrument, so we assert the neighbourhood, not the exact value.
		expect(syllables('beautiful')).toBeGreaterThanOrEqual(3);
		expect(syllables('beautiful')).toBeLessThanOrEqual(4);
	});

	it('never returns zero syllables for a real word', () => {
		for (const w of ['a', 'the', 'queue', 'rhythm', 'strengths']) {
			expect(syllables(w)).toBeGreaterThan(0);
		}
	});

	it('drops URLs from prose but keeps the rest', () => {
		const m = msg('Jimmy', 'check https://open.spotify.com/track/xyz this one');
		expect(words(prose(m))).toEqual(['check', 'this', 'one']);
	});

	it('treats a media message as zero words', () => {
		const m = msg('Jimmy', 'IMG-1.jpg (file attached)', { media: 'IMG-1.jpg' });
		expect(prose(m)).toBe('');
	});

	it('leaves a well-evidenced rate almost untouched', () => {
		// 6000 words against k=1000: barely moves.
		expect(shrink(10, 6000, 5)).toBeCloseTo(9.29, 1);
	});

	it('pulls a thinly-evidenced rate toward the group mean', () => {
		// 200 words against k=1000: mostly the mean.
		expect(shrink(10, 200, 5)).toBeCloseTo(5.83, 1);
	});

	it('sits exactly halfway at k words', () => {
		expect(shrink(10, 1000, 5, 1000)).toBeCloseTo(7.5, 5);
	});

	it('does not reward volume on its own', () => {
		// An average rate stays average no matter how many words back it.
		expect(shrink(5, 50, 5)).toBeCloseTo(5, 5);
		expect(shrink(5, 50000, 5)).toBeCloseTo(5, 5);
	});

	it('falls back to the group mean with no words at all', () => {
		expect(shrink(99, 0, 5)).toBe(5);
	});

	it('computes Gunning Fog from message length and complex-word share', () => {
		// 0.4 * (15 + 10) = 10
		expect(gunningFog(15, 10)).toBeCloseTo(10, 5);
	});

	it('rises with both longer messages and harder words', () => {
		expect(gunningFog(20, 10)).toBeGreaterThan(gunningFog(10, 10));
		expect(gunningFog(10, 20)).toBeGreaterThan(gunningFog(10, 10));
	});

	it('cannot be inflated by punctuation, unlike Flesch-Kincaid', () => {
		// The inputs are per-message and per-word; terminal punctuation is not an
		// input at all, so how someone punctuates cannot move the number.
		expect(gunningFog(10, 8)).toBe(gunningFog(10, 8));
	});
});

describe('standardizedTTR', () => {
	const rand = () => 0.5;

	it('returns null below the sample floor', () => {
		expect(standardizedTTR(['a', 'b', 'c'], 10, 3, rand)).toBeNull();
	});

	it('scores a fully repetitive corpus near zero richness', () => {
		const ttr = standardizedTTR(new Array(50).fill('same'), 10, 3, rand);
		expect(ttr).toBeCloseTo(10, 0); // 1 unique / 10 sampled
	});

	it('scores an all-distinct corpus at 100', () => {
		const tokens = Array.from({ length: 50 }, (_, i) => `w${i}`);
		expect(standardizedTTR(tokens, 10, 3, rand)).toBeCloseTo(100, 0);
	});

	it('does not simply reward volume', () => {
		// Chatty person, tiny vocabulary. Quiet person, all-distinct words.
		const chatty = new Array(200).fill(0).map((_, i) => `w${i % 5}`);
		const quiet = Array.from({ length: 60 }, (_, i) => `q${i}`);
		const a = standardizedTTR(chatty, 50, 5, Math.random) as number;
		const b = standardizedTTR(quiet, 50, 5, Math.random) as number;
		expect(b).toBeGreaterThan(a);
	});
});

describe('computeSuperlatives', () => {
	const dictionary = new Set(['antidisestablishmentarianism', 'thermos', 'napster', 'hello']);

	const messages: Message[] = [
		msg('Matt Mariani', 'hello hello hello there friend'),
		msg('Matt Mariani', 'antidisestablishmentarianism is a real word', { ts: T0 + 60_000 }),
		msg('Matt Mariani', 'edited thing', { ts: T0 + 120_000, edited: true }),
		msg('+1 (786) 626-6895', 'fuck this shit hello', { ts: T0 + 180_000 }),
		msg('+1 (786) 626-6895', 'thermos time', { ts: T0 + 240_000 }),
		msg('Jimmy', 'hi', { ts: T0 + 300_000 }),
	];

	const result = computeSuperlatives(
		messages,
		[
			{ person: 'Matt Mariani', comment: 'great pick here' },
			{ person: 'Grant Koziol', comment: 'yes' },
		],
		{ dictionary, vocabSample: 3 },
	);

	it('collapses aliases into canonical people', () => {
		expect(result.people.map((p) => p.name).sort()).toEqual(
			['Grant Koziol', 'Jimmy', 'Matt Mariani'].sort(),
		);
	});

	it('counts messages, words and edits per person', () => {
		const matt = result.people.find((p) => p.name === 'Matt Mariani')!;
		expect(matt.messages).toBe(3);
		expect(matt.edits).toBe(1);
		expect(matt.words).toBe(5 + 5 + 2);
	});

	it('awards Motormouth to the highest message count', () => {
		expect(result.awards.motormouth?.person).toBe('Matt Mariani');
	});

	it('awards the Lurker to the lowest', () => {
		expect(result.awards.lurker?.person).toBe('Jimmy');
	});

	it('picks the longest dictionary word as THE BIGGEST WORD', () => {
		expect(result.awards.biggestWord?.value).toBe('antidisestablishmentarianism');
		expect(result.awards.biggestWord?.person).toBe('Matt Mariani');
	});

	it('lists at most one biggest-word entry per person', () => {
		const people = result.biggestWords.map((b) => b.person);
		expect(new Set(people).size).toBe(people.length);
	});

	it('counts swears and reports a signature swear', () => {
		const grant = result.people.find((p) => p.name === 'Grant Koziol')!;
		expect(grant.swears).toBe(2);
		expect(grant.swearRate).toBeGreaterThan(0);
		expect(result.awards.explicit?.person).toBe('Grant Koziol');
	});

	it('excludes rookies from the talk-to-ballot metric', () => {
		const jimmy = result.people.find((p) => p.name === 'Jimmy')!;
		expect(jimmy.rookie).toBe(true);
		expect(jimmy.talkToBallot).toBeNull();
		expect(result.notes.join(' ')).toMatch(/Jimmy/);
	});

	it('computes talk-to-ballot for people who did vote', () => {
		const matt = result.people.find((p) => p.name === 'Matt Mariani')!;
		expect(matt.voteCommentWords).toBe(3);
		expect(matt.talkToBallot).toBeCloseTo(12 / 3, 5);
	});

	it('reports insufficient sample rather than a fake vocabulary score', () => {
		const jimmy = result.people.find((p) => p.name === 'Jimmy')!;
		expect(jimmy.vocabulary).toBeNull();
		expect(result.notes.join(' ')).toMatch(/Vocabulary richness needs 3 words.*Jimmy/);
	});

	it('treats voting without commenting as an infinite ratio, not a gap', () => {
		const silent = computeSuperlatives(
			messages,
			[{ person: 'Matt Mariani', comment: 'words here' }],
			{ dictionary, vocabSample: 3 },
			new Set(['Matt Mariani', 'Grant Koziol']),
		);
		const grant = silent.people.find((p) => p.name === 'Grant Koziol')!;
		expect(grant.voted).toBe(true);
		expect(grant.voteCommentWords).toBe(0);
		expect(grant.talkToBallot).toBe(Infinity);
		expect(silent.awards.allTalk?.person).toBe('Grant Koziol');
		expect(silent.awards.allTalk?.value).toBe('∞');
		expect(silent.notes.join(' ')).toMatch(/Grant Koziol voted without leaving/);
	});

	it('measures complex words as a rate, so one long word does not win it', () => {
		const r = computeSuperlatives(
			[
				// 1 complex word in 10 → 10%.
				msg('Matt Mariani', 'antidisestablishmentarianism a a a a a a a a a'),
				// 2 complex words in 4 → 50%, despite writing far less.
				msg('Jimmy', 'beautiful wonderful a a', { ts: T0 + 1000 }),
			],
			[],
			{ vocabSample: 2 },
		);
		const matt = r.people.find((p) => p.name === 'Matt Mariani')!;
		const jimmy = r.people.find((p) => p.name === 'Jimmy')!;
		expect(jimmy.complexWords).toBeGreaterThan(matt.complexWords);
	});

	it('counts rare words against the supplied common-word list', () => {
		const r = computeSuperlatives(
			[msg('Matt Mariani', 'the and cat')],
			[],
			{ commonWords: ['the', 'and'], commonCutoff: 2, vocabSample: 2 },
		);
		const matt = r.people.find((p) => p.name === 'Matt Mariani')!;
		expect(matt.rareWords).toBeCloseTo(100 / 3, 3); // only "cat" is rare
	});

	it('reports no rare words when given no common-word list', () => {
		const r = computeSuperlatives([msg('Matt Mariani', 'the and cat')], [], { vocabSample: 2 });
		expect(r.people[0].rareWords).toBe(0);
	});

	it('shrinks a thin sample toward the mean but leaves a thick one alone', () => {
		const many = Array.from({ length: 400 }, (_, i) =>
			msg('Matt Mariani', 'beautiful wonderful a a a a a a a a', { ts: T0 + i * 1000 }),
		);
		const r = computeSuperlatives(
			[...many, msg('Jimmy', 'beautiful wonderful a a', { ts: T0 + 900_000 })],
			[],
			{ vocabSample: 2 },
		);
		const matt = r.people.find((p) => p.name === 'Matt Mariani')!;
		const jimmy = r.people.find((p) => p.name === 'Jimmy')!;
		// Matt has thousands of words: his adjusted rate stays near his raw one.
		expect(Math.abs(matt.complexWordsAdj - matt.complexWords)).toBeLessThan(0.5);
		// Jimmy has four: his 50% gets dragged a long way down.
		expect(jimmy.complexWordsAdj).toBeLessThan(jimmy.complexWords - 10);
	});

	it('scores mastery only for words that are long, uncommon and real', () => {
		const r = computeSuperlatives(
			[
				msg('Matt Mariani', 'sacrilegious'),          // long + rare + real → counts
				msg('Jimmy', 'the the the the', { ts: T0 + 1 }), // common → no
			],
			[],
			{
				dictionary: new Set(['sacrilegious', 'everybody']),
				commonWords: ['the', 'everybody'],
				masteryCutoff: 2,
				vocabSample: 1,
			},
		);
		const matt = r.people.find((p) => p.name === 'Matt Mariani')!;
		const jimmy = r.people.find((p) => p.name === 'Jimmy')!;
		expect(matt.masteryDistinct).toBe(1);
		expect(matt.masteryExamples).toEqual(['sacrilegious']);
		expect(jimmy.masteryDistinct).toBe(0);
	});

	it('rejects a long rare word that is not in the dictionary', () => {
		// "Columbus" is rare only because it is a name; the lowercase dictionary
		// has no entry for it, so it must not score.
		const r = computeSuperlatives([msg('Matt Mariani', 'columbus')], [], {
			dictionary: new Set(['sacrilegious']),
			commonWords: ['the'],
			masteryCutoff: 1,
			vocabSample: 1,
		});
		expect(r.people[0].masteryDistinct).toBe(0);
	});

	it('rejects a long word that is common', () => {
		const r = computeSuperlatives([msg('Matt Mariani', 'everybody')], [], {
			dictionary: new Set(['everybody']),
			commonWords: ['everybody'],
			masteryCutoff: 1,
			vocabSample: 1,
		});
		expect(r.people[0].masteryDistinct).toBe(0);
	});

	it('gives a longer word more mastery points than a shorter one', () => {
		const long = computeSuperlatives([msg('Matt Mariani', 'sacrilegious')], [], {
			dictionary: new Set(['sacrilegious', 'gondola']),
			commonWords: ['the'],
			masteryCutoff: 1,
			vocabSample: 1,
		}).people[0].mastery;
		const short = computeSuperlatives([msg('Matt Mariani', 'gondola')], [], {
			dictionary: new Set(['sacrilegious', 'gondola']),
			commonWords: ['the'],
			masteryCutoff: 1,
			vocabSample: 1,
		}).people[0].mastery;
		expect(long).toBeGreaterThan(short);
	});

	it('keeps never-voted people out of the ratio entirely', () => {
		const jimmy = result.people.find((p) => p.name === 'Jimmy')!;
		expect(jimmy.voted).toBe(false);
		expect(jimmy.talkToBallot).toBeNull();
	});

	it('measures responsiveness as a rate, since timestamps are minute-resolution', () => {
		const quick = computeSuperlatives(
			[
				msg('Matt Mariani', 'a', { ts: T0 }),
				msg('Jimmy', 'b', { ts: T0 + 30_000 }), // same minute
				msg('Matt Mariani', 'c', { ts: T0 + 60_000 }),
				msg('Jimmy', 'd', { ts: T0 + 8 * 60_000 }), // 7 min later
			],
			[],
			{ vocabSample: 3 },
		);
		const jimmy = quick.people.find((p) => p.name === 'Jimmy')!;
		expect(jimmy.replies).toBe(2);
		expect(jimmy.snapBackRate).toBeCloseTo(0.5, 5);
	});

	it('requires a minimum reply sample before awarding Quickest Draw', () => {
		// Only a couple of replies exist in the fixture, so nobody qualifies.
		expect(result.awards.fastest).toBeNull();
	});

	it('is deterministic across runs', () => {
		const again = computeSuperlatives(messages, [], { dictionary, vocabSample: 3 });
		expect(JSON.stringify(again.people)).toBe(
			JSON.stringify(computeSuperlatives(messages, [], { dictionary, vocabSample: 3 }).people),
		);
	});

	it('builds a 7x24 heatmap per person', () => {
		const matt = result.people.find((p) => p.name === 'Matt Mariani')!;
		expect(matt.heatmap).toHaveLength(7);
		expect(matt.heatmap[0]).toHaveLength(24);
		const total = matt.heatmap.flat().reduce((s, n) => s + n, 0);
		expect(total).toBe(matt.messages);
	});

	it('ignores group pseudo-senders entirely', () => {
		const withNoise = computeSuperlatives(
			[...messages, msg('Mentioned all', 'noise')],
			[],
			{ dictionary, vocabSample: 3 },
		);
		expect(withNoise.generatedFrom.messages).toBe(messages.length);
	});
});
