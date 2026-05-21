<script lang="ts" module>
  export type RatingDimension = 'discovery' | 'theme_fit' | 'nostalgia' | 'personal';
</script>

<script lang="ts">
  // Canonical multi-color rating-bars UI. Originally shortlist/DnaStrip; hoisted
  // here so research (and any future surface) renders identically.
  //
  // Realtime-update bug fix vs the original DnaStrip: `rows` is now `$derived`,
  // so the rendered fill width recomputes when any of the four prop values
  // changes. The original captured prop values once at component init via
  // `const rows = [...]` and never updated.

  const {
    discovery = 0,
    themeFit = 0,
    nostalgia = 0,
    personal = 0,
    onchange,
  } = $props<{
    discovery?: number;
    themeFit?: number;
    nostalgia?: number;
    personal?: number;
    onchange?: (dimension: RatingDimension, value: number) => void;
  }>();

  const rows = $derived([
    { key: 'discovery' as const,  label: 'DSC', color: 'var(--sky)',       value: discovery },
    { key: 'theme_fit' as const,  label: 'THM', color: 'var(--mash-pulp)', value: themeFit },
    { key: 'nostalgia' as const,  label: 'NST', color: 'var(--amber)',     value: nostalgia },
    { key: 'personal' as const,   label: 'PRS', color: 'var(--moss)',      value: personal },
  ]);

  function handleTrackClick(key: RatingDimension, e: MouseEvent) {
    const track = e.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const val = Math.max(0, Math.min(5, Math.round(pct * 5)));
    onchange?.(key, val);
  }
</script>

<div class="srb" aria-label="Rating dimensions">
  {#each rows as row (row.key)}
    <div class="srb-row">
      <span class="srb-label" style="color: {row.color}">{row.label}</span>
      <button
        type="button"
        class="srb-track"
        aria-label="{row.label} rating {row.value} of 5"
        onclick={(e) => handleTrackClick(row.key, e)}
      >
        <span
          class="srb-fill"
          style="width: {(row.value / 5) * 100}%; background: {row.color}"
        ></span>
        {#each [20, 40, 60, 80] as tick (tick)}
          <span class="srb-tick" style="left: {tick}%"></span>
        {/each}
      </button>
      <span class="srb-val">{row.value}/5</span>
    </div>
  {/each}
</div>

<style>
  /* Visual match for the original .sl-dna-* shortlist treatment, just hoisted
     and namespaced so research can render the same look. */
  .srb {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
  }
  .srb-row {
    display: grid;
    grid-template-columns: 36px 1fr 26px;
    gap: 8px;
    align-items: center;
  }
  .srb-label {
    font: 700 9px/1 var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .srb-track {
    position: relative;
    height: 8px;
    border-radius: 999px;
    background: var(--ink-3);
    overflow: hidden;
    cursor: pointer;
    border: 0;
    padding: 0;
    transition: background var(--dur-fast, 120ms) var(--ease-out, ease-out);
  }
  .srb-track:hover { background: var(--ink-4, var(--ink-3)); }
  .srb-fill {
    position: absolute;
    top: 0; left: 0; bottom: 0;
    border-radius: 999px;
    transition: width var(--dur-fast, 120ms) var(--ease-out, ease-out);
  }
  .srb-tick {
    position: absolute;
    top: 0; bottom: 0;
    width: 1px;
    background: rgba(7, 9, 12, 0.6);
  }
  .srb-val {
    font: 700 11px/1 var(--font-mono);
    color: var(--fg-2);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
