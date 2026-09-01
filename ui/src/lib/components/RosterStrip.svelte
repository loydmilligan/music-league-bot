<!-- ui/src/lib/components/RosterStrip.svelte -->
<!--
  spec §7.4 — the candidate picker under each song: a strip of click-to-add
  roster pills that doubles as the availability display (README §5, D2c).

  Deliberately NOT a typeahead — spec §7.4a overrides §7.4 here: 9–13 local
  names don't warrant a keystroke + context-switch per add, and a typeahead
  hides availability until after you choose. The strip shows it at the moment
  of choosing. Do not build one; do not add remote search.

  THE STRIP OWNS NO WRITE PLUMBING. `onadd` goes up to RefineBoard, which owns
  the fetch (its existing `sendPatch`), the error/retry maps and the reload —
  the same split Task 5 established for CandidateRow. Local state here is
  UI-only: which pill is mid-request.

  Design source: docs/design_handoff_refine_grid/README.md §5, TOKEN-MAP.md.
  Recreated with Tailwind utilities against app.css @theme tokens; none of the
  prototype's inline styles are ported.
-->
<script lang="ts">
  import type { Candidate } from '$lib/guessing/candidates.js';
  import type { WorkspaceData } from '$lib/guessing/workspaceData.js';
  import { commitmentElsewhere } from '$lib/guessing/board.js';

  let {
    data,
    spotifyUri,
    existing,
    error = null,
    onadd,
    onretry,
  }: {
    /** Full payload — needed so `commitmentElsewhere` can scan every OTHER song. */
    data: WorkspaceData;
    spotifyUri: string;
    /** This song's current candidates — determines the "already added" pill state. */
    existing: Candidate[];
    /** The rejected-add message for this song, or null. Owned by the parent. */
    error?: string | null;
    /** Requests the add; the parent issues the PATCH and reloads on success. */
    onadd: (playerId: number) => Promise<void>;
    onretry?: () => void;
  } = $props();

  /** Player ids currently mid-request — disables just that pill, not the strip. */
  let pending = $state<Set<number>>(new Set());

  async function add(playerId: number) {
    if (pending.has(playerId)) return;
    pending = new Set(pending).add(playerId);
    try {
      await onadd(playerId);
    } finally {
      const next = new Set(pending);
      next.delete(playerId);
      pending = next;
    }
  }

  const presentIds = $derived(new Set(existing.map((c) => c.playerId)));
</script>

<div class="flex flex-wrap items-center gap-2 px-0.5 pt-0.5">
  <span class="mr-0.5 font-mono text-[9px] tracking-[0.12em] text-fg-faint uppercase">add</span>
  {#each data.roster as p (p.id)}
    {@const already = presentIds.has(p.id)}
    {@const commit = already ? null : commitmentElsewhere(data, p.id, spotifyUri)}
    {@const taken = commit?.kind === 'taken'}
    {@const dimmed = commit?.kind === 'dimmed'}
    {@const busy = pending.has(p.id)}
    <button
      type="button"
      disabled={already || taken || busy}
      onclick={() => add(p.id)}
      title={already
        ? `${p.name} is already a candidate on this song`
        : taken
          ? `${p.name} is locked on #${commit?.at}`
          : dimmed
            ? `${p.name} is prime on #${commit?.at} — still addable`
            : `add ${p.name}`}
      class="inline-flex cursor-pointer items-center gap-[5px] rounded-sm border px-2.5 py-[3px]
             font-mono text-xs transition-colors disabled:cursor-not-allowed
             {already
        ? 'border-border bg-surface text-fg-muted opacity-28'
        : taken
          ? 'border-border-muted bg-bg text-fg-faint opacity-50 line-through'
          : dimmed
            ? 'border-amber bg-surface text-fg-muted opacity-74'
            : 'border-border bg-surface text-fg-muted hover:bg-surface-hover'}"
    >{p.name}{#if commit}<span class="font-mono text-[9px] text-fg-faint">#{commit.at}</span>{/if}</button>
  {/each}
</div>

<!-- rejected add — same idiom as CandidateRow's error line: attempted state
     stays put, one inline mono line, no toast. -->
{#if error}
  <div class="px-0.5 pt-1 font-mono text-sm text-red-400">
    {error} ·
    <button type="button" onclick={onretry} class="cursor-pointer text-accent underline">retry now</button>
  </div>
{/if}
