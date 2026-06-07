<script lang="ts">
  import type { SpotifyResult } from './SongSearchCard.svelte';

  type OpenRound = {
    id: number;
    name: string;
    description: string | null;
    submissionDeadline: string | null;
    leagueName: string;
  };

  let {
    result,
    activeRoundId = null,
    openRounds = [],
  }: {
    result: SpotifyResult;
    activeRoundId?: number | null;
    openRounds?: OpenRound[];
  } = $props();

  const trackId = $derived(result.uri.replace('spotify:track:', ''));

  // + Shortlist state (quick-add to active round)
  let shortlisted = $state(false);
  let shortlisting = $state(false);
  let shortlistError = $state<string | null>(null);

  // Round picker — shared by + Shortlist (when no active round), + Round, + H2H
  let pickerMode = $state<'shortlist' | 'round' | 'h2h' | null>(null);
  let addingRoundId = $state<number | null>(null);
  // Track which rounds this song has been added to in this session
  let addedRoundIds = $state(new Set<number>());

  async function addToResearch(roundId: number): Promise<boolean> {
    addingRoundId = roundId;
    try {
      const res = await fetch(`/api/research/${roundId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spotifyUri: result.uri,
          title: result.name,
          artist: result.artists,
          album: result.album || null,
        }),
      });
      return res.ok;
    } catch { return false; }
    finally { addingRoundId = null; }
  }

  async function doShortlist() {
    if (shortlisted || shortlisting) return;
    shortlistError = null;
    if (activeRoundId !== null) {
      shortlisting = true;
      const ok = await addToResearch(activeRoundId);
      shortlisted = ok;
      if (!ok) shortlistError = 'Failed';
      shortlisting = false;
    } else {
      // No active round — open the picker
      pickerMode = pickerMode === 'shortlist' ? null : 'shortlist';
    }
  }

  async function pickRound(roundId: number) {
    const ok = await addToResearch(roundId);
    if (ok) {
      addedRoundIds = new Set([...addedRoundIds, roundId]);
      if (pickerMode === 'shortlist') shortlisted = true;
      pickerMode = null;
    }
  }

  function togglePicker(mode: 'round' | 'h2h') {
    pickerMode = pickerMode === mode ? null : mode;
  }

  function roundLabel(r: OpenRound): string {
    return `${r.leagueName} · ${r.description ?? r.name}`;
  }
</script>

<div class="flex flex-col gap-2 w-full">
  <!-- Action row -->
  <div class="flex items-center gap-3 flex-wrap text-xs font-mono">
    <!-- + Shortlist -->
    <button
      type="button"
      onclick={doShortlist}
      disabled={shortlisting || (shortlisted && activeRoundId !== null)}
      class="transition-colors {shortlisted
        ? 'text-health cursor-default'
        : 'text-fg-dim hover:text-fg'}"
    >
      {#if shortlisting}
        <span class="opacity-60">…</span>
      {:else if shortlisted}
        ✓ Shortlisted
      {:else}
        + Shortlist
      {/if}
    </button>
    {#if shortlistError}
      <span class="text-warn">{shortlistError}</span>
    {/if}

    <!-- + Round List -->
    <button
      type="button"
      onclick={() => togglePicker('round')}
      class="transition-colors {pickerMode === 'round' ? 'text-accent' : 'text-fg-dim hover:text-fg'}"
    >+ Round</button>

    <!-- + H2H -->
    <button
      type="button"
      onclick={() => togglePicker('h2h')}
      class="transition-colors {pickerMode === 'h2h' ? 'text-accent' : 'text-fg-dim hover:text-fg'}"
    >+ H2H</button>

    <!-- ▶ Play on Spotify -->
    <a
      href="https://open.spotify.com/track/{trackId}"
      target="_blank"
      rel="noreferrer"
      class="text-fg-dim hover:text-fg transition-colors ml-auto"
    >▶ Play</a>
  </div>

  <!-- Inline round picker (shared) -->
  {#if pickerMode && openRounds.length > 0}
    <div class="border border-border-muted rounded-lg overflow-hidden">
      <div class="px-2 py-1.5 bg-surface border-b border-border-muted">
        <span class="font-mono text-[10px] tracking-widest uppercase text-fg-faint">
          {pickerMode === 'h2h' ? 'Add to H2H pool' : 'Add to round list'}
        </span>
      </div>
      <div class="max-h-36 overflow-y-auto">
        {#each openRounds as round}
          {@const added = addedRoundIds.has(round.id)}
          <button
            type="button"
            onclick={() => pickRound(round.id)}
            disabled={addingRoundId === round.id}
            class="w-full text-left px-2 py-1.5 text-xs font-mono flex items-center gap-2 hover:bg-surface transition-colors border-b border-border-muted/50 last:border-0 {added ? 'text-health' : 'text-fg'}"
          >
            <span class="w-3 flex-shrink-0 text-center">
              {#if addingRoundId === round.id}
                <span class="opacity-60">…</span>
              {:else if added}
                ✓
              {:else}
                +
              {/if}
            </span>
            <span class="truncate flex-1">{roundLabel(round)}</span>
          </button>
        {/each}
      </div>
    </div>
  {:else if pickerMode && openRounds.length === 0}
    <p class="font-mono text-xs text-fg-faint italic px-1">No open rounds available.</p>
  {/if}
</div>
