import { describe, expect, it, vi } from 'vitest';
import { AVATAR_HIL_TOPIC, buildStyleHilNotification, hilConfigFromEnv, publishStyleHil } from './hil.js';

describe('avatar HIL ntfy', () => {
	it('uses topic avatar-hil even when NTFY_TOPIC is something else', () => {
		expect(
			hilConfigFromEnv({
				NTFY_URL: 'https://n.example',
				NTFY_TOPIC: 'mlb-digest',
				NTFY_TOKEN: 'k',
			}),
		).toEqual({ url: 'https://n.example', topic: AVATAR_HIL_TOPIC, token: 'k' });
	});

	it('throws when NTFY_URL is missing', () => {
		expect(() => hilConfigFromEnv({ NTFY_TOPIC: 'mlb-digest' })).toThrow(/NTFY_URL/);
	});

	it('Approve/Deny/Factory fill the three ntfy action slots', () => {
		const n = buildStyleHilNotification({
			title: 'Generate LEGO avatars?',
			message: '10 portraits',
			click: 'https://app.example/avatar-factory',
			approveUrl: 'https://app.example/api/avatar-factory/hil/approve',
			denyUrl: 'https://app.example/api/avatar-factory/hil/deny',
			token: 'tok',
			bearer: 'BR',
		});
		expect(n.actions?.map((a) => a.label)).toEqual(['Approve', 'Deny', 'Factory']);
		const approve = n.actions!.find((a) => a.label === 'Approve')!;
		expect(approve.action).toBe('http');
		expect(approve.headers?.Authorization).toBe('Bearer BR');
		expect(approve.body).toContain('tok');
	});

	it('publishes JSON to the ntfy root with topic avatar-hil', async () => {
		const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
			expect(String(input)).toBe('https://n.example');
			const body = JSON.parse(String(init?.body));
			expect(body.topic).toBe('avatar-hil');
			expect(body.title).toContain('LEGO');
			return new Response('{}', { status: 200 });
		});
		const sent = await publishStyleHil(
			buildStyleHilNotification({
				title: 'Generate LEGO avatars?',
				message: 'go',
				click: 'https://app.example/avatar-factory',
				approveUrl: 'https://app.example/api/avatar-factory/hil/approve',
				denyUrl: 'https://app.example/api/avatar-factory/hil/deny',
				token: 'tok',
				bearer: 'k',
			}),
			{ env: { NTFY_URL: 'https://n.example', NTFY_TOKEN: 'k' }, fetchImpl },
		);
		expect(sent).toBe(true);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
});
