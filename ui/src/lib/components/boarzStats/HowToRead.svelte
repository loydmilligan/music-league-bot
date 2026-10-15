<script lang="ts">
	// Collapsible "How to read this" for a stats card. Hover tooltips don't
	// exist on phones, so every chart also gets the same explanations here.
	let { items, summary = 'How to read this' }: { items: [string, string][]; summary?: string } = $props();
</script>

<details class="htr">
	<summary>ⓘ {summary}</summary>
	<dl>
		{#each items as [term, text] (term)}
			<div><dt>{term}</dt><dd>{text}</dd></div>
		{/each}
	</dl>
</details>

<style>
	.htr { margin-top: 0.75rem; font-size: 0.8rem; }
	.htr summary { cursor: pointer; font-weight: 600; opacity: 0.75; width: fit-content; }
	.htr summary:hover { opacity: 1; }
	.htr dl { margin: 0.5rem 0 0; display: grid; gap: 0.35rem; }
	.htr dt { display: inline; font-weight: 700; }
	.htr dt::after { content: ' — '; font-weight: 400; opacity: 0.6; }
	.htr dd { display: inline; margin: 0; opacity: 0.85; }
</style>
