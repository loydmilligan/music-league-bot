<script lang="ts">
	import StatusChip from '$lib/components/StatusChip.svelte';
	import RatingStars from './RatingStars.svelte';
	import { mediaUrl, RATING_KEYS, reasonText, shortModel, usd, type RatingKey, type Version } from './api';

	let {
		v,
		coverRel,
		isKeeper,
		busy = false,
		onrate,
		onnote,
		onkeeper,
	}: {
		v: Version;
		coverRel: string;
		isKeeper: boolean;
		busy?: boolean;
		onrate: (key: RatingKey, value: number | null) => void;
		onnote: (note: string) => void;
		onkeeper: () => void;
	} = $props();

	let showOriginal = $state(false);
	const ok = $derived(v.status === 'ok' && !!v.image_rel);
	const ratingOf = (k: RatingKey) => v[`rating_${k}`];
</script>

<article
	class="rounded-md border bg-surface overflow-hidden flex flex-col transition-colors {isKeeper
		? 'border-health shadow-[0_0_0_1px_var(--color-health)]'
		: 'border-border'}"
	aria-label="Try {v.try_no}"
>
	<div class="relative aspect-square bg-bg">
		{#if ok}
			<img
				src={mediaUrl(showOriginal ? coverRel : v.image_rel)}
				alt={showOriginal ? 'Original cover' : `Try ${v.try_no} result`}
				class="w-full h-full object-cover"
				loading="lazy"
			/>
			<button
				type="button"
				class="absolute bottom-2 left-2 rounded-sm border border-border bg-bg/80 backdrop-blur px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted hover:text-fg"
				aria-pressed={showOriginal}
				onclick={() => (showOriginal = !showOriginal)}>{showOriginal ? 'Showing original' : 'Show original'}</button
			>
		{:else}
			<div class="absolute inset-0 grid place-items-center p-6 text-center bg-ember-bg/40">
				<div class="space-y-2">
					<p class="font-display text-lg text-ember">No image</p>
					<p class="text-sm text-fg-muted">{reasonText(v.error_reason)}</p>
				</div>
			</div>
		{/if}
		<div class="absolute top-2 left-2 flex gap-1">
			<span class="rounded-sm bg-bg/80 backdrop-blur px-1.5 py-0.5 font-mono text-[10px] text-fg">#{v.try_no}</span>
			{#if isKeeper}<StatusChip label="keeper" tone="health" />{/if}
			{#if !ok}<StatusChip label="failed" tone="ember" />{/if}
		</div>
	</div>

	<div class="p-3 space-y-3 flex-1 flex flex-col">
		<p class="font-mono text-[10px] text-fg-dim flex flex-wrap gap-x-2">
			<span title={v.model_id}>{shortModel(v.model_id)}</span>
			<span>{usd(v.cost_usd)}{v.cost_estimated ? ' est' : ''}</span>
			{#if v.latency_ms != null}<span>{(v.latency_ms / 1000).toFixed(1)} s</span>{/if}
		</p>

		{#if ok}
			<div class="space-y-1">
				{#each RATING_KEYS as r (r.key)}
					<RatingStars label={r.label} value={ratingOf(r.key)} disabled={busy} onrate={(val) => onrate(r.key, val)} />
				{/each}
			</div>
		{/if}

		<label class="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-fg-faint">
			Note
			<textarea
				class="w-full bg-bg border border-border rounded-sm p-1.5 text-xs text-fg normal-case tracking-normal font-sans min-h-12 focus:border-accent focus:outline-none"
				placeholder={ok ? 'What worked, what to fix next try' : 'Why it failed, what to change'}
				value={v.note ?? ''}
				onchange={(e) => onnote((e.currentTarget as HTMLTextAreaElement).value)}
			></textarea>
		</label>

		{#if ok}
			<button
				type="button"
				class="mt-auto inline-flex items-center justify-center gap-2 rounded-md border font-mono text-xs uppercase tracking-wider px-3 py-2 transition-colors disabled:opacity-50 {isKeeper
					? 'border-health/50 bg-health-bg text-health'
					: 'border-border text-fg-muted hover:text-fg hover:bg-surface-hover'}"
				aria-pressed={isKeeper}
				disabled={busy || isKeeper}
				onclick={onkeeper}>{isKeeper ? '✓ Keeper' : 'Make keeper'}</button
			>
		{/if}
	</div>
</article>
