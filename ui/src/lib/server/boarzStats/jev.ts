// TypeSafe Jev (System One decision model) via OpenRouter's alpha Decisions API.
// Rate chat messages / vote comments as typed answers with full probability
// distributions. No $lib imports — this module also runs from standalone
// backfill scripts outside SvelteKit.

export const JEV_MODEL = 'typesafe/jev-1.13';
const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';

export interface JevAnswer {
	type: 'noul' | 'choice' | 'score';
	noul?: number;
	choice?: string;
	score?: number;
	probabilities?: Record<string, number>;
	confidence?: number;
	legend?: Record<string, string>;
}

export interface JevUsage {
	cost: number;
	input_tokens: number;
	output_tokens: number;
}

export interface JevResult {
	answers: Record<string, JevAnswer>;
	usage: JevUsage;
	model: string;
}

export async function jevDecide(
	state: Record<string, unknown>,
	questions: Record<string, unknown>,
	apiKey: string
): Promise<JevResult> {
	const res = await fetch(JEV_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ model: JEV_MODEL, state, questions }),
	});
	if (!res.ok) {
		throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 200)}`);
	}
	return (await res.json()) as JevResult;
}

// ---------------------------------------------------------------------------
// Rating schema — taxonomy v2 (music-league-whatsapp-analysis-taxonomy.md):
// 6 multi-label tags + 20 scored dimensions (0–3 scales, normalized at read
// time) + 13 binary dimensions + 5 categorical choices. ~44 questions/msg.
// Rubric wording only where A/B tests showed it matters.

export const TAG_KEYS = ['is_reaction', 'has_media', 'has_link', 'is_music', 'is_banter', 'is_logistics'] as const;
export type TagKey = (typeof TAG_KEYS)[number];

const TAG_DEFS: Record<TagKey, { type: 'noul'; instructions: string }> = {
	is_reaction: { type: 'noul', instructions: 'Is this a pure reaction with no content (lol, emoji only, +1, "this", one-word agreement)?' },
	has_media: { type: 'noul', instructions: 'Does this contain or consist of a photo, meme, or screenshot?' },
	has_link: { type: 'noul', instructions: 'Does this contain a URL worth clicking (spotify, youtube, article)?' },
	is_music: { type: 'noul', instructions: 'Is this about songs, artists, listening, voting, or the round?' },
	is_banter: { type: 'noul', instructions: 'Is this personal content (stories, roasts, jokes with real content, life updates)?' },
	is_logistics: { type: 'noul', instructions: 'Is this coordination (deadlines, scheduling, tech, housekeeping)?' },
};

// Ordered scales. Each 0–3; normalized to 0–1 at read time.
export const SCORE_KEYS = [
	'heat', 'energy', 'affection', 'conversation_pull', 'conversation_kill',
	'laugh_prediction', 'chaos', 'provocation', 'curiosity', 'explanatory_depth',
	'main_character', 'commissioner_energy', 'novelty',
	'inside_baseball', 'banter_strength', 'meme_potential',
	'seriousness', 'effort',
] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];

const SCORE_DEFS: Record<ScoreKey, { type: 'score'; instructions: string; criteria: string[] }> = {
	heat: {
		type: 'score',
		instructions: 'How heated is this message in the group chat?',
		criteria: ['chill - no tension, small talk or agreement', 'playful - teasing with clear affection behind it', 'heated - genuine annoyance or criticism visible', 'full roast - sustained deliberate comedic takedown'],
	},
	energy: { type: 'score', instructions: 'How animated, intense, or expressive is the message?', criteria: ['flat', 'mild', 'lively', 'unhinged'] },
	affection: {
		type: 'score',
		instructions: 'Where does the tone land between hostile and affectionate?',
		criteria: ['hostile - genuinely mean or angry', 'sharp - cutting but not serious', 'neutral - neither warm nor sharp', 'affectionate - warm, supportive, complimentary'],
	},
	conversation_pull: {
		type: 'score',
		instructions: 'How much response does this message invite from others?',
		criteria: ['thread killer - likely ends the exchange', 'weak pull - short acks at best', 'invites replies - people respond', 'must reply - demands a response'],
	},
	conversation_kill: {
		type: 'score',
		instructions: 'How likely is the conversation to stop right after this message?',
		criteria: ['conversation continues strongly', 'likely continues', 'might peter out', 'conversation likely ends here'],
	},
	laugh_prediction: {
		type: 'score',
		instructions: 'How likely is this message to draw laugh-style replies (lmao, lol, laughing emoji)?',
		criteria: ['silence - likely ignored or met with plain replies', 'chuckle - one light laugh reaction', 'several lols - multiple people laugh', 'lmao thread - people pile on with jokes of their own'],
	},
	chaos: {
		type: 'score',
		instructions: 'How chaotic/unhinged is the energy?',
		criteria: ['composed - calm and measured', 'loose - casual, mild excitement', 'chaotic - exclamatory, fragmented, spiraling', 'unhinged - caps lock, repetitive, complete loss of composure'],
	},
	provocation: { type: 'score', instructions: 'How likely is this to trigger challenge, disagreement, or a reaction?', criteria: ['none', 'low', 'likely', 'baiting'] },
	curiosity: { type: 'score', instructions: 'How much information-seeking or inquiry is happening?', criteria: ['none', 'slight', 'genuine interest', 'intense curiosity'] },
	explanatory_depth: { type: 'score', instructions: 'How much reasoning, context, or elaboration does this provide?', criteria: ['none - bare assertion', 'light', 'moderate - some reasoning or context', 'deep - extensive evidence or elaboration'] },
	main_character: { type: 'score', instructions: 'How much does this message center the sender or demand group attention?', criteria: ['fully about others', 'balanced', 'somewhat self-centered', 'all about me - attention demanding'] },
	commissioner_energy: { type: 'score', instructions: 'How much is this about rules, organization, deadlines, or league management?', criteria: ['none', 'touch of it', 'mostly organizational', 'pure commissioner business'] },
	novelty: { type: 'score', instructions: 'How new is this contribution vs reacting to or repeating the thread?', criteria: ['pure reaction to thread', 'adds small twist', 'adds new angle', 'wholly new subject or idea'] },
	inside_baseball: { type: 'score', instructions: 'How much does understanding this depend on group-specific history or inside jokes?', criteria: ['fully self-contained', 'slight reference', 'needs group context', 'incomprehensible to outsiders'] },
	banter_strength: { type: 'score', instructions: 'How strong is the friendly-adversarial humor?', criteria: ['not banter', 'light', 'strong', 'all-timer'] },
	meme_potential: { type: 'score', instructions: 'How likely is a phrase from this to become a later callback or inside joke?', criteria: ['none', 'possible', 'likely', 'instant classic'] },
	seriousness: { type: 'score', instructions: 'Does the speaker mean the content literally and sincerely?', criteria: ['fully joking', 'mostly joking', 'mixed', 'fully sincere'] },
	effort: { type: 'score', instructions: 'How much content investment does this represent (length, structure, research, links)?', criteria: ['minimal', 'low', 'moderate', 'high effort'] },
};

export const NOUL_KEYS = [
	'mock_outrage', 'sincerity', 'opens_question', 'music_ref', 'round_ref',
	'praise', 'defense', 'replying', 'name_drop', 'recurring_bit',
	'quote_joke', 'profanity', 'caps_energy',
	'context_dependent', 'vulnerability', 'agrees', 'expresses_disagreement',
] as const;
export type NoulKey = (typeof NOUL_KEYS)[number];

const NOUL_DEFS: Record<NoulKey, { type: 'noul'; instructions: string }> = {
	mock_outrage: { type: 'noul', instructions: 'Is the sender feigning outrage for comedic effect?' },
	sincerity: { type: 'noul', instructions: 'Is this sincere rather than ironic?' },
	opens_question: { type: 'noul', instructions: 'Does this open a new question or debate?' },
	music_ref: { type: 'noul', instructions: 'Does this reference a real song or artist?' },
	round_ref: { type: 'noul', instructions: 'Is this about a specific Music League round or its results?' },
	praise: { type: 'noul', instructions: 'Does this praise someone or their pick?' },
	defense: { type: 'noul', instructions: 'Is the sender defending themselves or someone else?' },
	replying: { type: 'noul', instructions: 'Is this a direct reply to a specific earlier message?' },
	name_drop: { type: 'noul', instructions: 'Does this mention another member by name?' },
	recurring_bit: { type: 'noul', instructions: 'Does this reference an existing inside joke or running bit?' },
	quote_joke: { type: 'noul', instructions: 'Is this quoting something (movie, song, earlier chat)?' },
	profanity: { type: 'noul', instructions: 'Does this contain profanity?' },
	caps_energy: { type: 'noul', instructions: 'Does this use ALL CAPS for emphasis?' },
	context_dependent: { type: 'noul', instructions: 'Would a newcomer to the group understand this message without prior context?' },
	vulnerability: { type: 'noul', instructions: 'Does this involve personal or emotional disclosure?' },
	agrees: { type: 'noul', instructions: 'Is this expressing agreement with a previous message?' },
	expresses_disagreement: { type: 'noul', instructions: 'Is this expressing disagreement with a previous message?' },
	// context_dependent is inverted by convention: noul = "needs context". Newcomer
	// wording kept so the model rates comprehension, not the flag itself.
};

export const CHOICE_KEYS = ['humor_type', 'roast_target', 'topic', 'question_type', 'form', 'ml_behavior', 'sequence_role'] as const;
export type ChoiceKey = (typeof CHOICE_KEYS)[number];

const CHOICE_DEFS: Record<ChoiceKey, { type: 'choice'; instructions: string; criteria: Record<string, string> }> = {
	humor_type: {
		type: 'choice',
		instructions: 'What kind of humor does this message use?',
		criteria: { none: '', absurd: '', sarcastic: '', roast: '', self_roast: '', callback: '', observational: '' },
	},
	roast_target: { type: 'choice', instructions: 'Who gets roasted or teased here?', criteria: { nobody: '', self: '', other: '' } },
	topic: { type: 'choice', instructions: 'What is the primary topic?', criteria: { music: '', personal: '', logistics: '', meta: '' } },
	question_type: { type: 'choice', instructions: 'What kind of question, if any?', criteria: { none: '', closed: '', open: '', rhetorical: '' } },
	form: { type: 'choice', instructions: 'What form is the message?', criteria: { quip: '', story: '', rant: '', logistics: '' } },
	ml_behavior: {
		type: 'choice',
		instructions: 'Which Music League behavior best fits this message?',
		criteria: {
			none: '',
			submission_talk: '',
			voting_talk: '',
			theme_lawyering: '',
			trash_talk: '',
			commissioner: '',
		},
	},
	sequence_role: {
		type: 'choice',
		instructions: 'What role does this message play in the conversation right now?',
		criteria: { ignition: '', sustain: '', revival: '', closer: '', standalone: '' },
	},
};

/** Build the per-message question set, namespaced `m{i}_<dim>`. */
export function buildQuestions(i: number): Record<string, unknown> {
	const q: Record<string, unknown> = {};
	for (const k of TAG_KEYS) q[`m${i}_${k}`] = TAG_DEFS[k];
	for (const k of SCORE_KEYS) q[`m${i}_${k}`] = SCORE_DEFS[k];
	for (const k of NOUL_KEYS) q[`m${i}_${k}`] = NOUL_DEFS[k];
	for (const k of CHOICE_KEYS) q[`m${i}_${k}`] = CHOICE_DEFS[k];
	return q;
}

export const DIMS_PER_MSG = TAG_KEYS.length + SCORE_KEYS.length + NOUL_KEYS.length + CHOICE_KEYS.length;

export interface ParsedMessageRating {
	tags: Record<TagKey, number>;
	noul: Record<NoulKey, number>;
	score: Record<ScoreKey, number>;
	choice: Record<ChoiceKey, { value: string; confidence: number }>;
	meanConfidence: number;
}

/** Extract one message's rating out of a batched answers map. */
export function parseAnswers(answers: Record<string, JevAnswer>, i: number): ParsedMessageRating {
	const readNoul = (key: string): number => {
		const a = answers[`m${i}_${key}`];
		if (!a || a.type !== 'noul') throw new Error(`missing answer m${i}_${key}`);
		return a.noul ?? 0;
	};
	const tags = {} as Record<TagKey, number>;
	for (const k of TAG_KEYS) tags[k] = readNoul(k);
	const noul = {} as Record<NoulKey, number>;
	for (const k of NOUL_KEYS) noul[k] = readNoul(k);
	const score = {} as Record<ScoreKey, number>;
	for (const k of SCORE_KEYS) {
		const a = answers[`m${i}_${k}`];
		if (!a || a.type !== 'score') throw new Error(`missing answer m${i}_${k}`);
		score[k] = a.score ?? 0;
	}
	const choice = {} as Record<ChoiceKey, { value: string; confidence: number }>;
	let confSum = 0;
	for (const k of CHOICE_KEYS) {
		const a = answers[`m${i}_${k}`];
		if (!a || a.type !== 'choice') throw new Error(`missing answer m${i}_${k}`);
		choice[k] = { value: a.choice ?? 'none', confidence: a.confidence ?? 0 };
		confSum += a.confidence ?? 0;
	}
	return { tags, noul, score, choice, meanConfidence: confSum / CHOICE_KEYS.length };
}
