<script lang="ts" module>
  // ── reconciliation-modal · sprint-14 (viz, Wave 2) ────────────────────────
  // Generation-time guardrail (decision D2): when a draft is generated the
  // backend recomputes standings from raw votes and diffs them against the
  // gospel `season_standings` table. On a MISMATCH this modal surfaces the
  // per-user stored-vs-computed differences and asks which side wins:
  //   • Use stored table (DEFAULT) — proceed on the gospel values, table
  //     untouched. (Just closes; the caller continues with stored values.)
  //   • Adopt computed — POST { action:'adopt' } overwrites the table with the
  //     AI's computed values (reconcile → match), then proceeds.
  // A match never reaches here (frontend only mounts on mismatch); we also
  // self-guard and render nothing if handed a match/empty payload.
  //
  // MOUNT CONTRACT for frontend (fed from the POST /draft response's
  // `reconcile` block, or a GET /standings reconcile):
  //   <ReconciliationModal
  //     roundId={…} reconcile={draftResponse.reconcile}
  //     onClose={() => /* proceed on stored table */}
  //     onAdopted={(result) => /* proceed; re-render chart from computed */}
  //     onError={(msg) => …} />
  //
  // Endpoint (backend 48e56cd):
  //   POST /api/digest/:roundId/standings { action:'adopt' } → StandingsResult
  import type { Reconcile, ReconcileField, StandingsResult } from '$lib/db/standings.js';

  const FIELD_LABEL: Record<ReconcileField, string> = {
    priorTotal: 'Prior total',
    roundPoints: 'Round points',
    currentTotal: 'Current total',
    rank: 'Rank',
    prevRank: 'Prev rank',
  };
  const fmt = (n: number | null) => (n == null ? '—' : String(n));
</script>

