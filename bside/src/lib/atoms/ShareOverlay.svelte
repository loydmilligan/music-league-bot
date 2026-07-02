<script lang="ts">
	import Avatar from './Avatar.svelte';
	import { bsAcc } from '../accents.js';
	import { icons } from '../icons.js';
	import type { SharePayload } from '../types.js';
	import TasteWaveform from '../taste-waveform/TasteWaveform.svelte';
	import { DEFAULT_TASTE_SETTINGS } from '../taste-waveform/taste-waveform.js';
	import { shareCardImage } from '../shareImage.js';

	interface Props {
		payload: SharePayload | null;
		leagueName: string;
		leagueSeason: number;
		onClose: () => void;
	}
	let { payload, leagueName, leagueSeason, onClose }: Props = $props();

	let cardEl: HTMLDivElement | undefined = $state();
</script>

{#if payload}
	<div class="bs-overlay" role="dialog" aria-modal="true" aria-label="Share card"
		onclick={onClose} onkeydown={(e) => e.key === 'Escape' && onClose()}>
		<button class="bs-icon-btn bs-overlay-close" onclick={onClose} aria-label="Close">
			{@html icons.close}
		</button>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		{#if payload.kind === 'signature' && payload.engine && payload.pi != null}
			<div bind:this={cardEl} onclick={(e) => e.stopPropagation()}>
				<TasteWaveform
					variant="card"
					engine={payload.engine}
					pi={payload.pi}
					name={payload.who}
					avatar={payload.initials}
					league={payload.league ?? leagueName}
					settings={payload.settings ?? DEFAULT_TASTE_SETTINGS}
					onshare={() => { if (!cardEl) return; shareCardImage(cardEl, 'sonic-signature-' + (payload?.who || 'me') + '.png'); }}
				/>
			</div>
			<div class="bs-overlay-cap">Screenshot-ready · no login, no app link — just your waveform.</div>
		{:else}
			<div class={'bs-sharecard ' + bsAcc(payload.accent)} onclick={(e) => e.stopPropagation()}>
				<div class="bs-sharecard-top">
					<span class="bs-mark bs-mark--sm">the b/side</span>
					<span class="bs-sharecard-league">{leagueName} · S{leagueSeason}</span>
				</div>
				<div class="bs-sharecard-medal">{@html icons.trophy}</div>
				<div class="bs-sharecard-award">{payload.award}</div>
				<div class="bs-sharecard-blurb">{payload.blurb}</div>
				<div class="bs-sharecard-foot">
					<Avatar hue={payload.hue} initials={payload.initials} size="sm" />
					<div class="bs-sharecard-name">
						{payload.who}
						<small>{leagueName}</small>
					</div>
				</div>
			</div>
			<div class="bs-overlay-cap">Screenshot-ready · no login, no app link — just the award and the league name.</div>
		{/if}
	</div>
{/if}
