import { z } from 'zod';
import type { PredictionTask } from '../../predict/predict.js';
import type { SeasonSignals } from '../seasonSignals.js';
import { modelFor } from '../../digest/modelFor.js';

export const SeasonUpdateInputSchema = z.object({
	leagueName: z.string(),
	season: z.string(),
	snarkLevel: z.number().int().min(0).max(2),
	signals: z.custom<SeasonSignals>(),
	recentSubjects: z.array(z.string()),
});
export type SeasonUpdateInput = z.infer<typeof SeasonUpdateInputSchema>;

export const SeasonUpdateOutputSchema = z.object({ title: z.string(), body: z.string() });
export type SeasonUpdateOutput = z.infer<typeof SeasonUpdateOutputSchema>;

const SNARK = ['gentle and warm', 'playful with teeth', 'spicy — full needle'];

export function buildSeasonUpdateMessages(input: SeasonUpdateInput) {
	const s = input.signals;
	const facts: string[] = [];
	if (s.bigMover) facts.push(`Big mover: ${s.bigMover.player} rank ${s.bigMover.fromRank}->${s.bigMover.toRank} (+${s.bigMover.roundPoints} pts, total ${s.bigMover.total}).`);
	if (s.faller) facts.push(`Faller: ${s.faller.player} rank ${s.faller.fromRank}->${s.faller.toRank}.`);
	for (const st of s.streaks) facts.push(`Streak: ${st.player} ${st.direction} ${st.rounds} rounds.`);
	for (const d of s.discoveryShifts) facts.push(`Discovery shift: ${d.player} ${d.direction} (${d.detail}).`);
	for (const r of s.rivalries) facts.push(`Rivalry (${r.kind}): ${r.players.join(' vs ')} — ${r.detail}.`);
	if (s.upcomingTension) facts.push(`Next up "${s.upcomingTension.nextRound?.name ?? 'TBD'}": ${s.upcomingTension.contenders.map(c => `${c.player} (${c.total}, gap ${c.gapToLeader})`).join('; ')}.`);

	const system = `You are the b-side season-pulse writer for the music league "${input.leagueName}". Write a short editorial "season update" — what stands out RIGHT NOW given the latest digest.
VOICE (${SNARK[input.snarkLevel]}): strife is welcome when it is FUNNY and FACT-BASED; never cruel or mean. Pattern-calling is fine when the facts support it. Matt (Mashew), Mara, and Jordan are always fair game. Do NOT pile on anyone in this list again: ${input.recentSubjects.join(', ') || '(none)'}.
HARD RULES: every competitive claim must come from the FACTS below — invent nothing. When you look ahead to the next round you MAY name artists but you may NOT name songs (it spoils pickability).
Output JSON: {"title": <punchy section title>, "body": <2-4 short paragraphs>}.`;

	const user = `Season: ${input.season}\nAs of: round ${s.asOfRound?.roundNumber} "${s.asOfRound?.name}".\nFACTS:\n${facts.join('\n') || '(season just starting — no trends yet)'}`;
	return [{ role: 'system' as const, content: system }, { role: 'user' as const, content: user }];
}

export const seasonUpdateTask: PredictionTask<SeasonUpdateInput, SeasonUpdateOutput> = {
	id: 'season-update',
	inputSchema: SeasonUpdateInputSchema,
	buildMessages: buildSeasonUpdateMessages,
	model: (db) => modelFor('digest', db),
	outputSchema: SeasonUpdateOutputSchema,
};