<script lang="ts">
  type Props = {
    roundId: number;
    reconcile: Reconcile;
    /** "Use stored table" — proceed on gospel values, table untouched. */
    onClose: () => void;
    /** After adopt persists; carries the fresh computed-as-gospel payload. */
    onAdopted?: (result: StandingsResult) => void;
    onError?: (msg: string) => void;
  };
  let { roundId, reconcile, onClose, onAdopted, onError }: Props = $props();

  const isMismatch = $derived(reconcile?.status === 'mismatch' && (reconcile?.diffs?.length ?? 0) > 0);

  let adopting = $state(false);
  let errorMsg = $state('');

  const presenceLabel = (p: 'stored-only' | 'computed-only' | undefined) =>
    p === 'stored-only'
      ? 'in table only · not in computed'
      : p === 'computed-only'
        ? 'computed only · not in table'
        : '';

  async function adopt() {
    adopting = true;
    errorMsg = '';
    try {
      const res = await fetch(`/api/digest/${roundId}/standings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'adopt' }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`adopt failed (${res.status}) ${t.slice(0, 160)}`);
      }
      const result = (await res.json()) as StandingsResult;
      onAdopted?.(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errorMsg = msg;
      onError?.(msg);
    } finally {
      adopting = false;
    }
  }

  function handleScrim(e: MouseEvent) {
    // Scrim click = the default "use stored table" choice.
    if (e.target === e.currentTarget && !adopting) onClose();
  }
  function handleScrimKey(e: KeyboardEvent) {
    if (e.target === e.currentTarget && !adopting && (e.key === 'Enter' || e.key === ' ')) onClose();
  }
  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && isMismatch && !adopting) onClose();
  }
</script>

<svelte:window onkeydown={handleKey} />

{#if isMismatch}
  <div
    class="dg-modal-scrim"
    onclick={handleScrim}
    onkeydown={handleScrimKey}
    role="dialog"
    aria-modal="true"
    aria-label="Standings reconciliation"
    tabindex="-1"
  >
    <div class="dg-modal rec-modal">
      <header class="dg-modal-head">
        <h3>Standings · <span style="color: var(--amber);">mismatch</span></h3>
        <button type="button" class="x" onclick={onClose} aria-label="Close" disabled={adopting}
          >✕</button
        >
      </header>

      <div class="dg-modal-body">
        <p class="rec-lede">
          The stored table and the AI's freshly-computed standings disagree for
          <strong>{reconcile.diffs.length}</strong> competitor{reconcile.diffs.length === 1
            ? ''
            : 's'}. The table is the source the digest renders from — keep it, or adopt the computed
          values as the new gospel.
        </p>

        <div class="rec-legend">
          <span><i class="rec-sw rec-sw--stored"></i>stored (table)</span>
          <span><i class="rec-sw rec-sw--computed"></i>computed (AI)</span>
        </div>

        <div class="rec-diffs">
          {#each reconcile.diffs as d (d.competitorId)}
            <div class="rec-diff">
              <div class="rec-diff-head">
                <span class="rec-name">{d.name}</span>
                {#if d.presence}
                  <span class="rec-presence">{presenceLabel(d.presence)}</span>
                {/if}
              </div>
              {#if d.fields.length}
                <div class="rec-fields">
                  {#each d.fields as f (f.field)}
                    <div class="rec-field">
                      <span class="rec-field-lbl">{FIELD_LABEL[f.field] ?? f.field}</span>
                      <span class="rec-val rec-val--stored">{fmt(f.stored)}</span>
                      <span class="rec-arrow">vs</span>
                      <span class="rec-val rec-val--computed">{fmt(f.computed)}</span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>

        {#if errorMsg}<p class="rec-error">{errorMsg}</p>{/if}
      </div>

      <footer class="dg-modal-foot">
        <span class="cost">{adopting ? 'adopting…' : 'default · keep the stored table'}</span>
        <div class="rec-actions">
          <button
            type="button"
            class="sd-btn sd-btn--secondary sd-btn--sm"
            onclick={adopt}
            disabled={adopting}>Adopt computed</button
          >
          <button
            type="button"
            class="sd-btn sd-btn--primary sd-btn--sm"
            onclick={onClose}
            disabled={adopting}>✓ Use stored table</button
          >
        </div>
      </footer>
    </div>
  </div>
{/if}

<style>
  .rec-modal {
    max-width: 560px;
    width: min(94vw, 560px);
  }
  .rec-lede {
    margin: 0;
    font: 400 13px/1.55 var(--font-body);
    color: var(--fg-2);
  }
  .rec-lede strong {
    color: var(--fg);
  }

  .rec-legend {
    display: flex;
    gap: 16px;
  }
  .rec-legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font: 500 9.5px/1.4 var(--font-mono);
    letter-spacing: 0.02em;
    color: var(--fg-quiet);
    text-transform: uppercase;
  }
  .rec-sw {
    width: 12px;
    height: 9px;
    border-radius: 2px;
    display: inline-block;
  }
  .rec-sw--stored {
    background: var(--ink-5);
  }
  .rec-sw--computed {
    background: var(--amber);
  }

  .rec-diffs {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 50vh;
    overflow-y: auto;
  }
  .rec-diff {
    padding: 9px 11px;
    border: 1px solid var(--line);
    border-left: 2px solid var(--amber);
    border-radius: 0 var(--r-2) var(--r-2) 0;
    background: var(--ink-0);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .rec-diff-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .rec-name {
    font: 700 12.5px/1.2 var(--font-body);
    color: var(--fg);
  }
  .rec-presence {
    font: 600 9px/1.2 var(--font-mono);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--amber);
  }
  .rec-fields {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .rec-field {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    align-items: baseline;
    gap: 8px;
  }
  .rec-field-lbl {
    font: 600 9.5px/1.2 var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-quiet);
  }
  .rec-val {
    font: 700 12.5px/1 var(--font-mono);
    font-variant-numeric: tabular-nums;
    min-width: 28px;
    text-align: right;
  }
  .rec-val--stored {
    color: var(--fg-2);
  }
  .rec-val--computed {
    color: var(--amber);
  }
  .rec-arrow {
    font: 500 10px/1 var(--font-mono);
    color: var(--fg-quiet);
  }

  .rec-error {
    margin: 0;
    font: 600 12px/1.5 var(--font-mono);
    color: var(--ember);
  }

  .rec-actions {
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
  .sd-btn--secondary {
    background: var(--surface-2);
    color: var(--fg);
    border-color: var(--line-strong);
  }

  @media (max-width: 460px) {
    .rec-field {
      grid-template-columns: 1fr auto auto auto;
      gap: 5px;
    }
  }
</style>
