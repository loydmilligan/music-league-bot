import { it, expect } from 'vitest';
import { computeScore } from './scoring.js';
const W = { weightDiscovery: 35, weightThemeFit: 25, weightPersonal: 25, weightNostalgia: 15 };

it('null when no ratings', () => expect(computeScore({}, W)).toBeNull());
it('full score', () => expect(computeScore({ discoveryPotential:5,themeFit:4,personalRating:4,nostalgiaPotential:1 }, W)).toBeCloseTo(3.9, 1));
it('discovery > nostalgia when equal otherwise', () => {
  const d = computeScore({ discoveryPotential:5,nostalgiaPotential:1,themeFit:3,personalRating:3 }, W);
  const n = computeScore({ discoveryPotential:1,nostalgiaPotential:5,themeFit:3,personalRating:3 }, W);
  expect(d!).toBeGreaterThan(n!);
});
