/**
 * chatIdentity — the Boarz roster, for the standalone export-based page ONLY.
 *
 * SCOPE: this is a hardcoded, single-league roster. It is correct for the
 * Boarz Tape page, which parses a WhatsApp export whose sender names come from
 * a contact list and are already clean.
 *
 * Do NOT use it for the digest. It has no league scoping, so running it against
 * another league resolves only the people who happen to also be in Boarz —
 * Second Best resolved just Matt and Jon and lost 116 of 167 messages. It also
 * guessed "~ Dave" was Dave Jensen where player_identities has Dave Steingart.
 * The digest builds a league-scoped roster from the database instead; see
 * chatRoster.ts.
 */

export interface Person {
	/** Canonical display name. */
	name: string;
	/** players.id, or null for chat-only participants. */
	playerId: number | null;
	/** competitors.ml_competitor_id, or null if they never competed. */
	mlCompetitorId: string | null;
	/** Joined mid-season; excluded from vote-linked metrics. */
	rookie: boolean;
}

export const PEOPLE: Person[] = [
	{ name: 'Grant Koziol', playerId: 30, mlCompetitorId: '460d237b12ff453f95f8d6c11e56d7c4', rookie: false },
	// players rows 1 and 4 have no ml_competitor_id; these come from the
	// competitors table, where they compete under other names ("Mashew",
	// "Jonathan Black").
	{ name: 'Matt Mariani', playerId: 1, mlCompetitorId: '2f0b5460e6ad4c9a9203f605c3ca0ad5', rookie: false },
	{ name: 'Jon Black', playerId: 4, mlCompetitorId: '02b8d5a0363f474bae7230a9d12cd34e', rookie: false },
	{ name: 'Conor Johnston', playerId: 32, mlCompetitorId: '52f8833c8da44d93b3476a9937f1ea4a', rookie: false },
	{ name: 'Dave Jensen', playerId: 34, mlCompetitorId: 'abf2c22836f14f1f887f753839331c49', rookie: false },
	{ name: 'Clements Johnson', playerId: 35, mlCompetitorId: 'cceba45dc2fe404693d8f58bb496882b', rookie: false },
	{ name: 'Shane Farkas', playerId: 31, mlCompetitorId: '4a21ed3e261643088654ff2f906c3b7a', rookie: false },
	// players.id 36 is misspelled "Darren Paletz" in the DB; the export is right.
	{ name: 'Darren Pallets', playerId: 36, mlCompetitorId: '7007caa2a0f24181a8024948c387ee8f', rookie: false },
	{ name: 'Dave Steingart', playerId: 33, mlCompetitorId: '583049ce3b11466f94d937e933c49ae0', rookie: false },
	// No players row, no competitor id — joined after round 1.
	{ name: 'Jimmy', playerId: null, mlCompetitorId: null, rookie: true },
];

/**
 * Sender string → canonical name, keyed by `normalizeSender` output, so the
 * tilde prefix and the narrow-no-break space are already stripped.
 */
const ALIASES: Record<string, string> = {
	'+1 (786) 626-6895': 'Grant Koziol',
	grant: 'Grant Koziol',
	'matt mariani': 'Matt Mariani',
	mashew: 'Matt Mariani',
	'jon black': 'Jon Black',
	'jonathan black': 'Jon Black',
	jb: 'Jon Black',
	'conor johnston': 'Conor Johnston',
	'conor j': 'Conor Johnston',
	'dave jensen': 'Dave Jensen',
	'david jensen': 'Dave Jensen',
	dave: 'Dave Jensen',
	djensen37: 'Dave Jensen',
	'clements johnson': 'Clements Johnson',
	clements: 'Clements Johnson',
	'shane farkas': 'Shane Farkas',
	shane: 'Shane Farkas',
	'darren pallets': 'Darren Pallets',
	'darren paletz': 'Darren Pallets',
	darren: 'Darren Pallets',
	'dave steingart': 'Dave Steingart',
	jimmy: 'Jimmy',
};

/**
 * Senders that are not people: WhatsApp group-event pseudo-senders, and the
 * group's own name. Resolving these to a person would invent chat activity.
 */
const NON_PARTICIPANTS = new Set([
	'mentioned all',
	'boarz ii men - music league',
	'whatsapp',
]);

const BY_NAME = new Map(PEOPLE.map((p) => [p.name, p]));

/**
 * Fold a raw sender string to a comparable key.
 *
 * WhatsApp's relay writes the "not in your contacts" marker as a tilde followed
 * by U+202F NARROW NO-BREAK SPACE — not a regular space. Matching literal
 * strings therefore fails on every relay-captured row while working fine on the
 * export, which is exactly the kind of difference that survives testing and
 * breaks in production. Normalising kills that whole class of bug, and lets one
 * entry cover "~ Dave", "~ David Jensen" and "Dave Jensen" alike.
 */
export function normalizeSender(raw: string): string {
	return raw
		.replace(/[   ⁠]/g, ' ')
		.replace(/^\s*~\s*/, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/**
 * Resolve a raw sender to a canonical person.
 *
 * Returns null for group pseudo-senders AND for anyone unrecognised. Unknown
 * senders must not throw here: this runs on every weekly digest, and a new
 * member joining the group is a normal event, not a reason to fail the run.
 * Use `resolveSenderStrict` for curated one-off analysis where silence is worse.
 */
export function resolveSender(raw: string): Person | null {
	const key = normalizeSender(raw);
	if (!key || NON_PARTICIPANTS.has(key)) return null;
	const canonical = ALIASES[key];
	return canonical ? BY_NAME.get(canonical) ?? null : null;
}

/** True when the sender is neither a known person nor a known non-participant. */
export function isUnknownSender(raw: string): boolean {
	const key = normalizeSender(raw);
	return !!key && !NON_PARTICIPANTS.has(key) && !ALIASES[key];
}

/** Throws on an unrecognised sender rather than silently dropping them. */
export function resolveSenderStrict(raw: string): Person | null {
	if (isUnknownSender(raw)) {
		throw new Error(
			`chatIdentity: unrecognised sender ${JSON.stringify(raw)}. ` +
				`Add it to ALIASES or NON_PARTICIPANTS — do not let it become a new person.`,
		);
	}
	return resolveSender(raw);
}

export function personByName(name: string): Person | undefined {
	return BY_NAME.get(name);
}
