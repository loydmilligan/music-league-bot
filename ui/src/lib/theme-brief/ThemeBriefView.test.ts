import { describe, it, expect } from 'vitest';
import { exposureLabel } from './exposureLabel.js';
import type { Exposure } from './types.js';

const recognizable: Exposure = { submissionId: 1, roundId: 109, title: 'Abissama', artist: 'Incredible Polo', recognizable: true, seenBy: [{ playerId: 4, name: 'Jon Black' }] };
const safe: Exposure = { submissionId: 2, roundId: 69, title: 'Abissama', artist: 'Incredible Polo', recognizable: false, seenBy: [] };

describe('exposureLabel', () => {
  it('names who would recognize a recognizable pick', () => {
    expect(exposureLabel(recognizable)).toBe('Jon Black would recognize this');
  });
  it('marks a safe pick as unseen by this league', () => {
    expect(exposureLabel(safe)).toBe('No one in this league saw this');
  });
});
