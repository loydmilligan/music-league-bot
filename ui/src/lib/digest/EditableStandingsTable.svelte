<script lang="ts" module>
  // ── editable-standings-table · sprint-14 (viz, Wave 2) ────────────────────
  // The human-correction surface for the gospel `season_standings` table. A
  // modal grid (standing order) where prior / round / current totals are all
  // editable. On submit it shows a CONFIRMATION step detailing every change,
  // then persists via the backend edit path — which re-ranks and returns the
  // fresh payload so the standings chart re-renders from the corrected numbers.
  //
  // Reached from the standings section's non-LLM edit + its regen (frontend
  // wires the open trigger). MOUNT CONTRACT for frontend:
  //   <EditableStandingsTable
  //     roundId={…} open={…}
  //     initial={standingsResult /* optional preload; else we GET on open */}
  //     onClose={() => …}
  //     onSaved={(result) => /* invalidate / re-render StandingsChart */} />
  //
  // Endpoints (backend 48e56cd):
  //   GET  /api/digest/:roundId/standings → StandingsResult
  //   POST /api/digest/:roundId/standings { action:'edit', edits:StandingEdit[] }
  //        → StandingsResult (re-ranked gospel)
  import type { StandingsResult, StandingRow, StandingEdit } from '$lib/db/standings.js';

  type EditField = 'priorTotal' | 'roundPoints' | 'currentTotal';
  const FIELD_LABEL: Record<EditField, string> = {
    priorTotal: 'Prior',
    roundPoints: 'Round',
    currentTotal: 'Total',
  };
</script>

