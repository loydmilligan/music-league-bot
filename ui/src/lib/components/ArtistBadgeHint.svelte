<script lang="ts">
  import type { BadgeSet } from '$lib/db/badges.js';

  const { set }: { set: BadgeSet } = $props();

  // Show only the highest-prestige badge as a subtle collapsed-row hint.
  const topBadge = $derived(
    set.medals.gold > 0
      ? '🥇'
      : set.medals.silver > 0
        ? '🥈'
        : set.medals.bronze > 0
          ? '🥉'
          : set.bigDiscussion > 0
            ? '🗣️'
            : set.poop > 0
              ? '💩'
              : null,
  );
</script>

{#if topBadge}
  <span class="artist-hint" title="Artist has badges">{topBadge}</span>
{/if}

<style>
  .artist-hint {
    font-size: 12px;
    opacity: 0.5;
    line-height: 1;
    /* Prevent hint from affecting the collapsed row's layout height */
    display: inline-block;
    vertical-align: middle;
  }
</style>
