<script lang="ts">
  // Ring-gauge indicator for the Theme Research pick row (sprint-25). A 20×20
  // SVG: a full track ring + a foreground arc filling `pct`, with a centered
  // glyph (target / bolt / waveform) tinted by the axis color. Opacity encodes
  // the coverage tier (see pickMetadata.opacityTier). Tooltip on the wrapper.
  import { RING_CIRCUMFERENCE, ringOffset, type IndicatorKind } from './pickMetadata';

  let {
    kind,
    pct,
    colorVar,
    opacity,
    tooltip,
  }: {
    kind: IndicatorKind;
    pct: number;
    colorVar: string;
    opacity: number;
    tooltip: string;
  } = $props();

  const offset = $derived(ringOffset(pct));
</script>

<span class="ring-gauge" title={tooltip} style="display:inline-flex;cursor:default">
  <svg width="20" height="20" viewBox="0 0 22 22" aria-hidden="true">
    <circle cx="11" cy="11" r="9" fill="none" stroke="var(--line)" stroke-width="2" />
    <circle
      cx="11"
      cy="11"
      r="9"
      fill="none"
      stroke={`var(${colorVar})`}
      stroke-width="2"
      stroke-linecap="round"
      stroke-dasharray={RING_CIRCUMFERENCE}
      stroke-dashoffset={offset}
      transform="rotate(-90 11 11)"
      style={`opacity:${opacity}`}
    />
    {#if kind === 'obscurity'}
      <g transform="translate(11 11)" style={`color:var(${colorVar});opacity:${opacity}`}>
        <circle r="1.6" fill="currentColor" />
        <circle r="3.6" fill="none" stroke="currentColor" stroke-width="1" />
      </g>
    {:else if kind === 'energy'}
      <g transform="translate(6 5) scale(0.38)" style={`color:var(${colorVar});opacity:${opacity}`}>
        <path d="M13 2L4 14h6l-1 8 9-12h-6z" fill="currentColor" />
      </g>
    {:else}
      <g transform="translate(3.5 7.5)" style={`color:var(${colorVar});opacity:${opacity}`}>
        <path
          d="M0 3c1.5-3 3-3 4.5 0s3 3 4.5 0 3-3 4.5 0"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </g>
    {/if}
  </svg>
</span>
