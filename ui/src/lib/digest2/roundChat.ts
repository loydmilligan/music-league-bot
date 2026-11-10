import type Database from 'better-sqlite3';
import type { Snapshot } from '$lib/server/boarzStats/data.js';
import { canonicalSender, dayOfTs } from '$lib/server/boarzStats/chat.js';
import { buildLaughTrack, readLaughReactions, type LaughMsg, type LaughTrack } from '$lib/server/boarzStats/laughs.js';

/**
 * The round's own window: its start (else the previous round's close, as in
 * chrome.ts) to its voting close (else the deadline). The stats snapshot spans the
 * whole season up to its LATEST closed round, so a digest for an older round needs
 * this explicit bound or its "this round" views would count later weeks too.
 */
export function roundWindow(db: Database.Database, roundId: number): { from: string; to: string } | null {
	const r = db
		.prepare(
			`SELECT r.round_started_at AS started, r.voting_ended_at AS ended, r.voting_deadline AS deadline,
			        (SELECT p.voting_ended_at FROM rounds p
			          WHERE p.season_id = r.season_id AND p.round_number = r.round_number - 1) AS prevEnded
			   FROM rounds r WHERE r.id = ?`
		)
		.get(roundId) as { started: string | null; ended: string | null; deadline: string | null; prevEnded: string | null } | undefined;
	const from = r?.started ?? r?.prevEnded ?? null;
	const to = r?.ended ?? r?.deadline ?? null;
	return from && to ? { from, to } : null;
}

export function roundEndDayFor(db: Database.Database, roundId: number): string | null {
	const w = roundWindow(db, roundId);
	return w ? dayOfTs(w.to) : null;
}

/**
 * 😂 Tear Forecast for this round only (the snapshot's `laughTrack` is the season).
 * Additive and isolated like the season one: any failure returns null and the card
 * falls back to the season view.
 */
export function buildRoundLaughTrack(db: Database.Database, roundId: number, snap: Snapshot): LaughTrack | null {
	try {
		const w = roundWindow(db, roundId);
		if (!w) return null;
		const map = JSON.parse(
			((db.prepare(`SELECT value FROM settings WHERE key = 'chat_league_group_map'`).get() as { value?: string } | undefined)?.value) ?? '{}'
		) as Record<string, string>;
		const group = map[snap.league.slug] ?? '';
		if (!group) return null;
		const rows = db
			.prepare(`SELECT sender, text, ts FROM chat_messages WHERE group_name = ? AND ts >= ? AND ts <= ? ORDER BY ts`)
			.all(group, w.from, w.to) as LaughMsg[];
		mapSendersToHandles(db, rows, snap.competitors);
		const displayByKey = new Map(snap.chat.people.map((p) => [p.key, p.display]));
		return buildLaughTrack(rows, snap.competitors, (k) => displayByKey.get(k) ?? k, readLaughReactions(db, group, w.from, w.to));
	} catch {
		return null;
	}
}

/**
 * Same WhatsApp-name → league-handle upgrade buildSnapshot applies to its chat rows
 * (server/boarzStats/data.ts, "Map chat senders the static alias table doesn't
 * know"). Copied rather than extracted so the snapshot builder stays untouched;
 * keep the two in step.
 */
function mapSendersToHandles(db: Database.Database, rows: LaughMsg[], competitors: { id: number }[]): void {
	try {
		const ws = (v: string) => v.replace(/[  ]/g, ' ').trim();
		const compNameByPlayer = new Map<number, string>();
		for (const row of db
			.prepare(`SELECT id, name, player_id FROM competitors WHERE id IN (${competitors.map(() => '?').join(',') || 'NULL'}) AND player_id IS NOT NULL`)
			.all(...competitors.map((c) => c.id)) as { id: number; name: string; player_id: number }[]) {
			compNameByPlayer.set(row.player_id, row.name);
		}
		const handleBySender = new Map<string, string>();
		for (const row of db
			.prepare(`SELECT identifier, player_id FROM player_identities WHERE identity_type = 'whatsapp'`)
			.all() as { identifier: string; player_id: number }[]) {
			const handle = compNameByPlayer.get(row.player_id);
			if (handle && !handleBySender.has(ws(row.identifier))) handleBySender.set(ws(row.identifier), handle);
		}
		for (const m of rows) {
			if (canonicalSender(m.sender) != null) continue;
			const handle = handleBySender.get(ws(m.sender));
			if (handle) m.sender = handle;
		}
	} catch {
		/* best-effort, as in buildSnapshot */
	}
}
