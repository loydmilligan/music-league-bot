<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';
	import { onMount } from 'svelte';

	type Answer = { who?: string; summary?: string };
	type Ama = { prompt?: string; askedBy?: string; when?: string; answers?: Answer[]; verdict?: string };
	type AmaContent = { title?: string; intro?: string; amas?: Ama[] };

	// voteSlug: the round's digest2 share slug. With it, votes go to /api/p/ama/<slug>,
	// the one prefix the static digest host proxies, so the published copy can vote too.
	let { content, snapshot, roundId = 168, voteSlug = null }: { content: unknown; snapshot?: Snapshot | null; roundId?: number; voteSlug?: string | null } = $props();
	const voteUrl = $derived(voteSlug ? `/api/p/ama/${voteSlug}` : `/api/digest2/${roundId}/ama-vote`);
	const c = $derived((content ?? {}) as AmaContent);
	const amas = $derived((Array.isArray(c.amas) ? c.amas : []).filter((a) => a?.prompt?.trim()));

	const colors = ['#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6', '#10b981', '#ec4899', '#f97316', '#6366f1'];
	function avatarColor(name: string) {
		let h = 0;
		for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
		return colors[Math.abs(h) % colors.length];
	}

	type VoteState = {
		myVotes: Record<number, number>;
		results: Record<number, Record<number, number>>;
		voterId: string | null;
		loading: boolean;
	};
	let vote = $state<VoteState>({ myVotes: {}, results: {}, voterId: null, loading: false });

	function fallbackId() {
		let id = localStorage.getItem('ama_voter_id');
		if (!id) {
			id = crypto.randomUUID();
			localStorage.setItem('ama_voter_id', id);
		}
		return id;
	}

	async function loadVotes() {
		vote = { ...vote, loading: true };
		try {
			const fb = fallbackId();
			const res = await fetch(fb ? `${voteUrl}?voter_id=${encodeURIComponent(fb)}` : voteUrl);
			if (!res.ok) throw new Error(String(res.status));
			const data = await res.json();
			if (data.voter_id) {
				vote = { ...vote, voterId: data.voter_id };
				localStorage.setItem('ama_voter_id', data.voter_id);
			}
			vote = { ...vote, myVotes: data.myVotes ?? {}, results: data.results ?? {}, loading: false };
		} catch {
			vote = { ...vote, loading: false };
		}
	}

	async function castVote(promptIndex: number, answerIndex: number) {
		vote = { ...vote, loading: true };
		try {
			const body: Record<string, unknown> = { prompt_index: promptIndex, answer_index: answerIndex };
			if (vote.voterId) body.voter_id = vote.voterId;
			const res = await fetch(voteUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			if (!res.ok) throw new Error(String(res.status));
			const data = await res.json();
			if (data.voter_id) {
				vote = { ...vote, voterId: data.voter_id };
				localStorage.setItem('ama_voter_id', data.voter_id);
			}
			vote = {
				...vote,
				myVotes: { ...vote.myVotes, [promptIndex]: answerIndex },
				results: data.results ? { ...vote.results, [promptIndex]: data.results } : vote.results,
				loading: false,
			};
		} catch {
			vote = { ...vote, loading: false };
		}
	}

	onMount(() => { loadVotes(); });

	function totalVotes(promptIndex: number) {
		const r = vote.results[promptIndex] ?? {};
		return Object.values(r).reduce((a, c) => a + c, 0);
	}
</script>

{#if amas.length}
	<section class="ama-root">
		<div class="ama-header">
			<h2>🔥 {c.title ?? 'Ask Me Anything'}</h2>
			{#if c.intro}<p>{c.intro}</p>{/if}
		</div>

		{#each amas as a, i (i)}
			<article class="ama-thread">
				<header class="thread-header">
					<span class="thread-flair">AMA</span>
					<span class="thread-meta">{[a.askedBy, a.when].filter(Boolean).join(' · ')}</span>
				</header>
				<h3 class="thread-question">“{a.prompt}”</h3>

				<ul class="answers-list">
					{#each (a.answers ?? []).filter((x) => x?.who && x?.summary) as ans, j (j)}
						<li class="answer-row" class:my-vote={vote.myVotes[i] === j}>
							<div class="answer-avatar" style="background:{avatarColor(ans.who ?? '')}">
								{ans.who?.charAt(0) ?? '?'}
							</div>
							<div class="answer-body">
								<div class="answer-who">{ans.who} · #{j + 1}</div>
								<div class="answer-summary">{ans.summary}</div>
							</div>
							<button
								type="button"
								class="vote-btn"
								class:vote-active={vote.myVotes[i] === j}
								onclick={() => castVote(i, j)}
								title="Vote for this answer as your favourite"
								disabled={vote.loading}
							>
								<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
									<path d="M8 3L13.5 13H2.5L8 3Z" fill="currentColor" />
								</svg>
								<span class="vote-count">{vote.results[i]?.[j] ?? 0}</span>
							</button>
						</li>
					{/each}
				</ul>
				{#if totalVotes(i) > 0}
					<div class="vote-tally">{totalVotes(i)} vote{totalVotes(i) !== 1 ? 's' : ''} so far</div>
				{/if}
				{#if a.verdict}<p class="verdict">{a.verdict}</p>{/if}
			</article>
		{/each}
	</section>
{/if}

<style>
	.ama-root { margin: 2rem 0; }
	.ama-header {
		background: linear-gradient(135deg, #dc2626 0%, #ea580c 50%, #f59e0b 100%);
		border-radius: 12px;
		padding: 1rem 1.25rem;
		margin-bottom: 1.25rem;
	}
	.ama-header h2 { color: #fff; margin: 0 0 .25rem; font-size: 1.125rem; font-weight: 600; }
	.ama-header p { color: rgba(255,255,255,.75); margin: 0; font-size: .875rem; }
	.ama-thread {
		background: #11151b;
		border: 1px solid #262d37;
		border-radius: 12px;
		padding: 14px;
		margin: 12px 0;
	}
	.thread-header { display: flex; align-items: center; gap: .5rem; margin-bottom: .5rem; }
	.thread-flair {
		background: #dc2626;
		color: #fff;
		font-size: .65rem;
		font-weight: 700;
		padding: 1px 7px;
		border-radius: 4px;
		text-transform: uppercase;
		letter-spacing: .05em;
	}
	.thread-meta {
		font-size: .7rem;
		color: #8b96a5;
		text-transform: uppercase;
		letter-spacing: .04em;
	}
	.thread-question {
		margin: 6px 0 10px;
		font: 600 1.1rem/1.3 system-ui;
		color: #fdb44a;
	}
	.answers-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
	.answer-row {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 9px 10px;
		background: #ffffff06;
		border-radius: 10px;
		border: 1px solid transparent;
		transition: border-color .15s;
	}
	.answer-row.my-vote { border-color: #f59e0b; background: #f59e0b0a; }
	.answer-avatar {
		flex-shrink: 0;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: .75rem;
		font-weight: 700;
		color: #fff;
	}
	.answer-body { flex: 1; min-width: 0; }
	.answer-who { font-size: .8rem; font-weight: 600; color: #e4e7ec; margin-bottom: 2px; }
	.answer-summary { font-size: .82rem; color: #9aa4b1; line-height: 1.35; }
	.vote-btn {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		background: none;
		border: none;
		padding: 2px 4px;
		cursor: pointer;
		color: #6b7280;
		border-radius: 6px;
		transition: color .15s, background .15s;
		min-width: 28px;
	}
	.vote-btn:hover { color: #f59e0b; background: #f59e0b15; }
	.vote-btn.vote-active { color: #f59e0b; }
	.vote-btn:disabled { opacity: .4; cursor: not-allowed; }
	.vote-count { font-size: .65rem; font-weight: 700; }
	.vote-tally { font-size: .75rem; color: #9aa4b1; margin-top: .5rem; }
	.verdict {
		margin: 12px 0 0;
		padding-top: 10px;
		border-top: 1px dashed #262d37;
		font-size: .88rem;
		color: #9aa4b1;
		font-style: italic;
	}
</style>