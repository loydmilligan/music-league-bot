import type { SongRatings } from './song/canonical.js';

// ---- Legacy 4-axis model (nostalgia/personal) — still used by unmigrated surfaces ----

export interface Weights { weightDiscovery: number; weightThemeFit: number; weightPersonal: number; weightNostalgia: number; }
export interface RatingInputs {
  discoveryPotential?: number | null; themeFit?: number | null;
  personalRating?: number | null; nostalgiaPotential?: number | null;
}

export function computeLegacyScore(r: RatingInputs, w: Weights): number | null {
  const dims = [
    { v: r.discoveryPotential, w: w.weightDiscovery },
    { v: r.themeFit,           w: w.weightThemeFit },
    { v: r.personalRating,     w: w.weightPersonal },
    { v: r.nostalgiaPotential, w: w.weightNostalgia },
  ].filter(d => d.v != null) as { v: number; w: number }[];
  if (!dims.length) return null;
  const totalW = dims.reduce((s, d) => s + d.w, 0);
  return dims.reduce((s, d) => s + d.v * d.w, 0) / totalW;
}

// Legacy alias — remove after all surfaces migrate to unicard
export const computeScore = computeLegacyScore;

// ---- Universal Songcard 4-axis model (discovery/themeFit/quality/replayability) ----

export interface UnicardWeights {
  weightDiscovery: number;
  weightThemeFit: number;
  weightQuality: number;
  weightReplayability: number;
}

export const DEFAULT_UNICARD_WEIGHTS: UnicardWeights = {
  weightDiscovery: 30,
  weightThemeFit: 40,
  weightQuality: 20,
  weightReplayability: 10,
};

/** Weighted score over the 4 new axes → value 0–20, or null if no ratings. */
export function computeUnicardScore(ratings: SongRatings, w: UnicardWeights): number | null {
  const dims = [
    { v: ratings.discovery,     wt: w.weightDiscovery },
    { v: ratings.themeFit,      wt: w.weightThemeFit },
    { v: ratings.quality,       wt: w.weightQuality },
    { v: ratings.replayability, wt: w.weightReplayability },
  ].filter(d => d.v != null) as { v: number; wt: number }[];
  if (!dims.length) return null;
  const totalW = dims.reduce((s, d) => s + d.wt, 0);
  if (!totalW) return null;
  // Scale: Σ(rating * weight) / Σ(weight) * 4 → max = 5 * 4 = 20
  return (dims.reduce((s, d) => s + d.v * d.wt, 0) / totalW) * 4;
}
