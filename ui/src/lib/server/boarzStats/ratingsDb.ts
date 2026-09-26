// Ratings store — separate SQLite file so the read-only share instance never
// touches a writable league.db, and backfills never contend with the bot/api.

import Database from 'better-sqlite3';
import type { ChoiceKey, NoulKey, ParsedMessageRating, ScoreKey, TagKey } from './jev.js';
import { CHOICE_KEYS, NOUL_KEYS, SCORE_KEYS, TAG_KEYS } from './jev.js';

const SCORE_COLUMNS = ['heat', 'energy', 'affection', 'conversation_pull', 'laugh_prediction', 'chaos'] as const;

export function openRatingsDb(path: string, create: boolean): Database.Database {
	if (create) {
		const db = new Database(path);
		db.pragma('journal_mode = WAL');
		db.exec(`
			CREATE TABLE IF NOT EXISTS chat_msg_ratings_v2 (
				msg_id TEXT PRIMARY KEY,
				model TEXT NOT NULL,
				${TAG_KEYS.map((k) => `${k} REAL NOT NULL`).join(', ')},
				${SCORE_KEYS.map((k) => `${k} REAL NOT NULL`).join(', ')},
				${NOUL_KEYS.map((k) => `${k} REAL NOT NULL`).join(', ')},
				${CHOICE_KEYS.map((k) => `${k} TEXT NOT NULL`).join(', ')},
				${CHOICE_KEYS.map((k) => `${k}_conf REAL NOT NULL`).join(', ')},
				mean_confidence REAL NOT NULL,
				cost_usd REAL NOT NULL,
				probs_json TEXT NOT NULL,
				outcome_json TEXT,
				rated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
			)
		`);
		db.exec(`
			CREATE TABLE IF NOT EXISTS vote_comment_ratings (
				vote_id INTEGER PRIMARY KEY,
				model TEXT NOT NULL,
				heat REAL NOT NULL,
				energy REAL NOT NULL,
				affection REAL NOT NULL,
				conversation_pull REAL NOT NULL,
				laugh_prediction REAL NOT NULL,
				chaos REAL NOT NULL,
				roast_target TEXT NOT NULL, roast_target_conf REAL NOT NULL,
				humor_type TEXT NOT NULL, humor_type_conf REAL NOT NULL,
				topic TEXT NOT NULL, topic_conf REAL NOT NULL,
				praise REAL NOT NULL,
				sincerity REAL NOT NULL,
				cost_usd REAL NOT NULL,
				rated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
			)
		`);
		return db;
	}
	return new Database(path, { readonly: true, fileMustExist: true });
}

const INSERT_CHAT = `
	INSERT OR REPLACE INTO chat_msg_ratings_v2
	(msg_id, model, ${TAG_KEYS.join(', ')}, ${SCORE_KEYS.join(', ')}, ${NOUL_KEYS.join(', ')}, ${CHOICE_KEYS.join(', ')}, ${CHOICE_KEYS.map((k) => `${k}_conf`).join(', ')}, mean_confidence, cost_usd, probs_json, outcome_json)
	VALUES (${['?', '?', ...TAG_KEYS.map(() => '?'), ...SCORE_KEYS.map(() => '?'), ...NOUL_KEYS.map(() => '?'), ...CHOICE_KEYS.map(() => '?'), ...CHOICE_KEYS.map(() => '?'), '?', '?', '?', '?'].join(', ')})
`;

export function insertChatRating(
	db: Database.Database,
	msgId: string,
	model: string,
	r: ParsedMessageRating,
	probs: unknown,
	costUsd: number,
	outcome?: unknown
): void {
	db.prepare(INSERT_CHAT).run(
		msgId,
		model,
		...TAG_KEYS.map((k) => r.tags[k]),
		...SCORE_KEYS.map((k) => r.score[k]),
		...NOUL_KEYS.map((k) => r.noul[k]),
		...CHOICE_KEYS.map((k) => r.choice[k].value),
		...CHOICE_KEYS.map((k) => r.choice[k].confidence),
		r.meanConfidence,
		costUsd,
		JSON.stringify(probs),
		outcome ? JSON.stringify(outcome) : null
	);
}

export function ratedChatIds(db: Database.Database): Set<string> {
	return new Set(db.prepare('SELECT msg_id FROM chat_msg_ratings_v2').all().map((r) => (r as { msg_id: string }).msg_id));
}

/** Write measured outcomes (replies, responders, continuation) onto rated rows. */
export function updateOutcome(db: Database.Database, msgId: string, outcome: unknown): void {
	db.prepare('UPDATE chat_msg_ratings_v2 SET outcome_json = ? WHERE msg_id = ?').run(JSON.stringify(outcome), msgId);
}

export function ratedVoteIds(db: Database.Database): Set<number> {
	return new Set(db.prepare('SELECT vote_id FROM vote_comment_ratings').all().map((r) => (r as { vote_id: number }).vote_id));
}

const INSERT_VOTE = `
	INSERT OR REPLACE INTO vote_comment_ratings
	(vote_id, model, ${SCORE_COLUMNS.join(', ')}, roast_target, roast_target_conf, humor_type, humor_type_conf, topic, topic_conf, praise, sincerity, cost_usd)
	VALUES (?, ?, ${SCORE_COLUMNS.map(() => '?').join(', ')}, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export interface VoteCommentRating {
	heat: number;
	energy: number;
	affection: number;
	conversation_pull: number;
	laugh_prediction: number;
	chaos: number;
	roast_target: string;
	roast_target_conf: number;
	humor_type: string;
	humor_type_conf: number;
	topic: string;
	topic_conf: number;
	praise: number;
	sincerity: number;
}

export function insertVoteRating(db: Database.Database, voteId: number, model: string, r: ParsedMessageRating, costUsd: number): void {
	db.prepare(INSERT_VOTE).run(
		voteId,
		model,
		...SCORE_COLUMNS.map((k) => r.score[k as ScoreKey]),
		r.choice.roast_target.value,
		r.choice.roast_target.confidence,
		r.choice.humor_type.value,
		r.choice.humor_type.confidence,
		r.choice.topic.value,
		r.choice.topic.confidence,
		r.noul.praise,
		r.noul.sincerity,
		costUsd
	);
}
