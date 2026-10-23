<script lang="ts">
	// The week's chat AMAs: one card per prompt, each answer a one-line row, a verdict
	// at the foot. Hand-built content (digest2_sections kind 'ama'), read defensively —
	// a missing field drops its row, never the section.
	type Answer = { who?: string; summary?: string };
	type Ama = { prompt?: string; askedBy?: string; when?: string; answers?: Answer[]; verdict?: string };
	type AmaContent = { title?: string; intro?: string; amas?: Ama[] };

	let { content }: { content: unknown } = $props();
	const c = $derived((content ?? {}) as AmaContent);
	const amas = $derived((Array.isArray(c.amas) ? c.amas : []).filter((a) => a?.prompt?.trim()));
</script>

{#if amas.length}
	<section class="ama">
		<h2>{c.title ?? 'Ask Me Anything'}</h2>
		{#if c.intro}<p class="intro">{c.intro}</p>{/if}
		{#each amas as a, i (i)}
			<article class="card">
				<p class="asked">{[a.askedBy, a.when].filter(Boolean).join(' · ')}</p>
				<h3>“{a.prompt}”</h3>
				<ul>
					{#each (a.answers ?? []).filter((x) => x?.who && x?.summary) as x, j (j)}
						<li><b>{x.who}</b> {x.summary}</li>
					{/each}
				</ul>
				{#if a.verdict}<p class="verdict">{a.verdict}</p>{/if}
			</article>
		{/each}
	</section>
{/if}

<style>
	.ama { margin: 2rem 0; }
	.intro { color: var(--fg-muted, #9aa4b1); }
	.card { background: var(--surface, #11151b); border: 1px solid var(--line, #262d37); border-radius: 14px; padding: 14px; margin: 12px 0; }
	.asked { margin: 0; font: .75rem var(--font-mono, monospace); color: var(--fg-muted, #8b96a5); text-transform: uppercase; letter-spacing: .04em; }
	h3 { margin: 6px 0 10px; font: 600 1.15rem/1.25 var(--font-display, system-ui); color: #e8b04a; }
	ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
	li { padding: 9px 11px; background: #ffffff08; border-radius: 10px; font-size: .92rem; }
	li b { margin-right: 4px; }
	.verdict { margin: 12px 0 0; padding-top: 10px; border-top: 1px dashed var(--line, #262d37); font-size: .92rem; }
</style>
