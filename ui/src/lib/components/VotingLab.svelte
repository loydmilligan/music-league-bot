<script lang="ts">
  import type { BallotEntry, LabData } from '$lib/voting-lab/types.js';
  import { canAllocate, computeUsage } from '$lib/voting-lab/budget.js';
  import VotingLabSongRow from './VotingLabSongRow.svelte';

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

  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function canAlloc(uri: string, kind: 'up' | 'down', delta: number): boolean {
    if (!data) return false;
    return canAllocate(data.rows.map((r) => r.ballot), data.budget, uri, kind, delta);
  }

  /** Update local state immediately, then debounce the PATCH per song. */
  function applyBallot(next: BallotEntry) {
    if (!data) return;
    data.rows = data.rows.map((r) =>
      r.song.spotifyUri === next.spotifyUri ? { ...r, ballot: next } : r,
    );
    const existing = saveTimers.get(next.spotifyUri);
    if (existing) clearTimeout(existing);
    saveTimers.set(
      next.spotifyUri,
      setTimeout(() => {
        void fetch(`/api/voting-lab/${roundId}/ballot`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        });
      }, 400),
    );
  }
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
        <VotingLabSongRow {row} {canAlloc} onchange={applyBallot} />
      {/each}
    </ul>
  {/if}
</section>
