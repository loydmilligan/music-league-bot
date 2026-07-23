<script lang="ts">
  import type { LabData } from '$lib/voting-lab/types.js';
  import { computeUsage } from '$lib/voting-lab/budget.js';

  let { roundId }: { roundId: number } = $props();

  let data = $state<LabData | null>(null);
  let loadError = $state<string | null>(null);

  async function load() {
    loadError = null;
    const res = await fetch(`/api/voting-lab/${roundId}`);
    if (!res.ok) { loadError = `Failed to load lab (${res.status})`; return; }
    data = (await res.json()) as LabData;
  }

  $effect(() => { void roundId; void load(); });

  const usage = $derived(
    data ? computeUsage(data.rows.map((r) => r.ballot), data.budget) : null,
  );
</script>

<section class="voting-lab">
  <header class="flex items-baseline justify-between gap-4">
    <h2 class="text-lg font-semibold">Voting Lab</h2>
    {#if usage && data}
      <div class="text-sm tabular-nums" class:text-red-500={usage.upRemaining < 0 || usage.downRemaining < 0}>
        Up: {usage.upUsed}/{data.budget.upTotal} · Down: {usage.downUsed}/{data.budget.downTotal}
        <span class="opacity-60">({data.budgetSource})</span>
      </div>
    {/if}
  </header>

  {#if loadError}
    <p class="text-red-500">{loadError}</p>
  {:else if !data}
    <p class="opacity-60">Loading…</p>
  {:else}
    <p class="mt-1 text-sm opacity-70">{data.themeName}</p>
    <ul class="mt-3 space-y-2">
      {#each data.rows as row (row.song.submissionId)}
        <li class="flex items-center gap-3 rounded border border-white/10 p-2">
          {#if row.song.albumArtUrl}
            <img src={row.song.albumArtUrl} alt="" class="h-10 w-10 rounded" />
          {/if}
          <div class="min-w-0">
            <div class="truncate font-medium">{row.song.title}</div>
            <div class="truncate text-sm opacity-70">{row.song.artist}</div>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>
