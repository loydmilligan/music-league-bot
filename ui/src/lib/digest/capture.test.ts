import { describe, it, expect, vi } from 'vitest';
import { captureRoundData } from './capture.js';

describe('captureRoundData', () => {
	it('returns ok:true with imported data on a successful response', async () => {
		const fetchFn = vi.fn().mockResolvedValue({
			json: async () => ({
				ok: true,
				imported: { submissions: 3, votes: 9, voteComments: 4 }
			})
		});

		const r = await captureRoundData(7, { fetchFn: fetchFn as unknown as typeof fetch });

		expect(r).toEqual({
			ok: true,
			imported: { submissions: 3, votes: 9, voteComments: 4 }
		});
	});

	it('returns ok:false with stage/reason on a failure response', async () => {
		const fetchFn = vi.fn().mockResolvedValue({
			json: async () => ({
				ok: false,
				stage: 'auth',
				reason: 'ml-auth required'
			})
		});

		const r = await captureRoundData(7, { fetchFn: fetchFn as unknown as typeof fetch });

		expect(r).toEqual({
			ok: false,
			stage: 'auth',
			reason: 'ml-auth required'
		});
	});

	it('returns ok:false stage "other" and never throws when fetch rejects', async () => {
		const fetchFn = vi.fn().mockRejectedValue(new Error('network down'));

		const r = await captureRoundData(7, { fetchFn: fetchFn as unknown as typeof fetch });

		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.stage).toBe('other');
			expect(r.reason).toContain('network down');
		}
	});

	it('POSTs to the correct import-export-zip URL for the given round', async () => {
		const fetchFn = vi.fn().mockResolvedValue({
			json: async () => ({ ok: true, imported: { submissions: 0, votes: 0, voteComments: 0 } })
		});

		await captureRoundData(7, { fetchFn: fetchFn as unknown as typeof fetch });

		expect(fetchFn).toHaveBeenCalledTimes(1);
		const [url, init] = fetchFn.mock.calls[0];
		expect(url).toContain('/api/digest/7/import-export-zip');
		expect(init).toMatchObject({ method: 'POST' });
	});
});
