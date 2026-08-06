<script lang="ts" module>
  // ── guesser-render · the-guesser sprint (viz) ─────────────────────────────
  // Visual form of the frontend-only synthetic 'guesser' section: "The
  // Guesser" — a deterministic ledger of one player's habit of guessing who
  // submitted each song from their vote comments. Modeled on ChatMoments.svelte
  // (dual web/export mode via `?export=1`), but — like DigestInsights (the
  // 'stats' precedent) — reads its heavy payload from the `data` prop
  // (visualData = GuesserData), NOT from `content`. `content` here is only the
  // optional editable caption ({ title, body }), same convention as `stats`.
  //
  // Implements the frontend VARIANT SLOT INTERFACE (`VisualComponentProps` in
  // variants.ts). Frontend registers this for kind 'guesser'
  // (VISUAL_CAPABLE.guesser = true, VISUAL_COMPONENTS.guesser = this file).
  // Mounted as:
  //   <GuesserLeaderboard kind="guesser" content={...} data={guesserData} variant="visual" />
  //
  // Reads GuesserData (ui/src/lib/db/guesserInsights.ts):
  //   {
  //     guesserName: string | null,
  //     weekly: { attempts, correct, rate, guesses[] },
  //     drunkByThird: { first, middle, last },  // 0..1 accuracy per third of the round
  //     eludesHim: GuesserLeaderRow[],           // hardest-to-guess submitters
  //     alwaysNails: GuesserLeaderRow[],         // easiest-to-guess submitters
  //     littermates: { aName, bName, swaps } | null,
  //   }
  // Defensive throughout: null/empty leaderboards and a null littermates pair
  // all render an explicit empty state rather than an empty table.
  import type { VisualComponentProps } from './variants.js';
  import type { GuesserData } from '../db/guesserInsights.js';
</script>

<script lang="ts">
  import { page } from '$app/state';

  let { content, data }: VisualComponentProps = $props();

  const g = $derived((data ?? null) as GuesserData | null);
  const caption = $derived((content ?? {}) as { title?: string; body?: string });

  const guesserName = $derived(g?.guesserName ?? null);
  const weekly = $derived(g?.weekly ?? { attempts: 0, correct: 0, rate: 0, guesses: [] });
  const drunkByThird = $derived(g?.drunkByThird ?? { first: 0, middle: 0, last: 0 });
  const eludesHim = $derived(g?.eludesHim ?? []);
  const alwaysNails = $derived(g?.alwaysNails ?? []);
  const littermates = $derived(g?.littermates ?? null);

  const hasWeekly = $derived(weekly.attempts > 0);

  function pct(rate: number): string {
    return `${Math.round(rate * 100)}%`;
  }

  // Static (PNG/PDF) export renders identically to web here — no interactive
  // affordances in this component to collapse — but the flag is threaded
  // through for parity with ChatMoments/future interactive variants.
  const isExport = $derived(page?.url?.searchParams?.get('export') === '1');
</script>

