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
const { computeSuperlatives, prose, words } = await jiti.import(
	path.join(UI, 'src/lib/digest/chatSuperlatives.ts'),
);
const { PEOPLE, isUnknownSender, resolveSender } = await jiti.import(
	path.join(UI, 'src/lib/digest/chatIdentity.ts'),
);

// Latest full-history export wins; BOARZ_EXPORT_ZIP overrides. The dated
// `whatsapp-boarz-chat-export-*.zip` drops supersede the original July export.
function latestExportZip() {
	if (process.env.BOARZ_EXPORT_ZIP) return path.resolve(process.env.BOARZ_EXPORT_ZIP);
	const dir = path.join(ROOT, 'data/boarz-ii-men/season-1');
	const dated = fs
		.readdirSync(dir)
		.filter((f) => /^whatsapp-boarz-chat-export-.*\.zip$/.test(f))
		.sort((a, b) => fs.statSync(path.join(dir, a)).mtimeMs - fs.statSync(path.join(dir, b)).mtimeMs);
	if (dated.length) return path.join(dir, dated[dated.length - 1]);
	return path.join(dir, 'WhatsApp Chat with Boarz II Men - Music League.zip');
}
const ZIP = latestExportZip();
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

console.error(`[info] export: ${path.relative(ROOT, ZIP)}`);
const messages = parseExport(readExportText(ZIP));
// A new member or renamed contact silently vanishes from every metric —
// surface it loudly instead.
const unknown = [...new Set(messages.map((m) => m.sender).filter(isUnknownSender))];
if (unknown.length) {
	console.error(`[warn] unknown sender(s) dropped from all metrics: ${unknown.join(', ')}`);
}
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

// Recency window — the six Mixing Board metrics over the last 14 days of the
// export, so charts can pivot between "season" and "lately".
const RECENT_DAYS = 14;
const URL_RE = /https?:\/\/\S+/g;
const maxTs = messages.reduce((m, x) => Math.max(m, x.ts), 0);
const cutoff = maxTs - RECENT_DAYS * 24 * 60 * 60 * 1000;
const recent = new Map();
for (const m of messages) {
	if (m.ts < cutoff) continue;
	const p = resolveSender(m.sender);
	if (!p) continue;
	let a = recent.get(p.name);
	if (!a) {
		a = { name: p.name, messages: 0, words: 0, characters: 0, edits: 0, mediaShared: 0, links: 0 };
		recent.set(p.name, a);
	}
	a.messages++;
	if (m.edited) a.edits++;
	if (m.media) a.mediaShared++;
	const links = m.text.match(URL_RE);
	if (links) a.links += links.length;
	const body = prose(m);
	a.words += words(body).length;
	a.characters += body.length;
}
result.recent = {
	days: RECENT_DAYS,
	since: new Date(cutoff).toISOString(),
	people: result.people.map(
		(p) =>
			recent.get(p.name) ?? {
				name: p.name, messages: 0, words: 0, characters: 0, edits: 0, mediaShared: 0, links: 0,
			},
	),
};

process.stdout.write(JSON.stringify(result, null, 2));
