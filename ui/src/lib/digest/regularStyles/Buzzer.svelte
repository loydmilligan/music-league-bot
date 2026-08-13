<script lang="ts">
  // `buzzer` — the tell lives in timestamps, not words. A 3px track runs from
  // "voting opens" to the deadline (a dashed --ember line); each ballot is a dot
  // placed by its clock time, so the cluster against the wall is the evidence.
  import type { RegularEntry } from '../regularStyles.js';
  import Evidence from './Evidence.svelte';

  let { entry, isExport }: { entry: RegularEntry; isExport: boolean } = $props();

  const bz = $derived(entry.buzzer);

  /** where the deadline sits on the track, leaving room for late marks */
  const DEAD_PCT = 94;
  const START_PCT = 6;

  /** "11:25pm" / "23:25" / "midnight" → minutes past midnight; null if unreadable */
  function mins(raw: string): number | null {
    const t = raw.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
    if (t === 'midnight') return 24 * 60;
    if (t === 'noon') return 12 * 60;
    const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!m) return null;
    let h = Number(m[1]);
    const mm = m[2] ? Number(m[2]) : 0;
    if (h > 23 || mm > 59) return null;
    if (m[3] === 'pm' && h < 12) h += 12;
    if (m[3] === 'am' && h === 12) h = 0;
    return h * 60 + mm;
  }

  // A dot per mark, positioned by clock time. When the window can't be read
  // (hand-authored YAML, free-text times) the marks still print — evenly spaced
  // in the run-up to the deadline — rather than vanishing from the track.
  const dots = $derived.by((): number[] => {
    if (!bz) return [];
    const opens = mins(bz.opens);
    let dead = mins(bz.deadline);
    const clamp = (p: number) => Math.max(2, Math.min(99, p));
    if (opens === null || dead === null) {
      const n = bz.marks.length;
      return bz.marks.map((_, i) => clamp(DEAD_PCT - (n - 1 - i) * 4));
    }
    if (dead <= opens) dead += 1440;
    return bz.marks.map((mk, i) => {
      let t = mins(mk);
      if (t === null) return clamp(DEAD_PCT - (bz.marks.length - 1 - i) * 4);
      if (t < opens) t += 1440;
      return clamp(START_PCT + ((t - opens) / (dead - opens)) * (DEAD_PCT - START_PCT));
    });
  });
</script>

<div class="rs" data-style="buzzer" data-export={isExport}>
  {#if entry.note}<p class="rs-line">{entry.note}</p>{/if}
  {#if bz}
    <div class="buz-lbl">
      <span>voting opens{#if bz.opens} · {bz.opens}{/if}</span>
      <span class="r">deadline{#if bz.deadline} · {bz.deadline}{/if}</span>
    </div>
    <div class="buz">
      <div class="dead" style:left={`${DEAD_PCT}%`}></div>
      {#each dots as pct, i (i)}
        <div class="mk" style:left={`${pct}%`} title={bz.marks[i]}></div>
      {/each}
    </div>
    <p class="marks">{bz.marks.join(' · ')}</p>
    {#if bz.caption}<p class="buzcap">{bz.caption}</p>{/if}
  {/if}
  <Evidence quotes={entry.evidence} highlight={entry.highlight} />
</div>

<style>
  .rs-line {
    margin: 2px 0 10px;
    color: var(--fg-2);
    font: 500 13px/1.4 var(--font-body);
    overflow-wrap: anywhere;
  }
  .buz-lbl {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    overflow-wrap: anywhere;
    margin-bottom: 6px;
    color: var(--fg-quiet);
    font: 700 8.5px/1.3 var(--font-mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .buz-lbl .r {
    color: var(--ember);
    text-align: right;
  }
  .buz {
    position: relative;
    height: 3px;
    margin: 20px 6px 8px;
    background: var(--line-strong);
    border-radius: 2px;
  }
  .buz .dead {
    position: absolute;
    top: -14px;
    bottom: -14px;
    width: 0;
    border-left: 2px dashed var(--ember);
  }
  .buz .mk {
    position: absolute;
    top: 50%;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--ember);
    border: 2px solid var(--surface);
    transform: translate(-50%, -50%);
  }
  .marks {
    overflow-wrap: anywhere;
    margin: 14px 0 0;
    color: var(--fg-muted);
    font: 600 10px/1.5 var(--font-mono);
  }
  .buzcap {
    margin: 6px 0 0;
    color: var(--fg-quiet);
    font: 400 11px/1.5 var(--font-mono);
  }
</style>