<div class="gsl" data-component="guesser-render" class:is-export={isExport}>
  <header class="gsl-head">
    <div>
      <span class="gsl-kicker">The Guesser</span>
      <h3>{guesserName ? `${guesserName}'s ledger` : 'The Guesser'}</h3>
    </div>
    <span class="gsl-note">deterministic · no LLM gloss</span>
  </header>

  {#if caption.body}<p class="gsl-user-note">{caption.body}</p>{/if}

  {#if !guesserName}
    <p class="gsl-empty">(no guesser detected for this round)</p>
  {:else}
    <div class="gsl-weekly">
      <div class="gsl-weekly-record">
        {#if hasWeekly}
          <strong>{weekly.correct}<span class="gsl-slash">/</span>{weekly.attempts}</strong>
          <span class="gsl-weekly-label">correct this week</span>
        {:else}
          <strong class="gsl-dim">—</strong>
          <span class="gsl-weekly-label">no guesses this week</span>
        {/if}
      </div>
      <div class="gsl-weekly-rate">
        <strong>{hasWeekly ? pct(weekly.rate) : '—'}</strong>
        <span class="gsl-weekly-label">hit rate</span>
      </div>
    </div>

    <section class="gsl-thirds">
      <div class="gsl-card-head"><span>Drunk by the third round</span><span>accuracy by play order</span></div>
      <div class="gsl-third-grid">
        <div>
          <b>{pct(drunkByThird.first)}</b>
          <span>first third</span>
        </div>
        <div>
          <b>{pct(drunkByThird.middle)}</b>
          <span>middle third</span>
        </div>
        <div>
          <b>{pct(drunkByThird.last)}</b>
          <span>last third</span>
        </div>
      </div>
    </section>

    <section class="gsl-table-block">
      <div class="gsl-card-head"><span>Eludes him</span><span>hardest to guess</span></div>
      {#if eludesHim.length}
        <table class="gsl-table">
          <tbody>
            {#each eludesHim as row (row.playerId)}
              <tr>
                <td class="gsl-name">{row.name}</td>
                <td class="gsl-count">{row.correct}/{row.attempts}</td>
                <td class="gsl-rate">{pct(row.rate)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="gsl-empty">(not enough season data yet)</p>
      {/if}
    </section>

    <section class="gsl-table-block">
      <div class="gsl-card-head"><span>Always nails</span><span>easiest to guess</span></div>
      {#if alwaysNails.length}
        <table class="gsl-table">
          <tbody>
            {#each alwaysNails as row (row.playerId)}
              <tr>
                <td class="gsl-name">{row.name}</td>
                <td class="gsl-count">{row.correct}/{row.attempts}</td>
                <td class="gsl-rate">{pct(row.rate)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="gsl-empty">(not enough season data yet)</p>
      {/if}
    </section>

    <section class="gsl-table-block">
      <div class="gsl-card-head"><span>Littermates</span><span>most-confused pair</span></div>
      {#if littermates}
        <div class="gsl-littermates">
          <span class="gsl-lit-name">{littermates.aName}</span>
          <span class="gsl-lit-swap">⇄ {littermates.swaps}×</span>
          <span class="gsl-lit-name">{littermates.bName}</span>
        </div>
      {:else}
        <p class="gsl-empty">(no recurring mix-up this season)</p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .gsl {
    padding: 16px;
    background: linear-gradient(135deg, var(--surface), var(--ink-0));
    border: 1px solid var(--line);
    border-radius: var(--r-3);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .gsl-head {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 12px;
  }
  .gsl-kicker {
    display: block;
    margin-bottom: 5px;
    color: var(--mash-pulp);
    font: 700 9px/1 var(--font-mono);
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }
  .gsl-head h3 {
    margin: 0;
    color: var(--fg);
    font: 600 16px/1.1 var(--font-display);
  }
  .gsl-note {
    color: var(--fg-quiet);
    font: 600 9px/1.2 var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .gsl-user-note {
    margin: 0;
    color: var(--fg-2);
    font: 500 12px/1.5 var(--font-body);
    white-space: pre-wrap;
  }
  .gsl-empty {
    margin: 0;
    color: var(--fg-quiet);
    font: 400 12px/1.4 var(--font-body);
    font-style: italic;
  }

  .gsl-weekly {
    display: flex;
    gap: 12px;
    padding: 14px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-2);
  }
  .gsl-weekly-record,
  .gsl-weekly-rate {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .gsl-weekly-record strong,
  .gsl-weekly-rate strong {
    color: var(--fg);
    font: 700 22px/1.1 var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .gsl-weekly-record .gsl-dim {
    color: var(--fg-quiet);
  }
  .gsl-slash {
    color: var(--fg-quiet);
    font-weight: 500;
    margin: 0 1px;
  }
  .gsl-weekly-label {
    color: var(--fg-muted);
    font: 600 9px/1.2 var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .gsl-card-head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
    color: var(--fg-muted);
    font: 700 10px/1.2 var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .gsl-thirds,
  .gsl-table-block {
    padding: 12px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-2);
  }
  .gsl-third-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .gsl-third-grid div {
    padding: 9px;
    background: var(--ink-0);
    border-radius: var(--r-1);
  }
  .gsl-third-grid b {
    display: block;
    color: var(--fg);
    font: 700 15px/1.1 var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .gsl-third-grid span {
    color: var(--fg-muted);
    font: 600 9px/1.3 var(--font-mono);
    text-transform: uppercase;
  }

  .gsl-table {
    width: 100%;
    border-collapse: collapse;
  }
  .gsl-table td {
    padding: 6px 4px;
    border-bottom: 1px solid var(--line);
    font: 500 12px/1.4 var(--font-body);
    color: var(--fg-2);
  }
  .gsl-table tr:last-child td {
    border-bottom: 0;
  }
  .gsl-table .gsl-name {
    color: var(--fg);
    font-weight: 600;
  }
  .gsl-table .gsl-count {
    color: var(--fg-muted);
    font: 500 11px/1.4 var(--font-mono);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .gsl-table .gsl-rate {
    color: var(--mash-pulp);
    font: 700 12px/1.4 var(--font-mono);
    font-variant-numeric: tabular-nums;
    text-align: right;
    width: 48px;
  }

  .gsl-littermates {
    display: flex;
    align-items: center;
    gap: 8px;
    font: 600 13px/1.3 var(--font-body);
    color: var(--fg);
  }
  .gsl-lit-swap {
    color: var(--mash-pulp);
    font: 700 11px/1 var(--font-mono);
  }

  @media (max-width: 460px) {
    .gsl-third-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }
  }
</style>
