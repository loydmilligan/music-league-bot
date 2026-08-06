<script lang="ts" module>
  // ── storylines-render · Guesser/Storylines redesign (CD handoff §4.2) ───────
  // Visual form of the digest's `storylines` section, reframed as "The
  // Regulars": the recurring chat characters who turned up THIS round. Designed
  // sparse-first — its real modal state is n = 0–2 (a seed only surfaces when
  // that round's chat + that player's vote comments contain real matching
  // quotes), so it must look intentional at n=1 and graceful at n=0.
  //
  // Renders:
  //   1. eyebrow "The Regulars" + a subhead counting who surfaced
  //   2. a persistent strip — one pill per regular (avatar · name · motif)
  //   3. per-regular evidence, DUAL-MODE exactly like ChatMoments.svelte:
  //        • web (?export absent): a click-to-expand accordion
  //        • export (?export=1): flat cards, every quote printed (PNG-safe)
  //   4. an n=0 empty state
  //   5. a micro-note explaining what makes a "regular" (doubles as newcomer
  //      explainer): every line is a verbatim quote; no evidence → dropped.
  //
  // Reads the storylines content_json (llm.ts SECTION_SCHEMA.storylines):
  //   { title, cast: [{ name, headline, evidence: string[], motif? }] }
  // `motif` is joined onto each cast member at load time from the seed (see the
  // digest +page.server.ts enrichment) — the LLM itself never writes it.
  //
  // Defensive: the LLM's generic missing-kind fallback is `{ title, body, items }`
  // (NOT `{ title, cast }`), so `content.cast` may be missing/malformed — always
  // coerce to an array and render the empty state rather than crash.
  //
  // CD designed this on a paper LIGHT surface; per the owner's call we build it
  // DARK-NATIVE with the shipping semantic tokens so it matches the current dark
  // digest surrounding it.
  import type { VisualComponentProps } from './variants.js';

  export type StorylineCastMember = {
    name?: string;
    headline?: string;
    evidence?: string[];
    motif?: string;
  };
  export type StorylinesContent = { title?: string; cast?: StorylineCastMember[] };

  function initialOf(name: string): string {
    const m = name.trim().match(/[a-z0-9]/i);
    return (m ? m[0] : '?').toUpperCase();
  }

  // The evidence strings often already arrive wrapped in quote marks; strip a
  // single balanced wrapping pair so the component's own quotes don't double up.
  function unquote(s: string): string {
    const t = s.trim();
    return t.replace(/^["“”'](.*)["“”']$/s, '$1').trim();
  }
</script>

<script lang="ts">
  import { page } from '$app/state';

  let { content }: VisualComponentProps = $props();

  const c = $derived((content ?? {}) as StorylinesContent);
  const cast = $derived(
    Array.isArray(c.cast)
      ? c.cast
          .filter((m): m is StorylineCastMember => !!m && (!!m.name || !!m.headline))
          .map((m) => ({
            name: m.name ?? '',
            headline: m.headline ?? '',
            motif: m.motif?.trim() ?? '',
            evidence: Array.isArray(m.evidence)
              ? m.evidence.filter((e): e is string => !!e?.trim()).map(unquote)
              : [],
          }))
      : [],
  );
  const n = $derived(cast.length);

  // web accordion open-state; first regular open by default (optional per §4.2).
  let open = $state<Record<number, boolean>>({ 0: true });
  function toggle(i: number) {
    open = { ...open, [i]: !open[i] };
  }

  const isExport = $derived(page?.url?.searchParams?.get('export') === '1');
</script>

<div class="stl" data-component="storylines-render" data-export={isExport}>
  <div class="stl-subhead">
    who turned up this week{#if n}<span> · <b>{n}</b> {n === 1 ? 'regular' : 'regulars'} surfaced</span>{/if}
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
      <!-- export: flat cards, every quote printed -->
      <div class="stl-cast">
        {#each cast as m, i (i)}
          <div class="stl-card">
            <p class="stl-cardname">{m.name}{#if m.motif} · {m.motif}{/if}</p>
            {#if m.headline}<p class="stl-head">{m.headline}</p>{/if}
            {#each m.evidence as quote, j (j)}
              <p class="stl-ev">"{quote}"</p>
            {/each}
          </div>
        {/each}
      </div>
    {:else}
      <!-- web: click-to-expand accordion -->
      <div class="stl-acc">
        {#each cast as m, i (i)}
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
              {#if m.motif}<span class="stl-mo">{m.motif}</span>{/if}
            </button>
            {#if open[i]}
              <div class="stl-panel" id={`stl-panel-${i}`} role="region">
                {#if m.headline}<p class="stl-head">{m.headline}</p>{/if}
                {#each m.evidence as quote, j (j)}
                  <p class="stl-ev">"{quote}"</p>
                {/each}
                {#if !m.headline && !m.evidence.length}<p class="stl-ev stl-quiet">(no evidence)</p>{/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <p class="stl-whatis">
      the regulars started as missmara's answers when her husband asked her for something funny about each
      player. one only turns up here when this round's chat or their own vote comments back the bit with a
      real quote — no quote that round, they sit it out. every line above is verbatim.
    </p>
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
    padding: 15px 17px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
    break-inside: avoid;
  }
  .stl-cardname {
    margin: 0 0 5px;
    color: var(--mash-pulp);
    font: 700 10px/1 var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .stl-head {
    margin: 0 0 10px;
    color: var(--fg);
    font: 700 16px/1.25 var(--font-display);
    font-style: italic;
    letter-spacing: -0.01em;
  }
  .stl-ev {
    margin: 0;
    padding-left: 14px;
    border-left: 2px solid var(--mash-pulp);
    color: var(--fg-2);
    font: 400 12px/1.5 var(--font-body);
  }
  .stl-ev + .stl-ev { margin-top: 9px; }
  .stl-quiet { color: var(--fg-quiet); font-style: italic; border-left-color: var(--line-strong); }

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
    align-items: center;
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
  .stl-trig .stl-name {
    color: var(--mash-pulp);
    font: 700 10px/1 var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .stl-trig .stl-mo {
    margin-left: auto;
    color: var(--fg-quiet);
    font: 500 11px/1 var(--font-mono);
  }
  .stl-panel {
    padding: 2px 15px 14px 36px;
    background: var(--surface);
  }
  .stl-panel .stl-head { font-size: 15px; margin-bottom: 8px; }

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
</style>