<script lang="ts">
  type Props = {
    roundId: number;
    open: boolean;
    /** Optional preloaded payload; when absent the table fetches GET on open. */
    initial?: StandingsResult | null;
    onClose: () => void;
    /** Fresh re-ranked payload after a successful persist — parent re-renders. */
    onSaved?: (result: StandingsResult) => void;
  };
  let { roundId, open, initial = null, onClose, onSaved }: Props = $props();

  type Draft = {
    competitorId: number;
    name: string;
    rank: number;
    priorTotal: number;
    roundPoints: number;
    currentTotal: number;
  };

  let stage = $state<'edit' | 'confirm'>('edit');
  let loading = $state(false);
  let saving = $state(false);
  let errorMsg = $state('');
  // Original (gospel) rows for diffing, + the working drafts the inputs bind to.
  let originals = $state<StandingRow[]>([]);
  let drafts = $state<Draft[]>([]);

  function toDraft(r: StandingRow): Draft {
    return {
      competitorId: r.competitorId,
      name: r.name,
      rank: r.rank,
      priorTotal: r.priorTotal,
      roundPoints: r.roundPoints,
      currentTotal: r.currentTotal,
    };
  }

  function hydrate(result: StandingsResult) {
    originals = result.standings;
    drafts = result.standings.map(toDraft);
    stage = 'edit';
    errorMsg = '';
  }

  async function load() {
    loading = true;
    errorMsg = '';
    try {
      const res = await fetch(`/api/digest/${roundId}/standings`);
      if (!res.ok) throw new Error(`load failed (${res.status})`);
      hydrate((await res.json()) as StandingsResult);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  // (Re)load whenever the modal opens. A preloaded payload wins (no fetch).
  let lastOpen = false;
  $effect(() => {
    if (open && !lastOpen) {
      if (initial) hydrate(initial);
      else load();
    }
    lastOpen = open;
  });

  // Per-row changed fields, computed against the gospel originals.
  type RowDiff = {
    competitorId: number;
    name: string;
    fields: { field: EditField; from: number; to: number }[];
  };
  const diffs = $derived.by<RowDiff[]>(() => {
    const byId = new Map(originals.map((o) => [o.competitorId, o]));
    const out: RowDiff[] = [];
    for (const d of drafts) {
      const o = byId.get(d.competitorId);
      if (!o) continue;
      const fields: RowDiff['fields'] = [];
      for (const f of ['priorTotal', 'roundPoints', 'currentTotal'] as EditField[]) {
        if (Number.isFinite(d[f]) && d[f] !== o[f]) fields.push({ field: f, from: o[f], to: d[f] });
      }
      if (fields.length) out.push({ competitorId: d.competitorId, name: d.name, fields });
    }
    return out;
  });
  const hasChanges = $derived(diffs.length > 0);

  // A row whose total ≠ prior + round — surfaced as a soft hint, not a block
  // (the user may be mid-edit, and backend treats each field independently).
  const inconsistent = (d: Draft) =>
    Number.isFinite(d.priorTotal) &&
    Number.isFinite(d.roundPoints) &&
    Number.isFinite(d.currentTotal) &&
    d.priorTotal + d.roundPoints !== d.currentTotal;

  function num(e: Event): number {
    const v = (e.target as HTMLInputElement).value;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function reset() {
    drafts = originals.map(toDraft);
    stage = 'edit';
  }

  async function persist() {
    saving = true;
    errorMsg = '';
    try {
      const edits: StandingEdit[] = diffs.map((d) => {
        const e: StandingEdit = { competitorId: d.competitorId };
        for (const f of d.fields) e[f.field] = f.to;
        return e;
      });
      const res = await fetch(`/api/digest/${roundId}/standings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'edit', edits }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`save failed (${res.status}) ${t.slice(0, 160)}`);
      }
      const result = (await res.json()) as StandingsResult;
      onSaved?.(result);
      onClose();
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
      stage = 'edit';
    } finally {
      saving = false;
    }
  }

  function handleScrim(e: MouseEvent) {
    if (e.target === e.currentTarget && !saving) onClose();
  }
  function handleScrimKey(e: KeyboardEvent) {
    if (e.target === e.currentTarget && !saving && (e.key === 'Enter' || e.key === ' ')) onClose();
  }
  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open && !saving) onClose();
  }
</script>

<svelte:window onkeydown={handleKey} />

{#if open}
  <div
    class="dg-modal-scrim"
    onclick={handleScrim}
    onkeydown={handleScrimKey}
    role="dialog"
    aria-modal="true"
    aria-label="Edit standings"
    tabindex="-1"
  >
    <div class="dg-modal est-modal">
      <header class="dg-modal-head">
        <h3>
          Standings · <span style="color: var(--mash-pulp);"
            >{stage === 'confirm' ? 'confirm changes' : 'edit gospel table'}</span
          >
        </h3>
        <button type="button" class="x" onclick={onClose} aria-label="Close" disabled={saving}
          >✕</button
        >
      </header>

      <div class="dg-modal-body">
        {#if loading}
          <p class="est-note">loading standings…</p>
        {:else if errorMsg && !drafts.length}
          <p class="est-error">{errorMsg}</p>
        {:else if stage === 'edit'}
          <span class="dg-modal-eyebrow">Standing order · all totals editable</span>
          <div class="est-grid" role="table" aria-label="Standings">
            <div class="est-row est-row--head" role="row">
              <span role="columnheader">#</span>
              <span role="columnheader">Competitor</span>
              <span role="columnheader" class="num">Prior</span>
              <span role="columnheader" class="num">Round</span>
              <span role="columnheader" class="num">Total</span>
            </div>
            {#each drafts as d, i (d.competitorId)}
              <div class="est-row" class:is-inconsistent={inconsistent(d)} role="row">
                <span class="est-rank" role="cell">{d.rank}</span>
                <span class="est-name" role="cell" title={d.name}>{d.name}</span>
                <input
                  class="est-input"
                  type="number"
                  inputmode="numeric"
                  aria-label={`${d.name} prior total`}
                  bind:value={drafts[i].priorTotal}
                  oninput={(e) => (drafts[i].priorTotal = num(e))}
                />
                <input
                  class="est-input"
                  type="number"
                  inputmode="numeric"
                  aria-label={`${d.name} round points`}
                  bind:value={drafts[i].roundPoints}
                  oninput={(e) => (drafts[i].roundPoints = num(e))}
                />
                <input
                  class="est-input est-input--total"
                  type="number"
                  inputmode="numeric"
                  aria-label={`${d.name} current total`}
                  bind:value={drafts[i].currentTotal}
                  oninput={(e) => (drafts[i].currentTotal = num(e))}
                />
              </div>
            {/each}
          </div>
          <p class="dg-modal-hint">
            Edited values become the gospel the digest renders from. A highlighted row means
            <em>total ≠ prior + round</em> — fine if intentional.
          </p>
          {#if errorMsg}<p class="est-error">{errorMsg}</p>{/if}
        {:else}
          <!-- confirm stage -->
          <span class="dg-modal-eyebrow">{diffs.length} competitor{diffs.length === 1 ? '' : 's'} changed</span>
          <div class="est-confirm">
            {#each diffs as d (d.competitorId)}
              <div class="est-confirm-row">
                <span class="est-confirm-name">{d.name}</span>
                <div class="est-confirm-fields">
                  {#each d.fields as f (f.field)}
                    <span class="est-chg">
                      <span class="est-chg-lbl">{FIELD_LABEL[f.field]}</span>
                      <span class="est-chg-from">{f.from}</span>
                      <span class="est-chg-arrow">→</span>
                      <span class="est-chg-to">{f.to}</span>
                    </span>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
          <p class="dg-modal-hint">Persisting overwrites the stored table and re-ranks by total.</p>
          {#if errorMsg}<p class="est-error">{errorMsg}</p>{/if}
        {/if}
      </div>

      <footer class="dg-modal-foot">
        <span class="cost"
          >{saving
            ? 'saving…'
            : stage === 'confirm'
              ? `${diffs.length} change${diffs.length === 1 ? '' : 's'} pending`
              : hasChanges
                ? `${diffs.length} row${diffs.length === 1 ? '' : 's'} edited`
                : 'no changes'}</span
        >
        <div class="est-actions">
          {#if stage === 'edit'}
            <button
              type="button"
              class="sd-btn sd-btn--ghost sd-btn--sm"
              onclick={reset}
              disabled={!hasChanges || saving}>↺ Reset</button
            >
            <button
              type="button"
              class="sd-btn sd-btn--primary sd-btn--sm"
              onclick={() => (stage = 'confirm')}
              disabled={!hasChanges || loading}>Review changes →</button
            >
          {:else}
            <button
              type="button"
              class="sd-btn sd-btn--ghost sd-btn--sm"
              onclick={() => (stage = 'edit')}
              disabled={saving}>← Back</button
            >
            <button
              type="button"
              class="sd-btn sd-btn--primary sd-btn--sm"
              onclick={persist}
              disabled={saving || !hasChanges}>✓ Persist as gospel</button
            >
          {/if}
        </div>
      </footer>
    </div>
  </div>
{/if}

<style>
  .est-modal {
    max-width: 600px;
    width: min(94vw, 600px);
  }

  .est-grid {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    overflow: hidden;
  }
  .est-row {
    display: grid;
    grid-template-columns: 28px 1fr 72px 72px 72px;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--line);
  }
  .est-row:last-child {
    border-bottom: 0;
  }
  .est-row--head {
    background: var(--ink-0);
    font: 700 9px/1 var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-quiet);
  }
  .est-row--head .num {
    text-align: right;
  }
  .est-row.is-inconsistent {
    background: var(--amber-soft);
  }
  .est-rank {
    font: 700 13px/1 var(--font-mono);
    color: var(--fg-muted);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  .est-name {
    font: 600 12.5px/1.2 var(--font-body);
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .est-input {
    width: 100%;
    padding: 5px 7px;
    background: var(--ink-0);
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    color: var(--fg);
    font: 600 12.5px/1 var(--font-mono);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .est-input:focus {
    outline: none;
    border-color: var(--mash-pulp);
  }
  .est-input--total {
    color: var(--mash-pulp);
  }
  /* strip the number spinners — they crowd a tight grid */
  .est-input::-webkit-outer-spin-button,
  .est-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .est-input[type='number'] {
    -moz-appearance: textfield;
    appearance: textfield;
  }

  /* confirm stage */
  .est-confirm {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 50vh;
    overflow-y: auto;
  }
  .est-confirm-row {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 9px 11px;
    border: 1px solid var(--line);
    border-left: 2px solid var(--mash-pulp);
    border-radius: 0 var(--r-2) var(--r-2) 0;
    background: var(--ink-0);
  }
  .est-confirm-name {
    font: 700 12.5px/1.2 var(--font-body);
    color: var(--fg);
  }
  .est-confirm-fields {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
  }
  .est-chg {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    font: 600 11.5px/1 var(--font-mono);
  }
  .est-chg-lbl {
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-quiet);
  }
  .est-chg-from {
    color: var(--fg-muted);
    text-decoration: line-through;
  }
  .est-chg-arrow {
    color: var(--fg-quiet);
  }
  .est-chg-to {
    color: var(--moss);
    font-weight: 700;
  }

  .est-note {
    margin: 0;
    font: 500 12.5px/1.5 var(--font-mono);
    color: var(--fg-quiet);
  }
  .est-error {
    margin: 0;
    font: 600 12px/1.5 var(--font-mono);
    color: var(--ember);
  }

  .est-actions {
    display: flex;
    gap: 8px;
  }

  /* scoped buttons — match the Mash Co. .mash-btn spec (no global rule loaded) */
  .sd-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 14px;
    border-radius: var(--r-3);
    border: 1px solid transparent;
    font: 600 13px/1 var(--font-body);
    cursor: pointer;
    transition: filter var(--dur-fast) var(--ease-out);
  }
  .sd-btn:hover:not(:disabled) {
    filter: brightness(0.92);
  }
  .sd-btn:active:not(:disabled) {
    transform: translateY(1px);
  }
  .sd-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .sd-btn--sm {
    padding: 6px 10px;
    font-size: 12px;
    border-radius: var(--r-2);
  }
  .sd-btn--primary {
    background: var(--mash-pulp);
    color: var(--bone);
    border-color: var(--mash-pulp-deep);
  }
  .sd-btn--ghost {
    background: transparent;
    color: var(--fg-muted);
    border-color: var(--line);
  }

  @media (max-width: 460px) {
    .est-row {
      grid-template-columns: 22px 1fr 58px 58px 58px;
      gap: 5px;
      padding: 6px;
    }
    .est-input {
      padding: 4px 5px;
      font-size: 11.5px;
    }
  }
</style>
