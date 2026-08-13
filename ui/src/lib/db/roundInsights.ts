import type Database from "better-sqlite3";
import { getWordFrequencies, type WordCloudWord } from '../digest/wordCloud.js';
import type { TopSectionVariant } from '../digest/topSectionVariants.js';

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

/**
 * An artist in this round who already appeared in an earlier season of the same
 * league. `sameSubmitter` marks the player going back to their own well.
 */
export interface ArtistCallback {
  artist: string;
  title: string;
  submitter: string | null;
  priorTitle: string;
  priorSubmitter: string | null;
  priorSeasonNumber: number | null;
  sameSubmitter: boolean;
}

export interface RoundArtistLandscape {
  songCount: number;
  uniqueArtistCount: number;
  /** Earlier seasons of this league that were searched for callbacks. */
  priorSeasonsCompared: number;
  callbackCount: number;
  callbacks: ArtistCallback[];
  topArtists: InsightCount[];
}

/**
 * The Coinage — a term the group coined (or adopted) inside this round's chat
 * window, rendered as an Urban-Dictionary entry. Hand-authored today via the
 * editable stats content (YAML, CD handoff §7); BACKLOG item 0(b) is the
 * deterministic detector (absent from all prior rounds · 3+ uses · 3+ speakers).
 *
 * Every field but `term` is optional and the older shape (`gloss`/`meta`/
 * `quotes`/`metrics`) still renders: the live R147 payload predates this schema
 * and must not break.
 */
export interface PhraseOfRound {
  /**
   * Forward-compatible layout knob. Today the only layout is `dictionary`, and
   * anything else (or nothing) renders it anyway — a second style would earn a
   * registry, one does not.
   */
  style?: string;
  term: string;
  /** e.g. "/ˌtʃɒpt ˈʌŋk/" */
  pronunciation?: string;
  /** e.g. "noun · slang" */
  part_of_speech?: string;
  /** the numbered entry; `gloss` is the older name for the same field */
  definition?: string;
  gloss?: string;
  /**
   * Who coined it, on whom, when, and why — rendered as the origin line.
   * `date` is a display string, never parsed: CD's `on:` was unusable because
   * YAML 1.1 reads a bare `on` key as the boolean `true`.
   */
  coined?: { by?: string; date?: string; at?: string; context?: string };
  /** the flag line's numbers; falls back to the free-text `meta` */
  stats?: { uses?: number | string; speakers?: number | string; prior_rounds?: number | string };
  /** labelled pull-quotes ("original" / "best"); falls back to `quotes` */
  usages?: { label?: string; speaker?: string; text?: string }[];
  /** origin explainer URL; nothing renders when absent */
  source?: string;
  /** right-hand meta on the card head, e.g. "coined 8/9 · 4 speakers" */
  meta?: string;
  metrics?: { value: string; label: string }[];
  quotes?: { speaker?: string; text: string }[];
  /**
   * Optional clip illustrating the phrase. Served from digest-static's /_media/
   * (outside /d/<slug>/, so a re-render can't wipe it). `poster` is required for
   * the PNG/PDF export path, which screenshots a still frame — video never
   * captures. Absolute URLs only: the export renders on a different origin.
   */
  media?: { src?: string; poster?: string; alt?: string; caption?: string };
}

export interface RoundInsights {
  roundId?: number;
  topSectionVariant?: TopSectionVariant;
  topSectionVisuals?: import('../digest/topSectionVariants.js').TopSectionVisual[];
  statsContent?: { title?: string; body?: string; phrase?: PhraseOfRound };
  audio: RoundAudioProfile;
  submissionTiming: RoundSubmissionTiming;
  artists: RoundArtistLandscape;
  wordCloud: WordCloudWord[];
}

interface SubmissionRow {
  title: string;
  artists: string;
  created_at: string;
  submitter: string | null;
}

interface PriorSubmissionRow {
  title: string;
  artists: string;
  submitter: string | null;
  season_number: number | null;
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
      `SELECT s.artists, s.created_at
              , s.title
              , COALESCE(p.name, c.name) AS submitter
       FROM ml_submissions s
       LEFT JOIN players p ON p.id = s.player_id
       LEFT JOIN competitors c ON c.id = s.competitor_id
       WHERE s.round_id = ? AND s.competitor_id IS NOT NULL
       ORDER BY s.id`,
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

  // Season callbacks: a single round never repeats an artist within itself, so
  // the interesting repeat is across seasons — an artist this league already
  // used in an earlier season of the same league.
  const seasonRow = db
    .prepare(
      `SELECT se.league_id, se.season_number
       FROM rounds r JOIN seasons se ON se.id = r.season_id
       WHERE r.id = ?`,
    )
    .get(roundId) as { league_id: number; season_number: number | null } | undefined;

  let priorSeasonsCompared = 0;
  let callbacks: ArtistCallback[] = [];
  if (seasonRow && seasonRow.season_number != null) {
    priorSeasonsCompared = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM seasons
           WHERE league_id = ? AND season_number < ?`,
        )
        .get(seasonRow.league_id, seasonRow.season_number) as { n: number }
    ).n;

    const priorRows = db
      .prepare(
        `SELECT ps.title, ps.artists
                , COALESCE(pp.name, pc.name) AS submitter
                , pse.season_number
         FROM ml_submissions ps
         JOIN rounds pr ON pr.id = ps.round_id
         JOIN seasons pse ON pse.id = pr.season_id
         LEFT JOIN players pp ON pp.id = ps.player_id
         LEFT JOIN competitors pc ON pc.id = ps.competitor_id
         WHERE ps.competitor_id IS NOT NULL
           AND pse.league_id = ? AND pse.season_number < ?
         ORDER BY pse.season_number DESC, ps.id`,
      )
      .all(seasonRow.league_id, seasonRow.season_number) as PriorSubmissionRow[];

    const priorByArtist = new Map<string, PriorSubmissionRow[]>();
    for (const row of priorRows) {
      const key = firstArtist(row.artists).toLocaleLowerCase();
      if (!key) continue;
      const bucket = priorByArtist.get(key);
      if (bucket) bucket.push(row);
      else priorByArtist.set(key, [row]);
    }

    for (const row of submissions) {
      const label = firstArtist(row.artists);
      if (!label) continue;
      for (const prior of priorByArtist.get(label.toLocaleLowerCase()) ?? []) {
        callbacks.push({
          artist: label,
          title: row.title,
          submitter: row.submitter,
          priorTitle: prior.title,
          priorSubmitter: prior.submitter,
          priorSeasonNumber: prior.season_number,
          sameSubmitter:
            !!row.submitter && !!prior.submitter && row.submitter === prior.submitter,
        });
      }
    }

    // Self-callbacks read as the sharper stat, then most recent season first.
    callbacks.sort(
      (a, b) =>
        Number(b.sameSubmitter) - Number(a.sameSubmitter) ||
        (b.priorSeasonNumber ?? 0) - (a.priorSeasonNumber ?? 0) ||
        a.artist.localeCompare(b.artist),
    );
    callbacks = callbacks.slice(0, MAX_ARTISTS);
  }

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
      priorSeasonsCompared,
      callbackCount: callbacks.length,
      callbacks,
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
      { limit: 24, extraStopwords: lexicalNoise },
    ),
  };
}
