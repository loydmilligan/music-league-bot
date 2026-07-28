<!--
  ChatLabSection — the digest's chat sub-section.

  Batches four independently excludable parts under one header:
    • Chat notes    — the LLM chat summaries, rendered by the existing
                      'Back cover · chat notes' section; this owns only its toggle
    • The chart     — mixing board OR activity heatmap, alternating by round
    • Feature       — one visual from the rotating pool
    • Superlatives  — a few awards from the rotating pool

  Rotation comes from the round number (see chatSection.ts), so regenerating a
  digest never reshuffles the layout. Each part carries a recommendation derived
  from what ran last round; the toggles remain the human's decision.

  EXPORT MODE: the digest renders to static PNG/PDF via `?export=1`. The mixing
  board is interactive on the web and collapses to a single ranked metric in
  export, following the same pattern as ChatMoments.
-->
<script lang="ts">
  import { page } from '$app/state';
  import type { PartId, PartRecommendation, ChatSectionData } from './chatSection.js';

  const {
    data,
    recommendations = [],
    initialExcluded = {},
    onExcludedChange,
  } = $props<{
    data: ChatSectionData | null;
    recommendations?: PartRecommendation[];
    initialExcluded?: Partial<Record<PartId, boolean>>;
    onExcludedChange?: (part: PartId, excluded: boolean) => void;
  }>();

  const isExport = $derived(page.url?.searchParams?.get('export') === '1');

  const PARTS: { id: PartId; label: string }[] = [
    { id: 'linerNotes', label: 'Chat notes' },
    { id: 'chart', label: 'The chart' },
    { id: 'feature', label: 'Feature' },
    { id: 'superlatives', label: 'Superlatives' },
  ];

  let excluded = $state<Record<PartId, boolean>>({
    linerNotes: !!initialExcluded.linerNotes,
    chart: !!initialExcluded.chart,
    feature: !!initialExcluded.feature,
    superlatives: !!initialExcluded.superlatives,
  });

  function toggle(id: PartId) {
    excluded[id] = !excluded[id];
    onExcludedChange?.(id, excluded[id]);
  }

  const recFor = (id: PartId): PartRecommendation | undefined =>
    recommendations.find((r: PartRecommendation) => r.part === id);

  /** A recommendation only deserves attention when it disagrees with the current state. */
  const disagrees = (id: PartId): boolean => {
    const r = recFor(id);
    return !!r && r.include === excluded[id];
  };

  const people = $derived(data?.stats?.people ?? []);
  const maxMessages = $derived(Math.max(1, ...people.map((p: any) => p.messages)));

  // Heatmap: sum every participant's 7x24 grid.
  const heat = $derived.by(() => {
    const g = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const p of people) {
      if (!Array.isArray(p.heatmap)) continue;
      for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) g[d][h] += p.heatmap[d][h] ?? 0;
    }
    return g;
  });
  const heatMax = $derived(Math.max(1, ...heat.flat()));
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const shortName = (n: string) => {
    const parts = n.split(' ');
    const dupe = people.filter((p: any) => p.name.split(' ')[0] === parts[0]).length > 1;
    return dupe && parts[1] ? `${parts[0]} ${parts[1][0]}.` : parts[0];
  };

  const bigWords = $derived(data?.stats?.biggestWords ?? []);
  const maxWords = $derived(Math.max(1, ...people.map((p: any) => p.words)));
  const maxChars = $derived(Math.max(1, ...people.map((p: any) => p.characters)));
  const trim = (t: string, n: number) => {
    const clean = (t ?? '').replace(/\s+/g, ' ').trim();
    return clean.length > n ? clean.slice(0, n) + '…' : clean;
  };

  const fmtWindow = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
</script>

