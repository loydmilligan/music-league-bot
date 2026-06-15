<script lang="ts">
  import '$lib/content/content.css';
  import type { PageData } from './$types.js';

  let { data }: { data: PageData } = $props();

  const digestHref = $derived(
    data.latestDigestRoundId ? `/digest/${data.latestDigestRoundId}` : '/digest',
  );
</script>

<svelte:head>
  <title>Content · music-league-bot</title>
</svelte:head>

<div style="display: flex; flex-direction: column; gap: 24px;">
  <header style="display: flex; flex-direction: column; gap: 6px;">
    <p style="font: 700 10px/1 var(--font-mono); letter-spacing: 0.16em; text-transform: uppercase; color: var(--fg-muted); margin: 0;">
      music-league-bot · /content
    </p>
    <h1 style="margin: 0; font: 700 28px/1.15 var(--font-display); letter-spacing: -0.015em; color: var(--fg);">
      Content
    </h1>
    <p style="margin: 0; font: 500 13px/1.5 var(--font-body); color: var(--fg-muted); max-width: 68ch;">
      Generate this round's digest, and keep each league's shareable b-side archive up to date — one link per league, all season.
    </p>
  </header>

  <div class="ct-tabrow">
    <div class="ct-tabs">
      <a href={digestHref} class="ct-tab">
        <span class="ct-tab-glyph">✉</span>
        Digest
      </a>
      <span class="ct-tab is-on">
        <span class="ct-tab-glyph">≣</span>
        Archive
        {#if data.pendingCount > 0}
          <span class="ct-count">{data.pendingCount}</span>
        {/if}
      </span>
    </div>
    <span class="ct-tabrow-note">
      {data.pendingCount > 0 ? `${data.pendingCount} league${data.pendingCount === 1 ? '' : 's'} have a new digest ready to archive` : 'all leagues up to date'}
    </span>
  </div>

  <!-- archive-list task builds the real content here -->
  <div style="padding: 32px 0; text-align: center; font: 500 13px/1.5 var(--font-mono); color: var(--fg-quiet);">
    Archive — league list coming in the next task.
  </div>
</div>
