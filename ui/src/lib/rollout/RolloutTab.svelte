<script lang="ts">
  /**
   * The Rollouts tab: per-league "what happens when a round ends".
   *
   * Deliberately mirrors the pipeline editor (reorder / skip toggle / cover
   * with a model) so the two levels feel like one system. The rollout addition
   * is the REMASTER checkbox on a cover: fires only when the cut's check fails.
   */
  import { resolveRollout } from './solve.js';
  import type { Rollout, RolloutCover } from './types.js';
  import RunsView from './RunsView.svelte';

  let { leagues }: { leagues: { id: number; name: string }[] } = $props();

  let leagueId = $state(leagues[0]?.id ?? 0);
  let rollout = $state<Rollout | null>(null);
  let enabled = $state(false);
  let mode = $state<'edit' | 'preview'>('edit');
  let section = $state<'definition' | 'runs'>('definition');
  let saving = $state(false);
  let saved = $state(false);

  const eps = $derived(rollout ? resolveRollout(rollout) : []);
  const holdCount = $derived(
    rollout ? rollout.order.filter((id) => rollout!.cuts[id]?.kind === 'human').length : 0,
  );

  async function load() {
    const r = await fetch(`/api/rollout/config?leagueId=${leagueId}`);
    if (!r.ok) return;
    const d = await r.json();
    rollout = d.rollout; enabled = d.enabled;
  }
  $effect(() => { if (leagueId) void load(); });

  async function save() {
    if (!rollout) return;
    saving = true; saved = false;
    try {
      const r = await fetch(`/api/rollout/config?leagueId=${leagueId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rollout, enabled }),
      });
      if (r.ok) { const d = await r.json(); rollout = d.rollout; enabled = d.enabled; saved = true; setTimeout(() => (saved = false), 2000); }
    } finally { saving = false; }
  }

  function move(idx: number, dir: -1 | 1) {
    if (!rollout) return;
    const order = [...rollout.order];
    const j = idx + dir;
    if (j < 0 || j >= order.length) return;
    [order[idx], order[j]] = [order[j], order[idx]];
    rollout = { ...rollout, order };
  }

  function toggleSkip(id: string) {
    if (!rollout) return;
    const skipAfter = { ...(rollout.skipAfter as Record<string, true>) };
    if (skipAfter[id]) delete skipAfter[id]; else skipAfter[id] = true;
    rollout = { ...rollout, skipAfter };
  }

  function toggleDisabled(id: string) {
    if (!rollout) return;
    const off = new Set(rollout.disabled ?? []);
    if (off.has(id)) off.delete(id); else off.add(id);
    rollout = { ...rollout, disabled: [...off] };
  }

  const coverOf = (id: string): RolloutCover | undefined => rollout?.covers.find((c) => c.of === id);

  function toggleCover(id: string) {
    if (!rollout) return;
    rollout = coverOf(id)
      ? { ...rollout, covers: rollout.covers.filter((c) => c.of !== id) }
      : { ...rollout, covers: [...rollout.covers, { of: id }] };
  }

  function toggleRemaster(id: string) {
    if (!rollout) return;
    rollout = {
      ...rollout,
      covers: rollout.covers.map((c) =>
        c.of === id ? (c.remaster ? { of: c.of, model: c.model } : { ...c, remaster: true as const, budget: c.budget ?? 1 }) : c),
    };
  }
</script>

<article class="ml-card rlt-card">
  <header class="ml-card-head rlt-head">
    <div>
      <h3 class="ml-card-title">Rollouts</h3>
      <p class="ml-card-sub">Per-league automation: what happens when a round ends.</p>
    </div>
  </header>

  <div class="rlt-sub-tabs" role="tablist">
    <button
      role="tab"
      class="mash-btn mash-btn--secondary"
      aria-selected={section === 'definition'}
      onclick={() => (section = 'definition')}
      disabled={section === 'definition'}
    >Definition</button>
    <button
      role="tab"
      class="mash-btn mash-btn--secondary"
      aria-selected={section === 'runs'}
      onclick={() => (section = 'runs')}
      disabled={section === 'runs'}
    >Runs</button>
  </div>

  <div class="rlt-toolbar">
    <label class="rlt-field">
      <span>League</span>
      <select class="mlm-select" bind:value={leagueId}>
        {#each leagues as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
      </select>
    </label>
    {#if section === 'definition'}
      <label class="rlt-enabled" title="While off, this league keeps the existing digest_jobs path.">
        <input type="checkbox" bind:checked={enabled} /> Rollout enabled
      </label>
      <span class="rlt-summary">{eps.length} EPs · {holdCount} holds</span>
      <div class="ml-btn-row rlt-toolbar-btns">
        <button class="mash-btn mash-btn--secondary" onclick={() => (mode = 'edit')} disabled={mode === 'edit'}>Edit</button>
        <button class="mash-btn mash-btn--secondary" onclick={() => (mode = 'preview')} disabled={mode === 'preview'}>Preview</button>
        <button class="mash-btn mash-btn--primary" onclick={save} disabled={saving}>
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
    {/if}
  </div>

  {#if section === 'definition'}
    {#if !rollout}
      <p class="ml-card-sub">Loading…</p>
    {:else if mode === 'edit'}
      <ol class="rlt-cutlist">
        {#each rollout.order as id, idx (id)}
          {@const cut = rollout.cuts[id]}
          {@const off = (rollout.disabled ?? []).includes(id)}
          {@const cover = coverOf(id)}
          {@const hasSkip = !!rollout.skipAfter[id]}
          <li class="rlt-cut" class:is-off={off}>
            <div class="rlt-cut-row">
              <div class="rlt-reorder-btns">
                <button class="ml-icon-btn" disabled={idx === 0} onclick={() => move(idx, -1)} title="Move up">▲</button>
                <button class="ml-icon-btn" disabled={idx === rollout.order.length - 1} onclick={() => move(idx, 1)} title="Move down">▼</button>
              </div>
              <span class="ml-chip rlt-kind-chip">{cut.kind}</span>
              <strong class="rlt-cut-label">{cut.label}</strong>
              <code class="rlt-cut-id">{id}</code>
              {#if cut.kind !== 'human'}<span class="ml-chip">{cut.runtime}</span>{/if}
              {#if 'check' in cut && cut.check}<span class="rlt-check-badge" title="This cut has a check">✓</span>{/if}

              <label class="rlt-toggle"><input type="checkbox" checked={!off} onchange={() => toggleDisabled(id)} /> on</label>
              <button
                class="mlm-skip-toggle {hasSkip ? 'is-active' : ''}"
                onclick={() => toggleSkip(id)}
                title={hasSkip ? 'Remove skip after this cut' : 'Add skip after this cut'}
              >{hasSkip ? '- skip' : '+ skip'}</button>
              <label class="rlt-toggle"><input type="checkbox" checked={!!cover} onchange={() => toggleCover(id)} /> cover</label>
              {#if cover}
                <label class="rlt-toggle" title="Fires only when this cut's check fails — this is how repair is expressed.">
                  <input type="checkbox" checked={!!cover.remaster} onchange={() => toggleRemaster(id)} /> remaster
                </label>
              {/if}
            </div>
            {#if hasSkip}<div class="rlt-skip-div">── skip ──</div>{/if}
          </li>
        {/each}
      </ol>
    {:else}
      <div class="rlt-ep-cards">
        {#each eps as ep, i (i)}
          <div class="rlt-ep-card">
            <div class="rlt-ep-card-label">EP {i}</div>
            <ul class="rlt-ep-list">{#each ep.cuts as id (id)}<li>{rollout.cuts[id].label}</li>{/each}</ul>
            {#each ep.covers as c (c.of)}
              <p class="rlt-cover-row">{c.remaster ? 'remaster' : 'cover'} of {rollout.cuts[c.of]?.label ?? c.of}</p>
            {/each}
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    <RunsView leagueId={leagueId} />
  {/if}
</article>

<style>
  .rlt-sub-tabs { display: flex; gap: 8px; }

  .rlt-toolbar {
    display: flex;
    gap: 14px;
    align-items: center;
    flex-wrap: wrap;
  }
  .rlt-field { display: flex; flex-direction: column; gap: 4px; font: 500 11px/1.2 var(--font-mono); color: var(--fg-muted); }
  .rlt-enabled { display: flex; align-items: center; gap: 6px; font: 500 12px/1.3 var(--font-body); color: var(--fg-muted); }
  .rlt-summary { font: 500 12px/1.3 var(--font-mono); color: var(--fg-muted); }
  .rlt-toolbar-btns { margin-left: auto; }

  .rlt-cutlist { display: flex; flex-direction: column; gap: 0; margin: 0; padding: 0; list-style: none; }
  .rlt-cut {
    border: 1px solid var(--line);
    border-radius: var(--r-3);
    padding: 10px 12px;
    margin-bottom: 8px;
    background: var(--surface-2);
  }
  .rlt-cut.is-off { opacity: 0.45; }
  .rlt-cut-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .rlt-reorder-btns { display: flex; flex-direction: column; gap: 2px; }
  .rlt-kind-chip { text-transform: capitalize; }
  .rlt-cut-label { font: 600 13px/1.2 var(--font-body); color: var(--fg); }
  .rlt-cut-id { font: 500 11px/1.2 var(--font-mono); color: var(--fg-muted); }
  .rlt-check-badge { color: var(--moss); font-weight: 700; }
  .rlt-toggle { display: flex; align-items: center; gap: 4px; font: 500 12px/1.3 var(--font-body); color: var(--fg-muted); white-space: nowrap; }
  .rlt-skip-div { text-align: center; font: 500 11px/1.2 var(--font-mono); color: var(--fg-muted); margin-top: 6px; }

  .mlm-skip-toggle {
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--fg-muted);
    border-radius: var(--r-2);
    padding: 4px 8px;
    font: 500 11px/1 var(--font-mono);
    cursor: pointer;
  }
  .mlm-skip-toggle.is-active { background: var(--amber-soft); color: var(--amber); border-color: #4d3f1c; }

  .rlt-ep-cards { display: flex; flex-direction: column; gap: 10px; }
  .rlt-ep-card { border: 1px solid var(--line); border-radius: var(--r-3); padding: 10px 12px; background: var(--surface-2); }
  .rlt-ep-card-label { font: 700 11px/1.2 var(--font-mono); color: var(--fg-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
  .rlt-ep-list { margin: 0; padding-left: 18px; }
  .rlt-cover-row { margin: 4px 0 0; font: 500 12px/1.3 var(--font-body); color: var(--amber); }
</style>
