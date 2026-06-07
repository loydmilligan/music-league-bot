<script lang="ts">
  import type { BadgeSet } from '$lib/db/badges.js';

  const {
    set,
    label = '',
  }: {
    set: BadgeSet;
    label?: string;
  } = $props();

  const hasBadges = $derived(
    set.medals.gold > 0 ||
      set.medals.silver > 0 ||
      set.medals.bronze > 0 ||
      set.poop > 0 ||
      set.bigDiscussion > 0,
  );
</script>

{#if hasBadges}
  <div class="badge-strip">
    {#if label}
      <span class="badge-label">{label}</span>
    {/if}
    {#if set.medals.gold > 0}
      <span class="badge-pill">🥇{#if set.medals.gold > 1}<span class="badge-count">×{set.medals.gold}</span>{/if}</span>
    {/if}
    {#if set.medals.silver > 0}
      <span class="badge-pill">🥈{#if set.medals.silver > 1}<span class="badge-count">×{set.medals.silver}</span>{/if}</span>
    {/if}
    {#if set.medals.bronze > 0}
      <span class="badge-pill">🥉{#if set.medals.bronze > 1}<span class="badge-count">×{set.medals.bronze}</span>{/if}</span>
    {/if}
    {#if set.poop > 0}
      <span class="badge-pill">💩{#if set.poop > 1}<span class="badge-count">×{set.poop}</span>{/if}</span>
    {/if}
    {#if set.bigDiscussion > 0}
      <span class="badge-pill">🗣️{#if set.bigDiscussion > 1}<span class="badge-count">×{set.bigDiscussion}</span>{/if}</span>
    {/if}
  </div>
{/if}

<style>
  .badge-strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }

  .badge-label {
    width: 100%;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-fg-faint);
    line-height: 1;
    margin-bottom: 1px;
  }

  .badge-pill {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 13px;
    line-height: 1;
    padding: 2px 6px 2px 4px;
    border-radius: 9999px;
    background: rgb(255 255 255 / 0.06);
    border: 1px solid rgb(255 255 255 / 0.08);
  }

  .badge-count {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    color: var(--color-fg-dim);
    letter-spacing: -0.02em;
  }
</style>
