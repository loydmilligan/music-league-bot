/**
 * chatIdentity — one canonical person per human, across two messy sources.
 *
 * The WhatsApp export names people from Matt's contact list (10 clean names).
 * chat_messages holds 21 sender strings for those same 10 people, because the
 * Android relay sees WhatsApp's own display strings ("~ Grant" for anyone not
 * in the relay phone's contacts). Canonical spelling follows the export.
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

/** Raw sender string (export or chat_messages) → canonical name. */
const ALIASES: Record<string, string> = {
	// Export senders
	'+1 (786) 626-6895': 'Grant Koziol',
	'Matt Mariani': 'Matt Mariani',
	'Jon Black': 'Jon Black',
	'Conor Johnston': 'Conor Johnston',
	'Dave Jensen': 'Dave Jensen',
	'Clements Johnson': 'Clements Johnson',
	'Shane Farkas': 'Shane Farkas',
	'Darren Pallets': 'Darren Pallets',
	'Dave Steingart': 'Dave Steingart',
	Jimmy: 'Jimmy',

	// chat_messages relay variants
	'~ Grant': 'Grant Koziol',
	'~ JB': 'Jon Black',
	'~ Conor J': 'Conor Johnston',
	'Conor J': 'Conor Johnston',
	'~ Dave': 'Dave Jensen',
	'David Jensen': 'Dave Jensen',
	'~ Shane': 'Shane Farkas',
	'~ Darren': 'Darren Pallets',
	'~ Jimmy': 'Jimmy',
	'~ Clements': 'Clements Johnson',
	'Darren Paletz': 'Darren Pallets',
};

const BY_NAME = new Map(PEOPLE.map((p) => [p.name, p]));

/**
 * Resolve a raw sender to a canonical person.
 * Returns null for non-participants (group-event pseudo-senders like
 * "Mentioned all" or the group's own name). Throws on an unrecognised
 * human-looking sender rather than silently minting an 11th person.
 */
export function resolveSender(raw: string): Person | null {
	const key = raw.trim();
	const NON_PARTICIPANTS = new Set([
		'Mentioned all',
		'Boarz II Men - Music League',
		'WhatsApp',
	]);
	if (NON_PARTICIPANTS.has(key)) return null;

	const canonical = ALIASES[key];
	if (!canonical) {
		throw new Error(
			`chatIdentity: unrecognised sender ${JSON.stringify(key)}. ` +
				`Add it to ALIASES or NON_PARTICIPANTS — do not let it become a new person.`,
		);
	}
	return BY_NAME.get(canonical) ?? null;
}

export function personByName(name: string): Person | undefined {
	return BY_NAME.get(name);
}
