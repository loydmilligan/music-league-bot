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

describe('AmaSection whole story', () => {
	const story = {
		title: 'AMA',
		amas: [{ prompt: 'Q?', answers: [
			{ who: 'Ann', summary: 'short', story: ['the whole long story', 'part two'] },
			{ who: 'Bob', summary: 'all of it' },
		] }],
	};
	const { body } = render(AmaSection, { props: { content: story, roundId: 1, voteSlug: 'abcDEF123456' } });
	const rows = body.split('<li').slice(1);

	it('only an answer with a story gets the affordance, carrying the full text', () => {
		expect(rows[0]).toContain('story-btn');
		expect(rows[0]).toContain('the whole long story');
		expect(rows[0]).toContain('part two');
		expect(rows[1]).not.toContain('story-btn');
	});
	it('the story control is its own button, separate from the vote button', () => {
		const storyBtn = rows[0].match(/<button[^>]*class="story-btn[^"]*"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';
		expect(storyBtn).toContain('Read the whole story');
		expect(storyBtn).not.toContain('vote');
		expect(rows[0]).toMatch(/class="vote-btn/);
	});
	it('the modal starts closed and the vote handler never opens it', () => {
		expect(body).toMatch(/<dialog[^>]*class="story-dialog/);
		expect(body).not.toMatch(/<dialog[^>]*\bopen\b/);
		const src = readFileSync('src/lib/digest2/AmaSection.svelte', 'utf8');
		const castVote = src.slice(src.indexOf('async function castVote'), src.indexOf('onMount('));
		expect(castVote).not.toMatch(/openStory|showModal/);
		expect(src).toMatch(/onclick=\{\(\) => castVote\(i, j\)\}/);
	});
});
