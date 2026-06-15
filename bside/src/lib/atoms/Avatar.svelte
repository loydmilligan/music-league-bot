<script lang="ts">
	interface Props {
		hue: string;
		initials: string;
		size?: 'sm' | 'md' | 'lg';
	}
	let { hue, initials, size = 'md' }: Props = $props();
</script>

<div class="bs-av" data-size={size} style:background={hue}>
	{initials}
</div>
