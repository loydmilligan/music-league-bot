import type Database from "better-sqlite3";
import { getWordFrequencies, type WordCloudWord } from '../digest/wordCloud.js';

const MAX_ARTISTS = 8;
const MAX_KEYS = 6;

export interface InsightCount {
  value: string;
  count: number;
}

export interface RoundAudioProfile {
  totalSongs: number;
  analyzedSongs: number;
  coveragePercent: number;
  medianBpm: number | null;
  bpmMin: number | null;
  bpmMax: number | null;
  averageEnergy: number | null;
  topKeys: InsightCount[];
  topScales: InsightCount[];
}

export interface RoundSubmissionTiming {
  submissionCount: number;
  deadline: string | null;
  measuredCount: number;
  lateCount: number | null;
  finalSixHoursCount: number | null;
  medianHoursBeforeDeadline: number | null;
  earliestHoursBeforeDeadline: number | null;
  latestHoursBeforeDeadline: number | null;
}

export interface RoundArtistLandscape {
  songCount: number;
  uniqueArtistCount: number;
  repeatedArtistCount: number;
  repeatRatePercent: number;
  topArtists: InsightCount[];
}

export interface RoundInsights {
  audio: RoundAudioProfile;
  submissionTiming: RoundSubmissionTiming;
  artists: RoundArtistLandscape;
  wordCloud: WordCloudWord[];
}

interface SubmissionRow {
  title: string;
  artists: string;
  created_at: string;
}

