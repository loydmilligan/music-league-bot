<!-- ui/src/lib/components/GuessWorkspace.svelte -->
<script lang="ts">
  import type { WorkspaceData, WorkspaceSong } from '$lib/guessing/workspaceData.js';

  let { roundId }: { roundId: number } = $props();

  let data = $state<WorkspaceData | null>(null);
  let configured = $state(true);
  let loadError = $state<string | null>(null);

  let gutError = $state<string | null>(null);
  let locking = $state(false);
  let rehearsalBusy = $state(false);
  let confirmingArchive = $state(false);

  export async function load() {
    loadError = null;
    const res = await fetch(`/api/guess/${roundId}`);
    if (!res.ok) { loadError = `Failed to load workspace (${res.status})`; return; }
    const body = (await res.json()) as { configured: boolean; data: WorkspaceData | null };
    configured = body.configured;
    data = body.data;
  }

  $effect(() => { void roundId; void load(); });

  function nameFor(playerId: number): string {
    return data?.roster.find((p) => p.id === playerId)?.name ?? `#${playerId}`;
  }

  async function setGutPick(song: WorkspaceSong, playerId: number | null) {
    if (playerId === null) return;
    gutError = null;
    const res = await fetch(`/api/guess/${roundId}/gut`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spotifyUri: song.spotifyUri, playerId }),
    });
    if (!res.ok) {
      // spec §7.1: a 409 means the gut slate locked underneath us — that is
      // information, not an error to hide or a select to silently revert.
      // Reload afterward so the UI reflects the true (locked) server state
      // instead of the optimistic edit the select just made.
      const body = await res.json().catch(() => null) as { message?: string } | null;
      gutError = body?.message ?? `Failed to save pick (${res.status})`;
    }
    await load();
  }

  async function lockGutSlate() {
    locking = true;
    try {
      const res = await fetch(`/api/guess/${roundId}/gut`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { message?: string } | null;
        gutError = body?.message ?? `Failed to lock (${res.status})`;
      }
      await load();
    } finally {
      locking = false;
    }
  }

  async function startRehearsal() {
    rehearsalBusy = true;
    try {
      const res = await fetch(`/api/guess/${roundId}/rehearsal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { message?: string } | null;
        gutError = body?.message ?? `Failed to start rehearsal (${res.status})`;
      }
      await load();
    } finally {
      rehearsalBusy = false;
    }
  }

  async function archiveRehearsal() {
    rehearsalBusy = true;
    try {
      const res = await fetch(`/api/guess/${roundId}/rehearsal`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { message?: string } | null;
        gutError = body?.message ?? `Failed to archive rehearsal (${res.status})`;
      }
      confirmingArchive = false;
      await load();
    } finally {
      rehearsalBusy = false;
    }
  }
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

  <!-- Rehearsal controls -->
  <div class="mb-6 flex items-center gap-3">
    {#if data.mode === 'live'}
      <button
        type="button"
        disabled={rehearsalBusy}
        onclick={startRehearsal}
        class="bg-accent hover:bg-accent-strong disabled:opacity-60 disabled:cursor-not-allowed text-bg-elevated font-mono text-xs tracking-widest uppercase px-3 py-1.5 rounded-sm transition-colors"
      >Start rehearsal</button>
    {:else if data.mode === 'rehearsal'}
      {#if !confirmingArchive}
        <button
          type="button"
          disabled={rehearsalBusy}
          onclick={() => (confirmingArchive = true)}
          class="bg-surface border border-border-muted hover:border-warn text-warn disabled:opacity-60 disabled:cursor-not-allowed font-mono text-xs tracking-widest uppercase px-3 py-1.5 rounded-sm transition-colors"
        >Archive rehearsal</button>
      {:else}
        <span class="font-mono text-xs text-fg-muted">
          This deletes every guess for this round — not undoable. Confirm?
        </span>
        <button
          type="button"
          disabled={rehearsalBusy}
          onclick={archiveRehearsal}
          class="bg-warn/20 hover:bg-warn/30 border border-warn disabled:opacity-60 disabled:cursor-not-allowed text-warn font-mono text-xs tracking-widest uppercase px-3 py-1.5 rounded-sm transition-colors"
        >Confirm archive</button>
        <button
          type="button"
          disabled={rehearsalBusy}
          onclick={() => (confirmingArchive = false)}
          class="font-mono text-xs text-fg-muted hover:text-fg tracking-widest uppercase px-3 py-1.5 transition-colors"
        >Cancel</button>
      {/if}
    {/if}
  </div>

  {#if gutError}
    <p class="mb-4 font-mono text-sm text-red-400">{gutError}</p>
  {/if}

  <!-- Validation summary -->
  <div class="mb-4 font-mono text-xs text-fg-muted">
    {#if data.validation.ok}
      <span class="text-accent">validation: clean — every song has a unique pick</span>
    {:else}
      <span>
        {#if data.validation.missingSongs.length > 0}
          {data.validation.missingSongs.length} song{data.validation.missingSongs.length === 1 ? '' : 's'} missing a pick
        {/if}
        {#if data.validation.missingSongs.length > 0 && data.validation.duplicatePlayerIds.length > 0} · {/if}
        {#if data.validation.duplicatePlayerIds.length > 0}
          duplicate: {data.validation.duplicatePlayerIds.map(nameFor).join(', ')}
        {/if}
      </span>
    {/if}
  </div>

  <button
    type="button"
    disabled={!data.validation.ok || data.gutLockedAt !== null || locking}
    onclick={lockGutSlate}
    class="mb-6 bg-accent hover:bg-accent-strong disabled:opacity-60 disabled:cursor-not-allowed text-bg-elevated font-mono text-xs tracking-widest uppercase px-3 py-1.5 rounded-sm transition-colors"
  >Lock gut slate</button>

  <!-- The gut slate -->
  <ol class="flex flex-col gap-2">
    {#each data.songs as song (song.spotifyUri)}
      <li class="flex items-start gap-3 pl-3 pr-4 py-2.5 bg-surface border-l-2 border-border-muted">
        <div class="flex-1 min-w-0">
          <span class="font-bold text-fg">{song.title}</span>
          <span class="text-fg-muted"> — {song.artists}</span>
          {#if song.comment}
            <p class="text-fg-faint text-sm italic mt-1">{song.comment}</p>
          {/if}
        </div>
        <select
          value={song.gutPickPlayerId ?? ''}
          disabled={data.gutLockedAt !== null}
          onchange={(e) => setGutPick(song, e.currentTarget.value ? Number(e.currentTarget.value) : null)}
          class="bg-bg border border-border-muted rounded-lg px-3 py-2 text-sm text-fg font-mono focus:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <option value="">— pick a player —</option>
          {#each data.roster as p (p.id)}
            <option value={p.id}>{p.name}</option>
          {/each}
        </select>
      </li>
    {/each}
  </ol>
{:else}
  <p class="font-mono text-sm text-fg-muted">Loading…</p>
{/if}
