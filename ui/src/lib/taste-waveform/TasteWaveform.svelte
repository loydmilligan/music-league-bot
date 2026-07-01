<!--
  TasteWaveform.svelte — thin Svelte wrapper over the framework-agnostic engine.
  Build the engine once from the (scoped) league data + settings, pass it + a
  player index. Variants: hero | card (264px share) | mark | row.
  Visual is locked; players tune only the signal/shape settings that feed the engine.
-->
<script lang="ts">
	import type { TasteEngine, TasteSettings } from './taste-waveform.js';
	import { DEFAULT_TASTE_SETTINGS } from './taste-waveform.js';
	import './taste-waveform.css';

	interface Props {
		engine: TasteEngine;
		pi: number;
		variant?: 'hero' | 'card' | 'mark' | 'row';
		name?: string;
		avatar?: string;
		league?: string;
		sub?: string;
		selected?: boolean;
		onselect?: () => void;
		settings?: TasteSettings;
		onshare?: () => void;
	}
	let {
		engine, pi, variant = 'hero', name = '', avatar = '',
		league = 'family league', sub, selected = false, onselect,
		settings = DEFAULT_TASTE_SETTINGS, onshare,
	}: Props = $props();

	const dims = $derived(
		variant === 'hero' ? { w: 322, h: 150 } :
		variant === 'card' ? { w: 228, h: 98 } :
		variant === 'row' ? { w: 150, h: 40 } : { w: 150, h: 54 },
	);
	const svg = $derived(engine.buildChart(pi, dims.w, dims.h, {
		chrome: settings.showLabels && variant !== 'row' && variant !== 'mark',
		nodes: true,
		leagueAvg: settings.showLeagueAvg ? engine.leagueAvg() : undefined,
	}));
	const archetype = $derived(engine.nameOf(pi));
	const read = $derived(engine.proseFor(pi));
	const chips = $derived(settings.showChips ? engine.chipsFor(pi) : []);
</script>

{#if variant === 'card'}
	<div class="tw-card">
		<div class="tw-card__glow"></div>
		<div class="tw-card__in">
			<div class="tw-card__head">
				<span class="tw-mono-av">{avatar}</span>
				<div style="flex:1">
					<div class="tw-card__who">{name}</div>
					<div class="tw-eyebrow" style="font-size:8.5px">TASTE WAVEFORM</div>
				</div>
			</div>
			<div class="tw-wave">{@html svg}</div>
			<div class="tw-card__name">{archetype}</div>
			{#if settings.showChips && chips.length}
				<div class="tw-chips">
					{#each chips as c, i}
						<span class="tw-chip {i === 0 ? 'tw-chip--star' : ''}">{c}</span>
					{/each}
				</div>
			{/if}
			{#if settings.showRead}
				<div class="tw-read">{read}</div>
			{/if}
			{#if settings.showKey}
				<div class="tw-key">━ your average · faint = your songs · - - downvotes</div>
			{/if}
			{#if onshare}
				<button class="tw-share" onclick={onshare}>Share</button>
			{/if}
			<div class="tw-card__foot"><span>the b/side · {league}</span><span style="color:var(--fg-quiet)">no login</span></div>
		</div>
	</div>

{:else if variant === 'hero'}
	<div class="tw-sig">
		<div class="tw-eyebrow">SONIC SIGNATURE</div>
		<div class="tw-name">{archetype}</div>
		<div class="tw-sub">{sub ?? 'your taste, across all your leagues'}</div>
		<div class="tw-wave">{@html svg}</div>
		{#if settings.showChips && chips.length}
			<div class="tw-chips">
				{#each chips as c, i}
					<span class="tw-chip {i === 0 ? 'tw-chip--star' : ''}">{c}</span>
				{/each}
			</div>
		{/if}
		{#if settings.showRead}
			<div class="tw-read">{read}</div>
		{/if}
		{#if settings.showKey}
			<div class="tw-key">━ your average · faint = your songs · - - downvotes</div>
		{/if}
		{#if onshare}
			<button class="tw-share" onclick={onshare}>Share</button>
		{/if}
	</div>

{:else if variant === 'row'}
	<div class="tw-row {selected ? 'is-on' : ''}" onclick={onselect} role="button" tabindex="0"
		onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onselect?.()}>
		<div class="tw-row__label">
			<div class="tw-row__name">{name}</div>
			<div class="tw-row__arch">{archetype.toUpperCase()}</div>
		</div>
		<div class="tw-row__wave">{@html svg}</div>
	</div>

{:else}
	<div class="tw-wave">{@html svg}</div>
{/if}
