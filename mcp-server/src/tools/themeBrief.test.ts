import { describe, it, expect, vi } from 'vitest';

vi.mock('../httpClient.js', () => ({ botUiFetch: vi.fn(async () => ({ brief: { roundId: 145, whatToSubmit: 'go familiar' } })) }));

import { getThemeBrief } from './themeBrief.js';
import { botUiFetch } from '../httpClient.js';

describe('getThemeBrief', () => {
  it('POSTs to the theme-brief endpoint and returns the brief', async () => {
    const out = await getThemeBrief({ roundId: 145, force: true });
    expect(botUiFetch).toHaveBeenCalledWith('/api/theme-brief/145', expect.objectContaining({ method: 'POST' }));
    expect(out).toMatchObject({ brief: { whatToSubmit: 'go familiar' } });
  });
});
