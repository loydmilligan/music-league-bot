export const TOP_SECTION_VARIANTS = ['auto', 'hero', 'sound', 'race', 'language'] as const;
export type TopSectionVariant = (typeof TOP_SECTION_VARIANTS)[number];
export type TopSectionVisual = Exclude<TopSectionVariant, "auto">;
export const TOP_SECTION_VISUALS = ["hero", "sound", "race", "language"] as const;

export const TOP_SECTION_VARIANT_META: Record<TopSectionVariant, { label: string; description: string }> = {
  auto: { label: 'Auto rotate', description: 'Choose the strongest available feature for this round' },
  hero: { label: 'Round hero', description: 'Broadcast-style headline and signal rail' },
  sound: { label: 'Sound profile', description: 'Tempo spread, energy fingerprint, and key mix' },
  race: { label: 'Submission race', description: 'Deadline pressure and final-six-hours rush' },
  language: { label: 'Room language', description: 'Structured comment vocabulary with counts' },
};

export function coerceTopSectionVisuals(value: unknown): TopSectionVisual[] {
  if (!Array.isArray(value)) return [];
  const requested = new Set(value.filter((v): v is TopSectionVisual => (TOP_SECTION_VISUALS as readonly string[]).includes(String(v))));
  return TOP_SECTION_VISUALS.filter((v) => requested.has(v));
}

export function coerceTopSectionVariant(value: unknown): TopSectionVariant {
  return (TOP_SECTION_VARIANTS as readonly string[]).includes(value as string)
    ? (value as TopSectionVariant)
    : 'auto';
}

/** Stable rotation. Feature order favors the strongest available signal. */
export function resolveTopSectionVariant(
  requested: unknown,
  roundId: number,
  available: Partial<Record<Exclude<TopSectionVariant, 'auto'>, boolean>>,
): Exclude<TopSectionVariant, 'auto'> {
  const explicit = coerceTopSectionVariant(requested);
  if (explicit !== 'auto' && available[explicit] !== false) return explicit;

  const candidates = (['hero', 'sound', 'race', 'language'] as const).filter((v) => available[v] !== false);
  if (candidates.length === 0) return 'hero';
  return candidates[Math.abs(Math.trunc(roundId)) % candidates.length] ?? 'hero';
}
