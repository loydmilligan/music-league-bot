import { describe, expect, it, vi } from 'vitest';
import {
	logProviderError,
	ProviderError,
	reasonFromHttpStatus,
	stripSecrets,
} from './errors.js';

describe('provider errors', () => {
	it('maps HTTP status to a typed reason', () => {
		expect(reasonFromHttpStatus(402)).toBe('out_of_credits');
		expect(reasonFromHttpStatus(429)).toBe('rate_limited');
		expect(reasonFromHttpStatus(400)).toBe('bad_input');
		expect(reasonFromHttpStatus(500)).toBe('provider_http');
	});

	it('strips keys and base64 from snippets', () => {
		const raw =
			'Bearer sk-live-secret data:image/png;base64,AAAAKEYDATA== plus Key abcdef and a face';
		const cleaned = stripSecrets(raw);
		expect(cleaned).not.toMatch(/sk-live-secret/);
		expect(cleaned).not.toMatch(/AAAAKEYDATA/);
		expect(cleaned).not.toMatch(/abcdef/);
		expect(cleaned).toContain('[data-uri]');
		expect(cleaned).toContain('Bearer [redacted]');
		expect(cleaned).toContain('Key [redacted]');
	});

	it('logs one JSON line with no keys or base64', () => {
		const log = vi.fn();
		const err = new ProviderError({
			provider: 'openrouter',
			model: 'google/gemini-2.5-flash-image',
			status: 200,
			reason: 'no_image',
			snippet: 'I cannot generate images of real people. data:image/png;base64,iVBORw0KGgo=',
			generationId: 'gen_1',
			finishReason: 'stop',
			nativeFinishReason: 'STOP',
			payloadBytes: 12345,
			refs: [{ filename: '1792809638774.png', width: 245, height: 700, bytes: 8000 }],
		});
		logProviderError(err, log);
		expect(log).toHaveBeenCalledTimes(1);
		const line = String(log.mock.calls[0][0]);
		expect(line.split('\n')).toHaveLength(1);
		const json = JSON.parse(line) as Record<string, unknown>;
		expect(json.avatarFactoryProviderError).toBe(true);
		expect(json.provider).toBe('openrouter');
		expect(json.reason).toBe('no_image');
		expect(json.generationId).toBe('gen_1');
		expect(json.payloadBytes).toBe(12345);
		expect(json.refs).toEqual([{ filename: '1792809638774.png', width: 245, height: 700, bytes: 8000 }]);
		expect(line).not.toMatch(/iVBORw0KGgo/);
		expect(line).not.toMatch(/base64/i);
		expect(err.userMessage).toMatch(/Safety\/likeness refusal by the model/);
		expect(err.httpStatus).toBe(422);
	});
});
