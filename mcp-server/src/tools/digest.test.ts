import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../httpClient.js', () => ({ botUiFetch: vi.fn() }));

import { botUiFetch } from '../httpClient.js';
import { checkDigestReadiness, generateDigest } from './digest.js';

beforeEach(() => { vi.mocked(botUiFetch).mockReset(); });

it('checkDigestReadiness POSTs to the prepare route', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ checks: [{ name: 'Submissions', ok: true, src: 'ml_submissions' }] });
  const result = await checkDigestReadiness({ roundId: 5 });
  expect(botUiFetch).toHaveBeenCalledWith('/api/digest/5/prepare', { method: 'POST' });
  expect(result.checks).toHaveLength(1);
});

it('generateDigest POSTs an empty body when no params are given (uses defaults/cache)', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ cached: true, draft: {}, sections: [] });
  await generateDigest({ roundId: 5 });
  expect(botUiFetch).toHaveBeenCalledWith('/api/digest/5/draft', { method: 'POST', body: JSON.stringify({}) });
});

it('generateDigest passes through sections/pastedChat/recap when given', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ cached: false, draft: {}, sections: [] });
  await generateDigest({
    roundId: 5,
    sections: [{ id: 'podium', enabled: true }],
    pastedChat: 'chat text',
    recap: { enabled: true, final: false },
  });
  expect(botUiFetch).toHaveBeenCalledWith('/api/digest/5/draft', {
    method: 'POST',
    body: JSON.stringify({
      sections: [{ id: 'podium', enabled: true }],
      pastedChat: 'chat text',
      recap: { enabled: true, final: false },
    }),
  });
});
