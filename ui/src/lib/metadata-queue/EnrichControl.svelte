<script lang="ts">
  import type { Scope } from '$lib/db/metadataQueue.js';

  let {
    scope,
    n,
    loading,
    onEnrich,
  }: {
    scope: Scope;
    n: number;
    loading: boolean;
    onEnrich: () => void;
  } = $props();
</script>

<button
  type="button"
  onclick={onEnrich}
  disabled={loading}
  class="font-mono text-[10px] tracking-widest uppercase px-3 py-1.5 rounded-sm border transition-colors {loading
    ? 'border-border-muted text-fg-faint cursor-not-allowed'
    : 'border-accent text-accent hover:bg-accent hover:text-bg'}"
>
  {#if loading}
    Enqueueing…
  {:else if scope.level === 'all'}
    Enrich everything missing · {n}
  {:else}
    Fill gaps · enrich {n}
  {/if}
</button>
