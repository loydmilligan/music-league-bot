import { it, expect, describe, vi, beforeEach } from 'vitest';
import {
	NO_STRIFE_CONSTRAINT,
	ACCENT_VALUES,
	playerSuperlativesTask,
	PlayerSuperlativesOutputSchema,
	fanHaterBlurbTask,
	FanHaterBlurbOutputSchema,
	leagueReelTask,
	LeagueReelOutputSchema,
	momentLinesTask,
	MomentLinesOutputSchema,
} from './narrative.js';
import type {
	PlayerSuperlativesInput,
	FanHaterBlurbInput,
	LeagueReelInput,
	MomentLinesInput,
} from './narrative.js';

// ── Stub callOpenRouter (no real spend) ───────────────────────────────────────

vi.mock('../../digest/llm.js', () => ({
	callOpenRouter: vi.fn(),
}));

import { callOpenRouter } from '../../digest/llm.js';
const mockCallOpenRouter = vi.mocked(callOpenRouter);

beforeEach(() => {
	vi.clearAllMocks();
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXTURE_FINGERPRINT = {
	signature_artists: ['The Cure', 'Massive Attack', 'Portishead'],
	genres: ['post-punk', 'trip-hop', 'dream pop'],
	eras: ['90s', '80s'],
	rewards: ['atmospheric production', 'strong basslines', 'emotional depth'],
	punishes: ['mainstream pop', 'overproduced radio sound'],
	summary: 'A player drawn to dark, atmospheric sounds from the post-punk and trip-hop worlds.',
	confidence: 'medium' as const,
};

const FIXTURE_PLAYER_INPUT: PlayerSuperlativesInput = {
	playerName: 'Marisol',
	leagueName: 'Fam-Jam',
	fingerprint: FIXTURE_FINGERPRINT,
	stat: { submitted: 14, avgPts: 9.1, wins: 3 },
};

const FIXTURE_SUPERLATIVES_OUTPUT = {
	superlatives: [
		{ award: 'Heart on Sleeve', accent: 'pulp', blurb: 'Wrote the longest submission notes in the league.' },
		{ award: 'Mayor of 1994', accent: 'amber', blurb: 'More picks from 1994 than any other year.' },
	],
	signatureSuperlative: {
		award: 'Patron Saint of the Slow Build',
		blurb: 'Submitted the three longest intros of the season and made everyone wait.',
	},
};

const FIXTURE_FAN_HATER_INPUT: FanHaterBlurbInput = {
	playerName: 'Marisol',
	leagueName: 'Fam-Jam',
	biggestFan: { who: 'Pop', pts: 41 },
	biggestHater: { who: 'Sal', pts: -2 },
};

const FIXTURE_FAN_HATER_OUTPUT = {
	fanLine: "Gave her picks 41 points this season. He doesn't even like Slowdive. He likes Marisol.",
	haterLine: "Used his only downvote of S3 on her Cocteau Twins pick — then admitted it 'grew on him.'",
};

const FIXTURE_REEL_INPUT: LeagueReelInput = {
	leagueName: 'Fam-Jam',
	season: 3,
	members: [
		{ name: 'Marisol', fingerprint: FIXTURE_FINGERPRINT, stat: { submitted: 14, avgPts: 9.1, wins: 3 } },
		{ name: 'Pop', fingerprint: { ...FIXTURE_FINGERPRINT, summary: 'Classic rock dad.' }, stat: { submitted: 14, avgPts: 11.3, wins: 4 } },
		{ name: 'Theo', fingerprint: { ...FIXTURE_FINGERPRINT, summary: 'Hyperpop evangelist.' }, stat: { submitted: 13, avgPts: 7.8, wins: 2 } },
	],
};

const FIXTURE_REEL_OUTPUT = {
	reel: [
		{ award: 'Tastemaker of S3', winner: 'Pop', accent: 'amber', blurb: 'Most picks that finished top-3.' },
		{ award: 'Deepest Cut', winner: 'Theo', accent: 'sky', blurb: 'Went where Spotify dare not follow.' },
		{ award: 'Heart on Sleeve', winner: 'Marisol', accent: 'pulp', blurb: '47 words of feelings per submission note.' },
	],
};

const FIXTURE_MOMENT_INPUT: MomentLinesInput = {
	leagueName: 'Fam-Jam',
	mostLoved: { title: 'Wicked Game', artist: 'Chris Isaak', submitter: 'marisol', round: 9 },
	mostDivisive: { title: 'money machine', artist: '100 gecs', submitter: 'theo', round: 6 },
	biggestUpset: { title: 'I Forget to Be Your Lover', artist: 'William Bell', submitter: 'rosa', round: 2 },
};

const FIXTURE_MOMENT_OUTPUT = {
	mostLovedLine: 'The most universally adored pick of S3 — five 5s and not a single hater.',
	mostDivisiveLine: 'Split the family clean down the middle. Thanksgiving was tense. Worth it.',
	biggestUpsetLine: 'Zero chat buzz, then quietly won the whole round. Classic Rosa.',
};

// ═══════════════════════════════════════════════════════════════════════════════
// NO-STRIFE CONSTRAINT — asserted in every prompt
// ═══════════════════════════════════════════════════════════════════════════════

describe('NO_STRIFE_CONSTRAINT — present in all task prompts', () => {
	it('playerSuperlativesTask prompt includes the no-strife constraint text', () => {
		const messages = playerSuperlativesTask.buildMessages(FIXTURE_PLAYER_INPUT);
		const allText = messages.map((m) => m.content).join('\n');
		expect(allText).toContain(NO_STRIFE_CONSTRAINT);
	});

	it('fanHaterBlurbTask prompt includes the no-strife constraint text', () => {
		const messages = fanHaterBlurbTask.buildMessages(FIXTURE_FAN_HATER_INPUT);
		const allText = messages.map((m) => m.content).join('\n');
		expect(allText).toContain(NO_STRIFE_CONSTRAINT);
	});

	it('leagueReelTask prompt includes the no-strife constraint text', () => {
		const messages = leagueReelTask.buildMessages(FIXTURE_REEL_INPUT);
		const allText = messages.map((m) => m.content).join('\n');
		expect(allText).toContain(NO_STRIFE_CONSTRAINT);
	});

	it('momentLinesTask prompt includes the no-strife constraint text', () => {
		const messages = momentLinesTask.buildMessages(FIXTURE_MOMENT_INPUT);
		const allText = messages.map((m) => m.content).join('\n');
		expect(allText).toContain(NO_STRIFE_CONSTRAINT);
	});

	it('NO_STRIFE_CONSTRAINT text explicitly forbids last-place language', () => {
		expect(NO_STRIFE_CONSTRAINT).toContain('last-place');
	});

	it('NO_STRIFE_CONSTRAINT text explicitly requires affectionate hater framing', () => {
		expect(NO_STRIFE_CONSTRAINT).toContain('affectionate');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// PlayerSuperlativesOutputSchema — validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('PlayerSuperlativesOutputSchema — valid shapes', () => {
	it('accepts a valid superlatives output', () => {
		expect(() => PlayerSuperlativesOutputSchema.parse(FIXTURE_SUPERLATIVES_OUTPUT)).not.toThrow();
	});

	it('accepts all allowed accent values', () => {
		for (const accent of ACCENT_VALUES) {
			const obj = {
				...FIXTURE_SUPERLATIVES_OUTPUT,
				superlatives: [{ award: 'Test Award', accent, blurb: 'A blurb.' }],
			};
			expect(() => PlayerSuperlativesOutputSchema.parse(obj)).not.toThrow();
		}
	});
});

describe('PlayerSuperlativesOutputSchema — rejects brutal/ranking shapes', () => {
	it('rejects a shape with a "lastPlace" field (no-strife contract)', () => {
		const brutal = { ...FIXTURE_SUPERLATIVES_OUTPUT, lastPlace: 'someone' };
		expect(() => PlayerSuperlativesOutputSchema.parse(brutal)).toThrow();
	});

	it('rejects a shape with a "rank" field', () => {
		const ranked = { ...FIXTURE_SUPERLATIVES_OUTPUT, rank: 1 };
		expect(() => PlayerSuperlativesOutputSchema.parse(ranked)).toThrow();
	});

	it('rejects a shape with a "losses" field', () => {
		const lossy = { ...FIXTURE_SUPERLATIVES_OUTPUT, losses: 5 };
		expect(() => PlayerSuperlativesOutputSchema.parse(lossy)).toThrow();
	});

	it('rejects an invalid accent value', () => {
		const bad = {
			...FIXTURE_SUPERLATIVES_OUTPUT,
			superlatives: [{ award: 'X', accent: 'red', blurb: 'bad' }],
		};
		expect(() => PlayerSuperlativesOutputSchema.parse(bad)).toThrow();
	});

	it('rejects a superlative item with an extra "ranking" field', () => {
		const bad = {
			superlatives: [{ award: 'X', accent: 'pulp', blurb: 'y', ranking: 3 }],
			signatureSuperlative: FIXTURE_SUPERLATIVES_OUTPUT.signatureSuperlative,
		};
		expect(() => PlayerSuperlativesOutputSchema.parse(bad)).toThrow();
	});

	it('rejects missing superlatives array', () => {
		const bad = { signatureSuperlative: FIXTURE_SUPERLATIVES_OUTPUT.signatureSuperlative };
		expect(() => PlayerSuperlativesOutputSchema.parse(bad)).toThrow();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// FanHaterBlurbOutputSchema — validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('FanHaterBlurbOutputSchema — valid shapes', () => {
	it('accepts a valid fan/hater blurb output', () => {
		expect(() => FanHaterBlurbOutputSchema.parse(FIXTURE_FAN_HATER_OUTPUT)).not.toThrow();
	});
});

describe('FanHaterBlurbOutputSchema — rejects brutal shapes', () => {
	it('rejects a shape with extra field "worstEnemy"', () => {
		const bad = { ...FIXTURE_FAN_HATER_OUTPUT, worstEnemy: 'someone' };
		expect(() => FanHaterBlurbOutputSchema.parse(bad)).toThrow();
	});

	it('rejects a shape with extra field "leastFavorite"', () => {
		const bad = { ...FIXTURE_FAN_HATER_OUTPUT, leastFavorite: 'nobody' };
		expect(() => FanHaterBlurbOutputSchema.parse(bad)).toThrow();
	});

	it('rejects missing fanLine', () => {
		const bad = { haterLine: FIXTURE_FAN_HATER_OUTPUT.haterLine };
		expect(() => FanHaterBlurbOutputSchema.parse(bad)).toThrow();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// LeagueReelOutputSchema — validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('LeagueReelOutputSchema — valid shapes', () => {
	it('accepts a valid league reel output', () => {
		expect(() => LeagueReelOutputSchema.parse(FIXTURE_REEL_OUTPUT)).not.toThrow();
	});

	it('all accent values in reel output are in the allowed set', () => {
		const result = LeagueReelOutputSchema.parse(FIXTURE_REEL_OUTPUT);
		for (const item of result.reel) {
			expect(ACCENT_VALUES).toContain(item.accent);
		}
	});
});

describe('LeagueReelOutputSchema — rejects ranking shapes', () => {
	it('rejects a reel item with extra "position" field', () => {
		const bad = {
			reel: [{ award: 'X', winner: 'Pop', accent: 'amber', blurb: 'Y', position: 1 }],
		};
		expect(() => LeagueReelOutputSchema.parse(bad)).toThrow();
	});

	it('rejects a shape with extra top-level field "standings"', () => {
		const bad = { ...FIXTURE_REEL_OUTPUT, standings: [] };
		expect(() => LeagueReelOutputSchema.parse(bad)).toThrow();
	});

	it('rejects reel with fewer than 3 items', () => {
		const bad = { reel: [FIXTURE_REEL_OUTPUT.reel[0]] };
		expect(() => LeagueReelOutputSchema.parse(bad)).toThrow();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// MomentLinesOutputSchema — validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('MomentLinesOutputSchema — valid shapes', () => {
	it('accepts a valid moment lines output', () => {
		expect(() => MomentLinesOutputSchema.parse(FIXTURE_MOMENT_OUTPUT)).not.toThrow();
	});
});

describe('MomentLinesOutputSchema — rejects ranking shapes', () => {
	it('rejects a shape with extra field "loser"', () => {
		const bad = { ...FIXTURE_MOMENT_OUTPUT, loser: 'someone' };
		expect(() => MomentLinesOutputSchema.parse(bad)).toThrow();
	});

	it('rejects missing mostDivisiveLine', () => {
		const bad = {
			mostLovedLine: FIXTURE_MOMENT_OUTPUT.mostLovedLine,
			biggestUpsetLine: FIXTURE_MOMENT_OUTPUT.biggestUpsetLine,
		};
		expect(() => MomentLinesOutputSchema.parse(bad)).toThrow();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Task metadata
// ═══════════════════════════════════════════════════════════════════════════════

describe('task identifiers', () => {
	it('playerSuperlativesTask has correct id', () => {
		expect(playerSuperlativesTask.id).toBe('narrative-player-superlatives');
	});

	it('fanHaterBlurbTask has correct id', () => {
		expect(fanHaterBlurbTask.id).toBe('narrative-fan-hater-blurbs');
	});

	it('leagueReelTask has correct id', () => {
		expect(leagueReelTask.id).toBe('narrative-league-reel');
	});

	it('momentLinesTask has correct id', () => {
		expect(momentLinesTask.id).toBe('narrative-moment-lines');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildMessages — prompt content checks
// ═══════════════════════════════════════════════════════════════════════════════

describe('playerSuperlativesTask.buildMessages', () => {
	it('includes the player name in the user message', () => {
		const messages = playerSuperlativesTask.buildMessages(FIXTURE_PLAYER_INPUT);
		const userMsg = messages.find((m) => m.role === 'user');
		expect(userMsg?.content).toContain('Marisol');
	});

	it('includes the league name in the system message', () => {
		const messages = playerSuperlativesTask.buildMessages(FIXTURE_PLAYER_INPUT);
		const sysMsg = messages.find((m) => m.role === 'system');
		expect(sysMsg?.content).toContain('Fam-Jam');
	});

	it('includes fingerprint summary in the user message', () => {
		const messages = playerSuperlativesTask.buildMessages(FIXTURE_PLAYER_INPUT);
		const userMsg = messages.find((m) => m.role === 'user');
		expect(userMsg?.content).toContain(FIXTURE_FINGERPRINT.summary);
	});
});

describe('fanHaterBlurbTask.buildMessages', () => {
	it('includes fan and hater names in the user message', () => {
		const messages = fanHaterBlurbTask.buildMessages(FIXTURE_FAN_HATER_INPUT);
		const userMsg = messages.find((m) => m.role === 'user');
		expect(userMsg?.content).toContain('Pop');
		expect(userMsg?.content).toContain('Sal');
	});

	it('mentions affectionate/friendly hater framing in system prompt', () => {
		const messages = fanHaterBlurbTask.buildMessages(FIXTURE_FAN_HATER_INPUT);
		const sysMsg = messages.find((m) => m.role === 'system');
		expect(sysMsg?.content).toMatch(/affection|lovingly|friendly/i);
	});
});

describe('leagueReelTask.buildMessages', () => {
	it('lists all member names in the user message', () => {
		const messages = leagueReelTask.buildMessages(FIXTURE_REEL_INPUT);
		const userMsg = messages.find((m) => m.role === 'user');
		for (const m of FIXTURE_REEL_INPUT.members) {
			expect(userMsg?.content).toContain(m.name);
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Integration: stubbed callOpenRouter → schema-valid output
// ═══════════════════════════════════════════════════════════════════════════════

describe('playerSuperlativesTask — stubbed LLM returns valid output', () => {
	it('resolves schema-valid superlatives with accent in the allowed set', async () => {
		mockCallOpenRouter.mockResolvedValueOnce({
			content: JSON.stringify(FIXTURE_SUPERLATIVES_OUTPUT),
			costUsd: 0,
		});

		// Simulate what runPrediction does: call buildMessages then callOpenRouter
		const messages = playerSuperlativesTask.buildMessages(FIXTURE_PLAYER_INPUT);
		expect(messages.length).toBeGreaterThan(0);

		const { content } = await callOpenRouter(messages, { model: playerSuperlativesTask.model, jsonMode: true });
		const parsed = JSON.parse(content);
		const result = PlayerSuperlativesOutputSchema.parse(parsed);

		expect(result.superlatives.length).toBeGreaterThan(0);
		for (const s of result.superlatives) {
			expect(ACCENT_VALUES).toContain(s.accent);
			expect(s.award.length).toBeGreaterThan(0);
			expect(s.blurb.length).toBeGreaterThan(0);
		}
		expect(result.signatureSuperlative.award.length).toBeGreaterThan(0);
	});
});

describe('fanHaterBlurbTask — stubbed LLM returns valid output', () => {
	it('resolves schema-valid fan and hater lines', async () => {
		mockCallOpenRouter.mockResolvedValueOnce({
			content: JSON.stringify(FIXTURE_FAN_HATER_OUTPUT),
			costUsd: 0,
		});

		const messages = fanHaterBlurbTask.buildMessages(FIXTURE_FAN_HATER_INPUT);
		const { content } = await callOpenRouter(messages, { model: fanHaterBlurbTask.model, jsonMode: true });
		const result = FanHaterBlurbOutputSchema.parse(JSON.parse(content));

		expect(result.fanLine.length).toBeGreaterThan(0);
		expect(result.haterLine.length).toBeGreaterThan(0);
	});
});

describe('leagueReelTask — stubbed LLM returns valid output', () => {
	it('resolves schema-valid reel with accent values in the allowed set', async () => {
		mockCallOpenRouter.mockResolvedValueOnce({
			content: JSON.stringify(FIXTURE_REEL_OUTPUT),
			costUsd: 0,
		});

		const messages = leagueReelTask.buildMessages(FIXTURE_REEL_INPUT);
		const { content } = await callOpenRouter(messages, { model: leagueReelTask.model, jsonMode: true });
		const result = LeagueReelOutputSchema.parse(JSON.parse(content));

		expect(result.reel.length).toBeGreaterThanOrEqual(3);
		for (const item of result.reel) {
			expect(ACCENT_VALUES).toContain(item.accent);
		}
	});
});

describe('momentLinesTask — stubbed LLM returns valid output', () => {
	it('resolves schema-valid moment lines', async () => {
		mockCallOpenRouter.mockResolvedValueOnce({
			content: JSON.stringify(FIXTURE_MOMENT_OUTPUT),
			costUsd: 0,
		});

		const messages = momentLinesTask.buildMessages(FIXTURE_MOMENT_INPUT);
		const { content } = await callOpenRouter(messages, { model: momentLinesTask.model, jsonMode: true });
		const result = MomentLinesOutputSchema.parse(JSON.parse(content));

		expect(result.mostLovedLine.length).toBeGreaterThan(0);
		expect(result.mostDivisiveLine.length).toBeGreaterThan(0);
		expect(result.biggestUpsetLine.length).toBeGreaterThan(0);
	});
});
