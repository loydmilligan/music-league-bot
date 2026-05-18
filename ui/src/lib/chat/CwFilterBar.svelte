<script lang="ts">
  const {
    total,
    unassignedCount,
    assignedCount,
    chatNames,
    status,
    activeChatName,
    sort,
    onStatusChange,
    onChatChange,
    onSortChange,
  } = $props<{
    total: number;
    unassignedCount: number;
    assignedCount: number;
    chatNames: string[];
    status: 'all' | 'unassigned' | 'assigned';
    activeChatName: string | null;
    sort: 'recent' | 'mentioned';
    onStatusChange: (s: 'all' | 'unassigned' | 'assigned') => void;
    onChatChange: (name: string | null) => void;
    onSortChange: (s: 'recent' | 'mentioned') => void;
  }>();
</script>

<div class="cw-bar">
  <div class="cw-bar-left">
    <div class="cw-filter-group">
      {#each ([['all', `All ${total}`], ['unassigned', `Unassigned ${unassignedCount}`], ['assigned', `Assigned ${assignedCount}`]] as const) as [key, label]}
        <button
          type="button"
          class="sl-sort-pill"
          class:is-active={status === key}
          onclick={() => onStatusChange(key)}
        >{label}</button>
      {/each}
    </div>

    {#if chatNames.length > 0}
      <div class="cw-filter-divider"></div>
      <div class="cw-filter-group">
        {#each chatNames as name}
          <button
            type="button"
            class="cw-chat-chip cw-chat-chip--{name === 'Hip Jammers' ? 'sky' : name === 'The Lads' ? 'amber' : 'muted'}"
            class:is-active={activeChatName === name}
            onclick={() => onChatChange(activeChatName === name ? null : name)}
          >{name}</button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="cw-bar-right">
    <div class="cw-sort-group">
      {#each ([['recent', '↓ recent'], ['mentioned', '↓ mentioned']] as const) as [key, label]}
        <button
          type="button"
          class="sl-sort-pill"
          class:is-active={sort === key}
          onclick={() => onSortChange(key)}
        >{label}</button>
      {/each}
    </div>
  </div>
</div>
