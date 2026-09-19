<script lang="ts">
  // Round research → per-song player analysis (codex Boarz profiles).
  // Two independent LLM runs: "who submitted it" (odds summing to 10) and
  // "how many points would each player give it". Both read the codex-generated
  // player profiles server-side; results are cached in prediction_runs.
  import type { SubmitterOddsResult } from '$lib/predict/tasks/submitterOdds.js';
  import type { VoteForecastResult } from '$lib/predict/tasks/voteForecast.js';

  let { roundId, spotifyUri }: { roundId: number; spotifyUri: string } = $props();

  let busyKind = $state<'submitter-odds' | 'vote-forecast' | null>(null);
  let errorMsg = $state<string | null>(null);
  let odds = $state<SubmitterOddsResult | null>(null);
  let forecast = $state<VoteForecastResult | null>(null);

  const BTN =
    'text-xs font-mono tracking-widest uppercase px-3 py-1.5 rounded-sm border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const BTN_IDLE = 'border-border-muted text-fg-dim hover:border-accent hover:text-fg';
  const BTN_BUSY = 'border-accent text-accent';

  async function run(kind: 'submitter-odds' | 'vote-forecast') {
    if (busyKind) return;
    busyKind = kind;
    errorMsg = null;
    try {
      const res = await fetch(`/api/research/${roundId}/player-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spotifyUri, kind }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `Analysis failed (${res.status})`);
      }
      if (kind === 'submitter-odds') {
        odds = (await res.json()) as SubmitterOddsResult;
      } else {
        forecast = (await res.json()) as VoteForecastResult;
      }
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : 'Analysis failed';
    } finally {
      busyKind = null;
    }
  }

  function metaLine(m: { model: string; costUsd: number | null }, cached: boolean): string {
    const cost = m.costUsd != null ? ` · $${m.costUsd.toFixed(4)}` : '';
    return `${m.model} · ${cached ? 'cached' : 'fresh'}${cost}`;
  }
</script>

<div class="mt-2 px-3 py-2.5 rounded-lg bg-bg border border-border-muted">
  <div class="flex items-center gap-2 flex-wrap">
    <button
      class={`${BTN} ${busyKind === 'submitter-odds' ? BTN_BUSY : BTN_IDLE}`}
      disabled={busyKind !== null}
      onclick={() => run('submitter-odds')}
    >
      {busyKind === 'submitter-odds' ? 'Analyzing…' : 'Who submitted it?'}
    </button>
    <button
      class={`${BTN} ${busyKind === 'vote-forecast' ? BTN_BUSY : BTN_IDLE}`}
      disabled={busyKind !== null}
      onclick={() => run('vote-forecast')}
    >
      {busyKind === 'vote-forecast' ? 'Predicting…' : 'Predict their votes'}
    </button>
  </div>

  {#if errorMsg}
    <p class="font-mono text-xs text-warn mt-2">{errorMsg}</p>
  {/if}

  {#if odds}
    <div class="mt-3">
      <div class="flex items-baseline justify-between mb-1.5">
        <h4 class="font-mono text-[11px] tracking-widest uppercase text-fg-faint">Submitter odds</h4>
        <span class="font-mono text-[10px] text-fg-faint">{metaLine(odds.meta, odds.cacheHit)}</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-x-6">
        {#each odds.players as p (p.name)}
          <div class="flex justify-between items-baseline py-0.5 border-b border-border-muted/40">
            <span class="text-sm text-fg truncate">
              {p.name}{#if p.competitorName !== p.name}<span class="text-fg-faint text-xs"> ({p.competitorName})</span>{/if}
            </span>
            <span class="font-mono text-sm ml-2">{p.score.toFixed(1)}</span>
          </div>
        {/each}
      </div>
      <p class="font-mono text-[10px] text-fg-faint mt-1">
        Sums to {odds.players.reduce((a, p) => a + p.score, 0).toFixed(1)} of 10.0
      </p>
      {#if odds.top3.length}
        <div class="mt-2.5">
          <h4 class="font-mono text-[11px] tracking-widest uppercase text-fg-faint mb-1">Why the top 3</h4>
          {#each odds.top3 as p (p.name)}
            <p class="text-sm text-fg-dim leading-snug">
              <span class="text-fg font-medium">{p.name} ({p.score.toFixed(1)})</span>
              {#if p.note} — {p.note}{/if}
            </p>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if forecast}
    <div class="mt-3">
      <div class="flex items-baseline justify-between mb-1.5">
        <h4 class="font-mono text-[11px] tracking-widest uppercase text-fg-faint">Predicted points</h4>
        <span class="font-mono text-[10px] text-fg-faint">{metaLine(forecast.meta, forecast.cacheHit)}</span>
      </div>
      {#each forecast.players as p (p.name)}
        <div class="py-1 border-b border-border-muted/40">
          <div class="flex justify-between items-baseline">
            <span class="text-sm text-fg truncate">
              {p.name}{#if p.competitorName !== p.name}<span class="text-fg-faint text-xs"> ({p.competitorName})</span>{/if}
            </span>
            <span class="font-mono text-sm ml-2">{p.points.toFixed(1)} pts</span>
          </div>
          {#if p.note}
            <p class="text-xs text-fg-faint leading-snug">{p.note}</p>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
