import { describe, it, expect, vi } from 'vitest';
vi.mock('$app/state', () => ({ page: { url: new URL('http://x/digest2/1?export=1') } }));
import { render } from 'svelte/server';
const { default: ChatMoments } = await import('./ChatMoments.svelte');

const URL_ = 'https://digest.mattmariani.com/_media/r170/half-baked-awards.png';
const content = {
	summary: 's',
	moments: [
		{ label: 'Awards', detail: `Conor gave himself one. The card: ${URL_} (see above).` },
		{ label: 'Plain', detail: 'No links here. <b>not html</b>' }
	]
};

describe('ChatMoments links', () => {
	it('turns a bare https URL in a moment into a link and leaves the rest as text', () => {
		const { body } = render(ChatMoments, { props: { kind: 'chat', content, variant: 'visual' } });
		expect(body).toMatch(new RegExp(`<a href="${URL_}" target="_blank" rel="noopener noreferrer"[^>]*>${URL_}</a>`));
		expect(body).toContain('(see above).');
	});
	it('never injects HTML from the text', () => {
		const { body } = render(ChatMoments, { props: { kind: 'chat', content, variant: 'visual' } });
		expect(body).not.toContain('<b>not html</b>');
		expect(body).toContain('&lt;b>not html&lt;/b>');
	});
});
