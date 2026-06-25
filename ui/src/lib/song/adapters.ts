import type { Song, SongRatings, SongContext, SongChat, HistoryStatus } from './canonical.js';
import { EMPTY_RATINGS } from './canonical.js';

const clamp05 = (n: number | null | undefined): number | null =>
  n == null ? null : Math.max(0, Math.min(5, n));

// H2H stores on 1–5; rescale to 0–5
const rescale1to5 = (n: number | null | undefined): number | null =>
  n == null ? null : clamp05(Math.round((n - 1) * (5 / 4)));

const pickArt = (r: Record<string, unknown>): { url: string } | null => {
  const url =
    (r.art && typeof r.art === 'object' && (r.art as { url?: string }).url)
    || (r.coverUrl as string)
    || (r.albumArtUrl as string)
    || (r.album_art_url as string)
    || (r.imageUrl as string)
    || null;
  return url ? { url: String(url) } : null;
};

function baseSong(r: Record<string, unknown>): Song {
  return {
    id: String(r.id ?? r.uri ?? r.spotifyUri ?? ''),
    spotifyUri: (r.spotifyUri as string) || (r.uri as string) || null,
    ytmUrl: (r.ytmUrl as string) || (r.ytm_link as string) || null,
    title: (r.title as string) || (r.name as string) || 'Untitled',
    artist: (r.artist as string) || '',
    album: (r.album as string) || '',
    year: (r.year as number) || null,
    art: pickArt(r),
    durationSec: (r.durationSec as number) || (r.durationMs ? Math.round((r.durationMs as number) / 1000) : 0),
    ratings: { ...EMPTY_RATINGS },
    metadata: {},
    context: {},
  };
}

export interface SongStatusMap {
  [spotifyUri: string]: HistoryStatus;
}

export const adapters = {
  fromSpotify(r: Record<string, unknown>, statusMap?: SongStatusMap): Song {
    const s = baseSong(r);
    if (statusMap && s.spotifyUri) {
      s.context = { historyStatus: statusMap[s.spotifyUri] ?? null };
    }
    return s;
  },

  fromShortlist(r: Record<string, unknown>): Song {
    const s = baseSong(r);
    const ratings = r as {
      ratingDiscovery?: number | null;
      ratingThemeFit?: number | null;
      ratingQuality?: number | null;
      ratingPersonal?: number | null;
      ratingReplayability?: number | null;
    };
    s.ratings = {
      discovery: clamp05(ratings.ratingDiscovery),
      themeFit: clamp05(ratings.ratingThemeFit),
      quality: clamp05(ratings.ratingQuality != null ? ratings.ratingQuality : ratings.ratingPersonal),
      replayability: clamp05(ratings.ratingReplayability),
    };
    const rawAssignments = (r.assignments as { roundId?: number | string }[]) || [];
    s.context = {
      assignments: rawAssignments.map(a => String(a.roundId ?? a)),
      submittedElsewhere: !!(r.submittedElsewhere),
      badges: r.badges as SongContext['badges'],
      corpus: r.corpus as SongContext['corpus'],
    };
    if (r.tags || r.popularity || r.audio) {
      s.metadata = {
        tags: r.tags as string[],
        popularity: r.popularity as Song['metadata']['popularity'],
        audio: r.audio as Song['metadata']['audio'],
        hasLyrics: r.hasLyrics as boolean | null,
        enrichState: r.enrichState as Song['metadata']['enrichState'],
      };
    }
    return s;
  },

  fromResearch(r: Record<string, unknown>): Song {
    const s = baseSong(r);
    const ratings = r as {
      discoveryPotential?: number | null;
      themeFit?: number | null;
      quality?: number | null;
      personalRating?: number | null;
      replayability?: number | null;
    };
    s.ratings = {
      discovery: clamp05(ratings.discoveryPotential),
      themeFit: clamp05(ratings.themeFit),
      quality: clamp05(ratings.quality != null ? ratings.quality : ratings.personalRating),
      replayability: clamp05(ratings.replayability),
    };
    s.context = {
      saveForFuture: !!(r.saveForFuture),
      submittedByOther: (r.submittedByOther as string | false) || null,
    };
    s.metadata = {
      tags: r.tags as string[],
      popularity: r.popularity as Song['metadata']['popularity'],
      audio: r.audio as Song['metadata']['audio'],
      hasLyrics: r.hasLyrics as boolean | null,
      enrichState: r.enrichState as Song['metadata']['enrichState'],
    };
    return s;
  },

  fromH2H(r: Record<string, unknown>): Song {
    const s = baseSong(r);
    const ratings = r as {
      discoveryPotential?: number | null;
      themeFit?: number | null;
      quality?: number | null;
      personalRating?: number | null;
      replayability?: number | null;
    };
    s.ratings = {
      discovery: rescale1to5(ratings.discoveryPotential),
      themeFit: rescale1to5(ratings.themeFit),
      quality: rescale1to5(ratings.quality != null ? ratings.quality : ratings.personalRating),
      replayability: rescale1to5(ratings.replayability),
    };
    return s;
  },

  fromChat(r: Record<string, unknown>): Song {
    const s = baseSong(r);
    const chatNames = (r.chatNames as string[]) || [];
    const TONES = ['sky', 'amber', 'moss', 'pulp', 'ember'] as const;
    const chatToneMap: Record<string, string> = Object.fromEntries(
      chatNames.map((n, i) => [n, TONES[i % TONES.length]])
    );
    const senderToneMap: Record<string, string> = {};
    let toneIdx = 0;
    function senderTone(name: string): string {
      if (!senderToneMap[name]) senderToneMap[name] = TONES[toneIdx++ % TONES.length];
      return senderToneMap[name];
    }
    function fmtTime(iso?: string): string | undefined {
      if (!iso) return undefined;
      const ms = Date.now() - Date.parse(iso);
      const min = Math.floor(ms / 60000);
      if (min < 60) return min <= 1 ? 'just now' : `${min}m ago`;
      const h = Math.floor(ms / 3600000);
      if (h < 24) return `${h}h ago`;
      const d = Math.floor(ms / 86400000);
      if (d < 30) return `${d}d ago`;
      return `${Math.round(d / 30)}mo ago`;
    }
    type RawMention = {
      rawMessage?: string; senderName?: string; chatName?: string;
      intent?: string; capturedAt?: string;
      priorMessages?: { text?: string; sender?: string }[];
    };
    const rawMentions = (r.mentions as RawMention[]) || [];
    const mentions: SongChat['mentions'] = rawMentions.map(m => ({
      text: m.rawMessage || '',
      sender: m.senderName || '',
      senderTone: senderTone(m.senderName || ''),
      chatName: m.chatName || '',
      tone: chatToneMap[m.chatName || ''] || 'muted',
      intent: m.intent,
      time: fmtTime(m.capturedAt),
      priors: (m.priorMessages || []).map(p => ({
        text: p.text || '',
        sender: p.sender || '',
        tone: senderTone(p.sender || ''),
      })),
    }));
    s.context = {
      chat: {
        mentionCount: (r.mentionCount as number) || mentions.length,
        chats: chatNames.map((n, i) => ({ name: n, tone: TONES[i % TONES.length] })),
        intent: rawMentions.at(-1)?.intent,
        mentions,
      },
      assignments: ((r.assignedRoundIds as number[]) || []).map(String),
    };
    return s;
  },

  fromPodium(r: Record<string, unknown>): Song {
    const s = baseSong(r);
    s.context = {
      rank: r.rank as number,
      points: r.points as number,
      submitter: r.submitter as string,
    };
    return s;
  },
};

export { clamp05, rescale1to5 };
