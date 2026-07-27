#!/usr/bin/env node
/**
 * chat-superlatives-data — parse the Boarz WhatsApp export, join round votes
 * from league.db, and emit the computed ChatSuperlatives object as JSON.
 *
 * Deliberately separate from the renderer: this owns all I/O, the compute
 * module stays pure, and the JSON is inspectable on its own.
 *
 *   node scripts/chat-superlatives-data.mjs > /tmp/superlatives.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import { createJiti } from 'jiti';

// Lives under ui/ because it resolves adm-zip and jiti from ui/node_modules.
const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(UI, '..');
const jiti = createJiti(import.meta.url);

const { parseExport } = await jiti.import(path.join(UI, 'src/lib/digest/chatExport.ts'));
const { computeSuperlatives } = await jiti.import(
	path.join(UI, 'src/lib/digest/chatSuperlatives.ts'),
);
const { PEOPLE } = await jiti.import(path.join(UI, 'src/lib/digest/chatIdentity.ts'));

const ZIP = path.join(
	ROOT,
	'data/boarz-ii-men/season-1/WhatsApp Chat with Boarz II Men - Music League.zip',
);
const DB = path.join(ROOT, 'data/league.db');
const BOARZ_LEAGUE_ID = 5;

// ── export ────────────────────────────────────────────────────────────────────

function readExportText(zipPath) {
	const zip = new AdmZip(zipPath);
	const entry = zip.getEntries().find((e) => e.entryName.endsWith('.txt'));
	if (!entry) throw new Error(`No .txt found inside ${zipPath}`);
	return entry.getData().toString('utf8');
}

// ── votes ─────────────────────────────────────────────────────────────────────

function readVoteComments(dbPath) {
	const db = new Database(dbPath, { readonly: true });
	try {
		// Every ballot, commented or not — a vote with no comment is the extreme
		// of the talk-to-ballot metric, not a missing data point.
		const rows = db
			.prepare(
				`SELECT c.ml_competitor_id AS cid, COALESCE(v.comment, '') AS comment
				   FROM votes v
				   JOIN competitors c ON c.id = v.voter_id
				   JOIN rounds r ON r.id = v.round_id
				   JOIN seasons s ON s.id = r.season_id
				  WHERE s.league_id = ?`,
			)
			.all(BOARZ_LEAGUE_ID);

		const byCompetitor = new Map(
			PEOPLE.filter((p) => p.mlCompetitorId).map((p) => [p.mlCompetitorId, p.name]),
		);

		const comments = [];
		const voters = new Set();
		const unmatched = new Set();
		for (const r of rows) {
			const person = byCompetitor.get(r.cid);
			if (!person) {
				unmatched.add(r.cid);
				continue;
			}
			voters.add(person);
			if (r.comment.trim()) comments.push({ person, comment: r.comment });
		}
		if (unmatched.size) {
			console.error(
				`[warn] ${unmatched.size} competitor id(s) in votes have no person mapping: ` +
					[...unmatched].join(', '),
			);
		}
		return { comments, voters };
	} finally {
		db.close();
	}
}

// ── dictionary ────────────────────────────────────────────────────────────────

function readDictionary() {
	const candidates = ['/usr/share/dict/words', '/usr/share/dict/american-english'];
	for (const p of candidates) {
		if (!fs.existsSync(p)) continue;
		const set = new Set();
		for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
			const w = line.trim().toLowerCase();
			// Skip possessives and proper nouns; neither should win "biggest word".
			if (!w || w.includes("'") || line[0] !== line[0]?.toLowerCase()) continue;
			set.add(w);
		}
		return set;
	}
	console.error('[warn] no system dictionary found — THE BIGGEST WORD will be null');
	return undefined;
}

// ── main ──────────────────────────────────────────────────────────────────────

const messages = parseExport(readExportText(ZIP));
const { comments: voteComments, voters } = readVoteComments(DB);
const dictionary = readDictionary();

console.error(
	`[info] ${messages.length} messages parsed, ${voters.size} voters, ` +
		`${voteComments.length} vote comments, ${dictionary?.size ?? 0} dictionary words`,
);

// Google's 10k English words, most-frequent first. Anything outside the top
// 1,000 counts as "rare".
const commonWords = fs
	.readFileSync(path.join(UI, 'src/lib/digest/common-words.txt'), 'utf8')
	.split('\n')
	.map((w) => w.trim())
	.filter(Boolean);

const result = computeSuperlatives(
	messages,
	voteComments,
	{ dictionary, commonWords, commonCutoff: 1000 },
	voters,
);
process.stdout.write(JSON.stringify(result, null, 2));
