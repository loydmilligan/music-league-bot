<script lang="ts">
  const {
    songTitle,
    assignedRoundIds = [],
    onAssign,
    onUnassign,
    onclose,
  } = $props<{
    songTitle: string;
    assignedRoundIds?: number[];
    onAssign: (roundId: number) => Promise<void>;
    onUnassign: (roundId: number) => Promise<void>;
    onclose: () => void;
  }>();

  type OpenRound = {
    id: number; name: string; description: string | null;
    submissionDeadline: string | null; leagueName: string;
  };

  let rounds = $state<OpenRound[]>([]);
  let pending = $state<Set<number>>(new Set(assignedRoundIds));
  let query = $state('');
  let activeLeague = $state<string | null>(null);

  async function loadRounds() {
    const res = await fetch('/api/rounds/open');
    if (res.ok) rounds = await res.json();
  }

  async function toggle(roundId: number) {
    if (pending.has(roundId)) {
      await onUnassign(roundId);
      pending = new Set([...pending].filter(id => id !== roundId));
    } else {
      await onAssign(roundId);
      pending = new Set([...pending, roundId]);
    }
  }

  const leagues = $derived([...new Set(rounds.map(r => r.leagueName))]);

  const filtered = $derived(rounds.filter(r => {
    if (activeLeague && r.leagueName !== activeLeague) return false;
    const q = query.trim().toLowerCase();
    if (q) {
      return (r.description ?? r.name).toLowerCase().includes(q)
        || r.leagueName.toLowerCase().includes(q)
        || r.name.toLowerCase().includes(q);
    }
    return true;
  }));

  function formatDeadline(iso: string | null): string {
    if (!iso) return '';
    const h = Math.round((Date.parse(iso) - Date.now()) / 3600000);
    if (h < 24) return `${h}h`;
    return `${Math.round(h / 24)}d`;
  }

  loadRounds();
</script>

<div class="sl-popover sl-popover--wide" onclick={(e) => e.stopPropagation()}>
  <div class="sl-popover-arrow"></div>
  <div class="sl-popover-eyebrow">Assign to a round · {songTitle}</div>

  <div class="sl-popover-filter">
    <div class="sl-popover-search">
      <span class="sl-popover-search-glyph">⌕</span>
      <input
        type="text"
        bind:value={query}
        placeholder="Filter themes, leagues, round ids…"
        autocomplete="off"
      />
      {#if query}
        <button type="button" class="sl-popover-search-clear" onclick={() => query = ''}>✕</button>
      {/if}
    </div>
    <div class="sl-popover-pills">
      <button
        type="button"
        class="sl-popover-pill"
        class:is-on={activeLeague === null}
        onclick={() => activeLeague = null}
      >All <span class="n">{rounds.length}</span></button>
      {#each leagues as league}
        <button
          type="button"
          class="sl-popover-pill"
          class:is-on={activeLeague === league}
          onclick={() => activeLeague = activeLeague === league ? null : league}
        >{league} <span class="n">{rounds.filter(r => r.leagueName === league).length}</span></button>
      {/each}
    </div>
  </div>

  <div class="sl-popover-list">
    {#each filtered as round}
      <button
        type="button"
        class="sl-popover-row"
        class:is-on={pending.has(round.id)}
        onclick={() => toggle(round.id)}
      >
        <span class="sl-popover-check">{pending.has(round.id) ? '✓' : ''}</span>
        <div style="min-width: 0">
          <div class="sl-popover-theme">{round.description ?? round.name}</div>
          <div class="sl-popover-league">{round.leagueName} · {round.name}</div>
        </div>
        {#if round.submissionDeadline}
          <span class="sl-popover-meta">{formatDeadline(round.submissionDeadline)}</span>
        {/if}
      </button>
    {:else}
      <div class="sl-popover-empty">
        No rounds match.
        {#if query || activeLeague}
          <button type="button" onclick={() => { query = ''; activeLeague = null; }}>Clear filters</button>
        {/if}
      </div>
    {/each}
  </div>

  <div class="sl-popover-foot">
    <span class="sl-popover-foot-hint">
      {filtered.length === rounds.length
        ? 'Song stays on the shortlist after assigning.'
        : `${filtered.length} of ${rounds.length} shown`}
    </span>
    <button type="button" class="sl-btn sl-btn-primary" onclick={onclose}>Done</button>
  </div>
</div>
