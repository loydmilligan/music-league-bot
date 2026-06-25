<script lang="ts">
	interface Props {
		hue: string;
		initials: string;
		size?: 'sm' | 'md' | 'lg';
		src?: string | null;
	}
	let { hue, initials, size = 'md', src = null }: Props = $props();
	let imgFailed = $state(false);
	function onError() { imgFailed = true; }
</script>

{#if src && !imgFailed}
	<img class="bs-av" data-size={size} src={src} alt={initials} onerror={onError} />
{:else}
	<div class="bs-av" data-size={size} style:background={hue}>
		{initials}
	</div>
{/if}
