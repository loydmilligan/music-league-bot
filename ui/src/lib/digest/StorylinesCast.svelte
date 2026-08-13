<script lang="ts" module>
  // ── storylines-render · "Time for a Reinvention" (CD handoff §5.3) ──────────
  // Visual form of the digest's `storylines` section: the regulars who gave
  // themselves away THIS round. Sparse-first — its real modal state is n = 0–2 —
  // so it must look intentional at n=1 and graceful at n=0.
  //
  // This file is only the CARRIER. Everything below the per-entry header is a
  // style component off the shelf (`regularStyles/`), picked by `resolveStyle`:
  //   quote-led (fallback) · spotlight · call-response · edit-history ·
  //   roster-map · refrain · buzzer
  // The old mandatory 3-line `headline` is gone; the tell itself is the hero and
  // `note` is an optional one-liner.
  //
  // Renders:
  //   1. subhead counting the tells that fired (the section title is printed by
  //      the DigestSection shell from `content.title` — not repeated here)
  //   2. a persistent strip — one pill per regular (initial avatar · name · motif)
  //   3. per-entry: name · motif · style, then that style's layout, DUAL-MODE
  //      exactly like ChatMoments.svelte:
  //        • web (?export absent): click-to-expand accordion
  //        • export (?export=1): flat cards, everything printed (PNG-safe)
  //   4. an n=0 empty state
  //   5. a mono micro-note (form not topic · verbatim · fired this round)
  //
  // Content is hand-authored YAML (see yamlContent.ts) coerced by
  // `normalizeCast` — a human typo must degrade, never crash: a hydration crash
  // takes the whole PNG export down (see the each_key_duplicate history), so
  // every {#each} here is index-keyed.
  import type { VisualComponentProps } from './variants.js';
  import { markRuns, type RegularEntry } from './regularStyles.js';

  // Re-exported: tests (and older call sites) import markRuns from this module.
  // Its home is regularStyles.ts now — every style needs it, not just the quotes.
  export { markRuns };

  /** The authored shape of one cast member; `normalizeCast` coerces it. */
  export type StorylineCastMember = Partial<RegularEntry>;
  export type StorylinesContent = {
    title?: string;
    cast?: StorylineCastMember[];
    /**
     * Footer explainer. Omit the key to keep the default (SSSC, where the
     * regulars came from missmara's answers); pass "" to hide it in leagues
     * where that origin story means nothing.
     */
    note?: string;
  };

  export const DEFAULT_REGULARS_NOTE =
    "the regulars started as missmara's answers when her husband asked her for something funny about each " +
    "player. one only turns up here when this round's chat or their own vote comments back the bit with a " +
    "real quote — no quote that round, they sit it out. every line above is verbatim.";

  function initialOf(name: string): string {
    const m = name.trim().match(/[a-z0-9]/i);
    return (m ? m[0] : '?').toUpperCase();
  }
</script>

<script lang="ts">
  import { page } from '$app/state';
  import { normalizeCast, resolveStyle } from './regularStyles.js';
  import { REGULAR_STYLE_COMPONENTS as REGISTRY } from './regularStyles/index.js';

  let { content }: VisualComponentProps = $props();

  const c = $derived((content ?? {}) as StorylinesContent);
  const cast = $derived(normalizeCast(content));
  const n = $derived(cast.length);

  // web accordion open-state. Every panel starts OPEN: each style's hero (the
  // spotlight word, the roster map, the refrain token, the buzzer track, the
  // redline) must be visible in web AND export, and that invariant can't be
  // left to depend on how many regulars happened to fire. Collapsing is a user
  // action from here, not a default.
  let toggled = $state<Record<number, boolean>>({});
  // Derived, not an effect, so SSR emits the same open panels the client does.
  const open = $derived(Object.fromEntries(cast.map((_, i) => [i, toggled[i] ?? true])));
  function toggle(i: number) {
    toggled = { ...toggled, [i]: !open[i] };
  }

  const isExport = $derived(page?.url?.searchParams?.get('export') === '1');
  const note = $derived(typeof c.note === 'string' ? c.note.trim() : DEFAULT_REGULARS_NOTE);
</script>

