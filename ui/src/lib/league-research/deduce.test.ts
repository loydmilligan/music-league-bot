import { describe, it, expect } from 'vitest';
import { checkpoints } from './deduce.js';

describe('checkpoints', () => {
  // Worked example from the spec: I vote 1st (index 0), partner votes 11th
  // (index 10), so N = 9 ballots sit between us.
  it('2GS checks at 0, 50, 100 — after voters 1, 6, 10', () => {
    expect(checkpoints(0, 10, 2)).toEqual([0, 5, 9]);
  });

  it('3GS checks at 0, 25, 50, 75, 100 — after voters 1, 4, 6, 8, 10', () => {
    expect(checkpoints(0, 10, 3)).toEqual([0, 3, 5, 7, 9]);
  });

  it('1GS checks only at the ends', () => {
    expect(checkpoints(0, 10, 1)).toEqual([0, 9]);
  });

  it('4GS checks after every voter in the window', () => {
    expect(checkpoints(0, 10, 4)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('adjacent voters leave no window', () => {
    expect(checkpoints(3, 4, 4)).toEqual([3]);
  });
});
