<!-- ui/src/lib/components/GuessWorkspace.svelte -->
<script lang="ts">
  import type { WorkspaceData } from '$lib/guessing/workspaceData.js';

  let { roundId }: { roundId: number } = $props();

  let data = $state<WorkspaceData | null>(null);
  let configured = $state(true);
  let loadError = $state<string | null>(null);

  export async function load() {
    loadError = null;
    const res = await fetch(`/api/guess/${roundId}`);
    if (!res.ok) { loadError = `Failed to load workspace (${res.status})`; return; }
    const body = (await res.json()) as { configured: boolean; data: WorkspaceData | null };
    configured = body.configured;
    data = body.data;
  }

  $effect(() => { void roundId; void load(); });
</script>

{#if loadError}
  <p class="font-mono text-sm text-red-400">{loadError}</p>
{:else if !configured}
  <p class="font-mono text-sm text-fg-muted">
    No guesser set for this league yet — set which competitor is you before using the workspace.
  </p>
{:else if data}
  <div class="mb-4 flex items-center gap-3 font-mono text-xs uppercase tracking-wider text-fg-faint">
    <span>phase: {data.phase}</span>
    {#if data.mode === 'rehearsal'}
      <span class="text-accent">rehearsal · as of {data.asOf}</span>
    {/if}
  </div>
  <p class="font-mono text-sm text-fg-muted">{data.songs.length} songs · {data.roster.length} players</p>
{:else}
  <p class="font-mono text-sm text-fg-muted">Loading…</p>
{/if}
