export type Accent = 'pulp' | 'amber' | 'sky' | 'moss' | 'ember';

export interface SignatureArtist { name: string; star?: boolean; }
export interface PeerScore { who: string; pct: number; label: string; }
export interface StatEntry { submitted: number; avgPts: number; wins: number; bestRound?: string; }
export interface FanHaterEntry { who: string; pts: number; line?: string; }
export interface SpectrumAxis { left: string; right: string; value: number; }
export interface SignatureSuperlative { award: string; blurb: string; }
export interface SuperlativeItem { award: string; accent: Accent; blurb: string; }
export interface PlaylistTrack { title: string; artist: string; why: string; }
export interface Playlist { name: string; nudge: string; tracks: PlaylistTrack[]; }

export interface FullMember {
	id: string; name: string; initials: string; hue: string; tier: 'full';
	joined?: string; headline?: string; avatar_url?: string | null;
	signatureArtists: SignatureArtist[];
	genres: string[]; eras: string[];
	rewards: string[]; punishes: string[];
	spectrum: [SpectrumAxis, SpectrumAxis, SpectrumAxis];
	signatureSuperlative: SignatureSuperlative;
	superlatives: SuperlativeItem[];
	biggestFan?: FanHaterEntry; biggestHater?: FanHaterEntry;
	voteTwins: PeerScore[]; voteTogether: PeerScore[];
	playlist: Playlist;
	stat: StatEntry;
}

export interface LiteMember {
	id: string; name: string; initials: string; hue: string; tier: 'lite';
	joined?: string; headline?: string; avatar_url?: string | null;
	signatureArtists: SignatureArtist[];
	genres: string[]; eras: string[];
	signatureSuperlative: SignatureSuperlative;
	biggestFan?: FanHaterEntry;
	stat: StatEntry;
}

export type Member = FullMember | LiteMember;

export interface KpiItem { value: string; label: string; sub: string; }

export interface MomentItem {
	title: string; artist: string; submitter: string;
	round: string | number; line: string;
}
export interface Moments {
	mostLoved: MomentItem; mostDivisive: MomentItem; biggestUpset: MomentItem;
}

export interface ReelItem { award: string; winner: string; accent: Accent; blurb: string; }

export interface ArchiveEntry {
	n: number; season: number; theme: string;
	winnerSong: string; winnerArtist: string; submitter: string;
	date: string; votes: number; hue: string; digestUrl?: string | null;
}

export interface LeagueMeta {
	name: string; slug?: string; season: number; round: number;
	seasons: number; memberCount: number; updated: string;
}

export interface ReadModel {
	league: LeagueMeta;
	members: Member[];
	reel: ReelItem[];
	kpis: KpiItem[];
	moments: Moments | null;
	archive: ArchiveEntry[];
	seasonUpdate: { title: string; body: string } | null;
}

export interface SharePayload {
	award: string; blurb: string;
	who: string; hue: string; initials: string;
	accent: Accent;
}

export interface Nav {
	goHome: () => void;
	goArchive: () => void;
	goProfile: (id: string) => void;
	openShare: (p: SharePayload) => void;
}
