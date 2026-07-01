<!--
  TasteSettings.svelte — the Signature settings surface (Settings → App-setup).
  Exposes exactly the spec's controls; everything visual stays locked.
  Persists to localStorage via tasteSettings (never read_model.json).
-->
<script lang="ts">
	import { tasteSettings as s, saveTasteSettings } from '../tasteSettings.svelte.js';
	import type { SignalMode } from '../taste-waveform/taste-waveform.js';

	interface Props { open: boolean; onClose: () => void; }
	let { open, onClose }: Props = $props();

	const modes: { v: SignalMode; label: string }[] = [
		{ v: 'all', label: 'ALL' }, { v: 'subs', label: 'SUBS' }, { v: 'top', label: 'TOP' }, { v: 'frac', label: 'VOTE %' },
	];
	function commit() { saveTasteSettings(); }
</script>

{#if open}
	<div class="ts-ov" role="dialog" aria-modal="true" aria-label="Signature settings" onclick={onClose}>
		<div class="ts" onclick={(e) => e.stopPropagation()}>
			<div class="ts__top">
				<span class="tw-eyebrow">SIGNATURE · APP-SETUP</span>
				<button class="ts__x" onclick={onClose} aria-label="Close">✕</button>
			</div>

			<div class="ts__row">
				<div><div class="ts__label">Signal source</div><div class="ts__sub">Each vote is a small share of a submission.</div></div>
				<div class="ts__seg">
					{#each modes as m}
						<button class={'ts__segb' + (s.signal === m.v ? ' on' : '')} onclick={() => { s.signal = m.v; commit(); }}>{m.label}</button>
					{/each}
				</div>
			</div>

			{#if s.signal === 'frac'}
				<div class="ts__row">
					<div><div class="ts__label">Vote value</div><div class="ts__sub">Each point spent = this share of one submission.</div></div>
					<div class="ts__slide">
						<div class="ts__val">{s.votePct}% / pt</div>
						<input type="range" min="0" max="25" step="1" bind:value={s.votePct} oninput={commit} />
					</div>
				</div>
			{/if}

			<div class="ts__row">
				<div><div class="ts__label">Count downvotes</div><div class="ts__sub">One per round — a strong signal that repels your waveform.</div></div>
				<button class={'ts__tog' + (s.negatives ? ' on' : '')} onclick={() => { s.negatives = !s.negatives; commit(); }} aria-pressed={s.negatives}><span class="ts__knob"></span></button>
			</div>

			{#if s.negatives}
				<div class="ts__row">
					<div><div class="ts__label">Downvote impact</div><div class="ts__sub">How hard a downvote pushes, vs a submission.</div></div>
					<div class="ts__slide"><div class="ts__val">{s.dnPct}%</div><input type="range" min="0" max="150" step="5" bind:value={s.dnPct} oninput={commit} /></div>
				</div>
			{/if}

			<div class="ts__row">
				<div><div class="ts__label">Lyrical impact</div><div class="ts__sub">Lower so near-universal lyrics don't drown other traits.</div></div>
				<div class="ts__slide"><div class="ts__val">{Math.round(s.lyrWeight * 100)}%</div><input type="range" min="0" max="1" step="0.05" bind:value={s.lyrWeight} oninput={commit} /></div>
			</div>

			<div class="ts__row">
				<div><div class="ts__label">Spread</div><div class="ts__sub">How far distinctive traits push from center.</div></div>
				<div class="ts__slide"><div class="ts__val">{s.spread.toFixed(2)}×</div><input type="range" min="1" max="1.6" step="0.05" bind:value={s.spread} oninput={commit} /></div>
			</div>

			<div class="ts__row">
				<div><div class="ts__label">Use all my leagues</div><div class="ts__sub">On: your whole taste across every league. Off: this league only.</div></div>
				<button class={'ts__tog' + (s.scopeAll ? ' on' : '')} onclick={() => { s.scopeAll = !s.scopeAll; commit(); }} aria-pressed={s.scopeAll}><span class="ts__knob"></span></button>
			</div>
		</div>
	</div>
{/if}

<style>
	.ts-ov { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(7,9,12,.86); backdrop-filter: blur(6px); }
	.ts { width: 380px; max-width: calc(100vw - 32px); max-height: calc(100vh - 40px); overflow-y: auto; background: var(--ink-2); border: 1px solid var(--ink-4); border-top: 2px solid var(--mash-pulp); border-radius: var(--r-6, 20px); padding: 16px; box-shadow: 0 24px 60px rgba(0,0,0,.6); }
	.ts__top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
	.ts__x { background: none; border: none; color: var(--fg-muted); font-size: 15px; cursor: pointer; }
	.ts__row { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 12px 0; border-bottom: 1px solid var(--line); }
	.ts__label { font-size: 13px; color: var(--fg); font-weight: 500; }
	.ts__sub { font-size: 11px; color: var(--fg-muted); margin-top: 3px; line-height: 1.4; }
	.ts__seg { display: flex; gap: 4px; background: var(--ink-1); border: 1px solid var(--line); border-radius: var(--r-3); padding: 3px; flex: none; }
	.ts__segb { font-family: 'JetBrains Mono', monospace; font-size: 10px; padding: 5px 8px; border-radius: var(--r-2); border: none; background: transparent; color: var(--fg-muted); cursor: pointer; }
	.ts__segb.on { background: var(--mash-pulp); color: var(--ink-0); font-weight: 700; }
	.ts__slide { width: 150px; flex: none; }
	.ts__val { text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #ff7a52; margin-bottom: 6px; }
	.ts__slide input { width: 100%; accent-color: var(--mash-pulp); }
	.ts__tog { width: 44px; height: 25px; border-radius: 999px; border: 1px solid var(--line-strong); background: var(--ink-1); position: relative; flex: none; cursor: pointer; }
	.ts__tog.on { background: var(--mash-pulp); border-color: var(--mash-pulp); }
	.ts__knob { position: absolute; top: 2px; left: 2px; width: 19px; height: 19px; border-radius: 50%; background: var(--fg-muted); transition: left var(--dur-base) var(--ease-out); }
	.ts__tog.on .ts__knob { left: 21px; background: var(--ink-0); }
</style>