interface AudioRow {
  bpm: number;
  key: string;
  scale: string;
  energy: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function rounded(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function topCounts(counts: Map<string, number>, limit: number): InsightCount[] {
  return [...counts.entries()]
    .sort(([a, aCount], [b, bCount]) => bCount - aCount || a.localeCompare(b))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function firstArtist(artists: string): string {
  return artists.split(",")[0]?.trim() ?? "";
}

/**
 * Compute small, deterministic, read-only insights for a completed digest round.
 *
 * The result is intentionally bounded: artist/key distributions are capped and
 * no song-level rows or free-form text are returned. Missing audio or deadline
 * data yields null metrics instead of inferred values.
 */
export function getRoundInsights(
  db: Database.Database,
  roundId: number,
): RoundInsights {
  const submissions = db
    .prepare(
      `SELECT artists, created_at
              , title
       FROM ml_submissions
       WHERE round_id = ? AND competitor_id IS NOT NULL
       ORDER BY id`,
    )
    .all(roundId) as SubmissionRow[];

  const commentEntries = db
    .prepare(
      `SELECT comment AS text FROM votes
       WHERE round_id = ? AND comment IS NOT NULL AND TRIM(comment) <> ''
       UNION ALL
       SELECT comment AS text FROM ml_submissions
       WHERE round_id = ? AND competitor_id IS NOT NULL
         AND comment IS NOT NULL AND TRIM(comment) <> ''`,
    )
    .all(roundId, roundId) as { text: string }[];
  let chatEntries: { text: string }[] = [];
  try {
    chatEntries = db
      .prepare(
        `SELECT m.raw_message AS text
         FROM chat_mentions m
         JOIN chat_assignments a ON a.chat_song_id = m.song_id
         WHERE a.round_id = ? AND TRIM(m.raw_message) <> ''`,
      )
      .all(roundId) as { text: string }[];
  } catch {
    // Older databases may not have chat tables yet; comments still provide a
    // useful aggregate vocabulary and the insight remains available.
  }
  const lexicalNoise = new Set<string>();
  for (const row of submissions) {
    for (const token of `${row.title} ${row.artists}`.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (token.length >= 3) lexicalNoise.add(token);
    }
  }
  const competitorNames = db
    .prepare(
      `SELECT DISTINCT c.name
       FROM competitors c
       JOIN votes v ON v.voter_id = c.id
       WHERE v.round_id = ?`,
    )
    .all(roundId) as { name: string }[];
  for (const row of competitorNames) {
    for (const token of row.name.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (token.length >= 3) lexicalNoise.add(token);
    }
  }

  const audio = db
    .prepare(
      `SELECT a.bpm, a.key, a.scale, a.energy
       FROM ml_submissions s
       JOIN song_audio_features a ON a.spotify_uri = s.spotify_uri
       WHERE s.round_id = ? AND s.competitor_id IS NOT NULL
       GROUP BY s.spotify_uri
       ORDER BY s.id`,
    )
    .all(roundId) as AudioRow[];

  const bpms = audio.map((row) => Number(row.bpm)).filter(Number.isFinite);
  const energies = audio
    .map((row) => Number(row.energy))
    .filter(Number.isFinite);
  const keyCounts = new Map<string, number>();
  const scaleCounts = new Map<string, number>();
  for (const row of audio) {
    if (row.key.trim())
      keyCounts.set(row.key.trim(), (keyCounts.get(row.key.trim()) ?? 0) + 1);
    if (row.scale.trim())
      scaleCounts.set(
        row.scale.trim(),
        (scaleCounts.get(row.scale.trim()) ?? 0) + 1,
      );
  }

  const artistCounts = new Map<string, { label: string; count: number }>();
  for (const row of submissions) {
    const label = firstArtist(row.artists);
    if (!label) continue;
    const normalized = label.toLocaleLowerCase();
    const existing = artistCounts.get(normalized);
    if (existing) existing.count += 1;
    else artistCounts.set(normalized, { label, count: 1 });
  }
  const artistMap = new Map(
    [...artistCounts].map(([key, value]) => [key, value.count]),
  );
  const repeatedArtistCount = [...artistCounts.values()].filter(
    (artist) => artist.count > 1,
  ).length;

  const round = db
    .prepare("SELECT submission_deadline FROM rounds WHERE id = ?")
    .get(roundId) as { submission_deadline: string | null } | undefined;
  const deadline = round?.submission_deadline ?? null;
  const deadlineMs = deadline ? Date.parse(deadline) : NaN;
  const offsets = Number.isFinite(deadlineMs)
    ? submissions
        .map((row) => (deadlineMs - Date.parse(row.created_at)) / 3_600_000)
        .filter(Number.isFinite)
    : [];

  return {
    audio: {
      totalSongs: submissions.length,
      analyzedSongs: audio.length,
      coveragePercent: submissions.length
        ? Math.round((audio.length / submissions.length) * 100)
        : 0,
      medianBpm: median(bpms) === null ? null : rounded(median(bpms)!),
      bpmMin: bpms.length ? Math.min(...bpms) : null,
      bpmMax: bpms.length ? Math.max(...bpms) : null,
      averageEnergy: energies.length
        ? rounded(
            energies.reduce((sum, value) => sum + value, 0) / energies.length,
            2,
          )
        : null,
      topKeys: topCounts(keyCounts, MAX_KEYS),
      topScales: topCounts(scaleCounts, MAX_KEYS),
    },
    submissionTiming: {
      submissionCount: submissions.length,
      deadline,
      measuredCount: offsets.length,
      lateCount: Number.isFinite(deadlineMs)
        ? offsets.filter((hours) => hours < 0).length
        : null,
      finalSixHoursCount: Number.isFinite(deadlineMs)
        ? offsets.filter((hours) => hours >= 0 && hours <= 6).length
        : null,
      medianHoursBeforeDeadline:
        median(offsets) === null ? null : rounded(median(offsets)!),
      earliestHoursBeforeDeadline: offsets.length
        ? rounded(Math.max(...offsets))
        : null,
      latestHoursBeforeDeadline: offsets.length
        ? rounded(Math.min(...offsets))
        : null,
    },
    artists: {
      songCount: submissions.length,
      uniqueArtistCount: artistCounts.size,
      repeatedArtistCount,
      repeatRatePercent: artistCounts.size
        ? Math.round((repeatedArtistCount / artistCounts.size) * 100)
        : 0,
      topArtists: topCounts(artistMap, MAX_ARTISTS).map((entry) => ({
        ...entry,
        value:
          artistCounts.get(entry.value.toLocaleLowerCase())?.label ??
          entry.value,
      })),
    },
    wordCloud: getWordFrequencies(
      [...commentEntries, ...chatEntries].map((entry) => ({
        text: entry.text,
        source: chatEntries.includes(entry) ? 'chat' : 'comment',
      })),
      { limit: 24, stopwords: lexicalNoise },
    ),
  };
}
