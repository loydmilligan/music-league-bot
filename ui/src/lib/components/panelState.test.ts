import { describe, it, expect } from 'vitest';
import { loadPanelOpen, savePanelOpen } from './panelState.js';

function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('panelState', () => {
  it('returns defaultOpen when nothing is stored', () => {
    const s = fakeStorage();
    expect(loadPanelOpen('x', false, s)).toBe(false);
    expect(loadPanelOpen('y', true, s)).toBe(true);
  });
  it('round-trips a saved value, overriding the default', () => {
    const s = fakeStorage();
    savePanelOpen('x', true, s);
    expect(loadPanelOpen('x', false, s)).toBe(true);
    savePanelOpen('x', false, s);
    expect(loadPanelOpen('x', true, s)).toBe(false);
  });
});
