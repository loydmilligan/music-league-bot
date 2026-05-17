<script lang="ts">
  const {
    discovery = 0, themeFit = 0, nostalgia = 0, personal = 0,
    onchange,
  } = $props<{
    discovery?: number;
    themeFit?: number;
    nostalgia?: number;
    personal?: number;
    onchange?: (dimension: 'discovery' | 'theme_fit' | 'nostalgia' | 'personal', value: number) => void;
  }>();

  const rows = [
    { key: 'discovery' as const,  label: 'DSC', color: 'var(--sky)',       value: discovery },
    { key: 'theme_fit' as const,  label: 'THM', color: 'var(--mash-pulp)', value: themeFit },
    { key: 'nostalgia' as const,  label: 'NST', color: 'var(--amber)',      value: nostalgia },
    { key: 'personal' as const,   label: 'PRS', color: 'var(--moss)',       value: personal },
  ];

  function handleTrackClick(key: typeof rows[0]['key'], e: MouseEvent) {
    const track = e.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const val = Math.max(0, Math.min(5, Math.round(pct * 5)));
    onchange?.(key, val);
  }
</script>

<div class="sl-dna" aria-label="Rating dimensions">
  {#each rows as row}
    <div class="sl-dna-row">
      <span class="sl-dna-label" style="color: {row.color}">{row.label}</span>
      <button
        type="button"
        class="sl-dna-track"
        aria-label="{row.label} rating {row.value} of 5"
        onclick={(e) => handleTrackClick(row.key, e)}
      >
        <span
          class="sl-dna-fill"
          style="width: {(row.value / 5) * 100}%; background: {row.color}"
        ></span>
        {#each [20, 40, 60, 80] as tick}
          <span class="sl-dna-tick" style="left: {tick}%"></span>
        {/each}
      </button>
      <span class="sl-dna-val">{row.value}/5</span>
    </div>
  {/each}
</div>
