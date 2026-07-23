<script lang="ts">
  import ThemeBriefView from '$lib/theme-brief/ThemeBriefView.svelte';
  let { data } = $props();
</script>

<ThemeBriefView roundId={data.roundId} brief={data.brief} />
