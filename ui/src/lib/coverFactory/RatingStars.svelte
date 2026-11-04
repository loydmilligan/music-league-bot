<script lang="ts">
	let {
		label,
		value,
		disabled = false,
		onrate,
	}: { label: string; value: number | null; disabled?: boolean; onrate: (v: number | null) => void } = $props();
	let hover = $state(0);
	const shown = $derived(hover || value || 0);
</script>

<div class="flex items-center gap-2" role="group" aria-label="{label} rating">
	<span class="w-16 shrink-0 font-mono text-[10px] uppercase tracking-wider text-fg-dim">{label}</span>
	<div class="flex" onmouseleave={() => (hover = 0)} role="presentation">
		{#each [1, 2, 3, 4, 5] as star (star)}
			<button
				type="button"
				class="px-0.5 text-base leading-none transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent rounded-sm disabled:cursor-not-allowed"
				class:text-warn={star <= shown}
				class:text-fg-faint={star > shown}
				aria-label="{label}: {star} of 5{value === star ? ' (click to clear)' : ''}"
				aria-pressed={value === star}
				{disabled}
				onmouseenter={() => (hover = star)}
				onclick={() => onrate(value === star ? null : star)}>★</button
			>
		{/each}
	</div>
	<span class="font-mono text-[10px] text-fg-faint w-4">{value ?? ''}</span>
</div>
