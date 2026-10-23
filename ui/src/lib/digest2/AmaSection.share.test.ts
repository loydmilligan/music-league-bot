import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import AmaSection from './AmaSection.svelte';

// The published copy is static (digest host proxies only /api/p/*), so the poll's
// API is unreachable there: the share render must not show vote buttons or a tally.
const content = {
	title: 'Ask Me Anything',
	amas: [{ prompt: 'Q?', askedBy: 'Asked by Matt', answers: [{ who: 'JB', summary: 'an answer' }] }],
};

describe('AmaSection share mode', () => {
	it('admin render shows the vote buttons', () => {
		const { body } = render(AmaSection, { props: { content, roundId: 1 } });
		expect(body).toContain('vote-btn');
	});
	it('share render has the answers but no vote UI', () => {
		const { body } = render(AmaSection, { props: { content, roundId: 1, share: true } });
		expect(body).toContain('an answer');
		expect(body).not.toContain('vote-btn');
		expect(body).not.toContain('vote-tally');
	});
	it('the digest page passes share through', () => {
		const src = readFileSync('src/routes/digest2/[roundId]/+page.svelte', 'utf8');
		expect(src).toMatch(/<AmaSection[^>]*share=\{data\.share\}/);
	});
});
