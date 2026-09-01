<!-- ui/src/lib/components/GuessWorkspace.svelte -->
<script lang="ts">
  import type { WorkspaceData, WorkspaceSong } from '$lib/guessing/workspaceData.js';
  import VotingLab from './VotingLab.svelte';
  import RefineBoard from './RefineBoard.svelte';

  let { roundId }: { roundId: number } = $props();

  let data = $state<WorkspaceData | null>(null);
  let configured = $state(true);
  let loadError = $state<string | null>(null);

  /**
   * The mounted refine board, for its flush handle (SearchBar.svelte's
   * `export function` + `bind:this` idiom). The board debounces candidate
   * edits by 400ms; the rehearsal controls below are reachable the entire time
   * it is mounted, and BOTH of them must serialize behind that debounce.
   * archiveRehearsal is the serious one — it deletes every guess for the
   * round, and a PATCH still sitting behind the debounce would land after the
   * delete and re-create the row via setCandidate's INSERT OR IGNORE. Same
   * class of bug as commit ad6a37f's serialize-before-delete.
   */
  let refineBoard = $state<{ flush: () => Promise<void> } | null>(null);

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

  // A <select> is uncontrolled once the user edits it: `value={...}` only
  // re-renders when that EXPRESSION's value changes, so any path that does
  // NOT end with a changed gutPickPlayerId — the blank placeholder, a 409,
  // any other non-ok response — leaves the DOM showing what the user picked
  // instead of what the server holds. There is no way to "not really
  // happen"; every one of those paths must explicitly restore the element to
  // the true value, read from freshly-reloaded data rather than the `song`
  // closure (which is a snapshot from before this edit and would go stale on
  // any change made through another path while this one was in flight).
  async function onPickChange(song: WorkspaceSong, evt: Event & { currentTarget: HTMLSelectElement }) {
    const el = evt.currentTarget;
    const raw = el.value;
    const restoreFromFreshData = () => {
      const fresh = data?.songs.find((s) => s.spotifyUri === song.spotifyUri);
      el.value = String(fresh?.gutPickPlayerId ?? '');
    };

    if (raw === '') {
      // The blank placeholder is hidden once a song has a real pick (see the
      // template), so this should be unreachable in practice — restore
      // directly, no server round trip needed since nothing was sent.
      restoreFromFreshData();
      return;
    }

    if (raw === '__mine__') {
      // Marking removes this song from data.songs entirely (eligibleSongs
      // excludes is_mine=1), so this <select> is about to be unmounted on the
      // success path. On any FAILURE path it survives, still showing
      // "__mine__" — a value that is not a real pick. setMine() reloads, and
      // the restore below puts it back to the server's truth either way.
      // Same hazard as the blank and 409 paths; same fix.
      await setMine(song.spotifyUri);
      restoreFromFreshData();
      return;
    }

    gutError = null;
    const res = await fetch(`/api/guess/${roundId}/gut`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spotifyUri: song.spotifyUri, playerId: Number(raw) }),
    });
    if (!res.ok) {
      // spec §7.1: a 409 means the gut slate locked underneath us — that is
      // information, not an error to hide. Surface it, then restore the DOM
      // to the true (rejected-write) value rather than leaving the select
      // showing a pick that was never actually saved.
      const body = await res.json().catch(() => null) as { message?: string } | null;
      gutError = body?.message ?? `Failed to save pick (${res.status})`;
    }
    await load();
    // Runs after the reload regardless of success/failure: on success this
    // is a harmless no-op (the fresh value already matches what the select
    // shows); on failure it is the only thing that fixes the DOM.
    restoreFromFreshData();
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
      // Before the request, not merely before the reload: this changes the
      // round's mode underneath any queued candidate edit.
      await refineBoard?.flush();
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
      // MUST be before the DELETE, not just before the reload: awaiting the
      // flush is what guarantees the queued PATCH lands first and is then
      // deleted, instead of landing afterwards and resurrecting the row.
      await refineBoard?.flush();
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

  // spec §7.4a correction 1: the refine layer is gated on the gut LOCK as well
  // as the phase, never on the phase alone — nothing in this repo ever writes
  // phase = 'refine' (lockGut sets 'fetch'), so a phase-only gate would render
  // on no real round at all. The same mistake shipped dead code on the vote
  // layer above. Locking the gut slate is the reachable event that starts
  // refine; the `phase === 'refine'` arm keeps working if a later project
  // builds the intermediate phase machine.
  const refining = $derived(data !== null && (data.gutLockedAt !== null || data.phase === 'refine'));

  // Default from the phase so this keeps working once something actually
  // advances it; today nothing writes 'vote' or 'refine' (lockGut sets
  // 'fetch'), so this resolves to 'refine' on every real round.
  // svelte-ignore state_referenced_locally -- deliberately non-reactive: seeded once
  // at mount from data.phase; must NOT re-derive on every load() (setMine, lockGutSlate,
  // rehearsal start/stop and RefineBoard edits all reassign `data`), or the user's manual
  // toggle choice would be silently overwritten on the next reload.
  let surface = $state<'refine' | 'vote'>(data?.phase === 'vote' ? 'vote' : 'refine');

  let mineBusy = $state(false);

  /**
   * Mark or clear the owner's own song. Always reloads afterwards — marking a
   * song removes it from `data.songs` (eligibleSongs excludes it) and changes
   * `data.validation`, so nothing about the rendered slate survives this write.
   */
  async function setMine(spotifyUri: string | null) {
    mineBusy = true;
    try {
      // gutError is shared with the gut-pick writer; a stale line from a failed
      // mark would otherwise survive a subsequent successful one.
      gutError = null;
      const res = await fetch(`/api/guess/${roundId}/mine`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spotifyUri }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { message?: string } | null;
        gutError = body?.message ?? `Failed to save your song (${res.status})`;
      }
      await load();
    } finally {
      mineBusy = false;
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

  <!-- Task 9: refine and the transplanted Voting Lab share the same
       `refining` gate, so once the gut slate locks both would render at
       once, stacked, burying the refine board's propagation moment below
       the vote UI. This toggle picks exactly one. -->
  {#if refining}
    <div class="mb-6 border-b border-border-muted flex gap-6">
      {#each [['refine', 'Refine'], ['vote', 'Vote']] as [key, label] (key)}
        <button
          type="button"
          onclick={() => (surface = key as 'refine' | 'vote')}
          class="font-mono text-xs tracking-widest uppercase py-2 -mb-px border-b-2 transition-colors"
          class:border-accent={surface === key}
          class:text-accent={surface === key}
          class:border-transparent={surface !== key}
          class:text-fg-muted={surface !== key}
          class:hover:text-fg={surface !== key}
        >{label}</button>
      {/each}
    </div>
  {/if}

  <!-- spec §7.6: the transplanted Voting Lab is this workspace's vote phase.
       Conditional mounting matches the guess tab's own pattern; the "Get take"
       result survives the remount via takeCache.

       Gated on `refining && surface === 'vote'` (Task 9): the refine board
       and the lab share the same `refining` gate, and the toggle above picks
       which of the two actually renders. -->
  {#if refining && surface === 'vote'}
    <VotingLab {roundId} />
  {/if}

  {#if gutError}
    <p class="mb-4 font-mono text-sm text-red-400">{gutError}</p>
  {/if}

  <!-- spec §6: exactly one song is Matt's own; it leaves the slate once marked,
       so it is surfaced here or it becomes unreachable. -->
  <div class="mb-4 flex items-center gap-3 font-mono text-xs">
    {#if data.mine}
      <span class="text-fg-muted">your song: <span class="text-fg">{data.mine.title}</span> — {data.mine.artists}</span>
      <button
        type="button"
        disabled={mineBusy || data.gutLockedAt !== null}
        onclick={() => setMine(null)}
        class="text-fg-faint hover:text-fg disabled:opacity-60 disabled:cursor-not-allowed tracking-widest uppercase transition-colors"
      >Unmark</button>
    {:else}
      <span class="text-warn">mark your own song first — the slate cannot balance until you do</span>
    {/if}
  </div>

  <!-- spec §7.4a: refine REPLACES the gut slate rather than stacking beneath
       it — once the slate is locked the <ol> and its lock button are inert, so
       they come down and the board takes the space. The phase eyebrow, the
       rehearsal banner and the marked-song banner stay.

       Gated on `refining && surface === 'refine'` (Task 9): when refining is
       true but the toggle above is set to 'vote', neither surface here
       renders — the Voting Lab above already occupies the space. -->
  {#if refining && surface === 'refine'}
    <RefineBoard bind:this={refineBoard} {data} {roundId} onchanged={load} />
  {:else if !refining}
    <!-- Validation summary — belongs to the gut slate, so it hides with it.
         lockGutSlate is gated on validation.ok, so once the slate is locked
         this line can only ever read "clean": a line that can never say
         anything again, sitting above the refine roll-up that supersedes it. -->
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
          onchange={(e) => onPickChange(song, e)}
          class="bg-bg border border-border-muted rounded-lg px-3 py-2 text-sm text-fg font-mono focus:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {#if song.gutPickPlayerId === null}
            <option value="">— pick a player —</option>
          {/if}
          <option value="__mine__">— my song —</option>
          {#each data.roster as p (p.id)}
            <option value={p.id}>{p.name}</option>
          {/each}
        </select>
      </li>
    {/each}
  </ol>
  {/if}
{:else}
  <p class="font-mono text-sm text-fg-muted">Loading…</p>
{/if}
