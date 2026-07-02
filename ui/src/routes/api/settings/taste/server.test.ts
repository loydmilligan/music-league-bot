import { describe, it, expect } from 'vitest';

// Rebuild the schema shape here to assert its contract without a live DB.
// This mirrors TasteSettingsSchema in +server.ts; keep in sync.
import { TasteSettingsSchema } from './schema.js';

const full = {
  signal: 'frac', votePct: 5, negatives: true, dnPct: 100, lyrWeight: 0.45, spread: 1.15, scopeAll: true,
  showLabels: true, showKey: true, showRead: true, showChips: true, showLeagueAvg: false,
  palette: 'cool', lineStyle: 'solid', nodeStyle: 'dot', order: 'raw', band: true, bandOpacity: 0.06, amplitude: 1.4,
};

describe('TasteSettingsSchema', () => {
  it('accepts a full v3 settings object', () => {
    expect(TasteSettingsSchema.safeParse(full).success).toBe(true);
  });
  it('rejects an unknown palette', () => {
    expect(TasteSettingsSchema.safeParse({ ...full, palette: 'rainbow' }).success).toBe(false);
  });
  it('rejects out-of-range amplitude', () => {
    expect(TasteSettingsSchema.safeParse({ ...full, amplitude: 9 }).success).toBe(false);
  });
});
