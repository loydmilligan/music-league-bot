<!--
  ShortlistStrip — sticky quick-assign header on /shortlist (sprint-25 shortlist-strip).
  One row per active league showing league name, current round theme + deadlines.
  When a song is open (openSongId truthy), shows a quick-assign button per row.
-->
<script lang="ts">
  import { onMount } from 'svelte';

  type ActiveRound = {
    id: number;
    name: string;
    theme: string | null;
    submissionDeadline: string | null;
    votingDeadline: string | null;
    phase: string;
  };
  type LeagueRow = {
    leagueId: number;
    name: string;
    activeRound: ActiveRound | null;
  };

  const {
    openSongId,
    onAssigned,
  } = $props<{
    openSongId: string | null;
    onAssigned: (songId: string, roundId: number) => void;
  }>();

  let leagues = $state<LeagueRow[]>([]);
  let assigning = $state<number | null>(null);
  let flash = $state<number | null>(null);

  onMount(async () => {
    const res = await fetch('/api/active-rounds');
    if (!res.ok) return;
    const data = (await res.json()) as { leagues?: LeagueRow[] };
    leagues = (data.leagues ?? []).filter((l) => l.activeRound !== null);
  });

  function fmtDeadline(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  async function quickAssign(l: LeagueRow) {
    const r = l.activeRound;
    if (!openSongId || !r || assigning !== null) return;
    assigning = r.id;
    try {
      const res = await fetch(`/api/shortlist/${openSongId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ round_id: r.id }),
      });
      if (res.ok) {
        onAssigned(openSongId, r.id);
        flash = r.id;
        setTimeout(() => { flash = null; }, 1800);
      }
    } finally {
      assigning = null;
    }
  }
</script>

{#if leagues.length > 0}
  <div class="sl-strip">
    {#each leagues as l (l.leagueId)}
      {@const r = l.activeRound!}
      <div class="sl-strip-row">
        <div class="sl-strip-info">
          <span class="sl-strip-league">{l.name}</span>
          <span class="sl-strip-sep">·</span>
          <span class="sl-strip-theme" title={r.theme ?? r.name}>{r.theme ?? r.name}</span>
          <span class="sl-strip-deadlines">
            <span>sub {fmtDeadline(r.submissionDeadline)}</span>
            <span>vote {fmtDeadline(r.votingDeadline)}</span>
          </span>
        </div>
        {#if openSongId}
          <button
            type="button"
            class="sl-strip-assign"
            class:is-assigned={flash === r.id}
            disabled={assigning !== null}
            onclick={() => quickAssign(l)}
          >
            {#if flash === r.id}✓ Assigned{:else if assigning === r.id}…{:else}↗ Assign{/if}
          </button>
        {:else}
          <span class="sl-strip-hint">open a song to assign</span>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .sl-strip {
    position: sticky;
    top: 0;
    z-index: 20;
    background: var(--surface, #0f1419);
    border: 1px solid var(--line, #283039);
    border-radius: var(--r-3, 8px);
    margin-bottom: 12px;
    overflow: hidden;
    box-shadow: var(--shadow-1);
  }
  .sl-strip-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 14px;
    border-bottom: 1px solid var(--line, #283039);
  }
  .sl-strip-row:last-child {
    border-bottom: none;
  }
  .sl-strip-info {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
    overflow: hidden;
  }
  .sl-strip-league {
    font: 700 10px/1 var(--font-mono);
    color: var(--mash-pulp, #7fb3ff);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    flex-shrink: 0;
  }
  .sl-strip-sep {
    color: var(--fg-quiet, #6b7b8a);
    font: 400 11px/1 var(--font-mono);
    flex-shrink: 0;
  }
  .sl-strip-theme {
    font: 600 13px/1.3 var(--font-body);
    color: var(--fg, #f1f4f7);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
    max-width: 240px;
  }
  .sl-strip-deadlines {
    display: flex;
    gap: 10px;
    font: 400 10px/1 var(--font-mono);
    color: var(--fg-quiet, #6b7b8a);
    flex-shrink: 0;
    white-space: nowrap;
  }
  .sl-strip-assign {
    flex-shrink: 0;
    padding: 5px 12px;
    font: 700 10px/1 var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-radius: var(--r-2, 5px);
    border: 1px solid var(--mash-pulp, #7fb3ff);
    background: transparent;
    color: var(--mash-pulp, #7fb3ff);
    cursor: pointer;
    transition: background 100ms, color 100ms, border-color 100ms;
    white-space: nowrap;
  }
  .sl-strip-assign:hover:not(:disabled) {
    background: color-mix(in srgb, var(--mash-pulp, #7fb3ff) 12%, transparent);
  }
  .sl-strip-assign:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .sl-strip-assign.is-assigned {
    border-color: var(--moss, #3fcb8a);
    color: var(--moss, #3fcb8a);
  }
  .sl-strip-hint {
    font: 400 10px/1 var(--font-mono);
    color: var(--fg-quiet, #6b7b8a);
    flex-shrink: 0;
    white-space: nowrap;
    font-style: italic;
  }
</style>