{#if data}
  <section class="cl" class:cl-quiet={data.tooQuiet}>
    <header class="cl-head">
      <div>
        <h2>Back cover · chat</h2>
        <p class="cl-sub">
          {data.messageCount.toLocaleString()} messages · {data.participantCount} people ·
          {fmtWindow(data.window.fromIso)}–{fmtWindow(data.window.toIso)}
        </p>
      </div>
      {#if !isExport}
        <div class="cl-toggles">
          {#each PARTS as p (p.id)}
            <button
              type="button"
              class="cl-tog"
              class:is-off={excluded[p.id]}
              class:is-flagged={disagrees(p.id)}
              aria-pressed={!excluded[p.id]}
              title={recFor(p.id)?.reason ?? ''}
              onclick={() => toggle(p.id)}
            >
              {excluded[p.id] ? '○' : '●'} {p.label}
            </button>
          {/each}
        </div>
      {/if}
    </header>

    {#if data.tooQuiet}
      <p class="cl-warn">
        Only {data.messageCount} messages in this window — probably not worth publishing.
      </p>
    {/if}

    {#if !isExport && recommendations.some((r: PartRecommendation) => disagrees(r.part))}
      <ul class="cl-recs">
        {#each recommendations.filter((r: PartRecommendation) => disagrees(r.part)) as r (r.part)}
          <li><b>{r.include ? 'Suggest keeping' : 'Suggest cutting'} {r.part}:</b> {r.reason}</li>
        {/each}
      </ul>
    {/if}

    <!-- ── the chart ─────────────────────────────────────────────────── -->
    {#if !excluded.chart}
      <div class="cl-part">
        {#if data.rotation.chart === 'heatmap'}
          <h3>When the chat happened</h3>
          <div class="cl-heat">
            {#each heat as row, d (d)}
              <span class="cl-heat-lab">{DAYS[d]}</span>
              {#each row as v, h (h)}
                <i
                  class="cl-heat-cell"
                  style="background: color-mix(in oklab, var(--mash-pulp) {v
                    ? Math.round(12 + Math.pow(v / heatMax, 0.62) * 88)
                    : 0}%, var(--ink-2))"
                  title="{DAYS[d]} {String(h).padStart(2, '0')}:00 — {v} message{v === 1 ? '' : 's'}"
                ></i>
              {/each}
            {/each}
          </div>
        {:else}
          <h3>Who talked</h3>
          <div class="cl-bars">
            {#each people.slice(0, 10) as p (p.name)}
              <div class="cl-bar-row">
                <span class="cl-bar-name">{shortName(p.name)}</span>
                <span class="cl-bar-track">
                  <span class="cl-bar-fill" style="width: {(p.messages / maxMessages) * 100}%"></span>
                </span>
                <span class="cl-bar-val">{p.messages.toLocaleString()}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- ── feature visual (rotates through FEATURES) ─────────────────── -->
    {#if !excluded.feature}
      {@const f = data.rotation.feature}
      <div class="cl-part">
        {#if f === 'biggestWord' && bigWords.length}
          <h3>Biggest word of the round</h3>
          <p class="cl-bigword">{bigWords[0].word}</p>
          <p class="cl-bigword-who">
            {bigWords[0].person} · {bigWords[0].word.length} letters
          </p>
          <p class="cl-quote">“{trim(bigWords[0].quote, 200)}”</p>
        {:else if f === 'longestWords' && bigWords.length}
          <h3>Longest words used</h3>
          <div class="cl-words">
            {#each bigWords.slice(0, 6) as b (b.person)}
              <div class="cl-word-row">
                <span class="cl-word">{b.word}</span>
                <span class="cl-word-who">{shortName(b.person)}</span>
                <span class="cl-word-len">{b.word.length}</span>
              </div>
            {/each}
          </div>
        {:else if f === 'trackList' && data.links.length}
          <h3>Shared in the chat</h3>
          <div class="cl-words">
            {#each data.links.slice(0, 8) as l (l.url)}
              <div class="cl-word-row">
                <a class="cl-word cl-link" href={l.url} target="_blank" rel="noopener">
                  {l.kind === 'youtube' ? 'YouTube' : 'Spotify'}{l.context ? ` — ${trim(l.context, 46)}` : ''}
                </a>
                <span class="cl-word-who">{shortName(l.person)}</span>
                <span class="cl-word-len"></span>
              </div>
            {/each}
          </div>
        {:else}
          <!-- triptych, and the fallback when a feature has no data this round -->
          <h3>Messages · words · characters</h3>
          <div class="cl-bars">
            {#each people.slice(0, 8) as p (p.name)}
              <div class="cl-tri-row">
                <span class="cl-bar-name">{shortName(p.name)}</span>
                <span class="cl-tri-stack">
                  {#each [['messages', maxMessages, 'var(--mash-pulp, #ff5b2e)'], ['words', maxWords, 'var(--sky, #5aa3ff)'], ['characters', maxChars, 'var(--moss, #3ec27a)']] as [key, max, color] (key)}
                    <span class="cl-tri-line">
                      <span class="cl-bar-track">
                        <span
                          class="cl-bar-fill"
                          style="width: {(p[key] / max) * 100}%; background: {color}"
                        ></span>
                      </span>
                      <span class="cl-tri-val">{p[key].toLocaleString()}</span>
                    </span>
                  {/each}
                </span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- ── superlatives ──────────────────────────────────────────────── -->
    {#if !excluded.superlatives && data.awards.length}
      <div class="cl-part">
        <h3>This round's superlatives</h3>
        <div class="cl-awards">
          {#each data.awards as a (a.key)}
            <div class="cl-award">
              <p class="cl-award-who">{a.person}</p>
              <p class="cl-award-val">{a.value}</p>
              <p class="cl-award-cap">{a.caption}</p>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if data.unmappedSenders.length && !isExport}
      <p class="cl-warn">
        {data.unmappedSenders.length} sender{data.unmappedSenders.length === 1 ? '' : 's'} not linked
        to a player: {data.unmappedSenders.join(', ')}. They are still counted, under those names —
        link them in <a href="/settings/setup">Settings → Setup</a> to merge them with their player.
      </p>
    {/if}
  </section>
{/if}

<style>
  .cl {
    background: var(--surface, #0d1116);
    border: 1px solid var(--line, #283039);
    border-radius: var(--r-3, 8px);
    padding: 18px 20px 20px;
  }
  .cl-quiet { opacity: 0.72; }
  .cl-head {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 16px; flex-wrap: wrap; margin: 0 0 16px;
  }
  .cl-head h2 {
    margin: 0; font: 700 20px/1.2 var(--font-display, sans-serif);
    color: var(--fg, #f1f4f7); letter-spacing: -0.02em;
  }
  .cl-sub {
    margin: 5px 0 0; font: 500 11px/1.4 var(--font-mono, monospace);
    color: var(--fg-muted, #8b97a4); letter-spacing: 0.04em;
  }
  .cl-toggles { display: flex; flex-wrap: wrap; gap: 6px; }
  .cl-tog {
    font: 500 11px/1 var(--font-mono, monospace);
    background: var(--ink-2, #141921); color: var(--fg-2, #c2cad3);
    border: 1px solid var(--line, #283039); border-radius: 100px;
    padding: 6px 11px; cursor: pointer;
  }
  .cl-tog:hover { border-color: var(--line-strong, #3a4451); }
  .cl-tog.is-off { color: var(--fg-quiet, #5a6773); }
  .cl-tog.is-flagged { border-color: var(--amber, #e8a83a); }
  .cl-tog:focus-visible { outline: 2px solid var(--mash-pulp, #ff5b2e); outline-offset: 2px; }

  .cl-recs {
    margin: 0 0 16px; padding: 10px 14px; list-style: none;
    background: var(--amber-soft, #3a2e15); border: 1px solid var(--amber, #e8a83a);
    border-radius: var(--r-2, 6px);
    font: 400 12.5px/1.5 var(--font-body, sans-serif); color: var(--fg-2, #c2cad3);
  }
  .cl-recs li + li { margin-top: 5px; }

  .cl-warn {
    margin: 0 0 14px; font: 500 12px/1.5 var(--font-body, sans-serif);
    color: var(--amber, #e8a83a);
  }

  .cl-part { margin: 0 0 22px; }
  .cl-part:last-child { margin-bottom: 0; }
  .cl-part h3 {
    margin: 0 0 12px; font: 600 11px/1 var(--font-mono, monospace);
    letter-spacing: 0.16em; text-transform: uppercase; color: var(--fg-muted, #8b97a4);
  }

  .cl-bar-row {
    display: grid; grid-template-columns: 92px 1fr 46px; gap: 12px;
    align-items: center; padding: 5px 0;
  }
  .cl-bar-name {
    font: 500 13px/1.2 var(--font-body, sans-serif); color: var(--fg-2, #c2cad3);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .cl-bar-track {
    height: 10px; background: var(--ink-3, #1c232c); border-radius: 2px; overflow: hidden;
  }
  .cl-bar-fill { display: block; height: 100%; background: var(--mash-pulp, #ff5b2e); }
  .cl-bar-val {
    font: 500 12px/1 var(--font-mono, monospace); color: var(--fg, #f1f4f7); text-align: right;
  }

  .cl-heat {
    display: grid; grid-template-columns: 30px repeat(24, 1fr); gap: 2px; align-items: center;
  }
  .cl-heat-lab {
    font: 500 9px/1 var(--font-mono, monospace); color: var(--fg-muted, #8b97a4);
  }
  .cl-heat-cell { aspect-ratio: 1; border-radius: 1px; display: block; }

  .cl-awards {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1px; background: var(--line, #283039);
    border: 1px solid var(--line, #283039);
  }
  .cl-award { background: var(--ink-1, #0d1116); padding: 12px 13px; }
  .cl-award-who {
    margin: 0; font: 700 14px/1.2 var(--font-display, sans-serif); color: var(--fg, #f1f4f7);
  }
  .cl-award-val {
    margin: 5px 0 0; font: 500 11px/1 var(--font-mono, monospace); color: var(--mash-pulp, #ff5b2e);
  }
  .cl-award-cap {
    margin: 7px 0 0; font: 400 12px/1.45 var(--font-body, sans-serif);
    color: var(--fg-muted, #8b97a4);
  }

  .cl-bigword {
    margin: 0; font: 800 clamp(26px, 6vw, 44px)/1 var(--font-display, sans-serif);
    color: var(--fg, #f1f4f7); letter-spacing: -0.04em; word-break: break-word;
  }
  .cl-bigword-who {
    margin: 10px 0 0; font: 500 12px/1 var(--font-mono, monospace);
    color: var(--mash-pulp, #ff5b2e); letter-spacing: 0.04em;
  }
  .cl-quote {
    margin: 12px 0 0; padding-left: 14px;
    border-left: 1px solid var(--line-strong, #3a4451);
    font: italic 400 13px/1.6 var(--font-body, sans-serif);
    color: var(--fg-muted, #8b97a4); max-width: 62ch;
  }

  .cl-word-row {
    display: grid; grid-template-columns: 1fr auto 26px; gap: 12px;
    align-items: baseline; padding: 7px 0;
    border-bottom: 1px solid var(--line, #283039);
  }
  .cl-word {
    font: 600 14px/1.3 var(--font-body, sans-serif); color: var(--fg, #f1f4f7);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cl-link { color: var(--mash-pulp, #ff5b2e); text-decoration: none; }
  .cl-link:hover { text-decoration: underline; }
  .cl-word-who {
    font: 500 11px/1 var(--font-mono, monospace); color: var(--fg-muted, #8b97a4);
    white-space: nowrap;
  }
  .cl-word-len {
    font: 500 11px/1 var(--font-mono, monospace); color: var(--fg-quiet, #5a6773);
    text-align: right;
  }

  .cl-tri-row {
    display: grid; grid-template-columns: 92px 1fr; gap: 12px;
    align-items: center; padding: 7px 0;
  }
  .cl-tri-stack { display: flex; flex-direction: column; gap: 3px; }
  .cl-tri-line { display: grid; grid-template-columns: 1fr 54px; gap: 10px; align-items: center; }
  .cl-tri-val {
    font: 500 10.5px/1 var(--font-mono, monospace); color: var(--fg-muted, #8b97a4);
    text-align: right;
  }

  @media (max-width: 640px) {
    .cl-bar-row { grid-template-columns: 74px 1fr 40px; gap: 9px; }
    .cl-heat { grid-template-columns: 24px repeat(24, 1fr); gap: 1px; }
    .cl-tri-row { grid-template-columns: 70px 1fr; gap: 9px; }
  }
</style>
