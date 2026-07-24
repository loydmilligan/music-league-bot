<script lang="ts">
  import type { BallotEntry, LabRow } from '$lib/voting-lab/types.js';
  import type { VotingTakeOutput } from '$lib/predict/tasks/votingTake.js';

  let {
    row,
    roundId,
    canAlloc,
    onchange,
    flushSaves,
  }: {
    row: LabRow;
    roundId: number;
    canAlloc: (uri: string, kind: 'up' | 'down', delta: number) => boolean;
    onchange: (ballot: BallotEntry) => void;
    /** Flush (and await) any pending debounced ballot save before drafting a comment. */
    flushSaves: () => Promise<void>;
  } = $props();

  let take = $state<VotingTakeOutput | null>(null);
  let takeLoading = $state(false);
  let takeError = $state<string | null>(null);
  let drafting = $state(false);
  let draftError = $state<string | null>(null);

  async function getTake(forceRegen = false) {
    takeLoading = true;
    takeError = null;
    try {
      const res = await fetch(`/api/voting-lab/${roundId}/take`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spotifyUri: row.song.spotifyUri, forceRegen }),
      });
      if (res.ok) {
        take = (await res.json()).output as VotingTakeOutput;
      } else {
        takeError = `Failed to get take (${res.status})`;
      }
    } catch {
      takeError = 'Failed to get take (network error)';
    } finally {
      takeLoading = false;
    }
  }

  /**
   * Draft/Regenerate the public vote comment. "Draft" (forceRegen:false) is
   * free on revisit — the backend serves a cached draft for these exact
   * inputs if one exists. "Regenerate" always passes forceRegen:true so it
   * never returns the same stale text.
   *
   * Flushes any pending debounced ballot save (notes/rating/allocation)
   * first — the comment endpoint reads those from the DB, and the ballot
   * PATCH is debounced 400ms client-side, so without this a "Draft comment"
   * click right after typing notes would draft (and cache) from stale notes.
   */
  async function draftComment(forceRegen: boolean) {
    drafting = true;
    draftError = null;
    try {
      await flushSaves();
      const res = await fetch(`/api/voting-lab/${roundId}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spotifyUri: row.song.spotifyUri, forceRegen }),
      });
      if (res.ok) {
        const { output } = (await res.json()) as { output: { draft: string } };
        onchange({ ...row.ballot, draftComment: output.draft });
      } else {
        draftError = `Failed to draft comment (${res.status})`;
      }
    } catch {
      draftError = 'Failed to draft comment (network error)';
    } finally {
      drafting = false;
    }
  }

  async function copyComment() {
    await navigator.clipboard.writeText(row.ballot.draftComment);
  }

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

  {#if take}
    <div class="mt-2 rounded bg-black/20 p-2 text-sm">
      <p><span class="opacity-60">Theme:</span> {take.theme_read}</p>
      <p><span class="opacity-60">Your taste:</span> {take.taste_note}</p>
      <ul class="mt-1 list-disc pl-5">
        {#each take.angles as a}<li>{a}</li>{/each}
      </ul>
      <div class="mt-1 flex flex-wrap gap-1 text-xs opacity-60">
        {#each take.signals as s}<span class="rounded bg-white/10 px-1">{s}</span>{/each}
      </div>
      <button
        class="mt-2 text-xs underline opacity-70"
        onclick={() => getTake(true)}
        disabled={takeLoading}
      >
        {takeLoading ? 'Thinking…' : 'Refresh'}
      </button>
    </div>
  {:else}
    <button class="mt-2 text-xs underline opacity-70" onclick={() => getTake(false)} disabled={takeLoading}>
      {takeLoading ? 'Thinking…' : 'Get take'}
    </button>
  {/if}
  {#if takeError}
    <p class="mt-1 text-xs text-red-500">{takeError}</p>
  {/if}

  <textarea
    class="mt-2 w-full rounded bg-black/20 p-2 text-sm"
    rows="2"
    placeholder="Your notes on this track…"
    value={row.ballot.notes}
    oninput={(e) => setNotes((e.currentTarget as HTMLTextAreaElement).value)}
  ></textarea>

  <div class="mt-2">
    <textarea
      class="w-full rounded bg-black/20 p-2 text-sm"
      rows="2"
      placeholder="Drafted vote comment…"
      value={row.ballot.draftComment}
      oninput={(e) => onchange({ ...row.ballot, draftComment: (e.currentTarget as HTMLTextAreaElement).value })}
    ></textarea>
    <div class="mt-1 flex gap-3 text-xs">
      <button
        class="underline opacity-70"
        onclick={() => draftComment(!!row.ballot.draftComment)}
        disabled={drafting}
      >
        {drafting ? 'Drafting…' : row.ballot.draftComment ? 'Regenerate' : 'Draft comment'}
      </button>
      {#if row.ballot.draftComment}
        <button class="underline opacity-70" onclick={copyComment}>Copy</button>
      {/if}
    </div>
    {#if draftError}
      <p class="mt-1 text-xs text-red-500">{draftError}</p>
    {/if}
  </div>
</li>
