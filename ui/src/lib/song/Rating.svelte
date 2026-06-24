<script lang="ts">
  import type { SongRatings, RatingMode } from './canonical.js';
  import { DIMS, EMPTY_RATINGS } from './canonical.js';

  const {
    value = EMPTY_RATINGS,
    mode = 'bars',
    editable = false,
    size = 'sm',
    onchange,
  } = $props<{
    value?: SongRatings;
    mode?: RatingMode;
    editable?: boolean;
    size?: 'sm' | 'lg';
    onchange?: (key: string, value: number) => void;
  }>();

  const v = $derived(value || EMPTY_RATINGS);

  function handleBarClick(key: string, e: MouseEvent) {
    if (!editable) return;
    const target = e.currentTarget as HTMLElement;
    const r = target.getBoundingClientRect();
    const val = Math.max(0, Math.min(5, Math.ceil(((e.clientX - r.left) / r.width) * 5)));
    onchange?.(key, val);
  }

  function handleDotClick(key: string, n: number) {
    if (!editable) return;
    const cur = (v as Record<string, number | null>)[key] ?? 0;
    onchange?.(key, n === cur ? n - 1 : n);
  }

  function handleFpClick(key: string) {
    if (!editable) return;
    const cur = (v as Record<string, number | null>)[key] ?? 0;
    onchange?.(key, cur >= 5 ? 0 : cur + 1);
  }

  const dimTotal = $derived(DIMS.reduce((a, d) => a + ((v as Record<string, number | null>)[d.key] ?? 0), 0));
</script>

{#if mode === 'bars'}
  <div class="rt-bars">
    {#each DIMS as d}
      {@const dv = (v as Record<string, number | null>)[d.key] ?? 0}
      <div class="rt-bar-row">
        <span class="rt-bar-label" style="color: {d.color}">{d.label}</span>
        <button
          class="rt-bar-track{editable ? '' : ' ro'}"
          disabled={!editable}
          onclick={(e) => handleBarClick(d.key, e)}
        >
          <span class="rt-bar-fill" style="width: {(dv / 5) * 100}%; background: {d.color}"></span>
          {#each [1, 2, 3, 4] as t}
            <span class="rt-bar-tick" style="left: {t * 20}%"></span>
          {/each}
        </button>
        <span class="rt-bar-val">{(v as Record<string, number | null>)[d.key] == null ? '–' : dv}</span>
      </div>
    {/each}
  </div>

{:else if mode === 'dots'}
  <div class="rt-dots">
    {#each DIMS as d}
      {@const dv = (v as Record<string, number | null>)[d.key] ?? 0}
      <div class="rt-dot-row">
        <span class="rt-dot-label" style="color: {d.color}">{d.label}</span>
        <div class="rt-dot-set">
          {#each [1, 2, 3, 4, 5] as n}
            <button
              class="rt-dot{n <= dv ? ' on' : ''}{editable ? '' : ' ro'}"
              disabled={!editable}
              style={n <= dv ? `background: ${d.color}` : undefined}
              onclick={() => handleDotClick(d.key, n)}
            ></button>
          {/each}
        </div>
      </div>
    {/each}
  </div>

{:else if mode === 'mini'}
  <div class="rt-mini" title={DIMS.map((d) => `${d.full} ${(v as Record<string, number | null>)[d.key] ?? '–'}`).join(' · ')}>
    {#each DIMS as d}
      {@const dv = (v as Record<string, number | null>)[d.key] ?? 0}
      <span style="--c: {d.color}; --h: {Math.max(8, (dv / 5) * 100)}%"></span>
    {/each}
  </div>

{:else if mode === 'chip'}
  <span class="rt-chip" title="Aggregate score / 20">
    <span class="bar4">
      {#each DIMS as d}
        {@const dv = (v as Record<string, number | null>)[d.key] ?? 0}
        <i style="background: {d.color}; opacity: {0.25 + (dv / 5) * 0.75}"></i>
      {/each}
    </span>
    {dimTotal}<span class="max">/20</span>
  </span>

{:else if mode === 'fingerprint'}
  <div class="rt-fp {size}">
    {#each DIMS as d}
      {@const dv = (v as Record<string, number | null>)[d.key] ?? 0}
      <button
        class="rt-fp-cell{editable ? '' : ' ro'}"
        disabled={!editable}
        title="{d.full}: {(v as Record<string, number | null>)[d.key] ?? '–'}"
        onclick={() => handleFpClick(d.key)}
      >
        <span class="fill" style="--c: {d.color}; --o: {dv === 0 ? 0.06 : 0.18 + (dv / 5) * 0.82}"></span>
        {#if size === 'lg'}
          <span class="num">{(v as Record<string, number | null>)[d.key] == null ? '–' : dv}</span>
        {:else}
          <span class="lab">{d.label}</span>
        {/if}
      </button>
    {/each}
  </div>

{:else if mode === 'strata'}
  {@const total = dimTotal || 1}
  <div class="rt-strata">
    <div class="rt-strata-bar">
      {#each DIMS as d}
        {@const dv = (v as Record<string, number | null>)[d.key] ?? 0}
        <i style="background: {d.color}; flex-basis: {(dv / total) * 100}%"></i>
      {/each}
    </div>
    <div class="rt-strata-legend">
      {#each DIMS as d}
        <span>
          <i class="d" style="background: {d.color}"></i>
          {d.full} {(v as Record<string, number | null>)[d.key] ?? '–'}
        </span>
      {/each}
    </div>
  </div>
{/if}
