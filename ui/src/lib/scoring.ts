export interface Weights { weightDiscovery: number; weightThemeFit: number; weightPersonal: number; weightNostalgia: number; }
export interface RatingInputs {
  discoveryPotential?: number | null; themeFit?: number | null;
  personalRating?: number | null; nostalgiaPotential?: number | null;
}

export function computeScore(r: RatingInputs, w: Weights): number | null {
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
