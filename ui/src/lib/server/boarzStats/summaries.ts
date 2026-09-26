// LLM topic summaries for peak chatter days. Results cache to
// data/boarz-chat-summaries.json so each day is summarized exactly once;
// new peaks (fresh days crossing the threshold) are the only spend.

import Database from 'better-sqlite3';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { callOpenRouter } from '$lib/digest/llm.js';
import { dayOfTs, type ChatMsg } from './chat.js';
import type { DaySummary } from '$lib/boarzStats/shared.js';

export type SummaryMap = Record<string, DaySummary>;

const MAX_CHARS = 28_000;
const MAX_TOPICS = 4;

function summariesFile(): string {
	return join(process.env.DATA_DIR ?? 'data', 'boarz-chat-summaries.json');
}

export function loadSummaries(): SummaryMap {
	try {
		if (!existsSync(summariesFile())) return {};
		return JSON.parse(readFileSync(summariesFile(), 'utf8')) as SummaryMap;
	} catch {
		return {};
	}
}

function saveSummaries(map: SummaryMap): void {
	writeFileSync(summariesFile(), JSON.stringify(map, null, 1));
}

function dayMessages(db: Database.Database, day: string): ChatMsg[] {
	const rows = db
		.prepare<[], { sender: string; text: string; ts: string }>(
			`SELECT sender, text, ts FROM chat_messages WHERE group_name LIKE 'Boarz%' ORDER BY ts`
		)
		.all();
	return rows.filter((r) => dayOfTs(r.ts) === day);
}

async function summarizeDay(db: Database.Database, day: string, count: number, model: string): Promise<string[]> {
	const msgs = dayMessages(db, day);
	// compact transcript: "sender: text" lines, hard-capped
	let transcript = '';
	const lines: string[] = [];
	for (const m of msgs) {
		const line = `${m.sender}: ${m.text.replace(/\s+/g, ' ').slice(0, 200)}`;
		if (transcript.length + line.length > MAX_CHARS) break;
		lines.push(line);
		transcript += line + '\n';
	}
	const res = await callOpenRouter(
		[
			{
				role: 'system',
				content:
					'You summarize one day of a rowdy, joke-heavy music-league friends group chat for a stats dashboard. '
					+ `Identify up to ${MAX_TOPICS} distinct topics of conversation that day, biggest first. `
					+ 'Each topic is ONE punchy line, max 12 words, written like an insider tease (no formal tone, no quotes). '
					+ 'If the day was mostly one big conversation, fewer topics is fine (minimum 1). '
					+ 'Respond ONLY with JSON: {"topics": ["...", "..."]}',
			},
			{
				role: 'user',
				content: `Day ${day} (${count} messages, ${msgs.length} loaded):\n\n${transcript}`,
			},
		],
		{ model, jsonMode: true, maxTokens: 500 }
	);
	const parsed = JSON.parse(res.content) as { topics?: unknown };
	const topics = Array.isArray(parsed.topics)
		? parsed.topics.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, MAX_TOPICS)
		: [];
	return topics;
}

/**
 * Summarize any peak day that doesn't have a cached summary yet. Sequential on
 * purpose (keeps provider load sane); returns the full map afterwards.
 */
export async function summarizeMissingPeaks(
	db: Database.Database,
	peaks: { day: string; count: number }[]
): Promise<SummaryMap> {
	const summaries = loadSummaries();
	// Stats summaries are decorative and cached permanently, so keep them off
	// the paid predict/digest buckets unless the operator explicitly opts in.
	const model = process.env.OPENROUTER_STATS_SUMMARY_MODEL ?? 'openrouter/free';
	let dirty = false;
	for (const peak of peaks) {
		if (summaries[peak.day]) continue;
		try {
			const topics = await summarizeDay(db, peak.day, peak.count, model);
			summaries[peak.day] = {
				day: peak.day,
				count: peak.count,
				topics,
				generatedAt: new Date().toISOString(),
			};
			dirty = true;
		} catch (err) {
			console.error(`[boarz-stats] topic summary failed for ${peak.day}:`, err);
		}
	}
	if (dirty) saveSummaries(summaries);
	return summaries;
}
