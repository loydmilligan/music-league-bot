import { describe, it, expect } from 'vitest';
import { buildArchiveContext } from './archiveContext.js';

describe('buildArchiveContext', () => {
  it('captures operator steer from genParams section context', () => {
    const ctx = buildArchiveContext(
      { sections: [{ id: 'flow', context: 'lean into the comeback angle' }] },
      { sections: { flow: { title: 'F', body: 'A surged from last to first.' } } },
    );
    expect(ctx.operatorSteer).toContain('comeback angle');
  });

  it('distills a one-line round-dynamics note from the flow body (first sentence)', () => {
    const ctx = buildArchiveContext(undefined, {
      sections: { flow: { title: 'F', body: 'A surged from last to first. Then more prose.' } },
    });
    expect(ctx.roundDynamics).toBe('A surged from last to first.');
  });

  it('returns empty fields when nothing is available (no throw)', () => {
    const ctx = buildArchiveContext(undefined, { sections: {} });
    expect(ctx).toEqual({ operatorSteer: '', roundDynamics: '' });
  });
});
