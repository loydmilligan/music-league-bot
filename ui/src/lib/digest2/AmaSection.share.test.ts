import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import AmaSection from './AmaSection.svelte';

// Players vote from the published copy too: its calls go to /api/p/ama/<shareSlug>,
// the one prefix the static digest host proxies to bot-ui.
const content = {
	title: 'Ask Me Anything',
	amas: [{ prompt: 'Q?', askedBy: 'Asked by Matt', answers: [{ who: 'JB', summary: 'an answer' }] }],
};

describe('AmaSection voting', () => {
	it('renders the vote buttons with a share slug', () => {
		const { body } = render(AmaSection, { props: { content, roundId: 1, voteSlug: 'abcDEF123456' } });
		expect(body).toContain('an answer');
		expect(body).toContain('vote-btn');
	});
	it('votes through the proxied public prefix when a slug exists', () => {
		const src = readFileSync('src/lib/digest2/AmaSection.svelte', 'utf8');
		expect(src).toContain('`/api/p/ama/${voteSlug}`');
		expect(src).not.toMatch(/!share/);
	});
	it('the digest page passes the share slug through', () => {
		const src = readFileSync('src/routes/digest2/[roundId]/+page.svelte', 'utf8');
		expect(src).toMatch(/<AmaSection[^>]*voteSlug=\{data\.amaVoteSlug\}/);
		const server = readFileSync('src/routes/digest2/[roundId]/+page.server.ts', 'utf8');
		expect(server).toMatch(/amaVoteSlug: peekDigest2Slug\(db, roundId\)/);
	});
});
