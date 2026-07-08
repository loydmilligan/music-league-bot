// Pure helpers for the Theme Research pick-row metadata display (sprint-25).
// The ring-gauge geometry, opacity tiers, and label/tooltip formatting live here
// so they can be unit-tested without a DOM. Axis colors and .usc-* classes are
// applied in the Svelte layer (RingGauge.svelte / ThemeResearchTab.svelte).
//
// Value-scale notes (verified against data/league.db):
//   obscurity  0–100 (100 − popularity_proxy; higher = more obscure)
//   energy     0–100 (already scaled in song_audio_features — do NOT ×100)
//   hasLyrics  true = lyrics on file, false = instrumental, null = not analyzed

export const RING_R = 9;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R; // ≈ 56.549

const clampPct = (n: number): number => (n < 0 ? 0 : n > 100 ? 100 : n);

/** SVG stroke-dashoffset for an arc filling `pct` (0–100) of the ring. */
export function ringOffset(pct: number): number {
  return RING_CIRCUMFERENCE * (1 - clampPct(pct) / 100);
}

/**
 * Opacity tier for an indicator's arc + glyph:
 *   1   strong (value ≥ 60)
 *   0.6 present but weak (value < 60)
 *   0.3 missing / not analyzed (value === null)
 */
export function opacityTier(value: number | null): number {
  if (value === null) return 0.3;
  return value >= 60 ? 1 : 0.6;
}

/** duration_s → "m:ss" (rounded). Null/undefined → em dash. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export type IndicatorKind = 'obscurity' | 'energy' | 'lyrics';

export interface Indicator {
  kind: IndicatorKind;
  /** CSS custom-property name for the axis color, e.g. "--sky". */
  colorVar: string;
  /** 0–100 fill for the arc. */
  pct: number;
  /** 1 | 0.6 | 0.3 */
  opacity: number;
  /** Native title-attribute string. */
  tooltip: string;
}

export interface PickSignals {
  obscurity: number | null;
  obscurityBucket: string | null; // human label, e.g. "Rabbit Hole" (computed server-side)
  energy: number | null;
  hasLyrics: boolean | null;
}

/** The three collapsed-row ring indicators, in fixed order: obscurity → energy → lyrics. */
export function buildIndicators(sig: PickSignals): Indicator[] {
  const lyricsValue = sig.hasLyrics === null ? null : sig.hasLyrics ? 100 : 0;
  return [
    {
      kind: 'obscurity',
      colorVar: '--sky',
      pct: sig.obscurity ?? 0,
      opacity: opacityTier(sig.obscurity),
      tooltip:
        sig.obscurity === null
          ? 'Obscurity — not analyzed yet'
          : `Obscurity ${sig.obscurity}/100${sig.obscurityBucket ? ` (${sig.obscurityBucket})` : ''}`,
    },
    {
      kind: 'energy',
      colorVar: '--amber',
      pct: sig.energy ?? 0,
      opacity: opacityTier(sig.energy),
      tooltip: sig.energy === null ? 'Energy — not analyzed yet' : `Energy ${sig.energy}/100`,
    },
    {
      kind: 'lyrics',
      colorVar: '--moss',
      pct: lyricsValue ?? 0,
      opacity: opacityTier(lyricsValue),
      tooltip:
        sig.hasLyrics === null
          ? 'Lyrics — not analyzed yet'
          : sig.hasLyrics
            ? 'Lyrics on file'
            : 'Instrumental',
    },
  ];
}

/** Points cell: em dash when the round hasn't been voted yet (null), else the number. */
export function pointsLabel(points: number | null): string {
  return points === null ? '—' : String(points);
}

/** Headline "Lyrics" value: on file / — (instrumental) / not analyzed yet. */
export function lyricsHeadline(hasLyrics: boolean | null): string {
  if (hasLyrics === null) return 'not analyzed yet';
  return hasLyrics ? 'on file' : '—';
}

/** First letter for the album-art fallback initial. */
export function artInitial(title: string): string {
  const c = (title ?? '').trim()[0];
  return c ? c.toUpperCase() : '?';
}
