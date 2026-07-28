/**
 * chatRoster — who is who in a given league's chat.
 *
 * Reads `player_identities`, which already maps WhatsApp/Google-Chat display
 * names to players and is scoped by `league_id`. That scoping is what keeps
 * leagues isolated: Second Best's digest resolves Second Best's roster, and a
 * person in both leagues (Matt, Jon) is looked up under each league separately
 * rather than through one shared table.
 *
 * Replaces a hardcoded roster built for the one-off Boarz page. That map was
 * wrong as well as unshareable — it guessed "~ Dave" was Dave Jensen, where
 * player_identities correctly has Dave Steingart, mis-crediting 33 messages.
 * Identity belongs in the database the humans maintain, not in source.
 */

import type Database from 'better-sqlite3';

export interface ChatPerson {
	/** Canonical display name. */
	name: string;
	playerId: number | null;
	/** True when nobody has mapped this sender to a player yet. */
	unmapped: boolean;
}

export interface ChatRoster {
	/** normalizeSender() key → person. */
	resolve(rawSender: string): ChatPerson | null;
	/** Senders seen in the chat with no player_identities row. */
	unmapped: string[];
	/** How many identities were loaded, for diagnostics. */
	mappedCount: number;
}

/**
 * Fold a raw sender to a comparable key.
 *
 * WhatsApp writes the "not in your contacts" marker as a tilde plus U+202F
 * NARROW NO-BREAK SPACE, not a regular space, so literal matching silently
 * fails on relay rows while working on exports. player_identities stores some
 * identifiers with the tilde ("~ Conor J") and some without ("Darren Pallets"),
 * so both sides get normalised and the distinction stops mattering.
 */
export function normalizeSender(raw: string): string {
	return raw
		.replace(/[  ⁠⁨⁩]/g, ' ')
		.replace(/^\s*~\s*/, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/**
 * Senders that are not people — WhatsApp group-event pseudo-senders. Resolving
 * these would invent a chat participant out of a system notice.
 */
const NON_PARTICIPANTS = new Set(['mentioned all', 'whatsapp', 'you']);

/** Strip the tilde for display, so an unmapped sender reads as a name. */
export function displayName(raw: string): string {
	const cleaned = raw
		.replace(/[  ]/g, ' ')
		.replace(/^\s*~\s*/, '')
		.replace(/\s+/g, ' ')
		.trim();
	return cleaned || raw;
}

/**
 * Build the roster for one league's chat group.
 *
 * Unmapped senders are NOT dropped. Dropping them looked tidy on Boarz, whose
 * roster happened to be hardcoded, and destroyed Second Best: only Matt and Jon
 * resolved (the two people also in Boarz) and 116 of 167 messages vanished.
 * An unmapped human is still a participant; they are surfaced so someone can
 * link them in /settings/setup.
 */
export function buildChatRoster(
	db: Database.Database,
	leagueId: number,
	sendersSeen: Iterable<string> = [],
	platform: 'whatsapp' | 'google-chat' = 'whatsapp',
	/** The group's own name — WhatsApp emits it as a sender on group events. */
	groupName?: string,
): ChatRoster {
	const groupKey = groupName ? normalizeSender(groupName) : null;
	const rows = db
		.prepare(
			`SELECT pi.identifier, p.id AS player_id, p.name
			   FROM player_identities pi
			   JOIN players p ON p.id = pi.player_id
			  WHERE pi.identity_type = ?
			    AND (pi.league_id = ? OR pi.league_id IS NULL)`,
		)
		.all(platform, leagueId) as { identifier: string; player_id: number; name: string }[];

	const byKey = new Map<string, ChatPerson>();
	for (const r of rows) {
		const key = normalizeSender(r.identifier);
		if (!key) continue;
		// League-scoped rows win over the global (league_id IS NULL) ones.
		if (!byKey.has(key)) byKey.set(key, { name: r.name, playerId: r.player_id, unmapped: false });
	}

	const unmapped = new Set<string>();
	// Anyone seen in the chat but absent from player_identities becomes their own
	// participant, keyed on their display name so their messages still count.
	for (const raw of sendersSeen) {
		const key = normalizeSender(raw);
		if (!key || NON_PARTICIPANTS.has(key) || key === groupKey || byKey.has(key)) continue;
		unmapped.add(raw);
		byKey.set(key, { name: displayName(raw), playerId: null, unmapped: true });
	}

	return {
		resolve(rawSender: string): ChatPerson | null {
			const key = normalizeSender(rawSender);
			if (!key || NON_PARTICIPANTS.has(key) || key === groupKey) return null;
			return byKey.get(key) ?? null;
		},
		unmapped: [...unmapped],
		mappedCount: rows.length,
	};
}
