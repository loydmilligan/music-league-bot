export interface SongRatings {
  discovery: number | null;
  themeFit: number | null;
  quality: number | null;
  replayability: number | null;
}

export type RatingMode = 'bars' | 'mini' | 'chip' | 'dots' | 'fingerprint' | 'strata' | 'none';
export type HistoryStatus = 'song-mine' | 'song-others' | 'artist-mine' | 'artist-others' | null;
export type ActionId =
  | 'shortlist' | 'research' | 'h2h' | 'assign' | 'play' | 'ytm'
  | 'analyze' | 'notes' | 'save' | 'submitted' | 'dismiss' | 'remove' | 'winner';
export type LayerId = 'state' | 'rating' | 'meta' | 'tags' | 'badges' | 'corpus' | 'chat' | 'notes' | 'analyze';
export type AccentColor = 'accent' | 'moss' | 'sky' | 'amber' | 'ember';

export interface SongArt { url: string; }

export interface SongPopularity {
  proxy: number;
  obscurity: number;
  bucket: 'radioHit' | 'known' | 'deepCut' | 'rabbitHole';
}

export interface SongAudio {
  bpm: number;
  key: string;
  scale: string;
  energy: number;
}

export interface SongMetadata {
  popularity?: SongPopularity;
  tags?: string[];
  audio?: SongAudio;
  hasLyrics?: boolean | null;
  enrichState?: 'none' | 'running' | 'done';
}

export interface SongCorpusEntry {
  by: string;
  mine: boolean;
  league?: string;
  season?: number;
  round?: string;
  points?: number;
}

export interface SongCorpusMention {
  by: string;
  quote: string;
}

export interface SongCorpus {
  appearances: number;
  submitters: string[];
  chatMentions: number;
  artistMine?: boolean;
  entries?: SongCorpusEntry[];
  chatList?: SongCorpusMention[];
}

export interface SongBadges {
  medals?: number;
  gold?: number;
  silver?: number;
  bronze?: number;
  bigDiscussion?: boolean;
  artistBigDiscussion?: boolean;
  poop?: boolean;
}

export interface ChatMention {
  text: string;
  sender: string;
  senderTone: string;
  chatName: string;
  tone: string;
  intent?: string;
  time?: string;
  priors?: { text: string; sender: string; tone: string }[];
}

export interface SongChat {
  mentionCount: number;
  chats: { name: string; tone: string }[];
  intent?: string;
  mentions: ChatMention[];
}

export interface SongContext {
  corpus?: SongCorpus;
  badges?: SongBadges;
  artistBadges?: SongBadges;
  chat?: SongChat;
  assignments?: string[];
  submittedElsewhere?: boolean;
  submittedByOther?: string | false | null;
  saveForFuture?: boolean;
  historyStatus?: HistoryStatus;
  rank?: number;
  points?: number;
  submitter?: string;
}

export interface Song {
  id: string;
  spotifyUri: string | null;
  ytmUrl: string | null;
  title: string;
  artist: string;
  album: string;
  year: number | null;
  art: SongArt | null;
  durationSec: number;
  ratings: SongRatings;
  metadata: SongMetadata;
  context: SongContext;
}

export interface SongCardConfig {
  ratingMode?: RatingMode;
  ratingEditable?: boolean;
  art?: boolean;
  artPx?: number;
  bucket?: boolean;
  duration?: boolean;
  showAlbum?: boolean;
  accent?: AccentColor;
  layers?: LayerId[];
  actions?: ActionId[];
  actionStyle?: 'inline' | 'reveal' | 'menu';
  expandedConfig?: Partial<SongCardConfig>;
  shortlisted?: boolean;
  noteText?: string;
  /** Mobile row trailing display. Defaults to 'mini' (mini rating bars). */
  mobileTrailing?: 'mini' | 'score' | 'none';
  /** Show bucket-category dot on mobile art corner. */
  mobileBucketDot?: boolean;
}

export const DIMS = [
  { key: 'discovery',     label: 'DSC', full: 'Discovery',     color: 'var(--sky)' },
  { key: 'themeFit',      label: 'THM', full: 'Theme fit',     color: 'var(--mash-pulp)' },
  { key: 'quality',       label: 'QLT', full: 'Quality',       color: 'var(--moss)' },
  { key: 'replayability', label: 'RPL', full: 'Replayability', color: 'var(--amber)' },
] as const;

export const BUCKETS = {
  radioHit:   { label: 'radio hit',   cls: 'radioHit' },
  known:      { label: 'known',       cls: 'known' },
  deepCut:    { label: 'deep cut',    cls: 'deepCut' },
  rabbitHole: { label: 'rabbit hole', cls: 'rabbitHole' },
} as const;

export const EMPTY_RATINGS: SongRatings = {
  discovery: null, themeFit: null, quality: null, replayability: null,
};

export const fmtDur = (s: number | null | undefined): string =>
  s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '';

export function makeSong(partial: Partial<Song>): Song {
  const id = String((partial as Record<string, unknown>).id ?? partial.spotifyUri ?? '');
  return {
    id,
    spotifyUri: null, ytmUrl: null,
    title: 'Untitled', artist: '', album: '', year: null,
    art: null, durationSec: 0,
    ...partial,
    ratings: { ...EMPTY_RATINGS, ...(partial.ratings ?? {}) },
    metadata: partial.metadata ?? {},
    context: partial.context ?? {},
  };
}
