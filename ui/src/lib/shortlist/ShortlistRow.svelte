<script lang="ts">
  import MiniDna from './MiniDna.svelte';
  import ScoreChip from './ScoreChip.svelte';
  import DnaStrip from './DnaStrip.svelte';
  import AssignPopover from './AssignPopover.svelte';
  import type { ShortlistSong } from '$lib/types.js';

  const { song, open = false, ontoggle, onremoved, personalRatingSignal = null } = $props<{
    song: ShortlistSong;
    open?: boolean;
    ontoggle: () => void;
    onremoved: (id: string) => void;
    personalRatingSignal?: number | null;
  }>();

  let showAssignPopover = $state(false);
  let localSong = $state({ ...song });

  $effect(() => {
    if (personalRatingSignal !== null && open) {
      patchRating('personal', personalRatingSignal);
    }
  });

  function humaneTime(iso: string): string {
    const ms = Date.now() - Date.parse(iso);
    const d = Math.floor(ms / 86400000);
    if (d === 0) return 'today';
    if (d === 1) return '1 day ago';
    if (d < 30) return `${d} days ago`;
    const mo = Math.floor(d / 30);
    return mo === 1 ? '1 month ago' : `${mo} months ago`;
  }

  async function patchRating(dimension: 'discovery' | 'theme_fit' | 'nostalgia' | 'personal', value: number) {
    await fetch(`/api/shortlist/${localSong.id}/rating`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dimension, value }),
    });
    if (dimension === 'discovery') localSong = { ...localSong, ratingDiscovery: value };
    else if (dimension === 'theme_fit') localSong = { ...localSong, ratingThemeFit: value };
    else if (dimension === 'nostalgia') localSong = { ...localSong, ratingNostalgia: value };
    else if (dimension === 'personal') localSong = { ...localSong, ratingPersonal: value };
  }

  let notesVal = $state(song.notes);
  async function saveNotes() {
    await fetch(`/api/shortlist/${localSong.id}/notes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: notesVal }),
    });
    localSong = { ...localSong, notes: notesVal };
  }

  async function remove() {
    await fetch(`/api/shortlist/${localSong.id}`, { method: 'DELETE' });
    onremoved(localSong.id);
  }

  async function markSubmittedElsewhere() {
    const newVal = !localSong.submittedElsewhere;
    await fetch(`/api/shortlist/${localSong.id}/submitted-elsewhere`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: newVal }),
    });
    localSong = { ...localSong, submittedElsewhere: newVal };
  }

  const assignedRoundIds = $derived((localSong.assignments ?? []).map(a => a.roundId));
  const hasAssignments = $derived(assignedRoundIds.length > 0);
</script>

{#if open}
  <div class="sl-row is-open">
    <div class="sl-row-open">
      <div class="sl-row-open-art">
        {#if localSong.albumArtUrl}
          <img src={localSong.albumArtUrl} alt="" width="180" height="180" style="border-radius: var(--r-2)" />
        {/if}
        <ScoreChip discovery={localSong.ratingDiscovery} themeFit={localSong.ratingThemeFit} nostalgia={localSong.ratingNostalgia} personal={localSong.ratingPersonal} />
      </div>
      <div class="sl-row-open-body">
        <div class="sl-row-open-title">{localSong.title}</div>
        <div class="sl-row-open-sub">{localSong.artist}{localSong.album ? ` · ${localSong.album}` : ''}</div>
        <DnaStrip discovery={localSong.ratingDiscovery} themeFit={localSong.ratingThemeFit} nostalgia={localSong.ratingNostalgia} personal={localSong.ratingPersonal} onchange={patchRating} />
        <textarea class="sl-notes" bind:value={notesVal} placeholder="Notes…" onblur={saveNotes} rows="3"></textarea>
        {#if hasAssignments}
          <div class="sl-row-open-assignments">
            {#each (localSong.assignments ?? []) as a}
              <span class="sl-assignment-chip">Round {a.roundId}</span>
            {/each}
          </div>
        {/if}
      </div>
      <div class="sl-row-open-actions">
        <a href="https://open.spotify.com/track/{localSong.spotifyUri.split(':').at(-1)}" target="_blank" rel="noopener" class="sl-btn sl-btn-primary">▶ Play on Spotify</a>
        <div style="position: relative">
          <button type="button" class="sl-btn sl-btn-secondary sl-iconbtn" class:has-some={hasAssignments} onclick={() => showAssignPopover = !showAssignPopover}>
            ⊕ Assign to round
            {#if hasAssignments}<span class="badge">{assignedRoundIds.length}</span>{/if}
          </button>
          {#if showAssignPopover}
            <AssignPopover songId={localSong.id} songTitle={localSong.title} {assignedRoundIds} onclose={() => showAssignPopover = false} />
          {/if}
        </div>
        <button type="button" class="sl-btn sl-btn-ghost" class:sl-btn-active={localSong.submittedElsewhere} onclick={markSubmittedElsewhere}>
          {localSong.submittedElsewhere ? '✓ Submitted elsewhere' : 'Mark as submitted elsewhere'}
        </button>
        <button type="button" class="sl-btn sl-btn-ghost sl-btn-ember" onclick={remove}>✕ Remove from shortlist</button>
        <p class="sl-action-hint">Press Esc to collapse</p>
      </div>
    </div>
  </div>
{:else}
  <button type="button" class="sl-row" onclick={ontoggle}>
    {#if localSong.albumArtUrl}
      <img src={localSong.albumArtUrl} alt="" class="sl-row-art" width="44" height="44" />
    {:else}
      <span class="sl-row-art-placeholder"></span>
    {/if}
    <span class="sl-row-body">
      <span class="sl-row-title">{localSong.title}</span>
      <span class="sl-row-artist">{localSong.artist}</span>
    </span>
    <span class="sl-row-meta">{humaneTime(localSong.addedAt)}</span>
    <MiniDna discovery={localSong.ratingDiscovery} themeFit={localSong.ratingThemeFit} nostalgia={localSong.ratingNostalgia} personal={localSong.ratingPersonal} />
    <ScoreChip discovery={localSong.ratingDiscovery} themeFit={localSong.ratingThemeFit} nostalgia={localSong.ratingNostalgia} personal={localSong.ratingPersonal} />
  </button>
{/if}
