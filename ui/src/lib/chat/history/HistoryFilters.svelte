<script lang="ts">
  interface Props {
    groups: { group_name: string; platform: string }[];
    senders: string[];
    selectedGroup: string;
    selectedSender: string;
    mediaOnly: boolean;
    searchQuery: string;
    onGroupChange: (g: string) => void;
    onSenderChange: (s: string) => void;
    onMediaOnlyChange: (v: boolean) => void;
    onSearchChange: (q: string) => void;
  }

  let {
    groups,
    senders,
    selectedGroup,
    selectedSender,
    mediaOnly,
    searchQuery,
    onGroupChange,
    onSenderChange,
    onMediaOnlyChange,
    onSearchChange,
  }: Props = $props();

  let searchInput = $state(searchQuery);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function handleSearch(e: Event) {
    const q = (e.target as HTMLInputElement).value;
    searchInput = q;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => onSearchChange(q), 200);
  }
</script>

<div class="ch-filters">
  <!-- Group select -->
  <div class="flex items-center gap-1">
    <span class="font-mono text-[9px] tracking-widest uppercase text-fg-faint">Group</span>
    <select
      class="ch-select"
      value={selectedGroup}
      onchange={(e) => onGroupChange((e.target as HTMLSelectElement).value)}
    >
      <option value="">All</option>
      {#each groups as g (g.group_name)}
        <option value={g.group_name}>{g.group_name}</option>
      {/each}
    </select>
  </div>

  <!-- Player select -->
  <div class="flex items-center gap-1">
    <span class="font-mono text-[9px] tracking-widest uppercase text-fg-faint">Player</span>
    <select
      class="ch-select"
      value={selectedSender}
      onchange={(e) => onSenderChange((e.target as HTMLSelectElement).value)}
    >
      <option value="">Everyone</option>
      {#each senders as s (s)}
        <option value={s}>{s}</option>
      {/each}
    </select>
  </div>

  <!-- Media-only toggle -->
  <button
    type="button"
    class="ch-toggle"
    class:is-on={mediaOnly}
    onclick={() => onMediaOnlyChange(!mediaOnly)}
  >
    Media only
  </button>

  <!-- Search -->
  <div class="ml-auto">
    <input
      type="search"
      class="ch-search"
      placeholder="Search messages…"
      value={searchInput}
      oninput={handleSearch}
    />
  </div>
</div>
