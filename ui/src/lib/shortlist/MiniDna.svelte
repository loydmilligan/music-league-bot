<script lang="ts">
  const { discovery = 0, themeFit = 0, nostalgia = 0, personal = 0 } = $props<{
    discovery?: number;
    themeFit?: number;
    nostalgia?: number;
    personal?: number;
  }>();

  const bars = [
    { pct: `${(discovery / 5) * 100}%`, color: 'var(--sky)' },
    { pct: `${(themeFit / 5) * 100}%`, color: 'var(--mash-pulp)' },
    { pct: `${(nostalgia / 5) * 100}%`, color: 'var(--amber)' },
    { pct: `${(personal / 5) * 100}%`, color: 'var(--moss)' },
  ];
</script>

<span class="sl-row-mini-dna">
  {#each bars as bar}
    <span style="--p: {bar.pct}; --c: {bar.color}"></span>
  {/each}
</span>
