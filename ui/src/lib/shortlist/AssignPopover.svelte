<script lang="ts">
  const { songId, songTitle, assignedRoundIds = [], onclose } = $props<{
    songId: string;
    songTitle: string;
    assignedRoundIds?: number[];
    onclose: () => void;
  }>();

  type OpenRound = { id: number; name: string; description: string | null; submissionDeadline: string | null; leagueName: string };

  let rounds = $state<OpenRound[]>([]);
  let pending = $state<Set<number>>(new Set(assignedRoundIds));

  async function loadRounds() {
    const res = await fetch('/api/rounds/open');
    if (res.ok) rounds = await res.json();
  }

  async function toggle(roundId: number) {
    const isAssigned = pending.has(roundId);
    if (isAssigned) {
      await fetch(`/api/shortlist/${songId}/assign/${roundId}`, { method: 'DELETE' });
      pending = new Set([...pending].filter(id => id !== roundId));
    } else {
      await fetch(`/api/shortlist/${songId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ round_id: roundId }),
      });
      pending = new Set([...pending, roundId]);
    }
  }

  function formatDeadline(iso: string | null): string {
    if (!iso) return '';
    const ms = Date.parse(iso) - Date.now();
    const h = Math.round(ms / 3600000);
    if (h < 24) return `${h}h`;
    return `${Math.round(h / 24)}d`;
  }

  loadRounds();
</script>

<div class="sl-popover">
  <div class="sl-popover-arrow"></div>
  <div class="sl-popover-eyebrow">Assign to a round · {songTitle}</div>
  <div class="sl-popover-body">
    {#each rounds as round}
      <button type="button" class="sl-popover-row" class:is-checked={pending.has(round.id)} onclick={() => toggle(round.id)}>
        <span class="sl-popover-check">{pending.has(round.id) ? '✓' : ''}</span>
        <span class="sl-popover-row-info">
          <span class="sl-popover-row-theme">{round.description ?? round.name}</span>
          <span class="sl-popover-row-sub">{round.leagueName} · {round.name}</span>
        </span>
        {#if round.submissionDeadline}
          <span class="sl-popover-row-deadline">{formatDeadline(round.submissionDeadline)}</span>
        {/if}
      </button>
    {:else}
      <p class="sl-popover-empty">No open rounds.</p>
    {/each}
  </div>
  <div class="sl-popover-footer">
    <span class="sl-popover-hint">Song stays on the shortlist after assigning.</span>
    <button type="button" class="sl-btn sl-btn-primary" onclick={onclose}>Done</button>
  </div>
</div>
