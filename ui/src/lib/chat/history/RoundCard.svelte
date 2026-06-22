<script lang="ts">
  interface Props {
    roundId: number;
    roundName: string;
    roundNumber?: number;
    platform: string;
    messageCount: number;
    lastTs: string | null;
    snippet: string | null;
    isSelected: boolean;
    isLive?: boolean;
    onclick: () => void;
  }

  let {
    roundId,
    roundName,
    platform,
    messageCount,
    lastTs,
    snippet,
    isSelected,
    isLive = false,
    onclick,
  }: Props = $props();

  function fmtDate(iso: string | null): string {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
</script>

<button
  type="button"
  class="ch-round-card w-full text-left"
  class:is-selected={isSelected}
  {onclick}
>
  <div class="flex items-center gap-2">
    <span class="ch-pip {platform}" aria-hidden="true"></span>
    {#if isLive}
      <span class="font-mono text-[9px] tracking-widest uppercase text-health">live</span>
    {/if}
    <span class="ch-round-card-name flex-1 min-w-0">{roundName}</span>
    <span class="font-mono text-[10px] text-fg-faint flex-shrink-0">r-{roundId}</span>
  </div>
  <div class="ch-round-card-meta">
    <span>{messageCount} msg{messageCount === 1 ? '' : 's'}</span>
    {#if lastTs}
      <span aria-hidden="true">·</span>
      <span>{fmtDate(lastTs)}</span>
    {/if}
  </div>
  {#if snippet}
    <div class="ch-round-card-snippet">{snippet}</div>
  {/if}
</button>
