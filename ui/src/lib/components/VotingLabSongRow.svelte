<script lang="ts">
  import type { BallotEntry, LabRow } from '$lib/voting-lab/types.js';

  let {
    row,
    canAlloc,
    onchange,
  }: {
    row: LabRow;
    canAlloc: (uri: string, kind: 'up' | 'down', delta: number) => boolean;
    onchange: (ballot: BallotEntry) => void;
  } = $props();

  function bump(kind: 'up' | 'down', delta: number) {
    if (!canAlloc(row.song.spotifyUri, kind, delta)) return;
    const next: BallotEntry = { ...row.ballot };
    if (kind === 'up') next.upPoints += delta;
    else next.downPoints += delta;
    onchange(next);
  }

  function setNotes(value: string) {
    onchange({ ...row.ballot, notes: value });
  }

  function toggleMine() {
    // Clearing points keeps the ballot valid the moment it is marked as yours.
    onchange({ ...row.ballot, isMine: !row.ballot.isMine, upPoints: 0, downPoints: 0 });
  }

  /** Clicking the active star clears the rating. */
  function setRating(value: number) {
    onchange({ ...row.ballot, rating: row.ballot.rating === value ? null : value });
  }
</script>

<li class="rounded border border-white/10 p-3">
  <div class="flex items-center gap-3">
    {#if row.song.albumArtUrl}
      <img src={row.song.albumArtUrl} alt="" class="h-10 w-10 rounded" />
    {/if}
    <div class="min-w-0 flex-1">
      <div class="truncate font-medium">{row.song.title}</div>
      <div class="truncate text-sm opacity-70">{row.song.artist}</div>
      <div class="mt-1 flex flex-wrap gap-1 text-xs opacity-60">
        {#if row.song.spotifyPopularity !== null}<span>pop {row.song.spotifyPopularity}</span>{/if}
        {#if row.song.bpm !== null}<span>{row.song.bpm} bpm</span>{/if}
        {#if row.song.energy !== null}<span>energy {row.song.energy.toFixed(2)}</span>{/if}
        {#if row.song.hasLyrics === false}<span>instrumental</span>{/if}
        {#each row.song.tags.slice(0, 3) as tag}<span>{tag}</span>{/each}
      </div>
    </div>

    {#if row.ballot.isMine}
      <span class="text-xs opacity-60">your song</span>
    {:else}
      <div class="flex items-center gap-1">
        <button class="px-2" onclick={() => bump('up', -1)} aria-label="one less up point">−</button>
        <span class="w-8 text-center tabular-nums">▲{row.ballot.upPoints}</span>
        <button class="px-2" onclick={() => bump('up', 1)} aria-label="one more up point">+</button>
      </div>
      <div class="flex items-center gap-1">
        <button class="px-2" onclick={() => bump('down', -1)} aria-label="one less down point">−</button>
        <span class="w-8 text-center tabular-nums">▼{row.ballot.downPoints}</span>
        <button class="px-2" onclick={() => bump('down', 1)} aria-label="one more down point">+</button>
      </div>
    {/if}

    <button class="text-xs underline opacity-60" onclick={toggleMine}>
      {row.ballot.isMine ? 'not mine' : 'mine'}
    </button>
  </div>

  <div class="mt-2 flex items-center gap-1 text-xs">
    <span class="opacity-60">Your rating</span>
    {#each [1, 2, 3, 4, 5] as star}
      <button
        class="px-1"
        class:opacity-100={row.ballot.rating !== null && star <= row.ballot.rating}
        class:opacity-30={row.ballot.rating === null || star > row.ballot.rating}
        onclick={() => setRating(star)}
        aria-label={`rate ${star} of 5`}
      >★</button>
    {/each}
  </div>

  <textarea
    class="mt-2 w-full rounded bg-black/20 p-2 text-sm"
    rows="2"
    placeholder="Your notes on this track…"
    value={row.ballot.notes}
    oninput={(e) => setNotes((e.currentTarget as HTMLTextAreaElement).value)}
  ></textarea>
</li>