<div class="stl" data-component="storylines-render" data-export={isExport}>
  <div class="stl-subhead">
    who gave themselves away this week{#if n}<span> · <b>{n}</b> {n === 1 ? 'tell' : 'tells'} fired</span>{/if}
  </div>

  {#if n}
    <!-- persistent strip -->
    <div class="stl-strip">
      {#each cast as m, i (i)}
        <span class="stl-reg">
          <span class="av">{initialOf(m.name || '?')}</span>{m.name}{#if m.motif}<span class="mo">{m.motif}</span>{/if}
        </span>
      {/each}
    </div>

    {#if isExport}
      <!-- export: flat cards, every style printed in full -->
      <div class="stl-cast">
        {#each cast as m, i (i)}
          {@const style = resolveStyle(m)}
          {@const C = REGISTRY[style]}
          <div class="stl-card">
            <p class="stl-cardhd">
              <span class="stl-name">{m.name}</span>
              <span class="stl-mo">{#if m.motif}{m.motif} · {/if}{style}</span>
            </p>
            <C entry={m} {isExport} />
          </div>
        {/each}
      </div>
    {:else}
      <!-- web: click-to-expand accordion -->
      <div class="stl-acc">
        {#each cast as m, i (i)}
          {@const style = resolveStyle(m)}
          {@const C = REGISTRY[style]}
          <div class="stl-item">
            <button
              type="button"
              class="stl-trig"
              aria-expanded={open[i] ?? false}
              aria-controls={`stl-panel-${i}`}
              onclick={() => toggle(i)}
            >
              <span class="stl-chev" class:is-open={open[i]} aria-hidden="true">▸</span>
              <span class="stl-name">{m.name}</span>
              <span class="stl-mo">{#if m.motif}{m.motif} · {/if}{style}</span>
            </button>
            {#if open[i]}
              <div class="stl-panel" id={`stl-panel-${i}`} role="region">
                <C entry={m} {isExport} />
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if note}<p class="stl-whatis">{note}</p>{/if}
  {:else}
    <div class="stl-emptystate">
      Quiet week — the usual suspects kept to themselves. The regulars return next round.
    </div>
  {/if}
</div>

<style>
  .stl {
    display: flex;
    flex-direction: column;
    gap: 0;
    font-family: var(--font-body);
  }

  .stl-subhead {
    margin: 0 0 16px;
    color: var(--fg-quiet);
    font: 400 11px/1.45 var(--font-mono);
  }
  .stl-subhead b { color: var(--mash-pulp); font-weight: 700; }

  /* persistent strip */
  .stl-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .stl-reg {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 14px 7px 9px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 999px;
    color: var(--fg);
    font: 600 12px/1 var(--font-body);
  }
  .stl-reg .av {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--mash-pulp-soft);
    border: 1px solid var(--mash-pulp);
    color: var(--mash-pulp);
    font: 700 9px/1 var(--font-mono);
  }
  .stl-reg .mo { color: var(--fg-quiet); font: 500 10.5px/1 var(--font-mono); }

  /* export: flat cards */
  .stl-cast {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 14px;
  }
  .stl-card {
    padding: 13px 16px 16px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    break-inside: avoid;
  }
  .stl-cardhd {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    margin: 0 0 10px;
  }

  /* shared entry header type (card + accordion trigger) */
  .stl-name {
    color: var(--mash-pulp);
    font: 700 10px/1.3 var(--font-mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .stl-mo {
    color: var(--fg-quiet);
    font: 500 10px/1.3 var(--font-mono);
    text-align: right;
  }

  /* web accordion */
  .stl-acc {
    margin-top: 14px;
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
  }
  .stl-item + .stl-item { border-top: 1px solid var(--line); }
  .stl-trig {
    width: 100%;
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 13px 15px;
    background: var(--surface);
    border: 0;
    text-align: left;
    cursor: pointer;
  }
  .stl-chev {
    flex: none;
    color: var(--mash-pulp);
    font: 700 10px/1 var(--font-mono);
    transition: transform 0.12s var(--ease-out, ease);
  }
  .stl-chev.is-open { transform: rotate(90deg); }
  .stl-trig .stl-mo { margin-left: auto; }
  .stl-panel {
    padding: 2px 15px 15px 36px;
    background: var(--surface);
  }

  /* n=0 empty state */
  .stl-emptystate {
    margin-top: 12px;
    padding: 16px 18px;
    background: var(--surface-2);
    border: 1px dashed var(--line-strong);
    border-radius: 8px;
    text-align: center;
    color: var(--fg-quiet);
    font: 400 12px/1.5 var(--font-body);
    font-style: italic;
  }

  .stl-whatis {
    margin: 14px 0 0;
    padding-top: 12px;
    border-top: 1px solid var(--line);
    color: var(--fg-quiet);
    font: 400 10.5px/1.5 var(--font-mono);
  }

  /* 430px reflow. The mobile PNG renders at a 520px viewport with the
     .dg-export--mobile frame class, so it needs its own selectors — the media
     query only covers genuinely narrow viewports (phone web). */
  :global(.dg-export--mobile) .stl-panel { padding-left: 24px; }
  :global(.dg-export--mobile) .stl-cardhd { flex-direction: column; gap: 3px; }
  :global(.dg-export--mobile) .stl-cardhd .stl-mo { text-align: left; }
  @media (max-width: 460px) {
    .stl-panel { padding-left: 24px; }
    .stl-cardhd { flex-direction: column; gap: 3px; }
    .stl-cardhd .stl-mo { text-align: left; }
  }
</style>
